'use strict';

const express        = require('express');
const router         = express.Router();
const { query, initSeed } = require('../db/database');
const attendanceService = require('../services/attendance_service');
const geoService     = require('../services/geo_service');
const sqlSyncClient  = require('../services/sql_sync_client');
const teamService    = require('../services/team_service');
const biometricService = require('../services/biometric_service');
const { STATE_DISTRICTS_MAP, getAllStates, getDistrictsForState, matchStateAndDistrict } = require('../data/india_states_districts');
const authService    = require('../services/auth_service');
const sessionService = require('../services/session_service');
const storageService = require('../services/storage_service');
const {
  extractToken,
  requireAuthenticatedEmployee,
  requireAuthenticatedAdmin,
  requireAuthenticatedUser
} = require('../middleware/auth_middleware');

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------
function isProductionEnvironment() {
  const env = (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase().trim();
  return env === 'production';
}

function handleApiError(res, req, err, defaultMsg = 'Internal server error') {
  const safeMsg = (err && err.message) ? String(err.message) : (typeof err === 'string' ? err : defaultMsg);
  console.error(`[API ERROR ${req.method} ${req.originalUrl || req.url}]:`, safeMsg);
  return res.status(500).json({ success: false, error: safeMsg });
}

// ---------------------------------------------------------------------------
// Health check endpoint
// ---------------------------------------------------------------------------
router.get('/health', async (req, res) => {
  try {
    const orgs = await query('SELECT count(*) as count FROM organizations');
    const emps = await query('SELECT count(*) as count FROM employees');
    res.json({
      status: 'healthy',
      database: 'connected',
      organizations: parseInt(orgs.rows[0].count, 10),
      employees: parseInt(emps.rows[0].count, 10),
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'error',
      error: err.message
    });
  }
});

function isDemoBypassAllowed() {
  const nodeEnv    = (process.env.NODE_ENV || '').toLowerCase().trim();
  const appEnv     = (process.env.APP_ENV  || '').toLowerCase().trim();
  const allowBypass = (process.env.ALLOW_DEMO_BYPASS || '').toLowerCase().trim();
  if (nodeEnv === 'production' || appEnv === 'production') return false;
  const isExplicitNonProd = nodeEnv === 'development' || nodeEnv === 'test' || appEnv === 'development' || appEnv === 'test';
  if (!isExplicitNonProd) return false;
  return allowBypass === 'true';
}

function resolveEmployerId(req) {
  return req.employerId || req.headers['x-employer-id'] || req.query.employer_id || req.body?.employer_id || 'ORG-001';
}

async function resolveEmployee(req) {
  if (req.employee) return req.employee;
  const empId = req.headers['x-employee-id'] || req.query.employee_id || req.body?.employee_id;
  if (!empId) return null;
  const result = await query('SELECT * FROM employees WHERE id = $1', [empId]);
  return result.rows[0] || null;
}

// ---------------------------------------------------------------------------
// 1. Organization Details & Policy
// ---------------------------------------------------------------------------
router.get('/organization', async (req, res) => {
  try {
    const employerId = resolveEmployerId(req);
    let result = await query('SELECT * FROM organizations WHERE id = $1', [employerId]);
    if (result.rows.length === 0 && employerId === 'ORG-001') {
      await initSeed();
      result = await query('SELECT * FROM organizations WHERE id = $1', [employerId]);
    }
    const org    = result.rows[0];
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const { admin_password, ...safeOrg } = org;
    res.json({ success: true, organization: safeOrg });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 2. All Organizations (multi-tenant switcher)
// ---------------------------------------------------------------------------
router.get('/organizations', async (req, res) => {
  try {
    let result = await query(
      'SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, timezone FROM organizations WHERE is_active = 1',
      []
    );
    if (result.rows.length === 0) {
      await initSeed();
      result = await query(
        'SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, timezone FROM organizations WHERE is_active = 1',
        []
      );
    }
    res.json({ success: true, organizations: result.rows });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 3. Employee List (filtered by authenticated employer_id)
// ---------------------------------------------------------------------------
router.get('/employees', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const result = await query(
      `SELECT e.id, e.employer_id, e.name, e.email, e.department, e.designation, e.is_admin, e.is_active,
              e.team_id, e.state, e.district, COALESCE(t.name, 'Unassigned') AS team_name
       FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id
       WHERE e.employer_id = $1`,
      [employerId]
    );
    res.json({ success: true, employees: result.rows });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 3b. Delete Employee (Cascades child records cleanly)
// ---------------------------------------------------------------------------
router.delete('/employees/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const empId      = req.params.id;
    const empRes     = await query(
      'SELECT id, name, employer_id FROM employees WHERE id = $1 AND employer_id = $2',
      [empId, employerId]
    );
    const employee = empRes.rows[0];
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found for this employer organization.' });
    }

    // Revoke any active sessions
    await sessionService.revokeUserSessions(empId);

    // Clean up dependent child records to prevent foreign key constraint violations
    await query('DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id = $1)', [empId]);
    await query('DELETE FROM external_sync_records WHERE employee_id = $1', [empId]);
    await query('DELETE FROM attendance WHERE employee_id = $1', [empId]);
    await query('DELETE FROM employees WHERE id = $1 AND employer_id = $2', [empId, employerId]);

    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    attendanceService.logAudit('EMPLOYEE_DELETED', empId, employerId, 'DELETE_EMPLOYEE', 'SUCCESS', { employee_name: employee.name }, clientIp, userAgent);

    res.json({ success: true, message: `Employee ${employee.name} (${empId}) and all associated records permanently deleted.` });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 3c. Update Employee Profile
// ---------------------------------------------------------------------------
router.put('/employees/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const empId      = req.params.id;
    const { name, department, designation, team_id, is_active } = req.body || {};

    const empRes = await query(
      'SELECT * FROM employees WHERE id = $1 AND employer_id = $2',
      [empId, employerId]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const current = empRes.rows[0];
    const newName = name !== undefined ? String(name).trim() : current.name;
    const newDept = department !== undefined ? String(department).trim() : current.department;
    const newDesig = designation !== undefined ? String(designation).trim() : current.designation;
    const newTeam = team_id !== undefined ? team_id : current.team_id;
    const newActive = is_active !== undefined ? (is_active ? 1 : 0) : current.is_active;

    await query(
      `UPDATE employees
       SET name = $1, department = $2, designation = $3, team_id = $4, is_active = $5, updated_at = $6
       WHERE id = $7 AND employer_id = $8`,
      [newName, newDept, newDesig, newTeam, newActive, new Date().toISOString(), empId, employerId]
    );

    res.json({ success: true, message: 'Employee profile updated successfully.' });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 4. Employee Login
// ---------------------------------------------------------------------------
router.post('/auth/employee/login', authService.rateLimitMiddleware(authService.loginRateLimiter, 'Login'), async (req, res) => {
  try {
    const { employer_id, login_id, employee_id, password } = req.body;
    const effectiveLoginId = (login_id || employee_id || '').trim();
    const clientIp         = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent        = req.headers['user-agent'] || 'Unknown';

    if (!employer_id) return res.status(400).json({ success: false, error: 'Employer ID is required.' });
    if (!effectiveLoginId || !password) return res.status(400).json({ success: false, error: 'Both Employee ID/Email and Password are required.' });

    let employerRes = await query('SELECT * FROM organizations WHERE id = $1', [employer_id]);
    if (employerRes.rows.length === 0 && employer_id === 'ORG-001') {
      await initSeed();
      employerRes = await query('SELECT * FROM organizations WHERE id = $1', [employer_id]);
    }
    const employer    = employerRes.rows[0];
    if (!employer) {
      attendanceService.logAudit('AUTH_FAILED_ORG_NOT_FOUND', null, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id: effectiveLoginId }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password.' });
    }

    const empRes = await query(
      `SELECT e.*, COALESCE(t.name, 'Unassigned') AS team_name
       FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id
       WHERE e.employer_id = $1 AND (e.id = $2 OR e.email = $3)`,
      [employer_id, effectiveLoginId, effectiveLoginId]
    );
    const employee = empRes.rows[0];

    if (!employee) {
      attendanceService.logAudit('AUTH_FAILED_USER_NOT_FOUND', null, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id: effectiveLoginId }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password.' });
    }

    const isMatch = authService.verifyPassword(password, employee.password) ||
      (employee.pin && authService.verifyPassword(password, employee.pin));
    if (!isMatch) {
      attendanceService.logAudit('AUTH_FAILED_INVALID_PASSWORD', employee.id, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id: effectiveLoginId }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password.' });
    }

    // Auto-upgrade legacy plain password to scrypt
    if (employee.password && !employee.password.startsWith('scrypt$')) {
      try {
        const newHash = authService.hashPassword(password);
        await query('UPDATE employees SET password = $1 WHERE id = $2', [newHash, employee.id]);
      } catch (_) {}
    }

    if (!employee.is_active) {
      attendanceService.logAudit('AUTH_FAILED_INACTIVE', employee.id, employer_id, 'EMPLOYEE_LOGIN', 'BLOCKED', {}, clientIp, userAgent);
      return res.status(403).json({ success: false, error: 'Account is deactivated. Please contact your employer administrator.' });
    }

    attendanceService.logAudit('EMPLOYEE_LOGIN_SUCCESS', employee.id, employer_id, 'EMPLOYEE_LOGIN', 'SUCCESS', {}, clientIp, userAgent);

    const session = await sessionService.createSession({
      sessionType: 'employee', userId: employee.id, employerId: employer.id, clientIp, userAgent
    });

    res.setHeader('Set-Cookie', `attendance_session=${session.token}; Path=/; HttpOnly; SameSite=Lax${isProductionEnvironment() ? '; Secure' : ''}`);

    const { password: _, pin: __, face_descriptor: ___, face_photo: ____, ...safeEmployee } = employee;
    const { admin_password: _____, ...safeEmployer } = employer;

    res.json({ success: true, token: session.token, message: `Welcome back, ${employee.name}!`, employee: safeEmployee, employer: safeEmployer });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// Employee ID sequence helper (async, PostgreSQL RETURNING)
// ---------------------------------------------------------------------------
async function generateEmployeeId(employerId = 'ORG-001') {
  const result = await query(
    `INSERT INTO employee_sequences (employer_id, last_seq)
     VALUES ($1, 1001)
     ON CONFLICT (employer_id) DO UPDATE SET last_seq = employee_sequences.last_seq + 1
     RETURNING last_seq`,
    [employerId]
  );
  return `EMP-${result.rows[0].last_seq}`;
}

// ---------------------------------------------------------------------------
// 4a-pre. Check Employee ID availability
// ---------------------------------------------------------------------------
router.get('/auth/employee/check-id', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id || !employee_id.trim()) {
      return res.status(400).json({ success: false, error: 'employee_id is required.' });
    }
    const trimmedId = employee_id.trim().toUpperCase();
    const result = await query('SELECT id, name FROM employees WHERE UPPER(id) = $1', [trimmedId]);
    const existing = result.rows[0];
    if (existing) {
      return res.json({ success: true, available: false, error: `Employee ID '${existing.id}' is already registered. Please use a different ID.` });
    }
    return res.json({ success: true, available: true });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 4a. Employee Sign Up
// ---------------------------------------------------------------------------
router.post('/auth/employee/signup', authService.rateLimitMiddleware(authService.signupRateLimiter, 'Signup'), async (req, res) => {
  try {
    const {
      name, employee_id, email, phone,
      employer_id = 'ORG-001', department = 'Dental', designation = 'PRS-1',
      state, district, password, face_photo, face_descriptor
    } = req.body;

    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Full Name is required.' });

    const manualEmpId = employee_id ? employee_id.trim() : '';
    if (!manualEmpId && (!email || !email.trim())) {
      return res.status(400).json({ success: false, error: 'Employee ID is required.' });
    }

    const policyCheck = authService.validatePasswordPolicy(password);
    if (!policyCheck.valid) return res.status(400).json({ success: false, error: policyCheck.error });

    // State / district validation
    if (state && String(state).trim()) {
      const validStates   = getAllStates();
      const cleanState    = String(state).trim();
      const matchedState  = validStates.find(s => s.toLowerCase() === cleanState.toLowerCase());
      if (!matchedState) {
        return res.status(400).json({ success: false, error: `Invalid State/UT '${state}'. Please select a valid Indian State or Union Territory.` });
      }
      if (district && String(district).trim()) {
        const cleanDistrict    = String(district).trim();
        const validDistricts   = getDistrictsForState(matchedState);
        const matchedDistName  = validDistricts.find(d => d.toLowerCase() === cleanDistrict.toLowerCase());
        if (!matchedDistName) {
          return res.status(400).json({ success: false, error: `District '${district}' does not belong to State '${matchedState}'. Please select a valid district.` });
        }
      }
    } else if (district && String(district).trim()) {
      return res.status(400).json({ success: false, error: 'State must be specified when district is provided.' });
    }

    const effectiveOrgId = employer_id || 'ORG-001';
    let orgRes = await query('SELECT * FROM organizations WHERE id = $1', [effectiveOrgId]);
    if (orgRes.rows.length === 0) {
      await initSeed();
      orgRes = await query('SELECT * FROM organizations WHERE id = $1', [effectiveOrgId]);
    }
    const employer = orgRes.rows[0] || (await query('SELECT * FROM organizations WHERE id = $1', ['ORG-001'])).rows[0];
    if (!employer) return res.status(404).json({ success: false, error: 'Employer organization not found.' });

    const newEmpId = manualEmpId || await generateEmployeeId(effectiveOrgId);

    const existingByIdRes = await query('SELECT id, name FROM employees WHERE UPPER(id) = $1', [newEmpId.toUpperCase()]);
    if (existingByIdRes.rows.length > 0) {
      const ex = existingByIdRes.rows[0];
      return res.status(409).json({ success: false, error: `Employee ID '${ex.id}' is already registered. Please sign in or use a different ID.` });
    }

    const finalEmail = (email && email.trim())
      ? email.trim().toLowerCase()
      : `${newEmpId.toLowerCase().replace(/[^a-z0-9_-]/g, '')}@aiims.internal`;

    const existingEmailRes = await query('SELECT id, email FROM employees WHERE email = $1', [finalEmail]);
    if (existingEmailRes.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An employee account with this ID or Email already exists. Please sign in.' });
    }

    // Resolve matching team
    let teamId = null;
    if (state && district) {
      const teamRes = await query(
        'SELECT id FROM teams WHERE employer_id = $1 AND state = $2 AND district = $3 LIMIT 1',
        [effectiveOrgId, state, district]
      );
      if (teamRes.rows.length > 0) {
        teamId = teamRes.rows[0].id;
      } else {
        const stateTeamRes = await query(
          'SELECT id FROM teams WHERE employer_id = $1 AND state = $2 LIMIT 1',
          [effectiveOrgId, state]
        );
        if (stateTeamRes.rows.length > 0) teamId = stateTeamRes.rows[0].id;
      }
    }

    const now = new Date().toISOString();
    let descriptorToSave = null;
    let hasFaceEnrolled  = 0;

    if (face_descriptor) {
      descriptorToSave = Array.isArray(face_descriptor) ? JSON.stringify(face_descriptor) : String(face_descriptor);
      hasFaceEnrolled  = 1;
    } else if (face_photo) {
      descriptorToSave = JSON.stringify(biometricService.createDeterministicDescriptor(face_photo.slice(-500)));
      hasFaceEnrolled  = 1;
    }

    const hashedPassword = authService.hashPassword(password);

    await query(
      `INSERT INTO employees
         (id, employer_id, name, email, phone, department, designation,
          pin, password, face_photo, face_descriptor, face_enrolled,
          is_active, is_admin, team_id, state, district, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        newEmpId, effectiveOrgId, name.trim(), finalEmail,
        phone ? phone.trim() : null,
        department ? department.trim() : 'Dental',
        designation ? designation.trim() : 'PRS-1',
        '1234', hashedPassword,
        null, descriptorToSave, hasFaceEnrolled,
        1, 0, teamId, state || null, district || null, now
      ]
    );

    attendanceService.logAudit('EMPLOYEE_SIGNUP_SUCCESS', newEmpId, effectiveOrgId, 'EMPLOYEE_SIGNUP', 'SUCCESS', {
      name: name.trim(), email: finalEmail, department: department ? department.trim() : 'Dental', face_enrolled: hasFaceEnrolled
    }, clientIp, userAgent);

    const createdRes = await query(
      `SELECT e.*, COALESCE(t.name, 'Direct Assignment') AS team_name
       FROM employees e LEFT JOIN teams t ON e.team_id = t.id WHERE e.id = $1`,
      [newEmpId]
    );
    const createdEmployee = createdRes.rows[0];

    const { password: _, pin: __, face_descriptor: ___, ...safeEmployee } = createdEmployee;
    const { admin_password: ____, ...safeEmployer } = employer;

    const session = await sessionService.createSession({
      sessionType: 'employee', userId: safeEmployee.id, employerId: safeEmployee.employer_id, clientIp, userAgent
    });

    res.setHeader('Set-Cookie', `attendance_session=${session.token}; Path=/; HttpOnly; SameSite=Lax${isProductionEnvironment() ? '; Secure' : ''}`);
    res.status(201).json({ success: true, token: session.token, message: `Account created successfully! Welcome to ${employer.name}, ${name.trim()}.`, employee: safeEmployee, employer: safeEmployer });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 4b. Employee Face Login
// ---------------------------------------------------------------------------
router.post('/auth/employee/face-login', authService.rateLimitMiddleware(authService.faceRateLimiter, 'Face Unlock'), async (req, res) => {
  try {
    const { employer_id, face_descriptor, face_photo, mock_employee_id } = req.body;
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    let candidateDescriptor = face_descriptor;

    if (mock_employee_id) {
      if (!isDemoBypassAllowed()) {
        return res.status(403).json({ success: false, error: 'Demo quick-unlock is disabled in production / unauthorized environments.' });
      }
      const demoRes = await query('SELECT * FROM employees WHERE id = $1', [mock_employee_id]);
      const demoEmp = demoRes.rows[0];
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

    const matchResult = await biometricService.matchFaceToEmployee(candidateDescriptor, employer_id);

    if (!matchResult.match) {
      attendanceService.logAudit('AUTH_FAILED_FACE_MISMATCH', null, employer_id || 'UNKNOWN', 'FACE_UNLOCK', 'BLOCKED', { bestScore: matchResult.bestScore }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Face not recognized. Please align your face in the reticle or sign in with ID and password.' });
    }

    const matchedEmp = matchResult.employee;
    const employerRes = await query('SELECT * FROM organizations WHERE id = $1', [matchedEmp.employer_id]);
    const employer = employerRes.rows[0];

    attendanceService.logAudit('EMPLOYEE_FACE_LOGIN_SUCCESS', matchedEmp.id, matchedEmp.employer_id, 'FACE_UNLOCK', 'SUCCESS', { confidence: matchResult.confidence }, clientIp, userAgent);

    const session = await sessionService.createSession({
      sessionType: 'employee', userId: matchedEmp.id, employerId: matchedEmp.employer_id, clientIp, userAgent
    });

    res.setHeader('Set-Cookie', `attendance_session=${session.token}; Path=/; HttpOnly; SameSite=Lax${isProductionEnvironment() ? '; Secure' : ''}`);
    const { admin_password: _, ...safeEmployer } = employer;
    res.json({ success: true, token: session.token, message: `Face recognized! Welcome back, ${matchedEmp.name}.`, employee: matchedEmp, employer: safeEmployer, confidence: matchResult.confidence });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 4c. Enroll Face (authenticated)
// ---------------------------------------------------------------------------
router.post('/auth/employee/enroll-face', requireAuthenticatedUser, async (req, res) => {
  try {
    const { employee_id, face_photo, face_descriptor } = req.body;
    let targetEmployeeId = null;

    if (req.userType === 'employee') {
      if (employee_id && String(employee_id).trim() !== req.employee.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: You can only enroll Face ID for your own employee account.' });
      }
      targetEmployeeId = req.employee.id;
    } else if (req.userType === 'admin') {
      if (!employee_id) return res.status(400).json({ success: false, error: 'Employee ID is required.' });
      const targetRes = await query('SELECT * FROM employees WHERE id = $1 AND employer_id = $2', [employee_id, req.employerId]);
      if (targetRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Employee not found in your organization.' });
      targetEmployeeId = targetRes.rows[0].id;
    }

    const empRes = await query('SELECT * FROM employees WHERE id = $1', [targetEmployeeId]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Employee not found.' });
    const employee = empRes.rows[0];

    await biometricService.enrollEmployeeFace(targetEmployeeId, face_photo, face_descriptor);
    res.json({ success: true, message: `Biometric Face ID successfully enrolled for ${employee.name}!` });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 4d. Demo Face Recognition Credentials
// ---------------------------------------------------------------------------
router.get('/auth/demo-face-credentials', async (req, res) => {
  try {
    if (!isDemoBypassAllowed()) {
      return res.status(403).json({ success: false, error: 'Demo credentials endpoint is disabled in production / unauthorized environments.' });
    }
    const result = await query(
      `SELECT e.id, e.name, e.department, e.designation, e.employer_id, o.name AS employer_name, e.face_enrolled
       FROM employees e
       JOIN organizations o ON e.employer_id = o.id
       WHERE e.is_active = 1
       ORDER BY e.id ASC LIMIT 6`,
      []
    );
    res.json({ success: true, demoEmployees: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 5. Employer / Admin Login
// ---------------------------------------------------------------------------
router.post('/auth/employer/login', authService.rateLimitMiddleware(authService.loginRateLimiter, 'Employer Login'), async (req, res) => {
  try {
    const { employer_id, admin_username, admin_password } = req.body || {};
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    if (!employer_id || !admin_username || !admin_password) {
      return res.status(400).json({ success: false, error: 'Employer ID, Admin Username, and Admin Password are required.' });
    }

    const cleanOrgId = String(employer_id).trim();
    let orgRes = await query('SELECT * FROM organizations WHERE UPPER(id) = UPPER($1) OR UPPER(name) = UPPER($1)', [cleanOrgId]);
    if (orgRes.rows.length === 0 && (cleanOrgId.toUpperCase() === 'ORG-001' || cleanOrgId.toUpperCase() === 'AIIMS')) {
      await initSeed();
      orgRes = await query('SELECT * FROM organizations WHERE UPPER(id) = UPPER($1) OR UPPER(name) = UPPER($1)', [cleanOrgId]);
    }
    const employer = orgRes.rows[0];
    if (!employer) return res.status(401).json({ success: false, error: 'Invalid Employer Admin credentials.' });

    const usernameMatch = employer.admin_username && employer.admin_username.toLowerCase() === String(admin_username).trim().toLowerCase();
    const passwordMatch = authService.verifyPassword(String(admin_password), employer.admin_password);

    if (!usernameMatch || !passwordMatch) {
      attendanceService.logAudit('ADMIN_AUTH_FAILED', null, employer.id, 'EMPLOYER_LOGIN', 'BLOCKED', { admin_username }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Invalid Employer Admin credentials.' });
    }

    attendanceService.logAudit('ADMIN_LOGIN_SUCCESS', null, employer_id, 'EMPLOYER_LOGIN', 'SUCCESS', { admin_username }, clientIp, userAgent);

    const session = await sessionService.createSession({
      sessionType: 'admin', userId: employer.admin_username, employerId: employer.id, clientIp, userAgent
    });

    res.setHeader('Set-Cookie', `attendance_session=${session.token}; Path=/; HttpOnly; SameSite=Lax${isProductionEnvironment() ? '; Secure' : ''}`);
    const { admin_password: _, ...safeEmployer } = employer;
    res.json({
      success: true, token: session.token,
      message: `Authenticated as Employer Administrator for ${employer.name}`,
      employer: safeEmployer,
      admin_session: { token: session.token, employer_id: employer.id, admin_username: employer.admin_username, authenticated_at: new Date().toISOString() }
    });
  } catch (err) { return handleApiError(res, req, err); }
});

// ---------------------------------------------------------------------------
// 6. Logout
// ---------------------------------------------------------------------------
router.post('/auth/logout', async (req, res) => {
  try {
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const token     = extractToken(req);

    let employeeId = null, employerId = null;
    if (token) {
      const session = await sessionService.getSession(token);
      if (session) {
        employeeId = session.session_type === 'employee' ? session.user_id : null;
        employerId = session.employer_id;
      }
      await sessionService.revokeSession(token);
    }

    attendanceService.logAudit('USER_LOGOUT', employeeId || null, employerId || null, 'LOGOUT', 'SUCCESS', {}, clientIp, userAgent);
    res.setHeader('Set-Cookie', 'attendance_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 7. Current Attendance Status
// ---------------------------------------------------------------------------
router.get('/attendance/current', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const employee = req.employee;
    const activeSession = await attendanceService.getActiveSession(employee.id);

    if (!activeSession) {
      const orgRes = await query('SELECT timezone FROM organizations WHERE id = $1', [employee.employer_id]);
      const orgTimezone = orgRes.rows[0]?.timezone || 'Asia/Kolkata';
      const todayStr    = attendanceService.getLocalDateString(new Date(), orgTimezone);

      const latestRes = await query(
        `SELECT * FROM attendance
         WHERE employee_id = $1 AND attendance_status IN ('COMPLETED', 'ANOMALY_FLAGGED')
         ORDER BY updated_at DESC LIMIT 1`,
        [employee.id]
      );
      const latestCompleted = latestRes.rows[0] || null;

      const isCompletedToday = latestCompleted && latestCompleted.checkin_server_timestamp &&
        attendanceService.getLocalDateString(new Date(latestCompleted.checkin_server_timestamp), orgTimezone) === todayStr;

      return res.json({
        success: true, hasActiveSession: false,
        status:             isCompletedToday ? 'SHIFT_COMPLETED_TODAY' : 'NOT_CHECKED_IN',
        alreadyCompletedToday: !!isCompletedToday, latestCompleted
      });
    }

    const currentBreakRes = await query(
      `SELECT * FROM breaks WHERE attendance_id = $1 AND end_server_timestamp IS NULL LIMIT 1`,
      [activeSession.id]
    );
    const allBreaksRes = await query(
      'SELECT * FROM breaks WHERE attendance_id = $1 ORDER BY start_server_timestamp ASC',
      [activeSession.id]
    );

    res.json({
      success: true, hasActiveSession: true, session: activeSession,
      status:       activeSession.attendance_status,
      currentBreak: currentBreakRes.rows[0] || null,
      breaks:       allBreaksRes.rows,
      serverTime:   new Date().toISOString()
    });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 8. Check-In
// ---------------------------------------------------------------------------
router.post('/attendance/check-in', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const employee = req.employee;
    const { photo, latitude, longitude, accuracy, client_timestamp, idempotency_key, work_mode, field_site_notes, team_id, state, district } = req.body;

    if (!photo) return res.status(400).json({ success: false, error: 'Real-time live camera photo is required. Gallery uploads are disabled.' });
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ success: false, error: 'Real-time device geolocation (latitude, longitude, accuracy) is required.' });
    }

    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await attendanceService.processCheckIn({
      employee, photoData: photo, latitude, longitude, accuracy,
      clientTimestamp: client_timestamp, idempotencyKey: idempotency_key,
      workMode: work_mode || 'OFFICE', fieldSiteNotes: field_site_notes || null,
      teamId: team_id || null, state: state || null, district: district || null,
      clientIp, userAgent
    });
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 8b. Location Preview
// ---------------------------------------------------------------------------
router.get('/location/preview', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, error: 'Latitude and longitude required.' });
    const address = await geoService.reverseGeocode(parseFloat(lat), parseFloat(lng));
    const matched = matchStateAndDistrict({ state: address, city: address });
    res.json({ success: true, address, state: matched.state, district: matched.district });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 9. Start Break
// ---------------------------------------------------------------------------
router.post('/attendance/break/start', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result    = await attendanceService.startBreak(req.employee.id, clientIp, userAgent);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 10. End Break
// ---------------------------------------------------------------------------
router.post('/attendance/break/end', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result    = await attendanceService.endBreak(req.employee.id, clientIp, userAgent);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 11. Check-Out
// ---------------------------------------------------------------------------
router.post('/attendance/check-out', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const { photo, latitude, longitude, accuracy, client_timestamp } = req.body;
    if (!photo) return res.status(400).json({ success: false, error: 'Real-time live camera photo is required for checkout.' });
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ success: false, error: 'Real-time device geolocation (latitude, longitude, accuracy) is required.' });
    }
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await attendanceService.processCheckOut({
      employee: req.employee, photoData: photo, latitude, longitude, accuracy,
      clientTimestamp: client_timestamp, clientIp, userAgent
    });
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// Attendance record helper (for admin routes)
// ---------------------------------------------------------------------------
async function getFilteredAttendanceRecords({ employerId, work_mode, status, state, district, team_id, search }) {
  const params = [employerId];
  let sql = `
    SELECT a.*, e.name AS employee_name, e.department, e.designation, e.email,
           COALESCE(t.name, 'Direct Assignment') AS team_name,
           COALESCE(a.state, e.state, t.state) AS state,
           COALESCE(a.district, e.district, t.district) AS district,
           o.name AS employer_name, o.office_name, o.office_lat, o.office_lng, o.geofence_radius_m
    FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
    JOIN organizations o ON a.employer_id = o.id
    WHERE a.employer_id = $1
  `;

  if (work_mode && work_mode !== 'ALL') {
    params.push(work_mode);
    sql += ` AND a.work_mode = $${params.length}`;
  }
  if (status && status !== 'ALL') {
    params.push(status);
    sql += ` AND a.attendance_status = $${params.length}`;
  }
  if (state && state !== 'ALL') {
    params.push(state);
    sql += ` AND (a.state = $${params.length} OR (a.state IS NULL AND (e.state = $${params.length} OR t.state = $${params.length})))`;
  }
  if (district && district !== 'ALL') {
    params.push(district);
    sql += ` AND (a.district = $${params.length} OR (a.district IS NULL AND (e.district = $${params.length} OR t.district = $${params.length})))`;
  }
  if (team_id && team_id !== 'ALL') {
    params.push(team_id);
    sql += ` AND (a.team_id = $${params.length} OR (a.team_id IS NULL AND e.team_id = $${params.length}))`;
  }
  if (search && typeof search === 'string' && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    params.push(s);
    const n = params.length;
    sql += ` AND (
      LOWER(e.name) LIKE $${n} OR
      LOWER(e.id) LIKE $${n} OR
      LOWER(e.department) LIKE $${n} OR
      LOWER(COALESCE(t.name, '')) LIKE $${n} OR
      LOWER(COALESCE(a.state, e.state, t.state, '')) LIKE $${n} OR
      LOWER(COALESCE(a.district, e.district, t.district, '')) LIKE $${n} OR
      LOWER(COALESCE(a.field_site_notes, '')) LIKE $${n} OR
      LOWER(COALESCE(a.checkin_address, '')) LIKE $${n}
    )`;
  }

  sql += ' ORDER BY a.created_at DESC';
  const result = await query(sql, params);
  const rows = result.rows;

  if (storageService.isStorageConfigured()) {
    for (const r of rows) {
      if (r.checkin_photo && !r.checkin_photo.startsWith('/uploads/')) {
        r.checkin_photo = await storageService.resolvePhotoUrl(r.checkin_photo);
      }
      if (r.checkout_photo && !r.checkout_photo.startsWith('/uploads/')) {
        r.checkout_photo = await storageService.resolvePhotoUrl(r.checkout_photo);
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CSV generator (unchanged logic — uses already-fetched rows)
// ---------------------------------------------------------------------------
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (/^[\s\t\r]*[=+\-@\t\r|%]/.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateAttendanceCsv(records) {
  const headers = [
    'Attendance ID','Employee ID','Employee Name','Department','Designation','Email',
    'Organization','Team Name','State / UT','District','Work Mode','Attendance Status',
    'Check-In Date','Check-In Time','Check-In Server Timestamp (UTC)',
    'Check-In Latitude','Check-In Longitude','Check-In GPS Accuracy (m)',
    'Check-In Geofence Distance (m)','Check-In Geofence Status','Check-In Address',
    'Checkout Date','Checkout Time','Checkout Server Timestamp (UTC)',
    'Checkout Latitude','Checkout Longitude','Checkout GPS Accuracy (m)',
    'Checkout Geofence Distance (m)','Checkout Geofence Status','Checkout Address',
    'Gross Working Hours','Break Minutes','Net Working Hours','Overtime Hours',
    'Field Site Notes','DB Sync Status','Created At'
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];
  for (const r of records) {
    const checkinDate  = r.checkin_server_timestamp  ? new Date(r.checkin_server_timestamp).toISOString().split('T')[0]  : '';
    const checkinTime  = r.checkin_server_timestamp  ? new Date(r.checkin_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    const checkoutDate = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toISOString().split('T')[0] : '';
    const checkoutTime = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    rows.push([
      r.id, r.employee_id, r.employee_name, r.department, r.designation, r.email,
      r.employer_name, r.team_name || 'Direct Assignment', r.state, r.district,
      r.work_mode === 'FIELD_WORK' ? 'Field Work' : 'Office Duty', r.attendance_status,
      checkinDate, checkinTime, r.checkin_server_timestamp || '',
      r.checkin_lat   != null ? Number(r.checkin_lat).toFixed(6)   : '',
      r.checkin_lng   != null ? Number(r.checkin_lng).toFixed(6)   : '',
      r.checkin_accuracy  != null ? Number(r.checkin_accuracy).toFixed(1)  : '',
      r.checkin_geofence_distance != null ? Number(r.checkin_geofence_distance).toFixed(1) : '',
      r.checkin_geofence_status || '', r.checkin_address || '',
      checkoutDate, checkoutTime, r.checkout_server_timestamp || '',
      r.checkout_lat  != null ? Number(r.checkout_lat).toFixed(6)  : '',
      r.checkout_lng  != null ? Number(r.checkout_lng).toFixed(6)  : '',
      r.checkout_accuracy != null ? Number(r.checkout_accuracy).toFixed(1) : '',
      r.checkout_geofence_distance != null ? Number(r.checkout_geofence_distance).toFixed(1) : '',
      r.checkout_geofence_status || '', r.checkout_address || '',
      r.gross_working_seconds != null ? (r.gross_working_seconds / 3600).toFixed(2) : '0.00',
      r.break_seconds != null ? Math.round(r.break_seconds / 60) : '0',
      r.net_working_seconds  != null ? (r.net_working_seconds  / 3600).toFixed(2) : '0.00',
      r.overtime_seconds     != null ? (r.overtime_seconds     / 3600).toFixed(2) : '0.00',
      r.field_site_notes || '', r.redcap_sync_status || 'PENDING', r.created_at || ''
    ].map(escapeCsvCell).join(','));
  }

  return '\uFEFF' + rows.join('\r\n');
}

// ---------------------------------------------------------------------------
// 12. Admin: Attendance List
// ---------------------------------------------------------------------------
router.get('/admin/attendance', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { work_mode, status, state, district, team_id, search } = req.query;
    const records = await getFilteredAttendanceRecords({ employerId: req.employerId, work_mode, status, state, district, team_id, search });
    res.json({ success: true, employer_id: req.employerId, records });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 12a. Admin: Export CSV
// ---------------------------------------------------------------------------
router.get('/admin/attendance/export.csv', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { work_mode, status, state, district, team_id, search } = req.query;
    const records = await getFilteredAttendanceRecords({ employerId: req.employerId, work_mode, status, state, district, team_id, search });
    const csvData  = generateAttendanceCsv(records);
    const dateStr  = new Date().toISOString().split('T')[0];
    const filename = `attendance_export_${req.employerId}_${dateStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csvData);
  } catch (err) { res.status(500).json({ error: isProductionEnvironment() ? 'An internal server error occurred.' : 'Failed to export attendance CSV' }); }
});

// ---------------------------------------------------------------------------
// 13. Admin: Attendance Matrix
// ---------------------------------------------------------------------------
router.get('/admin/attendance/matrix', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const matrix = await teamService.getMultiStateAttendanceMatrix(req.employerId, req.query.date);
    res.json({ success: true, employer_id: req.employerId, totalActive: matrix.total_active, activeStatesCount: matrix.total_states_active, matrix });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'An internal server error occurred.' : err.message }); }
});

// ---------------------------------------------------------------------------
// 14. Admin: Single Attendance Detail
// ---------------------------------------------------------------------------
router.get('/admin/attendance/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const recordRes = await query(
      `SELECT a.*, e.name AS employee_name, e.department, e.designation, e.email,
              COALESCE(t.name, 'Direct Assignment') AS team_name,
              COALESCE(a.state, e.state, t.state) AS state,
              COALESCE(a.district, e.district, t.district) AS district,
              o.name AS employer_name, o.office_name, o.office_lat, o.office_lng, o.geofence_radius_m, o.max_gps_accuracy_m
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
       JOIN organizations o ON a.employer_id = o.id
       WHERE a.id = $1 AND a.employer_id = $2`,
      [req.params.id, req.employerId]
    );
    const record = recordRes.rows[0];
    if (!record) return res.status(404).json({ success: false, error: 'Record not found for this employer.' });

    const breaksRes = await query('SELECT * FROM breaks WHERE attendance_id = $1 ORDER BY start_server_timestamp ASC', [record.id]);
    const auditRes  = await query(
      'SELECT * FROM audit_logs WHERE employer_id = $1 AND details_json LIKE $2 ORDER BY timestamp DESC',
      [req.employerId, `%${record.id}%`]
    );

    if (storageService.isStorageConfigured() && record) {
      if (record.checkin_photo && !record.checkin_photo.startsWith('/uploads/')) {
        record.checkin_photo = await storageService.resolvePhotoUrl(record.checkin_photo);
      }
      if (record.checkout_photo && !record.checkout_photo.startsWith('/uploads/')) {
        record.checkout_photo = await storageService.resolvePhotoUrl(record.checkout_photo);
      }
    }

    res.json({ success: true, record, breaks: breaksRes.rows, auditEvents: auditRes.rows });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 14b. Photo Signed URL Generator (authenticated)
// ---------------------------------------------------------------------------
router.get('/attendance/photo-signed-url', requireAuthenticatedUser, async (req, res) => {
  try {
    const { path: photoPath } = req.query;
    if (!photoPath || typeof photoPath !== 'string') {
      return res.status(400).json({ success: false, error: 'path query parameter is required.' });
    }
    // Security check: only allow valid attendance photo paths
    if (!photoPath.startsWith('attendance/')) {
      return res.status(403).json({ success: false, error: 'Invalid photo storage path.' });
    }
    const signedUrl = await storageService.getSignedPhotoUrl(photoPath, 3600);
    if (!signedUrl) {
      return res.status(404).json({ success: false, error: 'Could not generate signed URL.' });
    }
    res.json({ success: true, signedUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message });
  }
});

// ---------------------------------------------------------------------------
// Geo routes
// ---------------------------------------------------------------------------
router.get('/geo/states',           (req, res) => res.json({ success: true, states: getAllStates() }));
router.get('/geo/districts',        (req, res) => { const { state } = req.query; res.json({ success: true, state, districts: getDistrictsForState(state) }); });
router.get('/geo/states-districts', (req, res) => res.json({ success: true, totalStates: Object.keys(STATE_DISTRICTS_MAP).length, data: STATE_DISTRICTS_MAP }));

// ---------------------------------------------------------------------------
// Team routes
// ---------------------------------------------------------------------------
router.get('/teams', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { state, district } = req.query;
    const teams = await teamService.listTeams(req.employerId, state, district);
    res.json({ success: true, employer_id: req.employerId, teams });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

router.post('/teams', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { name, state, district, description } = req.body;
    const newTeam = await teamService.createTeam(req.employerId, { name, state, district, description });
    res.status(201).json({ success: true, team: newTeam });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/teams/assign', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { employee_id, team_id } = req.body;
    const result = await teamService.assignEmployeeTeam(req.employerId, employee_id, team_id);
    res.json(result);
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 14. Admin: Audit Logs
// ---------------------------------------------------------------------------
router.get('/admin/audit-logs', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit || '100', 10));
    const result = await query(
      `SELECT l.*, e.name AS employee_name
       FROM audit_logs l
       LEFT JOIN employees e ON l.employee_id = e.id
       WHERE l.employer_id = $1
       ORDER BY l.timestamp DESC LIMIT $2`,
      [req.employerId, limit]
    );
    res.json({ success: true, employer_id: req.employerId, logs: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 15. Admin: Settings Get & Update
// ---------------------------------------------------------------------------
router.get('/admin/settings', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, geofence_policy, shift_hours, timezone, admin_username FROM organizations WHERE id = $1',
      [req.employerId]
    );
    res.json({ success: true, settings: result.rows[0] || null });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

router.post('/admin/settings', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { office_name, office_lat, office_lng, geofence_radius_m, geofence_policy, max_gps_accuracy_m, shift_hours, timezone } = req.body;
    const currentRes = await query('SELECT id FROM organizations WHERE id = $1', [req.employerId]);
    if (currentRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Employer organization not found.' });

    await query(
      `UPDATE organizations
       SET office_name        = COALESCE($1, office_name),
           office_lat         = COALESCE($2, office_lat),
           office_lng         = COALESCE($3, office_lng),
           geofence_radius_m  = COALESCE($4, geofence_radius_m),
           geofence_policy    = COALESCE($5, geofence_policy),
           max_gps_accuracy_m = COALESCE($6, max_gps_accuracy_m),
           shift_hours        = COALESCE($7, shift_hours),
           timezone           = COALESCE($8, timezone),
           updated_at         = $9
       WHERE id = $10`,
      [
        office_name,
        office_lat  !== undefined ? parseFloat(office_lat)  : null,
        office_lng  !== undefined ? parseFloat(office_lng)  : null,
        geofence_radius_m  !== undefined ? parseFloat(geofence_radius_m)  : null,
        geofence_policy,
        max_gps_accuracy_m !== undefined ? parseFloat(max_gps_accuracy_m) : null,
        shift_hours !== undefined ? parseFloat(shift_hours) : null,
        timezone,
        new Date().toISOString(),
        currentRes.rows[0].id
      ]
    );

    attendanceService.logAudit('SETTINGS_UPDATED', null, currentRes.rows[0].id, 'UPDATE_SETTINGS', 'SUCCESS', req.body);

    const updatedRes = await query(
      'SELECT id, name, office_name, office_lat, office_lng, geofence_radius_m, max_gps_accuracy_m, geofence_policy, shift_hours, timezone, admin_username FROM organizations WHERE id = $1',
      [currentRes.rows[0].id]
    );
    res.json({ success: true, settings: updatedRes.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 15b. Set Current Office Location
// ---------------------------------------------------------------------------
router.post('/settings/set-current-office', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { latitude, longitude, office_name } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'Latitude and longitude required.' });
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    await query(
      `UPDATE organizations
       SET office_lat  = $1,
           office_lng  = $2,
           office_name = COALESCE($3, office_name),
           max_gps_accuracy_m = GREATEST(max_gps_accuracy_m, 350),
           updated_at  = $4
       WHERE id = $5`,
      [lat, lng, office_name || 'Current Registered Workplace', new Date().toISOString(), req.employerId]
    );

    attendanceService.logAudit('OFFICE_LOCATION_SYNCED', null, req.employerId, 'SYNC_OFFICE_COORDS', 'SUCCESS', { lat, lng });

    const updatedRes = await query('SELECT * FROM organizations WHERE id = $1', [req.employerId]);
    res.json({ success: true, message: 'Office location synchronized to your current GPS coordinates.', settings: updatedRes.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'An internal server error occurred.' : err.message }); }
});

// ---------------------------------------------------------------------------
// 16. Admin: SQL Sync Records
// ---------------------------------------------------------------------------
router.get('/admin/redcap/records', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const records = await sqlSyncClient.getRecords(req.employerId);
    res.json({
      success: true, employer_id: req.employerId, mode: 'SQL_DB', isLive: false,
      description: 'Attendance records stored in PostgreSQL (REDCap integration pending configuration)',
      records, total: records.length
    });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 17. Admin: Export SQL Sync CSV
// ---------------------------------------------------------------------------
router.get('/admin/redcap/data-dictionary.csv', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const csv = await sqlSyncClient.generateCsvExport(req.employerId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="Attendance_Sync_Records.csv"');
    res.send(csv);
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

module.exports = router;
