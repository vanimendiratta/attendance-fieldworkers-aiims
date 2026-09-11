const express = require('express');
const router = express.Router();
const db = require('../db/database');
const attendanceService = require('../services/attendance_service');
const geoService = require('../services/geo_service');
const redcapClient = require('../redcap/redcap_client');
const teamService = require('../services/team_service');
const biometricService = require('../services/biometric_service');
const { STATE_DISTRICTS_MAP, getAllStates, getDistrictsForState, matchStateAndDistrict } = require('../data/india_states_districts');
const authService = require('../services/auth_service');

function isProductionEnvironment() {
  const env = (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase().trim();
  return env === 'production';
}

function resolveEmployerId(req) {
  return req.headers['x-employer-id'] || req.query.employer_id || req.body?.employer_id || 'ORG-001';
}

// Helper to resolve employee identity
function resolveEmployee(req) {
  const empId = req.headers['x-employee-id'] || req.query.employee_id || req.body?.employee_id;
  if (!empId) return null;
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
}

// 1. Organization Details & Policy
router.get('/organization', (req, res) => {
  const employerId = resolveEmployerId(req);
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(employerId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }
  const { admin_password, ...safeOrg } = org;
  res.json({ success: true, organization: safeOrg });
});

// 2. All Organizations (for multi-tenant employer switcher)
router.get('/organizations', (req, res) => {
  const orgs = db.prepare('SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, timezone FROM organizations WHERE is_active = 1').all();
  res.json({ success: true, organizations: orgs });
});

// 3. Employee List for Employer (filtered by employer_id with Team & Territory info)
router.get('/employees', (req, res) => {
  const employerId = resolveEmployerId(req);
  const employees = db.prepare(`
    SELECT e.id, e.employer_id, e.name, e.email, e.department, e.designation, e.is_admin, e.is_active,
           e.team_id, e.state, e.district, COALESCE(t.name, 'Unassigned') as team_name
    FROM employees e
    LEFT JOIN teams t ON e.team_id = t.id
    WHERE e.employer_id = ?
  `).all(employerId);
  res.json({ success: true, employees });
});

// 3b. Delete Employee (permanently purges record and associated biometric descriptor)
router.delete('/employees/:id', (req, res) => {
  const employerId = resolveEmployerId(req);
  const empId = req.params.id;
  const employee = db.prepare('SELECT id, name, employer_id FROM employees WHERE id = ? AND employer_id = ?').get(empId, employerId);
  if (!employee) {
    return res.status(404).json({ success: false, error: 'Employee not found for this employer organization.' });
  }

  db.prepare('DELETE FROM employees WHERE id = ?').run(empId);
  res.json({ success: true, message: `Employee ${employee.name} (${empId}) and all associated biometric descriptors permanently purged.` });
});

// 4. EMPLOYEE LOGIN with ID & Password (against backend details of each employer)
router.post('/auth/employee/login', authService.rateLimitMiddleware(authService.loginRateLimiter, 'Login'), (req, res) => {
  const { employer_id, login_id, password } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (!employer_id) {
    return res.status(400).json({ success: false, error: 'Employer ID is required.' });
  }
  if (!login_id || !password) {
    return res.status(400).json({ success: false, error: 'Both Employee ID/Email and Password are required.' });
  }

  const employer = db.prepare('SELECT * FROM organizations WHERE id = ?').get(employer_id);
  if (!employer) {
    return res.status(404).json({ success: false, error: 'Employer organization not found.' });
  }

  // Find employee under this employer with Team details
  const employee = db.prepare(`
    SELECT e.*, COALESCE(t.name, 'Unassigned') as team_name
    FROM employees e
    LEFT JOIN teams t ON e.team_id = t.id
    WHERE e.employer_id = ? AND (e.id = ? OR e.email = ?)
  `).get(employer_id, login_id, login_id);

  if (!employee) {
    attendanceService.logAudit('AUTH_FAILED_USER_NOT_FOUND', null, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id }, clientIp, userAgent);
    return res.status(401).json({ success: false, error: 'Invalid Employee ID or credentials for this employer.' });
  }

  // Check password against backend details using constant-time verification & scrypt support
  const isMatch = authService.verifyPassword(password, employee.password) || (employee.pin && authService.verifyPassword(password, employee.pin));
  if (!isMatch) {
    attendanceService.logAudit('AUTH_FAILED_INVALID_PASSWORD', employee.id, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id }, clientIp, userAgent);
    return res.status(401).json({ success: false, error: 'Invalid password. Please check backend employee details and try again.' });
  }

  // Auto-upgrade legacy unhashed password to salted scrypt hash upon successful login
  if (employee.password && !employee.password.startsWith('scrypt$')) {
    try {
      const newHash = authService.hashPassword(password);
      db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(newHash, employee.id);
    } catch (migErr) {
      // non-fatal
    }
  }

  if (!employee.is_active) {
    attendanceService.logAudit('AUTH_FAILED_INACTIVE', employee.id, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', {}, clientIp, userAgent);
    return res.status(403).json({ success: false, error: 'Account is deactivated. Please contact your employer administrator.' });
  }

  attendanceService.logAudit('EMPLOYEE_LOGIN_SUCCESS', employee.id, employer_id, 'EMPLOYEE_LOGIN', 'SUCCESS', {}, clientIp, userAgent);

  // Strictly strip sensitive credentials and biometric descriptors from returned employee profile
  const { password: _, pin: __, face_descriptor: ___, face_photo: ____, ...safeEmployee } = employee;
  const { admin_password: _____, ...safeEmployer } = employer;

  res.json({
    success: true,
    message: `Welcome back, ${employee.name}!`,
    employee: safeEmployee,
    employer: safeEmployer
  });
});

// Helper to generate next sequential employee ID atomically using database sequences
function generateEmployeeId(employerId = 'ORG-001') {
  const getSeqStmt = db.prepare(`
    INSERT INTO employee_sequences (employer_id, last_seq)
    VALUES (?, 1001)
    ON CONFLICT(employer_id) DO UPDATE SET last_seq = last_seq + 1
    RETURNING last_seq;
  `);
  const row = getSeqStmt.get(employerId);
  return `EMP-${row.last_seq}`;
}

// 4a. EMPLOYEE SIGN UP (Registration with basic enquiries + face biometric enrollment)
router.post('/auth/employee/signup', authService.rateLimitMiddleware(authService.signupRateLimiter, 'Signup'), (req, res) => {
  const {
    name,
    employee_id,
    email,
    phone,
    employer_id = 'ORG-001',
    department = 'Dental',
    designation = 'PRS-1',
    state,
    district,
    password,
    face_photo,
    face_descriptor
  } = req.body;

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Full Name is required.' });
  }

  const manualEmpId = employee_id ? employee_id.trim() : '';
  if (!manualEmpId && (!email || !email.trim())) {
    return res.status(400).json({ success: false, error: 'Employee ID is required.' });
  }

  // Enforce password security policy
  const policyCheck = authService.validatePasswordPolicy(password);
  if (!policyCheck.valid) {
    return res.status(400).json({ success: false, error: policyCheck.error });
  }

  // Cross-validate State and District
  if (state && String(state).trim()) {
    const validStates = getAllStates();
    const cleanState = String(state).trim();
    const matchedStateName = validStates.find(s => s.toLowerCase() === cleanState.toLowerCase());
    if (!matchedStateName) {
      return res.status(400).json({ success: false, error: `Invalid State/UT '${state}'. Please select a valid Indian State or Union Territory.` });
    }
    if (district && String(district).trim()) {
      const cleanDistrict = String(district).trim();
      const validDistricts = getDistrictsForState(matchedStateName);
      const matchedDistName = validDistricts.find(d => d.toLowerCase() === cleanDistrict.toLowerCase());
      if (!matchedDistName) {
        return res.status(400).json({ success: false, error: `District '${district}' does not belong to State '${matchedStateName}'. Please select a valid district.` });
      }
    }
  } else if (district && String(district).trim()) {
    return res.status(400).json({ success: false, error: 'State must be specified when district is provided.' });
  }

  const effectiveOrgId = employer_id || 'ORG-001';
  const employer = db.prepare('SELECT * FROM organizations WHERE id = ?').get(effectiveOrgId) 
    || db.prepare('SELECT * FROM organizations WHERE id = ?').get('ORG-001');
  if (!employer) {
    return res.status(404).json({ success: false, error: 'Employer organization not found.' });
  }

  const newEmpId = manualEmpId || generateEmployeeId(effectiveOrgId);

  // Check if manual employee ID already exists
  const existingById = db.prepare('SELECT id, name FROM employees WHERE id = ?').get(newEmpId);
  if (existingById) {
    return res.status(409).json({ success: false, error: `Employee ID '${newEmpId}' is already registered. Please sign in or enter a different ID.` });
  }

  // Derive unique corporate email if not entered manually
  const finalEmail = (email && email.trim())
    ? email.trim().toLowerCase()
    : `${newEmpId.toLowerCase().replace(/[^a-z0-9_-]/g, '')}@aiims.internal`;

  // Check if email already registered
  const existingEmp = db.prepare('SELECT id, email FROM employees WHERE email = ?').get(finalEmail);
  if (existingEmp) {
    return res.status(409).json({ success: false, error: 'An employee account with this ID or Email already exists. Please sign in.' });
  }

  // Resolve matching regional team if state & district provided
  let teamId = null;
  if (state && district) {
    const matchedTeam = db.prepare('SELECT id FROM teams WHERE employer_id = ? AND state = ? AND district = ? LIMIT 1').get(effectiveOrgId, state, district);
    if (matchedTeam) {
      teamId = matchedTeam.id;
    } else {
      const stateTeam = db.prepare('SELECT id FROM teams WHERE employer_id = ? AND state = ? LIMIT 1').get(effectiveOrgId, state);
      if (stateTeam) teamId = stateTeam.id;
    }
  }

  const now = new Date().toISOString();
  let descriptorToSave = null;
  let hasFaceEnrolled = 0;

  if (face_descriptor) {
    descriptorToSave = Array.isArray(face_descriptor) ? JSON.stringify(face_descriptor) : String(face_descriptor);
    hasFaceEnrolled = 1;
  } else if (face_photo) {
    descriptorToSave = JSON.stringify(biometricService.createDeterministicDescriptor(face_photo.slice(-500)));
    hasFaceEnrolled = 1;
  }

  // Hash password using scrypt
  const hashedPassword = authService.hashPassword(password);

  db.prepare(`
    INSERT INTO employees (
      id, employer_id, name, email, phone, department, designation,
      pin, password, face_photo, face_descriptor, face_enrolled,
      is_active, is_admin, team_id, state, district, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newEmpId,
    effectiveOrgId,
    name.trim(),
    finalEmail,
    phone ? phone.trim() : null,
    department ? department.trim() : 'Dental',
    designation ? designation.trim() : 'PRS-1',
    '1234',
    hashedPassword,
    null, // Raw camera frames are never persisted to database
    descriptorToSave,
    hasFaceEnrolled,
    1,
    0,
    teamId,
    state || null,
    district || null,
    now
  );

  attendanceService.logAudit('EMPLOYEE_SIGNUP_SUCCESS', newEmpId, effectiveOrgId, 'EMPLOYEE_SIGNUP', 'SUCCESS', {
    name: name.trim(),
    email: finalEmail,
    department: department ? department.trim() : 'Dental',
    face_enrolled: hasFaceEnrolled
  }, clientIp, userAgent);

  const createdEmployee = db.prepare(`
    SELECT e.*, COALESCE(t.name, 'Direct Assignment') as team_name
    FROM employees e
    LEFT JOIN teams t ON e.team_id = t.id
    WHERE e.id = ?
  `).get(newEmpId);

  const { password: _, pin: __, face_descriptor: ___, ...safeEmployee } = createdEmployee;
  const { admin_password: ____, ...safeEmployer } = employer;

  res.status(201).json({
    success: true,
    message: `Account created successfully! Welcome to ${employer.name}, ${name.trim()}.`,
    employee: safeEmployee,
    employer: safeEmployer
  });
});

// 4b. EMPLOYEE FACE LOGIN (Screenlock-style biometric unlock)
router.post('/auth/employee/face-login', authService.rateLimitMiddleware(authService.faceRateLimiter, 'Face Unlock'), (req, res) => {
  const { employer_id, face_descriptor, face_photo, mock_employee_id } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  let candidateDescriptor = face_descriptor;

  // If mock_employee_id passed: strictly forbid in production
  if (mock_employee_id) {
    if (isProductionEnvironment()) {
      return res.status(403).json({ success: false, error: 'Demo quick-unlock is disabled in production environment.' });
    }
    const demoEmp = db.prepare('SELECT * FROM employees WHERE id = ?').get(mock_employee_id);
    if (demoEmp && demoEmp.face_descriptor) {
      candidateDescriptor = demoEmp.face_descriptor;
    } else if (demoEmp) {
      candidateDescriptor = biometricService.createDeterministicDescriptor(demoEmp.name);
    }
  } else if (!candidateDescriptor && face_photo) {
    candidateDescriptor = biometricService.createDeterministicDescriptor(face_photo.slice(-500));
  }

  if (!candidateDescriptor) {
    return res.status(400).json({ success: false, error: 'No face biometric data captured from camera.' });
  }

  const matchResult = biometricService.matchFaceToEmployee(candidateDescriptor, employer_id);

  if (!matchResult.match) {
    attendanceService.logAudit('AUTH_FAILED_FACE_MISMATCH', null, employer_id || 'UNKNOWN', 'FACE_UNLOCK', 'BLOCKED', {
      bestScore: matchResult.bestScore
    }, clientIp, userAgent);
    return res.status(401).json({
      success: false,
      error: 'Face not recognized. Please align your face in the reticle or sign in with ID and password.'
    });
  }

  const matchedEmp = matchResult.employee;
  const employer = db.prepare('SELECT * FROM organizations WHERE id = ?').get(matchedEmp.employer_id);

  attendanceService.logAudit('EMPLOYEE_FACE_LOGIN_SUCCESS', matchedEmp.id, matchedEmp.employer_id, 'FACE_UNLOCK', 'SUCCESS', {
    confidence: matchResult.confidence
  }, clientIp, userAgent);

  const { admin_password: _, ...safeEmployer } = employer;

  res.json({
    success: true,
    message: `Face recognized! Welcome back, ${matchedEmp.name}.`,
    employee: matchedEmp,
    employer: safeEmployer,
    confidence: matchResult.confidence
  });
});

// 4c. ENROLL FACE FOR EXISTING EMPLOYEE
router.post('/auth/employee/enroll-face', (req, res) => {
  const { employee_id, face_photo, face_descriptor } = req.body;
  if (!employee_id) {
    return res.status(400).json({ success: false, error: 'Employee ID is required.' });
  }
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!employee) {
    return res.status(404).json({ success: false, error: 'Employee not found.' });
  }

  biometricService.enrollEmployeeFace(employee_id, face_photo, face_descriptor);

  res.json({
    success: true,
    message: `Biometric Face ID successfully enrolled for ${employee.name}!`
  });
});

// 4d. DEMO FACE RECOGNITION CREDENTIALS
router.get('/auth/demo-face-credentials', (req, res) => {
  if (isProductionEnvironment()) {
    return res.status(403).json({ success: false, error: 'Demo credentials endpoint is disabled in production environment.' });
  }

  const demoEmployees = db.prepare(`
    SELECT e.id, e.name, e.department, e.designation, e.employer_id, o.name as employer_name, e.face_enrolled
    FROM employees e
    JOIN organizations o ON e.employer_id = o.id
    WHERE e.is_active = 1
    ORDER BY e.id ASC
    LIMIT 6
  `).all();
  res.json({ success: true, demoEmployees });
});

// 5. EMPLOYER / ADMIN LOGIN with ID & Password (against backend details of each employer)
router.post('/auth/employer/login', authService.rateLimitMiddleware(authService.loginRateLimiter, 'Employer Login'), (req, res) => {
  const { employer_id, admin_username, admin_password } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (!employer_id || !admin_username || !admin_password) {
    return res.status(400).json({ success: false, error: 'Employer ID, Admin Username, and Admin Password are required.' });
  }

  const employer = db.prepare('SELECT * FROM organizations WHERE id = ?').get(employer_id);
  if (!employer) {
    return res.status(404).json({ success: false, error: 'Employer organization not found.' });
  }

  // Verify credentials against employer backend record
  const usernameMatch = employer.admin_username.toLowerCase() === admin_username.trim().toLowerCase();
  const passwordMatch = authService.verifyPassword(admin_password, employer.admin_password);

  if (!usernameMatch || !passwordMatch) {
    attendanceService.logAudit('ADMIN_AUTH_FAILED', null, employer_id, 'EMPLOYER_LOGIN', 'BLOCKED', { admin_username }, clientIp, userAgent);
    return res.status(401).json({ success: false, error: 'Invalid Employer Admin credentials according to backend records.' });
  }

  attendanceService.logAudit('ADMIN_LOGIN_SUCCESS', null, employer_id, 'EMPLOYER_LOGIN', 'SUCCESS', { admin_username }, clientIp, userAgent);

  const { admin_password: _, ...safeEmployer } = employer;
  res.json({
    success: true,
    message: `Authenticated as Employer Administrator for ${employer.name}`,
    employer: safeEmployer,
    admin_session: {
      employer_id: employer.id,
      admin_username: employer.admin_username,
      authenticated_at: new Date().toISOString()
    }
  });
});

// 6. LOGOUT
router.post('/auth/logout', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const employeeId = req.body?.employee_id || req.headers['x-employee-id'];
  const employerId = req.body?.employer_id || req.headers['x-employer-id'];

  attendanceService.logAudit('USER_LOGOUT', employeeId || null, employerId || null, 'LOGOUT', 'SUCCESS', {}, clientIp, userAgent);
  res.json({ success: true, message: 'Logged out successfully.' });
});

// 7. Current Attendance Status
router.get('/attendance/current', (req, res) => {
  const employee = resolveEmployee(req);
  if (!employee) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Please log in with your Employee credentials.' });
  }

  const activeSession = attendanceService.getActiveSession(employee.id);
  if (!activeSession) {
    const org = db.prepare('SELECT timezone FROM organizations WHERE id = ?').get(employee.employer_id);
    const orgTimezone = org?.timezone || 'Asia/Kolkata';
    const todayStr = attendanceService.getLocalDateString(new Date(), orgTimezone);

    const latestCompleted = db.prepare(`
      SELECT * FROM attendance
      WHERE employee_id = ? AND attendance_status IN ('COMPLETED', 'ANOMALY_FLAGGED')
      ORDER BY updated_at DESC LIMIT 1
    `).get(employee.id);

    const isCompletedToday = latestCompleted && latestCompleted.checkin_server_timestamp &&
      attendanceService.getLocalDateString(new Date(latestCompleted.checkin_server_timestamp), orgTimezone) === todayStr;

    return res.json({
      success: true,
      hasActiveSession: false,
      status: isCompletedToday ? 'SHIFT_COMPLETED_TODAY' : 'NOT_CHECKED_IN',
      alreadyCompletedToday: !!isCompletedToday,
      latestCompleted
    });
  }

  const currentBreak = db.prepare(`
    SELECT * FROM breaks
    WHERE attendance_id = ? AND end_server_timestamp IS NULL
    LIMIT 1
  `).get(activeSession.id);

  const allBreaks = db.prepare(`
    SELECT * FROM breaks
    WHERE attendance_id = ?
    ORDER BY start_server_timestamp ASC
  `).all(activeSession.id);

  res.json({
    success: true,
    hasActiveSession: true,
    session: activeSession,
    status: activeSession.attendance_status,
    currentBreak,
    breaks: allBreaks,
    serverTime: new Date().toISOString()
  });
});

// 8. Check-In Endpoint
router.post('/attendance/check-in', async (req, res) => {
  try {
    const employee = resolveEmployee(req);
    if (!employee) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Please log in with your Employee credentials.' });
    }

    const {
      photo,
      latitude,
      longitude,
      accuracy,
      client_timestamp,
      idempotency_key,
      work_mode,
      field_site_notes,
      team_id,
      state,
      district
    } = req.body;

    if (!photo) {
      return res.status(400).json({ success: false, error: 'Real-time live camera photo is required. Gallery uploads are disabled.' });
    }

    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ success: false, error: 'Real-time device geolocation (latitude, longitude, accuracy) is required.' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await attendanceService.processCheckIn({
      employee,
      photoData: photo,
      latitude,
      longitude,
      accuracy,
      clientTimestamp: client_timestamp,
      idempotencyKey: idempotency_key,
      workMode: work_mode || 'OFFICE',
      fieldSiteNotes: field_site_notes || null,
      teamId: team_id || null,
      state: state || null,
      district: district || null,
      clientIp,
      userAgent
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8b. Real-Time Dynamic Location Preview (Reverse Geocode for Field Work with State & District matching)
router.get('/location/preview', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'Latitude and longitude required.' });
    }
    const address = await geoService.reverseGeocode(parseFloat(lat), parseFloat(lng));
    const matched = matchStateAndDistrict({ state: address, city: address });
    res.json({
      success: true,
      address,
      state: matched.state,
      district: matched.district
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Start Break
router.post('/attendance/break/start', (req, res) => {
  try {
    const employee = resolveEmployee(req);
    if (!employee) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = attendanceService.startBreak(employee.id, clientIp, userAgent);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10. End Break
router.post('/attendance/break/end', (req, res) => {
  try {
    const employee = resolveEmployee(req);
    if (!employee) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = attendanceService.endBreak(employee.id, clientIp, userAgent);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 11. Check-Out Endpoint
router.post('/attendance/check-out', async (req, res) => {
  try {
    const employee = resolveEmployee(req);
    if (!employee) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Please log in with your Employee credentials.' });
    }

    const {
      photo,
      latitude,
      longitude,
      accuracy,
      client_timestamp,
      work_mode,
      field_site_notes
    } = req.body;

    if (!photo) {
      return res.status(400).json({ success: false, error: 'Real-time live camera photo is required for checkout.' });
    }

    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ success: false, error: 'Real-time device geolocation (latitude, longitude, accuracy) is required.' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await attendanceService.processCheckOut({
      employee,
      photoData: photo,
      latitude,
      longitude,
      accuracy,
      clientTimestamp: client_timestamp,
      workMode: work_mode,
      fieldSiteNotes: field_site_notes,
      clientIp,
      userAgent
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Helper for fetching attendance records with tenant isolation and territorial/work_mode filters
function getFilteredAttendanceRecords({ employerId, work_mode, status, state, district, team_id, search }) {
  let query = `
    SELECT a.*, e.name as employee_name, e.department, e.designation, e.email,
           COALESCE(t.name, 'Direct Assignment') as team_name,
           COALESCE(a.state, e.state, t.state) as state,
           COALESCE(a.district, e.district, t.district) as district,
           o.name as employer_name, o.office_name, o.office_lat, o.office_lng, o.geofence_radius_m
    FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
    JOIN organizations o ON a.employer_id = o.id
    WHERE a.employer_id = ?
  `;
  const params = [employerId];

  if (work_mode && work_mode !== 'ALL') {
    query += ` AND a.work_mode = ?`;
    params.push(work_mode);
  }

  if (status && status !== 'ALL') {
    query += ` AND a.attendance_status = ?`;
    params.push(status);
  }

  if (state && state !== 'ALL') {
    query += ` AND (a.state = ? OR (a.state IS NULL AND (e.state = ? OR t.state = ?)))`;
    params.push(state, state, state);
  }

  if (district && district !== 'ALL') {
    query += ` AND (a.district = ? OR (a.district IS NULL AND (e.district = ? OR t.district = ?)))`;
    params.push(district, district, district);
  }

  if (team_id && team_id !== 'ALL') {
    query += ` AND (a.team_id = ? OR (a.team_id IS NULL AND e.team_id = ?))`;
    params.push(team_id, team_id);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    query += ` AND (
      LOWER(e.name) LIKE ? OR
      LOWER(e.id) LIKE ? OR
      LOWER(e.department) LIKE ? OR
      LOWER(COALESCE(t.name, '')) LIKE ? OR
      LOWER(COALESCE(a.state, e.state, t.state, '')) LIKE ? OR
      LOWER(COALESCE(a.district, e.district, t.district, '')) LIKE ? OR
      LOWER(COALESCE(a.field_site_notes, '')) LIKE ? OR
      LOWER(COALESCE(a.checkin_address, '')) LIKE ?
    )`;
    params.push(s, s, s, s, s, s, s, s);
  }

  query += ` ORDER BY a.created_at DESC`;
  return db.prepare(query).all(...params);
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  // OWASP CSV / Excel Formula Injection sanitization
  // If cell begins with =, +, -, @, \t, or \r (including leading whitespace before formula triggers),
  // prepend a single quote to force strict text interpretation in spreadsheet applications
  if (/^[\s\t\r]*[=+\-@\t\r|%]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateAttendanceCsv(records) {
  const headers = [
    'Attendance ID',
    'Employee ID',
    'Employee Name',
    'Department',
    'Designation',
    'Email',
    'Organization',
    'Team Name',
    'State / UT',
    'District',
    'Work Mode',
    'Attendance Status',
    'Check-In Date',
    'Check-In Time',
    'Check-In Server Timestamp (UTC)',
    'Check-In Latitude',
    'Check-In Longitude',
    'Check-In GPS Accuracy (m)',
    'Check-In Geofence Distance (m)',
    'Check-In Geofence Status',
    'Check-In Address',
    'Checkout Date',
    'Checkout Time',
    'Checkout Server Timestamp (UTC)',
    'Checkout Latitude',
    'Checkout Longitude',
    'Checkout GPS Accuracy (m)',
    'Checkout Geofence Distance (m)',
    'Checkout Geofence Status',
    'Checkout Address',
    'Gross Working Hours',
    'Break Minutes',
    'Net Working Hours',
    'Overtime Hours',
    'Field Site Notes',
    'REDCap Sync Status',
    'Created At'
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];

  for (const r of records) {
    const checkinDate = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp).toISOString().split('T')[0] : '';
    const checkinTime = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    const checkoutDate = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toISOString().split('T')[0] : '';
    const checkoutTime = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';

    const row = [
      r.id || '',
      r.employee_id || '',
      r.employee_name || '',
      r.department || '',
      r.designation || '',
      r.email || '',
      r.employer_name || '',
      r.team_name || 'Direct Assignment',
      r.state || '',
      r.district || '',
      r.work_mode === 'FIELD_WORK' ? 'Field Work' : 'Office Duty',
      r.attendance_status || '',
      checkinDate,
      checkinTime,
      r.checkin_server_timestamp || '',
      r.checkin_lat != null ? Number(r.checkin_lat).toFixed(6) : '',
      r.checkin_lng != null ? Number(r.checkin_lng).toFixed(6) : '',
      r.checkin_accuracy != null ? Number(r.checkin_accuracy).toFixed(1) : '',
      r.checkin_geofence_distance != null ? Number(r.checkin_geofence_distance).toFixed(1) : '',
      r.checkin_geofence_status || '',
      r.checkin_address || '',
      checkoutDate,
      checkoutTime,
      r.checkout_server_timestamp || '',
      r.checkout_lat != null ? Number(r.checkout_lat).toFixed(6) : '',
      r.checkout_lng != null ? Number(r.checkout_lng).toFixed(6) : '',
      r.checkout_accuracy != null ? Number(r.checkout_accuracy).toFixed(1) : '',
      r.checkout_geofence_distance != null ? Number(r.checkout_geofence_distance).toFixed(1) : '',
      r.checkout_geofence_status || '',
      r.checkout_address || '',
      r.gross_working_seconds != null ? (r.gross_working_seconds / 3600).toFixed(2) : '0.00',
      r.break_seconds != null ? Math.round(r.break_seconds / 60) : '0',
      r.net_working_seconds != null ? (r.net_working_seconds / 3600).toFixed(2) : '0.00',
      r.overtime_seconds != null ? (r.overtime_seconds / 3600).toFixed(2) : '0.00',
      r.field_site_notes || '',
      r.redcap_sync_status || 'PENDING',
      r.created_at || ''
    ];

    rows.push(row.map(escapeCsvCell).join(','));
  }

  // Prepend UTF-8 BOM (\uFEFF) for immediate, perfect rendering in Microsoft Excel
  return '\uFEFF' + rows.join('\r\n');
}

// 12. Admin: Attendance List with TENANT ISOLATION and Mode, State, District, and Team Filters
router.get('/admin/attendance', (req, res) => {
  const employerId = resolveEmployerId(req);
  const { work_mode, status, state, district, team_id, search } = req.query;

  const records = getFilteredAttendanceRecords({
    employerId,
    work_mode,
    status,
    state,
    district,
    team_id,
    search
  });

  res.json({ success: true, employer_id: employerId, records });
});

// 12a. Admin: Export Attendance Sheet in Excel .CSV Format
router.get('/admin/attendance/export.csv', (req, res) => {
  try {
    const employerId = resolveEmployerId(req);
    const { work_mode, status, state, district, team_id, search } = req.query;

    const records = getFilteredAttendanceRecords({
      employerId,
      work_mode,
      status,
      state,
      district,
      team_id,
      search
    });

    const csvData = generateAttendanceCsv(records);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `attendance_export_${employerId}_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csvData);
  } catch (err) {
    console.error('Error generating attendance CSV export:', err);
    res.status(500).json({ error: 'Failed to export attendance CSV' });
  }
});

// 13. Admin: Simultaneous Multi-State and District Attendance Matrix
router.get('/admin/attendance/matrix', (req, res) => {
  try {
    const employerId = resolveEmployerId(req);
    const { date } = req.query;
    const matrix = teamService.getMultiStateAttendanceMatrix(employerId, date);
    res.json({
      success: true,
      employer_id: employerId,
      totalActive: matrix.total_active,
      activeStatesCount: matrix.total_states_active,
      matrix
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Admin: Single Attendance Detailed Timeline
router.get('/admin/attendance/:id', (req, res) => {
  const employerId = resolveEmployerId(req);
  const record = db.prepare(`
    SELECT a.*, e.name as employee_name, e.department, e.designation, e.email,
           COALESCE(t.name, 'Direct Assignment') as team_name,
           COALESCE(a.state, e.state, t.state) as state,
           COALESCE(a.district, e.district, t.district) as district,
           o.name as employer_name, o.office_name, o.office_lat, o.office_lng, o.geofence_radius_m, o.max_gps_accuracy_m
    FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
    JOIN organizations o ON a.employer_id = o.id
    WHERE a.id = ? AND a.employer_id = ?
  `).get(req.params.id, employerId);

  if (!record) {
    return res.status(404).json({ success: false, error: 'Record not found for this employer.' });
  }

  const breaks = db.prepare(`
    SELECT * FROM breaks
    WHERE attendance_id = ?
    ORDER BY start_server_timestamp ASC
  `).all(record.id);

  const auditEvents = db.prepare(`
    SELECT * FROM audit_logs
    WHERE employer_id = ? AND details_json LIKE ?
    ORDER BY timestamp DESC
  `).all(employerId, `%${record.id}%`);

  res.json({
    success: true,
    record,
    breaks,
    auditEvents
  });
});

// --- STATE, DISTRICT & TEAM ROUTES ---

// 13b. All Indian States & UTs
router.get('/geo/states', (req, res) => {
  res.json({ success: true, states: getAllStates() });
});

// 13c. Districts for a given State
router.get('/geo/districts', (req, res) => {
  const { state } = req.query;
  res.json({ success: true, state, districts: getDistrictsForState(state) });
});

// 13d. Full States and Districts Dictionary
router.get('/geo/states-districts', (req, res) => {
  res.json({ success: true, totalStates: Object.keys(STATE_DISTRICTS_MAP).length, data: STATE_DISTRICTS_MAP });
});

// 13e. List Teams for Employer
router.get('/teams', (req, res) => {
  const employerId = resolveEmployerId(req);
  const { state, district } = req.query;
  const teams = teamService.listTeams(employerId, state, district);
  res.json({ success: true, employer_id: employerId, teams });
});

// 13f. Create Team by State and District
router.post('/teams', (req, res) => {
  try {
    const employerId = resolveEmployerId(req);
    const { name, state, district, description } = req.body;
    const newTeam = teamService.createTeam(employerId, { name, state, district, description });
    res.status(201).json({ success: true, team: newTeam });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 13g. Assign Employee to Team
router.post('/teams/assign', (req, res) => {
  try {
    const employerId = resolveEmployerId(req);
    const { employee_id, team_id } = req.body;
    const result = teamService.assignEmployeeTeam(employerId, employee_id, team_id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});



// 14. Admin: Security Audit Logs with TENANT ISOLATION
router.get('/admin/audit-logs', (req, res) => {
  const employerId = resolveEmployerId(req);
  const limit = Math.min(200, parseInt(req.query.limit || '100', 10));
  const logs = db.prepare(`
    SELECT l.*, e.name as employee_name
    FROM audit_logs l
    LEFT JOIN employees e ON l.employee_id = e.id
    WHERE l.employer_id = ? OR l.employer_id IS NULL
    ORDER BY l.timestamp DESC
    LIMIT ?
  `).all(employerId, limit);

  res.json({ success: true, employer_id: employerId, logs });
});

// 15. Admin: Organization Settings Get & Update for Specific Employer
router.get('/admin/settings', (req, res) => {
  const employerId = resolveEmployerId(req);
  const settings = db.prepare('SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, geofence_policy, shift_hours, timezone, admin_username FROM organizations WHERE id = ?').get(employerId);
  res.json({ success: true, settings });
});

router.post('/admin/settings', (req, res) => {
  const employerId = resolveEmployerId(req);
  const {
    office_name,
    office_lat,
    office_lng,
    geofence_radius_m,
    geofence_policy,
    max_gps_accuracy_m,
    shift_hours,
    timezone
  } = req.body;

  const current = db.prepare('SELECT id FROM organizations WHERE id = ?').get(employerId);
  if (!current) {
    return res.status(404).json({ success: false, error: 'Employer organization not found.' });
  }

  db.prepare(`
    UPDATE organizations
    SET office_name = COALESCE(?, office_name),
        office_lat = COALESCE(?, office_lat),
        office_lng = COALESCE(?, office_lng),
        geofence_radius_m = COALESCE(?, geofence_radius_m),
        geofence_policy = COALESCE(?, geofence_policy),
        max_gps_accuracy_m = COALESCE(?, max_gps_accuracy_m),
        shift_hours = COALESCE(?, shift_hours),
        timezone = COALESCE(?, timezone),
        updated_at = ?
    WHERE id = ?
  `).run(
    office_name,
    office_lat !== undefined ? parseFloat(office_lat) : null,
    office_lng !== undefined ? parseFloat(office_lng) : null,
    geofence_radius_m !== undefined ? parseFloat(geofence_radius_m) : null,
    geofence_policy,
    max_gps_accuracy_m !== undefined ? parseFloat(max_gps_accuracy_m) : null,
    shift_hours !== undefined ? parseFloat(shift_hours) : null,
    timezone,
    new Date().toISOString(),
    current.id
  );

  attendanceService.logAudit('SETTINGS_UPDATED', null, current.id, 'UPDATE_SETTINGS', 'SUCCESS', req.body);

  const updated = db.prepare('SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, geofence_policy, shift_hours, timezone, admin_username FROM organizations WHERE id = ?').get(current.id);
  res.json({ success: true, settings: updated });
});

// 15b. Set Current Live Coordinates as Registered Office Location
router.post('/settings/set-current-office', (req, res) => {
  try {
    const { employer_id, latitude, longitude, office_name } = req.body;
    const empId = employer_id || resolveEmployerId(req);

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'Latitude and longitude required.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    db.prepare(`
      UPDATE organizations
      SET office_lat = ?,
          office_lng = ?,
          office_name = COALESCE(?, office_name),
          max_gps_accuracy_m = MAX(max_gps_accuracy_m, 350),
          updated_at = ?
      WHERE id = ?
    `).run(lat, lng, office_name || 'Current Registered Workplace', new Date().toISOString(), empId);

    attendanceService.logAudit('OFFICE_LOCATION_SYNCED', null, empId, 'SYNC_OFFICE_COORDS', 'SUCCESS', { lat, lng });

    const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(empId);
    res.json({ success: true, message: 'Office location synchronized to your current GPS coordinates.', settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. Admin: REDCap Data
router.get('/admin/redcap/records', (req, res) => {
  const employerId = resolveEmployerId(req);
  const mockData = redcapClient.getMockData();
  const employerRecords = (mockData.records || []).filter(r => r.employer_id === employerId);
  
  res.json({
    success: true,
    employer_id: employerId,
    isLive: redcapClient.isLive,
    apiUrl: redcapClient.apiUrl ? redcapClient.apiUrl.replace(/(token=)([^&]+)/i, '$1****') : null,
    mockData: {
      ...mockData,
      records: employerRecords
    }
  });
});

// 17. Admin: Download Official REDCap CSV Data Dictionary
router.get('/admin/redcap/data-dictionary.csv', (req, res) => {
  const csv = redcapClient.generateDataDictionaryCsv();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="REDCap_Attendance_Data_Dictionary.csv"');
  res.send(csv);
});

module.exports = router;
