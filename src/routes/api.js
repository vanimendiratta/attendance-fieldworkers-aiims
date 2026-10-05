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
const emailService   = require('../services/email_service');
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
    const { employer_id, login_id, employee_id, password } = req.body || {};
    const effectiveLoginId = String(login_id || employee_id || '').trim();
    const rawXForwarded    = req.headers['x-forwarded-for'];
    const clientIp         = (typeof rawXForwarded === 'string' ? rawXForwarded.split(',')[0].trim() : null) || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent        = req.headers['user-agent'] || 'Unknown';

    if (!employer_id) return res.status(400).json({ success: false, error: 'Employer ID is required.' });
    if (!effectiveLoginId || !password) return res.status(400).json({ success: false, error: 'Both Employee ID/Email and Password are required.' });

    const cleanOrgId = String(employer_id).trim();
    let employerRes = await query(
      'SELECT * FROM organizations WHERE UPPER(id) = UPPER($1) OR UPPER(name) = UPPER($1)',
      [cleanOrgId]
    );
    if (employerRes.rows.length === 0 && (cleanOrgId.toUpperCase() === 'ORG-001' || cleanOrgId.toUpperCase() === 'AIIMS')) {
      await initSeed();
      employerRes = await query(
        'SELECT * FROM organizations WHERE UPPER(id) = UPPER($1) OR UPPER(name) = UPPER($1)',
        [cleanOrgId]
      );
    }
    const employer = employerRes.rows[0];
    if (!employer) {
      attendanceService.logAudit('AUTH_FAILED_ORG_NOT_FOUND', null, cleanOrgId, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id: effectiveLoginId }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password.' });
    }

    const digitsOnly = effectiveLoginId.replace(/\D/g, '');

    const empRes = await query(
      `SELECT e.*, COALESCE(t.name, 'Unassigned') AS team_name
       FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id
       WHERE e.employer_id = $1 AND (
         UPPER(TRIM(e.id)) = UPPER($2)
         OR LOWER(TRIM(e.email)) = LOWER($2)
         OR TRIM(COALESCE(e.phone, '')) = $2
         OR ($3 <> '' AND LENGTH($3) >= 10 AND REPLACE(REPLACE(REPLACE(COALESCE(e.phone, ''), ' ', ''), '-', ''), '+91', '') = $3)
       )`,
      [employer.id, effectiveLoginId, digitsOnly]
    );
    const employee = empRes.rows[0];

    if (!employee) {
      attendanceService.logAudit('AUTH_FAILED_USER_NOT_FOUND', null, employer.id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id: effectiveLoginId }, clientIp, userAgent);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password.' });
    }

    const isMatch = authService.verifyPassword(password, employee.password) ||
      (employee.pin && authService.verifyPassword(password, employee.pin));
    if (!isMatch) {
      attendanceService.logAudit('AUTH_FAILED_INVALID_PASSWORD', employee.id, employer.id, 'EMPLOYEE_LOGIN', 'BLOCKED', { login_id: effectiveLoginId }, clientIp, userAgent);
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
      attendanceService.logAudit('AUTH_FAILED_INACTIVE', employee.id, employer.id, 'EMPLOYEE_LOGIN', 'BLOCKED', {}, clientIp, userAgent);
      return res.status(403).json({ success: false, error: 'Account is deactivated. Please contact your employer administrator.' });
    }

    attendanceService.logAudit('EMPLOYEE_LOGIN_SUCCESS', employee.id, employer.id, 'EMPLOYEE_LOGIN', 'SUCCESS', {}, clientIp, userAgent);

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

    const cleanOrgId = String(employer_id || 'ORG-001').trim();
    let orgRes = await query('SELECT * FROM organizations WHERE UPPER(id) = UPPER($1) OR UPPER(name) = UPPER($1)', [cleanOrgId]);
    if (orgRes.rows.length === 0) {
      await initSeed();
      orgRes = await query('SELECT * FROM organizations WHERE UPPER(id) = UPPER($1) OR UPPER(name) = UPPER($1)', [cleanOrgId]);
    }
    const employer = orgRes.rows[0] || (await query('SELECT * FROM organizations WHERE id = $1', ['ORG-001'])).rows[0];
    if (!employer) return res.status(404).json({ success: false, error: 'Employer organization not found.' });

    const effectiveOrgId = employer.id;
    const newEmpId = manualEmpId ? manualEmpId.toUpperCase() : await generateEmployeeId(effectiveOrgId);

    const existingByIdRes = await query('SELECT id, name FROM employees WHERE UPPER(TRIM(id)) = $1', [newEmpId.toUpperCase()]);
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

    if (face_descriptor && Array.isArray(face_descriptor) && face_descriptor.length >= 32) {
      descriptorToSave = JSON.stringify(face_descriptor);
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
    const { employer_id, face_descriptor, mock_employee_id, employee_id, login_id } = req.body || {};
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
      }
    }

    if (!candidateDescriptor || !Array.isArray(candidateDescriptor) || candidateDescriptor.length < 32) {
      return res.status(400).json({ success: false, error: 'No face biometric signature detected. Please look directly into the camera viewfinder.' });
    }

    const specificId = (employee_id || login_id || '').trim() || null;
    const matchResult = await biometricService.matchFaceToEmployee(candidateDescriptor, employer_id, undefined, specificId);

    if (!matchResult.match) {
      attendanceService.logAudit('AUTH_FAILED_FACE_MISMATCH', null, employer_id || 'UNKNOWN', 'FACE_UNLOCK', 'BLOCKED', { bestScore: matchResult.bestScore }, clientIp, userAgent);
      return res.status(401).json({
        success: false,
        error: matchResult.error || 'Face biometrics not recognized. If you have not enrolled your face, please sign in with ID and password.'
      });
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
    const { 
      photo, latitude, longitude, accuracy, client_timestamp, idempotency_key, 
      work_mode, field_site_notes, team_id, state, district,
      punch_location_type, hotel_stay_id, hotel_name, hotel_room, hotel_phone
    } = req.body;

    if (!photo) return res.status(400).json({ success: false, error: 'Real-time live camera photo is required. Gallery uploads are disabled.' });
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ success: false, error: 'Real-time device geolocation (latitude, longitude, accuracy) is required.' });
    }

    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await attendanceService.processCheckIn({
      employee, photoData: photo, latitude, longitude, accuracy,
      clientTimestamp: client_timestamp, idempotencyKey: idempotency_key,
      workMode: work_mode || 'FIELD_WORK', fieldSiteNotes: field_site_notes || null,
      teamId: team_id || null, state: state || null, district: district || null,
      punchLocationType: punch_location_type || 'FIELD_SITE',
      hotelStayId: hotel_stay_id || null,
      hotelName: hotel_name || null,
      hotelRoom: hotel_room || null,
      hotelPhone: hotel_phone || null,
      clientIp, userAgent
    });
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 8b. Location Preview with Detailed Place Identification
// ---------------------------------------------------------------------------
router.get('/location/preview', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, error: 'Latitude and longitude required.' });
    const details = await geoService.reverseGeocodeDetailed(parseFloat(lat), parseFloat(lng));
    const matched = matchStateAndDistrict({ state: details.address, city: details.address });
    res.json({ 
      success: true, 
      address: details.address, 
      placeName: details.placeName,
      placeType: details.placeType,
      isLodging: details.isLodging,
      isHealthFacility: details.isHealthFacility,
      coordinatesUrl: details.coordinatesUrl,
      state: matched.state, 
      district: matched.district 
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ---------------------------------------------------------------------------
// 8c. Employee: Get Current Active Hotel Stay
// ---------------------------------------------------------------------------
router.get('/employee/hotel-stay/active', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const employeeId = req.employee.id;
    const result = await query(
      `SELECT * FROM employee_hotel_stays 
       WHERE employee_id = $1 AND stay_status = 'ACTIVE' 
       ORDER BY created_at DESC LIMIT 1`,
      [employeeId]
    );
    res.json({ success: true, stay: result.rows[0] || null });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 8d. Employee: Register or Update Hotel Stay Details
// ---------------------------------------------------------------------------
router.post('/employee/hotel-stay', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const employeeId = req.employee.id;
    const employerId = req.employee.employer_id || 'ORG-001';
    const {
      hotel_name, room_number, hotel_address, hotel_phone,
      checkin_date, checkout_date, booking_ref, hotel_lat, hotel_lng, notes
    } = req.body;

    if (!hotel_name || !hotel_address) {
      return res.status(400).json({ success: false, error: 'Hotel name and hotel address are required.' });
    }

    const stayId = `STAY-${employeeId}-${Date.now().toString(36)}`;
    const cIn = checkin_date ? String(checkin_date).split('T')[0] : new Date().toISOString().split('T')[0];
    const cOut = checkout_date ? String(checkout_date).split('T')[0] : null;

    // Mark previous active stays as completed
    await query(
      `UPDATE employee_hotel_stays 
       SET stay_status = 'COMPLETED', updated_at = NOW() 
       WHERE employee_id = $1 AND stay_status = 'ACTIVE'`,
      [employeeId]
    );

    const result = await query(
      `INSERT INTO employee_hotel_stays (
         id, employer_id, employee_id, hotel_name, room_number, hotel_address, hotel_phone,
         checkin_date, checkout_date, booking_ref, hotel_lat, hotel_lng, stay_status, notes,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE', $13, NOW(), NOW())
       RETURNING *`,
      [
        stayId, employerId, employeeId, String(hotel_name).trim(), room_number ? String(room_number).trim() : null,
        String(hotel_address).trim(), hotel_phone ? String(hotel_phone).trim() : null,
        cIn, cOut, booking_ref ? String(booking_ref).trim() : null,
        hotel_lat != null && !isNaN(hotel_lat) ? parseFloat(hotel_lat) : null,
        hotel_lng != null && !isNaN(hotel_lng) ? parseFloat(hotel_lng) : null,
        notes ? String(notes).trim() : null
      ]
    );

    res.json({ success: true, stay: result.rows[0], message: 'Hotel stay details registered successfully.' });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 8d-2. Employee: End / Check-out Current Hotel Stay
// ---------------------------------------------------------------------------
router.post('/employee/hotel-stay/checkout', requireAuthenticatedEmployee, async (req, res) => {
  try {
    const employeeId = req.employee.id;
    const today = new Date().toISOString().split('T')[0];
    const result = await query(
      `UPDATE employee_hotel_stays 
       SET stay_status = 'COMPLETED', checkout_date = COALESCE(checkout_date, $1), updated_at = NOW() 
       WHERE employee_id = $2 AND stay_status = 'ACTIVE'
       RETURNING *`,
      [today, employeeId]
    );
    res.json({ success: true, message: 'Hotel stay checked out successfully.', stay: result.rows[0] || null });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 8e. Admin: List All Employee Hotel Stays
// ---------------------------------------------------------------------------
router.get('/admin/hotel-stays', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const { employee_id, status, search } = req.query;
    const params = [employerId];
    let sql = `
      SELECT s.*, e.name AS employee_name, e.department, e.designation, e.phone AS employee_phone,
             COALESCE(t.name, 'Direct Assignment') AS team_name
      FROM employee_hotel_stays s
      JOIN employees e ON s.employee_id = e.id
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE s.employer_id = $1
    `;

    if (employee_id && employee_id !== 'ALL') {
      params.push(employee_id);
      sql += ` AND s.employee_id = $${params.length}`;
    }
    if (status && status !== 'ALL') {
      params.push(status);
      sql += ` AND s.stay_status = $${params.length}`;
    }
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const n = params.length;
      sql += ` AND (
        LOWER(e.name) LIKE $${n} OR
        LOWER(s.hotel_name) LIKE $${n} OR
        LOWER(s.hotel_address) LIKE $${n} OR
        LOWER(COALESCE(s.room_number, '')) LIKE $${n}
      )`;
    }

    sql += ' ORDER BY s.created_at DESC';
    const result = await query(sql, params);
    res.json({ success: true, stays: result.rows });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 8f. Admin: List Stays for Specific Employee
// ---------------------------------------------------------------------------
router.get('/admin/employees/:id/hotel-stays', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const employeeId = req.params.id;
    const result = await query(
      `SELECT * FROM employee_hotel_stays 
       WHERE employer_id = $1 AND employee_id = $2 
       ORDER BY created_at DESC`,
      [employerId, employeeId]
    );
    res.json({ success: true, stays: result.rows });
  } catch (err) {
    return handleApiError(res, req, err);
  }
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
// Organization Holidays helper
// ---------------------------------------------------------------------------
async function getOrganizationHolidaysMap(employerId) {
  try {
    const res = await query(
      'SELECT id, holiday_date, name, holiday_type FROM organization_holidays WHERE employer_id = $1 ORDER BY holiday_date ASC',
      [employerId]
    );
    const map = new Map();
    for (const h of res.rows) {
      const dStr = typeof h.holiday_date === 'string'
        ? h.holiday_date.split('T')[0]
        : new Date(h.holiday_date).toISOString().split('T')[0];
      map.set(dStr, h);
    }
    return map;
  } catch (err) {
    console.error('Error fetching organization holidays map:', err.message);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Attendance record helper (for admin routes)
// ---------------------------------------------------------------------------
async function getFilteredAttendanceRecords({ employerId, employee_id, work_mode, status, state, district, team_id, search }) {
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

  if (employee_id && employee_id !== 'ALL') {
    params.push(employee_id);
    sql += ` AND a.employee_id = $${params.length}`;
  }
  if (work_mode && work_mode !== 'ALL') {
    params.push(work_mode);
    sql += ` AND a.work_mode = $${params.length}`;
  }
  if (status && status !== 'ALL' && status !== 'HOLIDAY_DUTY') {
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

  const holidaysMap = await getOrganizationHolidaysMap(employerId);
  const orgRes = await query('SELECT shift_hours FROM organizations WHERE id = $1', [employerId]);
  const shiftTargetHours = (orgRes.rows.length > 0 && orgRes.rows[0].shift_hours) ? parseFloat(orgRes.rows[0].shift_hours) : 8.0;

  for (const r of rows) {
    const dIn = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp) : (r.created_at ? new Date(r.created_at) : null);
    const dStr = dIn ? dIn.toISOString().split('T')[0] : '';
    const isSunday = dIn ? dIn.getUTCDay() === 0 : false;
    const hInfo = holidaysMap.get(dStr);

    r.is_holiday_work = Boolean(isSunday || hInfo);
    r.holiday_name = hInfo ? hInfo.name : (isSunday ? 'Sunday / Weekly Off' : null);
    r.holiday_type = hInfo ? hInfo.holiday_type : (isSunday ? 'WEEKLY_OFF' : null);
    r.compoff_earned = r.is_holiday_work ? 1 : 0;

    r.exact_coordinates_url = r.exact_coordinates_url || (r.checkin_lat != null && r.checkin_lng != null ? `https://www.google.com/maps?q=${Number(r.checkin_lat).toFixed(6)},${Number(r.checkin_lng).toFixed(6)}` : null);
    r.punch_location_type = r.punch_location_type || (r.work_mode === 'TRAVEL' ? 'TRAVEL_TRANSIT' : 'FIELD_SITE');

    const netH = r.net_working_seconds != null ? (r.net_working_seconds / 3600) : 0;
    r.shift_variance_hours = Number((netH - shiftTargetHours).toFixed(2));
    r.shift_target_hours = shiftTargetHours;
  }

  if (status === 'HOLIDAY_DUTY') {
    return rows.filter(r => r.is_holiday_work);
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
    'Location Classification','Hotel / Stay Name','Hotel Room Number','Hotel Contact Phone',
    'Holiday / Sunday Duty','Holiday Name','Comp-Off Credit',
    'Check-In Date','Check-In Time','Check-In Server Timestamp (UTC)',
    'Check-In Latitude','Check-In Longitude','Check-In GPS Accuracy (m)',
    'Exact Google Maps Satellite Pin URL',
    'Check-In Geofence Distance (m)','Check-In Geofence Status','Check-In Address',
    'Checkout Date','Checkout Time','Checkout Server Timestamp (UTC)',
    'Checkout Latitude','Checkout Longitude','Checkout GPS Accuracy (m)',
    'Checkout Geofence Distance (m)','Checkout Geofence Status','Checkout Address',
    'Gross Working Hours','Break Minutes','Net Working Hours','Overtime Hours',
    'Shift Variance vs Target (Dec)','Field Site Notes','DB Sync Status','Created At'
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];
  for (const r of records) {
    const checkinDate  = r.checkin_server_timestamp  ? new Date(r.checkin_server_timestamp).toISOString().split('T')[0]  : '';
    const checkinTime  = r.checkin_server_timestamp  ? new Date(r.checkin_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    const checkoutDate = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toISOString().split('T')[0] : '';
    const checkoutTime = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    const exactMapUrl  = r.exact_coordinates_url || (r.checkin_lat != null && r.checkin_lng != null ? `https://www.google.com/maps?q=${Number(r.checkin_lat).toFixed(6)},${Number(r.checkin_lng).toFixed(6)}` : '');
    const locationTypeLabel = r.punch_location_type === 'HOTEL_STAY' ? 'Hotel / Accommodation' : (r.work_mode === 'TRAVEL' ? 'Official Transit' : 'Active Field Site');

    rows.push([
      r.id, r.employee_id, r.employee_name, r.department, r.designation, r.email,
      r.employer_name, r.team_name || 'Direct Assignment', r.state, r.district,
      r.work_mode === 'TRAVEL' ? 'Official Travel' : (r.work_mode === 'FIELD_WORK' ? 'Field Work' : 'Office Duty'), r.attendance_status,
      locationTypeLabel,
      r.hotel_name || '',
      r.hotel_room || '',
      r.hotel_phone || '',
      r.is_holiday_work ? 'Yes' : 'No',
      r.holiday_name || '',
      r.compoff_earned ? '1 Comp-Off' : '0',
      checkinDate, checkinTime, r.checkin_server_timestamp || '',
      r.checkin_lat   != null ? Number(r.checkin_lat).toFixed(6)   : '',
      r.checkin_lng   != null ? Number(r.checkin_lng).toFixed(6)   : '',
      r.checkin_accuracy  != null ? Number(r.checkin_accuracy).toFixed(1)  : '',
      exactMapUrl,
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
      r.shift_variance_hours != null ? (r.shift_variance_hours >= 0 ? `+${r.shift_variance_hours.toFixed(2)}` : r.shift_variance_hours.toFixed(2)) : '0.00',
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
    const { employee_id, work_mode, status, state, district, team_id, search } = req.query;
    const records = await getFilteredAttendanceRecords({ employerId: req.employerId, employee_id, work_mode, status, state, district, team_id, search });
    res.json({ success: true, employer_id: req.employerId, records });
  } catch (err) { res.status(500).json({ success: false, error: isProductionEnvironment() ? 'Internal server error' : err.message }); }
});

// ---------------------------------------------------------------------------
// 12a. Admin: Export CSV
// ---------------------------------------------------------------------------
router.get('/admin/attendance/export.csv', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { employee_id, work_mode, status, state, district, team_id, search } = req.query;
    const records = await getFilteredAttendanceRecords({ employerId: req.employerId, employee_id, work_mode, status, state, district, team_id, search });
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
// 12b. Admin: Manual Trigger - Send Attendance Backup Email
// ---------------------------------------------------------------------------
router.post('/admin/attendance/send-backup-email', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const { recipient_email } = req.body || {};
    const effectiveRecipient = recipient_email || emailService.getBackupRecipient();

    if (!effectiveRecipient) {
      return res.status(400).json({
        success: false,
        error: 'No recipient email specified. Please provide an email or configure BACKUP_EMAIL_RECIPIENT.'
      });
    }

    if (!emailService.isEmailConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'SMTP email credentials are not configured on the server. Please set SMTP_USER and SMTP_PASS (e.g. Gmail App Password) in environment variables.'
      });
    }

    const result = await emailService.sendDailyAttendanceBackup({
      employerId: req.employerId,
      recipientEmail: effectiveRecipient
    });

    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    attendanceService.logAudit(
      'ATTENDANCE_BACKUP_EMAILED',
      null,
      req.employerId,
      'EMAIL_BACKUP',
      'SUCCESS',
      { recipient: effectiveRecipient, recordCount: result.recordCount },
      clientIp,
      userAgent
    );

    res.json({
      success: true,
      message: result.message,
      recipient: result.recipient,
      recordCount: result.recordCount,
      filename: result.filename
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 12c. Automated Cron: Daily Attendance Backup Email
// ---------------------------------------------------------------------------
router.get('/cron/daily-attendance-backup', async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers['authorization'];
      const querySecret = req.query.secret;
      const isAuthorized = (authHeader === `Bearer ${cronSecret}`) || (querySecret === cronSecret);
      if (!isAuthorized) {
        return res.status(401).json({ success: false, error: 'Unauthorized cron request.' });
      }
    }

    if (!emailService.isEmailConfigured()) {
      console.warn('[Cron] Daily backup skipped: SMTP_USER / SMTP_PASS not configured.');
      return res.status(200).json({
        success: false,
        skipped: true,
        message: 'SMTP credentials not configured on the server. Please set SMTP_USER and SMTP_PASS.'
      });
    }

    const orgsRes = await query('SELECT id, name FROM organizations WHERE is_active = 1');
    const orgs = orgsRes.rows.length > 0 ? orgsRes.rows : [{ id: 'ORG-001', name: 'AIIMS' }];

    const results = [];
    for (const org of orgs) {
      try {
        const backupRes = await emailService.sendDailyAttendanceBackup({ employerId: org.id });
        results.push({ orgId: org.id, orgName: org.name, ...backupRes });
      } catch (backupErr) {
        console.error(`[Cron] Error backing up attendance for org ${org.id}:`, backupErr.message);
        results.push({ orgId: org.id, orgName: org.name, success: false, error: backupErr.message });
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      results
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 12d. Cumulative Individual Timesheet Helper & CSV Generator
// ---------------------------------------------------------------------------
function formatSecToHhMm(totalSec) {
  if (totalSec == null || isNaN(totalSec) || totalSec <= 0) return '0h 00m';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function generateIndividualTimesheetCsv(employee, summary, records) {
  const lines = [];

  // Title & Metadata block
  lines.push(['CUMULATIVE INDIVIDUAL TIMESHEET REPORT'].map(escapeCsvCell).join(','));
  lines.push(['Report Generated At (UTC)', new Date().toISOString(), 'Organization', employee.employer_name || 'AIIMS'].map(escapeCsvCell).join(','));
  lines.push([]);

  // Employee Profile
  lines.push(['EMPLOYEE PROFILE'].map(escapeCsvCell).join(','));
  lines.push(['Employee ID', employee.id, 'Full Name', employee.name].map(escapeCsvCell).join(','));
  lines.push(['Department', employee.department || 'CDER', 'Designation', employee.designation || 'Staff'].map(escapeCsvCell).join(','));
  lines.push(['Email Address', employee.email || 'N/A', 'Contact Phone', employee.phone || 'N/A'].map(escapeCsvCell).join(','));
  lines.push(['Team / Unit', employee.team_name || 'Direct Assignment', 'State / District', `${employee.state || 'N/A'} / ${employee.district || 'N/A'}`].map(escapeCsvCell).join(','));
  lines.push([]);

  // Cumulative Metrics
  lines.push(['CUMULATIVE ATTENDANCE & WORKING HOURS SUMMARY'].map(escapeCsvCell).join(','));
  lines.push(['Total Shifts / Check-Ins', summary.totalRecords, 'Completed Shifts (With Check-Out)', summary.completedRecords].map(escapeCsvCell).join(','));
  lines.push(['Active / In-Progress Shifts', summary.inProgressRecords, 'Shift Completion Rate', summary.completionRate + '%'].map(escapeCsvCell).join(','));
  lines.push(['Total Net Working Hours (Dec)', Number(summary.totalNetWorkingHours || 0).toFixed(2) + ' hrs', 'Total Net Working Time (HH:MM)', summary.totalNetWorkingFormatted].map(escapeCsvCell).join(','));
  lines.push(['Average Working Hours / Shift', Number(summary.avgWorkingHoursPerShift || 0).toFixed(2) + ' hrs/shift', 'Average Working Time / Shift (HH:MM)', summary.avgWorkingFormatted].map(escapeCsvCell).join(','));
  lines.push(['Standard Shift Target', `${Number(summary.targetShiftHours || 8.0).toFixed(1)} hrs/shift`, 'Total Expected Hours', `${Number(summary.totalExpectedHours || 0).toFixed(2)} hrs`].map(escapeCsvCell).join(','));
  lines.push(['Cumulative Hours Balance', `${Number(summary.hoursBalance || 0) >= 0 ? '+' : ''}${Number(summary.hoursBalance || 0).toFixed(2)} hrs (${summary.hoursBalanceStatus || 'BALANCED'})`, 'Comp-Off Credits Earned', `${summary.totalCompOffEarned || 0} Days`].map(escapeCsvCell).join(','));
  lines.push(['Total Gross Working Hours (Dec)', Number(summary.totalGrossWorkingHours || 0).toFixed(2) + ' hrs', 'Total Gross Working Time (HH:MM)', summary.totalGrossWorkingFormatted].map(escapeCsvCell).join(','));
  lines.push(['Total Break Duration (Minutes)', summary.totalBreakMinutes + ' mins', 'Total Break Duration (Hours)', Number(summary.totalBreakHours || 0).toFixed(2) + ' hrs'].map(escapeCsvCell).join(','));
  lines.push(['Total Overtime Hours (Dec)', Number(summary.totalOvertimeHours || 0).toFixed(2) + ' hrs', 'Total Overtime Time (HH:MM)', summary.totalOvertimeFormatted].map(escapeCsvCell).join(','));
  lines.push(['First Check-In Date', summary.firstRecordDate || 'N/A', 'Latest Check-In Date', summary.lastRecordDate || 'N/A'].map(escapeCsvCell).join(','));
  lines.push([]);

  // Itemized Session Log
  lines.push(['ITEMIZED CHECK-IN & CHECK-OUT ATTENDANCE LOG'].map(escapeCsvCell).join(','));
  const headers = [
    'Shift ID', 'Date', 'Day of Week',
    'Location Type', 'Hotel / Stay Name', 'Hotel Room', 'Hotel Contact Phone',
    'Check-In Time', 'Check-In Server Timestamp (UTC)', 'Check-In Address', 'Check-In Coordinates', 'Exact Google Maps URL', 'Check-In Accuracy (m)',
    'Check-Out Time', 'Check-Out Server Timestamp (UTC)', 'Check-Out Address', 'Check-Out Coordinates', 'Check-Out Accuracy (m)',
    'Attendance Status', 'Work Mode', 'Holiday / Sunday Duty', 'Holiday Name', 'Comp-Off Credit (+1)',
    'Net Working Time (HH:MM)', 'Net Working Hours (Dec)', 'Shift Variance vs Target (Dec)', 'Gross Working Time (HH:MM)', 'Gross Working Hours (Dec)',
    'Break Duration (Mins)', 'Overtime (HH:MM)', 'Overtime Hours (Dec)',
    'Field Site Notes', 'Check-In Photo URL', 'Check-Out Photo URL'
  ];
  lines.push(headers.map(escapeCsvCell).join(','));

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const r of records) {
    const dIn = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp) : null;
    const dateStr = dIn ? dIn.toISOString().split('T')[0] : '';
    const dayStr = dIn ? daysOfWeek[dIn.getUTCDay()] : '';
    const checkinTimeStr = dIn ? dIn.toLocaleTimeString('en-US', { hour12: false }) : '';

    const dOut = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp) : null;
    const checkoutTimeStr = dOut ? dOut.toLocaleTimeString('en-US', { hour12: false }) : (r.checkout_server_timestamp ? '' : 'In Progress');

    const checkinCoords = (r.checkin_lat != null && r.checkin_lng != null) ? `${Number(r.checkin_lat).toFixed(6)}, ${Number(r.checkin_lng).toFixed(6)}` : '';
    const checkoutCoords = (r.checkout_lat != null && r.checkout_lng != null) ? `${Number(r.checkout_lat).toFixed(6)}, ${Number(r.checkout_lng).toFixed(6)}` : '';
    const exactMapUrl = r.exact_coordinates_url || (r.checkin_lat != null && r.checkin_lng != null ? `https://www.google.com/maps?q=${Number(r.checkin_lat).toFixed(6)},${Number(r.checkin_lng).toFixed(6)}` : '');
    const locationTypeLabel = r.punch_location_type === 'HOTEL_STAY' ? 'Hotel / Stay' : (r.work_mode === 'TRAVEL' ? 'Official Transit' : 'Active Field Site');

    lines.push([
      r.id,
      dateStr,
      dayStr,
      locationTypeLabel,
      r.hotel_name || '',
      r.hotel_room || '',
      r.hotel_phone || '',
      checkinTimeStr,
      r.checkin_server_timestamp || '',
      r.checkin_address || '',
      checkinCoords,
      exactMapUrl,
      r.checkin_accuracy != null ? Number(r.checkin_accuracy).toFixed(1) : '',
      checkoutTimeStr,
      r.checkout_server_timestamp || '',
      r.checkout_address || '',
      checkoutCoords,
      r.checkout_accuracy != null ? Number(r.checkout_accuracy).toFixed(1) : '',
      r.attendance_status || '',
      r.work_mode === 'TRAVEL' ? 'Official Travel' : (r.work_mode === 'FIELD_WORK' ? 'Field Work' : 'Office Duty'),
      r.is_holiday_work ? 'Yes' : 'No',
      r.holiday_name || '',
      r.compoff_earned ? '1 Comp-Off' : '0',
      formatSecToHhMm(r.net_working_seconds),
      r.net_working_seconds != null ? (r.net_working_seconds / 3600).toFixed(2) : '0.00',
      r.shift_variance_hours != null ? (r.shift_variance_hours >= 0 ? `+${r.shift_variance_hours.toFixed(2)}` : r.shift_variance_hours.toFixed(2)) : '0.00',
      formatSecToHhMm(r.gross_working_seconds),
      r.gross_working_seconds != null ? (r.gross_working_seconds / 3600).toFixed(2) : '0.00',
      r.break_seconds != null ? Math.round(r.break_seconds / 60) : '0',
      formatSecToHhMm(r.overtime_seconds),
      r.overtime_seconds != null ? (r.overtime_seconds / 3600).toFixed(2) : '0.00',
      r.field_site_notes || '',
      r.checkin_photo || '',
      r.checkout_photo || ''
    ].map(escapeCsvCell).join(','));
  }

  return '\uFEFF' + lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// 12e. Admin: Cumulative Individual Timesheet JSON
// ---------------------------------------------------------------------------
router.get('/admin/employees/:id/timesheet', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const empId = req.params.id;

    const empRes = await query(
      `SELECT e.id, e.employer_id, e.name, e.email, e.phone, e.department, e.designation, e.is_admin, e.is_active,
              e.team_id, e.state, e.district, e.created_at,
              COALESCE(t.name, 'Unassigned') AS team_name,
              o.name AS employer_name
       FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id
       JOIN organizations o ON e.employer_id = o.id
       WHERE e.id = $1 AND e.employer_id = $2`,
      [empId, employerId]
    );
    const employee = empRes.rows[0];
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found for this organization.' });
    }

    const { start_date, end_date, status } = req.query;
    const params = [employerId, empId];
    let sql = `
      SELECT a.*,
             COALESCE(a.state, e.state, t.state) AS state,
             COALESCE(a.district, e.district, t.district) AS district,
             COALESCE(t.name, 'Direct Assignment') AS team_name
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      WHERE a.employer_id = $1 AND a.employee_id = $2
    `;

    if (status && status !== 'ALL') {
      params.push(status);
      sql += ` AND a.attendance_status = $${params.length}`;
    }
    if (start_date) {
      params.push(`${start_date}T00:00:00.000Z`);
      sql += ` AND (a.checkin_server_timestamp >= $${params.length} OR a.created_at >= $${params.length})`;
    }
    if (end_date) {
      params.push(`${end_date}T23:59:59.999Z`);
      sql += ` AND (a.checkin_server_timestamp <= $${params.length} OR a.created_at <= $${params.length})`;
    }

    sql += ' ORDER BY a.checkin_server_timestamp DESC, a.created_at DESC';

    const recordsRes = await query(sql, params);
    const rows = recordsRes.rows;

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

    const holidaysMap = await getOrganizationHolidaysMap(employerId);
    const orgRes = await query('SELECT shift_hours FROM organizations WHERE id = $1', [employerId]);
    const shiftTargetHours = (orgRes.rows.length > 0 && orgRes.rows[0].shift_hours) ? parseFloat(orgRes.rows[0].shift_hours) : 8.0;

    let totalCompOffEarned = 0;
    for (const r of rows) {
      const dIn = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp) : (r.created_at ? new Date(r.created_at) : null);
      const dStr = dIn ? dIn.toISOString().split('T')[0] : '';
      const isSunday = dIn ? dIn.getUTCDay() === 0 : false;
      const hInfo = holidaysMap.get(dStr);

      r.is_holiday_work = Boolean(isSunday || hInfo);
      r.holiday_name = hInfo ? hInfo.name : (isSunday ? 'Sunday / Weekly Off' : null);
      r.holiday_type = hInfo ? hInfo.holiday_type : (isSunday ? 'WEEKLY_OFF' : null);
      r.compoff_earned = r.is_holiday_work ? 1 : 0;
      if (r.compoff_earned > 0) totalCompOffEarned++;

      const netH = r.net_working_seconds != null ? (r.net_working_seconds / 3600) : 0;
      r.shift_variance_hours = Number((netH - shiftTargetHours).toFixed(2));
      r.shift_target_hours = shiftTargetHours;
    }

    const totalRecords = rows.length;
    const completedRecords = rows.filter(r => r.checkout_server_timestamp != null).length;
    const inProgressRecords = totalRecords - completedRecords;

    const totalNetWorkingSeconds = rows.reduce((acc, r) => acc + (Number(r.net_working_seconds) || 0), 0);
    const totalGrossWorkingSeconds = rows.reduce((acc, r) => acc + (Number(r.gross_working_seconds) || 0), 0);
    const totalBreakSeconds = rows.reduce((acc, r) => acc + (Number(r.break_seconds) || 0), 0);
    const totalOvertimeSeconds = rows.reduce((acc, r) => acc + (Number(r.overtime_seconds) || 0), 0);

    const totalNetWorkingHours = Number((totalNetWorkingSeconds / 3600).toFixed(2));
    const totalGrossWorkingHours = Number((totalGrossWorkingSeconds / 3600).toFixed(2));
    const totalBreakMinutes = Math.round(totalBreakSeconds / 60);
    const totalBreakHours = Number((totalBreakSeconds / 3600).toFixed(2));
    const totalOvertimeHours = Number((totalOvertimeSeconds / 3600).toFixed(2));

    const avgDenominator = completedRecords > 0 ? completedRecords : (totalRecords > 0 ? totalRecords : 1);
    const avgWorkingSecondsPerShift = Math.round(totalNetWorkingSeconds / avgDenominator);
    const avgWorkingHoursPerShift = Number((totalNetWorkingSeconds / avgDenominator / 3600).toFixed(2));

    const totalExpectedHours = Number((completedRecords * shiftTargetHours).toFixed(2));
    const hoursBalance = Number((totalNetWorkingHours - totalExpectedHours).toFixed(2));
    let hoursBalanceStatus = 'BALANCED';
    if (hoursBalance > 0.1) hoursBalanceStatus = 'SURPLUS';
    else if (hoursBalance < -0.1) hoursBalanceStatus = 'DEFICIT';

    const completionRate = totalRecords > 0 ? Math.round((completedRecords / totalRecords) * 100) : 0;

    const summary = {
      totalRecords,
      completedRecords,
      inProgressRecords,
      totalNetWorkingSeconds,
      totalNetWorkingHours,
      totalNetWorkingFormatted: formatSecToHhMm(totalNetWorkingSeconds),
      avgWorkingSecondsPerShift,
      avgWorkingHoursPerShift,
      avgWorkingFormatted: formatSecToHhMm(avgWorkingSecondsPerShift),
      targetShiftHours,
      totalExpectedHours,
      hoursBalance,
      hoursBalanceStatus,
      totalCompOffEarned,
      totalGrossWorkingSeconds,
      totalGrossWorkingHours,
      totalGrossWorkingFormatted: formatSecToHhMm(totalGrossWorkingSeconds),
      totalBreakSeconds,
      totalBreakMinutes,
      totalBreakHours,
      totalBreakFormatted: formatSecToHhMm(totalBreakSeconds),
      totalOvertimeSeconds,
      totalOvertimeHours,
      totalOvertimeFormatted: formatSecToHhMm(totalOvertimeSeconds),
      completionRate,
      firstRecordDate: rows.length > 0 && rows[rows.length - 1].checkin_server_timestamp ? rows[rows.length - 1].checkin_server_timestamp.split('T')[0] : null,
      lastRecordDate: rows.length > 0 && rows[0].checkin_server_timestamp ? rows[0].checkin_server_timestamp.split('T')[0] : null
    };

    res.json({
      success: true,
      employee,
      summary,
      records: rows
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 12f. Admin: Export Individual Timesheet (.CSV)
// ---------------------------------------------------------------------------
router.get('/admin/employees/:id/timesheet/export.csv', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const empId = req.params.id;

    const empRes = await query(
      `SELECT e.id, e.employer_id, e.name, e.email, e.phone, e.department, e.designation, e.is_admin, e.is_active,
              e.team_id, e.state, e.district, e.created_at,
              COALESCE(t.name, 'Unassigned') AS team_name,
              o.name AS employer_name
       FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id
       JOIN organizations o ON e.employer_id = o.id
       WHERE e.id = $1 AND e.employer_id = $2`,
      [empId, employerId]
    );
    const employee = empRes.rows[0];
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    const { start_date, end_date, status } = req.query;
    const params = [employerId, empId];
    let sql = `
      SELECT a.*,
             COALESCE(a.state, e.state, t.state) AS state,
             COALESCE(a.district, e.district, t.district) AS district,
             COALESCE(t.name, 'Direct Assignment') AS team_name
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      WHERE a.employer_id = $1 AND a.employee_id = $2
    `;

    if (status && status !== 'ALL') {
      params.push(status);
      sql += ` AND a.attendance_status = $${params.length}`;
    }
    if (start_date) {
      params.push(`${start_date}T00:00:00.000Z`);
      sql += ` AND (a.checkin_server_timestamp >= $${params.length} OR a.created_at >= $${params.length})`;
    }
    if (end_date) {
      params.push(`${end_date}T23:59:59.999Z`);
      sql += ` AND (a.checkin_server_timestamp <= $${params.length} OR a.created_at <= $${params.length})`;
    }

    sql += ' ORDER BY a.checkin_server_timestamp DESC, a.created_at DESC';

    const recordsRes = await query(sql, params);
    const rows = recordsRes.rows;

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

    const holidaysMap = await getOrganizationHolidaysMap(employerId);
    const orgRes = await query('SELECT shift_hours FROM organizations WHERE id = $1', [employerId]);
    const shiftTargetHours = (orgRes.rows.length > 0 && orgRes.rows[0].shift_hours) ? parseFloat(orgRes.rows[0].shift_hours) : 8.0;

    let totalCompOffEarned = 0;
    for (const r of rows) {
      const dIn = r.checkin_server_timestamp ? new Date(r.checkin_server_timestamp) : (r.created_at ? new Date(r.created_at) : null);
      const dStr = dIn ? dIn.toISOString().split('T')[0] : '';
      const isSunday = dIn ? dIn.getUTCDay() === 0 : false;
      const hInfo = holidaysMap.get(dStr);

      r.is_holiday_work = Boolean(isSunday || hInfo);
      r.holiday_name = hInfo ? hInfo.name : (isSunday ? 'Sunday / Weekly Off' : null);
      r.holiday_type = hInfo ? hInfo.holiday_type : (isSunday ? 'WEEKLY_OFF' : null);
      r.compoff_earned = r.is_holiday_work ? 1 : 0;
      if (r.compoff_earned > 0) totalCompOffEarned++;

      const netH = r.net_working_seconds != null ? (r.net_working_seconds / 3600) : 0;
      r.shift_variance_hours = Number((netH - shiftTargetHours).toFixed(2));
      r.shift_target_hours = shiftTargetHours;
    }

    const totalRecords = rows.length;
    const completedRecords = rows.filter(r => r.checkout_server_timestamp != null).length;
    const inProgressRecords = totalRecords - completedRecords;

    const totalNetWorkingSeconds = rows.reduce((acc, r) => acc + (Number(r.net_working_seconds) || 0), 0);
    const totalGrossWorkingSeconds = rows.reduce((acc, r) => acc + (Number(r.gross_working_seconds) || 0), 0);
    const totalBreakSeconds = rows.reduce((acc, r) => acc + (Number(r.break_seconds) || 0), 0);
    const totalOvertimeSeconds = rows.reduce((acc, r) => acc + (Number(r.overtime_seconds) || 0), 0);

    const totalNetWorkingHours = Number((totalNetWorkingSeconds / 3600).toFixed(2));
    const totalGrossWorkingHours = Number((totalGrossWorkingSeconds / 3600).toFixed(2));
    const totalBreakMinutes = Math.round(totalBreakSeconds / 60);
    const totalBreakHours = Number((totalBreakSeconds / 3600).toFixed(2));
    const totalOvertimeHours = Number((totalOvertimeSeconds / 3600).toFixed(2));

    const avgDenominator = completedRecords > 0 ? completedRecords : (totalRecords > 0 ? totalRecords : 1);
    const avgWorkingSecondsPerShift = Math.round(totalNetWorkingSeconds / avgDenominator);
    const avgWorkingHoursPerShift = Number((totalNetWorkingSeconds / avgDenominator / 3600).toFixed(2));

    const totalExpectedHours = Number((completedRecords * shiftTargetHours).toFixed(2));
    const hoursBalance = Number((totalNetWorkingHours - totalExpectedHours).toFixed(2));
    let hoursBalanceStatus = 'BALANCED';
    if (hoursBalance > 0.1) hoursBalanceStatus = 'SURPLUS';
    else if (hoursBalance < -0.1) hoursBalanceStatus = 'DEFICIT';

    const completionRate = totalRecords > 0 ? Math.round((completedRecords / totalRecords) * 100) : 0;

    const summary = {
      totalRecords,
      completedRecords,
      inProgressRecords,
      totalNetWorkingSeconds,
      totalNetWorkingHours,
      totalNetWorkingFormatted: formatSecToHhMm(totalNetWorkingSeconds),
      avgWorkingSecondsPerShift,
      avgWorkingHoursPerShift,
      avgWorkingFormatted: formatSecToHhMm(avgWorkingSecondsPerShift),
      targetShiftHours,
      totalExpectedHours,
      hoursBalance,
      hoursBalanceStatus,
      totalCompOffEarned,
      totalGrossWorkingSeconds,
      totalGrossWorkingHours,
      totalGrossWorkingFormatted: formatSecToHhMm(totalGrossWorkingSeconds),
      totalBreakSeconds,
      totalBreakMinutes,
      totalBreakHours,
      totalBreakFormatted: formatSecToHhMm(totalBreakSeconds),
      totalOvertimeSeconds,
      totalOvertimeHours,
      totalOvertimeFormatted: formatSecToHhMm(totalOvertimeSeconds),
      completionRate,
      firstRecordDate: rows.length > 0 && rows[rows.length - 1].checkin_server_timestamp ? rows[rows.length - 1].checkin_server_timestamp.split('T')[0] : null,
      lastRecordDate: rows.length > 0 && rows[0].checkin_server_timestamp ? rows[0].checkin_server_timestamp.split('T')[0] : null
    };

    const csvData = generateIndividualTimesheetCsv(employee, summary, rows);
    const dateStr = new Date().toISOString().split('T')[0];
    const safeName = (employee.name || 'employee').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `timesheet_${safeName}_${empId}_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csvData);
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 12g. Admin: Organization Holidays Management
// ---------------------------------------------------------------------------
router.get('/admin/holidays', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const result = await query(
      `SELECT id, employer_id, holiday_date, name, holiday_type, created_at
       FROM organization_holidays
       WHERE employer_id = $1
       ORDER BY holiday_date ASC`,
      [employerId]
    );

    if (result.rows.length === 0) {
      const defaultHolidays = [
        { date: '2026-01-26', name: 'Republic Day', type: 'NATIONAL' },
        { date: '2026-03-04', name: 'Holi', type: 'GAZETTED' },
        { date: '2026-03-21', name: 'Id-ul-Fitr', type: 'GAZETTED' },
        { date: '2026-04-03', name: 'Good Friday', type: 'GAZETTED' },
        { date: '2026-04-14', name: 'Dr. B.R. Ambedkar Jayanti', type: 'GAZETTED' },
        { date: '2026-05-27', name: 'Id-ul-Zuha (Bakrid)', type: 'GAZETTED' },
        { date: '2026-08-15', name: 'Independence Day', type: 'NATIONAL' },
        { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti', type: 'NATIONAL' },
        { date: '2026-10-20', name: 'Dussehra (Vijay Dashami)', type: 'GAZETTED' },
        { date: '2026-11-08', name: 'Diwali (Deepavali)', type: 'GAZETTED' },
        { date: '2026-12-25', name: 'Christmas Day', type: 'GAZETTED' }
      ];
      for (const h of defaultHolidays) {
        const hId = `HOL-${employerId}-${h.date}`;
        await query(
          `INSERT INTO organization_holidays (id, employer_id, holiday_date, name, holiday_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (employer_id, holiday_date) DO NOTHING`,
          [hId, employerId, h.date, h.name, h.type]
        );
      }
      const refetched = await query(
        `SELECT id, employer_id, holiday_date, name, holiday_type, created_at
         FROM organization_holidays
         WHERE employer_id = $1
         ORDER BY holiday_date ASC`,
        [employerId]
      );
      return res.json({ success: true, holidays: refetched.rows });
    }

    res.json({ success: true, holidays: result.rows });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

router.post('/admin/holidays', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const { holiday_date, name, holiday_type } = req.body;

    if (!holiday_date || !name) {
      return res.status(400).json({ success: false, error: 'Holiday date and name are required.' });
    }

    const dStr = String(holiday_date).trim().split('T')[0];
    const hId = `HOL-${employerId}-${dStr}-${Date.now().toString(36)}`;
    const hType = holiday_type || 'GAZETTED';

    await query(
      `INSERT INTO organization_holidays (id, employer_id, holiday_date, name, holiday_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employer_id, holiday_date) DO UPDATE
       SET name = EXCLUDED.name, holiday_type = EXCLUDED.holiday_type`,
      [hId, employerId, dStr, String(name).trim(), hType]
    );

    res.json({ success: true, message: 'Holiday saved successfully.' });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

router.delete('/admin/holidays/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const hId = req.params.id;

    await query(
      'DELETE FROM organization_holidays WHERE id = $1 AND employer_id = $2',
      [hId, employerId]
    );

    res.json({ success: true, message: 'Holiday deleted successfully.' });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// ---------------------------------------------------------------------------
// 12f. Admin: Leave Management & Unmarked Field Personnel
// ---------------------------------------------------------------------------
router.get('/admin/leaves', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    let targetDate = req.query.date ? String(req.query.date).trim().split('T')[0] : '';
    if (!targetDate) {
      targetDate = attendanceService.getLocalDateString(new Date(), 'Asia/Kolkata');
    }

    // Ensure employee_leaves table exists
    await query(`
      CREATE TABLE IF NOT EXISTS employee_leaves (
        id TEXT PRIMARY KEY,
        employer_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        leave_date DATE NOT NULL,
        leave_type TEXT NOT NULL DEFAULT 'UNMARKED_ABSENCE',
        status TEXT NOT NULL DEFAULT 'PENDING',
        reason TEXT,
        applied_by TEXT DEFAULT 'SYSTEM_ABSENCE',
        admin_remarks TEXT,
        regularized_attendance_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(employer_id, employee_id, leave_date)
      )
    `).catch(() => {});

    // 1. Fetch all active field staff
    const employeesRes = await query(
      `SELECT e.id, e.name, e.email, e.phone, e.department, e.designation,
              e.team_id, e.state, e.district,
              COALESCE(t.name, 'Direct Assignment') AS team_name
       FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id
       WHERE e.employer_id = $1 AND e.is_active = 1
       ORDER BY e.name ASC`,
      [employerId]
    );
    const allEmployees = employeesRes.rows;

    // 2. Fetch all attendance records on this date
    const attendanceRes = await query(
      `SELECT a.*, e.name AS employee_name
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.employer_id = $1
         AND (
           (a.checkin_server_timestamp IS NOT NULL AND a.checkin_server_timestamp::text LIKE $2)
           OR (a.created_at::text LIKE $2)
         )`,
      [employerId, `${targetDate}%`]
    );
    const attendanceMap = new Map();
    for (const att of attendanceRes.rows) {
      attendanceMap.set(att.employee_id, att);
    }

    // 3. Fetch all recorded leaves on this date
    const leavesRes = await query(
      `SELECT l.*, e.name AS employee_name, e.department, e.designation, e.phone,
              COALESCE(t.name, 'Direct Assignment') AS team_name,
              COALESCE(e.state, t.state) AS state,
              COALESCE(e.district, t.district) AS district
       FROM employee_leaves l
       JOIN employees e ON l.employee_id = e.id
       LEFT JOIN teams t ON e.team_id = t.id
       WHERE l.employer_id = $1 AND (l.leave_date = $2::date OR l.leave_date::text = $2)
       ORDER BY l.created_at DESC`,
      [employerId, targetDate]
    );
    const leaves = leavesRes.rows;
    const leaveMap = new Map();
    for (const lev of leaves) {
      leaveMap.set(lev.employee_id, lev);
    }

    // 4. Classify each employee
    const unmarkedEmployees = [];
    let presentCount = 0;
    let regularizedCount = 0;

    for (const emp of allEmployees) {
      const att = attendanceMap.get(emp.id);
      const lev = leaveMap.get(emp.id);

      if (att) {
        if (att.is_regularized) regularizedCount++;
        else presentCount++;
      } else {
        // Person has not marked check-in / check-out
        unmarkedEmployees.push({
          ...emp,
          has_checkin: false,
          has_checkout: false,
          attendance_id: null,
          unmarked_status: 'NO_PUNCH',
          unmarked_label: 'No Punch Recorded',
          is_recorded_on_leave: Boolean(lev),
          leave_id: lev ? lev.id : null,
          leave_type: lev ? lev.leave_type : null,
          leave_status: lev ? lev.status : null,
          leave_reason: lev ? lev.reason : null
        });
      }
    }

    // Also check if any employee checked in but has missing checkout
    for (const att of attendanceRes.rows) {
      if (att.attendance_status === 'CHECKED_IN' && !att.checkout_server_timestamp) {
        const existingUnmarked = unmarkedEmployees.find(u => u.id === att.employee_id);
        if (!existingUnmarked) {
          const emp = allEmployees.find(e => e.id === att.employee_id);
          if (emp) {
            const lev = leaveMap.get(emp.id);
            unmarkedEmployees.push({
              ...emp,
              has_checkin: true,
              has_checkout: false,
              attendance_id: att.id,
              unmarked_status: 'MISSING_CHECKOUT',
              unmarked_label: 'Checked In Only (Missing Checkout)',
              is_recorded_on_leave: Boolean(lev),
              leave_id: lev ? lev.id : null,
              leave_type: lev ? lev.leave_type : null,
              leave_status: lev ? lev.status : null,
              leave_reason: lev ? lev.reason : null
            });
          }
        }
      }
    }

    const metrics = {
      targetDate,
      totalFieldEmployees: allEmployees.length,
      presentCount,
      unmarkedCount: unmarkedEmployees.length,
      onLeaveCount: leaves.filter(l => l.status !== 'REGULARIZED').length,
      regularizedCount
    };

    res.json({
      success: true,
      targetDate,
      metrics,
      unmarkedEmployees,
      leaves
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// Sync / Add all unmarked field workers to the leave list
router.post('/admin/leaves/sync-unmarked', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    let targetDate = req.body?.date ? String(req.body.date).trim().split('T')[0] : '';
    if (!targetDate) {
      targetDate = attendanceService.getLocalDateString(new Date(), 'Asia/Kolkata');
    }

    const defaultLeaveType = req.body?.leave_type || 'UNMARKED_ABSENCE';
    const defaultReason = req.body?.reason || 'Field Duty: Unmarked Check-In/Check-Out';

    // 1. Get active employees
    const employeesRes = await query(
      'SELECT id, name FROM employees WHERE employer_id = $1 AND is_active = 1',
      [employerId]
    );

    // 2. Get attendance records on this date
    const attRes = await query(
      `SELECT employee_id FROM attendance 
       WHERE employer_id = $1 
         AND (
           (checkin_server_timestamp IS NOT NULL AND checkin_server_timestamp::text LIKE $2)
           OR (created_at::text LIKE $2)
         )
         AND attendance_status = 'COMPLETED'`,
      [employerId, `${targetDate}%`]
    );
    const presentEmpIds = new Set(attRes.rows.map(r => r.employee_id));

    // 3. Get existing leaves for this date
    const levRes = await query(
      `SELECT employee_id FROM employee_leaves 
       WHERE employer_id = $1 AND (leave_date = $2::date OR leave_date::text = $2)`,
      [employerId, targetDate]
    );
    const existingLeaveEmpIds = new Set(levRes.rows.map(r => r.employee_id));

    let addedCount = 0;
    for (const emp of employeesRes.rows) {
      if (!presentEmpIds.has(emp.id) && !existingLeaveEmpIds.has(emp.id)) {
        const leaveId = `LEV-${employerId}-${emp.id}-${targetDate.replace(/-/g, '')}-${Date.now().toString(36)}`;
        await query(
          `INSERT INTO employee_leaves 
             (id, employer_id, employee_id, leave_date, leave_type, status, reason, applied_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, 'SYSTEM_ABSENCE', NOW(), NOW())
           ON CONFLICT (employer_id, employee_id, leave_date) DO NOTHING`,
          [leaveId, employerId, emp.id, targetDate, defaultLeaveType, defaultReason]
        );
        addedCount++;
      }
    }

    attendanceService.logAudit(
      'LEAVES_BATCH_SYNCED_UNMARKED',
      null,
      employerId,
      'BATCH_LEAVE_ADD',
      'SUCCESS',
      { date: targetDate, addedCount },
      req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
      req.headers['user-agent'] || 'Unknown'
    );

    res.json({
      success: true,
      addedCount,
      targetDate,
      message: `Successfully added ${addedCount} unmarked field workers to the leave list for ${targetDate}.`
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// Add single leave entry
router.post('/admin/leaves', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const { employee_id, leave_date, leave_type, status, reason, admin_remarks } = req.body;

    if (!employee_id || !leave_date) {
      return res.status(400).json({ success: false, error: 'Employee ID and leave date are required.' });
    }

    const dStr = String(leave_date).trim().split('T')[0];
    const lType = leave_type || 'CASUAL_LEAVE';
    const lStatus = status || 'APPROVED';
    const leaveId = `LEV-${employerId}-${employee_id}-${dStr.replace(/-/g, '')}-${Date.now().toString(36)}`;

    await query(
      `INSERT INTO employee_leaves 
         (id, employer_id, employee_id, leave_date, leave_type, status, reason, applied_by, admin_remarks, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ADMIN', $8, NOW(), NOW())
       ON CONFLICT (employer_id, employee_id, leave_date) DO UPDATE
       SET leave_type = EXCLUDED.leave_type,
           status = EXCLUDED.status,
           reason = COALESCE(EXCLUDED.reason, employee_leaves.reason),
           admin_remarks = COALESCE(EXCLUDED.admin_remarks, employee_leaves.admin_remarks),
           updated_at = NOW()`,
      [leaveId, employerId, employee_id, dStr, lType, lStatus, reason || null, admin_remarks || null]
    );

    res.json({ success: true, message: 'Leave record recorded successfully.' });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// Update leave entry
router.put('/admin/leaves/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const leaveId = req.params.id;
    const { leave_type, status, reason, admin_remarks } = req.body;

    await query(
      `UPDATE employee_leaves
       SET leave_type = COALESCE($1, leave_type),
           status = COALESCE($2, status),
           reason = COALESCE($3, reason),
           admin_remarks = COALESCE($4, admin_remarks),
           updated_at = NOW()
       WHERE id = $5 AND employer_id = $6`,
      [leave_type || null, status || null, reason || null, admin_remarks || null, leaveId, employerId]
    );

    res.json({ success: true, message: 'Leave record updated successfully.' });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// Delete leave entry
router.delete('/admin/leaves/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const leaveId = req.params.id;

    await query(
      'DELETE FROM employee_leaves WHERE id = $1 AND employer_id = $2',
      [leaveId, employerId]
    );

    res.json({ success: true, message: 'Leave record removed.' });
  } catch (err) {
    return handleApiError(res, req, err);
  }
});

// Alter & Regularize Attendance (Core User Feature)
router.post('/admin/attendance/alter', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const employerId = req.employerId;
    const {
      employee_id,
      date,
      checkin_time,
      checkout_time,
      work_mode,
      state,
      district,
      field_site_notes,
      alteration_reason,
      attendance_status,
      leave_id,
      attendance_id
    } = req.body;

    if (!employee_id || !date) {
      return res.status(400).json({ success: false, error: 'Employee ID and attendance date are required.' });
    }
    if (!alteration_reason || !String(alteration_reason).trim()) {
      return res.status(400).json({ success: false, error: 'Alteration reason is mandatory for audit compliance.' });
    }

    // Verify employee
    const empRes = await query('SELECT * FROM employees WHERE id = $1 AND employer_id = $2', [employee_id, employerId]);
    const employee = empRes.rows[0];
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found.' });
    }

    // Verify organization
    const orgRes = await query('SELECT * FROM organizations WHERE id = $1', [employerId]);
    const org = orgRes.rows[0];
    const shiftTargetHours = (org && org.shift_hours) ? parseFloat(org.shift_hours) : 8.0;

    const dateStr = String(date).trim().split('T')[0];
    const inTime = checkin_time || '09:00';
    const outTime = checkout_time || '17:30';

    // Construct timestamps
    const checkinIso = `${dateStr}T${inTime.length === 5 ? inTime + ':00' : inTime}.000Z`;
    const checkoutIso = `${dateStr}T${outTime.length === 5 ? outTime + ':00' : outTime}.000Z`;

    const checkinMs = new Date(checkinIso).getTime();
    const checkoutMs = new Date(checkoutIso).getTime();
    let netWorkingSeconds = 0;
    if (checkoutMs > checkinMs) {
      netWorkingSeconds = Math.round((checkoutMs - checkinMs) / 1000);
    } else {
      netWorkingSeconds = Math.round(shiftTargetHours * 3600);
    }

    const overtimeSeconds = Math.max(0, netWorkingSeconds - Math.round(shiftTargetHours * 3600));
    const effectiveStatus = attendance_status || 'COMPLETED';
    const effectiveMode = (work_mode === 'TRAVEL' || work_mode === 'FIELD_WORK') ? work_mode : 'FIELD_WORK';
    const finalState = state || employee.state || null;
    const finalDistrict = district || employee.district || null;
    const siteNotes = field_site_notes || `Field regularized attendance (${alteration_reason})`;
    const adminUser = req.adminUsername || 'aiims_admin';

    let targetAttendanceId = attendance_id || null;

    // Check if attendance already exists for this employee on this date
    if (!targetAttendanceId) {
      const existingAttRes = await query(
        `SELECT id FROM attendance 
         WHERE employer_id = $1 AND employee_id = $2 
           AND (
             (checkin_server_timestamp IS NOT NULL AND checkin_server_timestamp::text LIKE $3)
             OR (created_at::text LIKE $3)
           )
         LIMIT 1`,
        [employerId, employee_id, `${dateStr}%`]
      );
      if (existingAttRes.rows.length > 0) {
        targetAttendanceId = existingAttRes.rows[0].id;
      }
    }

    if (targetAttendanceId) {
      // UPDATE existing attendance record
      await query(
        `UPDATE attendance SET
           attendance_status = $1,
           checkin_server_timestamp = $2,
           checkout_server_timestamp = $3,
           gross_working_seconds = $4,
           break_seconds = 0,
           net_working_seconds = $4,
           overtime_seconds = $5,
           work_mode = $6,
           field_site_notes = $7,
           state = $8,
           district = $9,
           location_place_name = 'Admin Altered / Regularized',
           is_regularized = 1,
           regularized_by = $10,
           regularization_notes = $11,
           updated_at = NOW()
         WHERE id = $12 AND employer_id = $13`,
        [
          effectiveStatus,
          checkinIso,
          checkoutIso,
          netWorkingSeconds,
          overtimeSeconds,
          effectiveMode,
          siteNotes,
          finalState,
          finalDistrict,
          adminUser,
          alteration_reason,
          targetAttendanceId,
          employerId
        ]
      );
    } else {
      // INSERT new regularized attendance record
      targetAttendanceId = `ATT-REG-${employee_id}-${dateStr.replace(/-/g, '')}-${Date.now().toString(36)}`;
      const officeLat = org ? parseFloat(org.office_lat || '28.5672') : 28.5672;
      const officeLng = org ? parseFloat(org.office_lng || '77.2100') : 77.2100;

      await query(
        `INSERT INTO attendance (
           id, employee_id, employer_id, attendance_status,
           checkin_photo, checkin_lat, checkin_lng, checkin_accuracy,
           checkin_server_timestamp, checkin_address,
           checkout_photo, checkout_lat, checkout_lng, checkout_accuracy,
           checkout_server_timestamp, checkout_address,
           gross_working_seconds, break_seconds, net_working_seconds, overtime_seconds,
           work_mode, field_site_notes, state, district, team_id,
           location_place_name, location_place_type,
           is_regularized, regularized_by, regularization_notes,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, 0,
           $8, $9,
           $5, $6, $7, 0,
           $10, $9,
           $11, 0, $11, $12,
           $13, $14, $15, $16, $17,
           'Admin Altered / Regularized', 'FIELD_SITE',
           1, $18, $19,
           NOW(), NOW()
         )`,
        [
          targetAttendanceId, employee_id, employerId, effectiveStatus,
          'ADMIN_REGULARIZED_PUNCH', officeLat, officeLng,
          checkinIso, `${siteNotes} (Admin Verified)`,
          checkoutIso,
          netWorkingSeconds, overtimeSeconds,
          effectiveMode, siteNotes, finalState, finalDistrict, employee.team_id || null,
          adminUser, alteration_reason
        ]
      );
    }

    // 3. If there was a corresponding leave record, update it to REGULARIZED
    await query(
      `UPDATE employee_leaves SET
         status = 'REGULARIZED',
         regularized_attendance_id = $1,
         admin_remarks = COALESCE(admin_remarks, '') || ' [Attendance Altered & Regularized: ' || $2 || ']',
         updated_at = NOW()
       WHERE employer_id = $3 AND employee_id = $4 AND (leave_date = $5::date OR leave_date::text = $5)`,
      [targetAttendanceId, alteration_reason, employerId, employee_id, dateStr]
    );

    // 4. Log immutable audit trail
    attendanceService.logAudit(
      'ATTENDANCE_ALTERED_BY_ADMIN',
      employee_id,
      employerId,
      'ALTER_ATTENDANCE',
      'SUCCESS',
      {
        attendance_id: targetAttendanceId,
        date: dateStr,
        checkin: checkinIso,
        checkout: checkoutIso,
        net_working_seconds: netWorkingSeconds,
        hours: (netWorkingSeconds / 3600).toFixed(2),
        work_mode: effectiveMode,
        reason: alteration_reason,
        regularized_by: adminUser
      },
      req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
      req.headers['user-agent'] || 'Unknown'
    );

    res.json({
      success: true,
      attendance_id: targetAttendanceId,
      net_working_hours: (netWorkingSeconds / 3600).toFixed(2),
      message: `Attendance for ${employee.name} (${employee_id}) successfully altered and verified for ${dateStr}.`
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
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
// 14c. Admin: Delete Single Attendance Record
// ---------------------------------------------------------------------------
router.delete('/admin/attendance/:id', requireAuthenticatedAdmin, async (req, res) => {
  try {
    const recordId   = req.params.id;
    const employerId = req.employerId;

    const recordRes = await query(
      `SELECT a.id, a.employee_id, a.employer_id, a.checkin_photo, a.checkout_photo, e.name AS employee_name
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.id = $1 AND a.employer_id = $2`,
      [recordId, employerId]
    );

    const record = recordRes.rows[0];
    if (!record) {
      return res.status(404).json({ success: false, error: 'Attendance record not found for this employer organization.' });
    }

    // 1. Delete dependent break records to avoid foreign key constraint violations
    await query('DELETE FROM breaks WHERE attendance_id = $1', [recordId]);

    // 2. Delete corresponding external sync records
    await query('DELETE FROM external_sync_records WHERE id = $1', [recordId]);

    // 3. Asynchronously remove uploaded photos if stored
    if (record.checkin_photo) {
      await storageService.deleteAttendancePhoto(record.checkin_photo).catch(err => {
        console.warn('[Storage] Could not delete checkin photo:', err.message);
      });
    }
    if (record.checkout_photo) {
      await storageService.deleteAttendancePhoto(record.checkout_photo).catch(err => {
        console.warn('[Storage] Could not delete checkout photo:', err.message);
      });
    }

    // 4. Delete the attendance record row
    await query('DELETE FROM attendance WHERE id = $1 AND employer_id = $2', [recordId, employerId]);

    // 5. Audit log entry
    const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    attendanceService.logAudit(
      'ATTENDANCE_RECORD_DELETED',
      record.employee_id,
      employerId,
      'DELETE_ATTENDANCE',
      'SUCCESS',
      { attendance_id: recordId, employee_name: record.employee_name },
      clientIp,
      userAgent
    );

    res.json({
      success: true,
      message: `Attendance record ${recordId} for ${record.employee_name} permanently deleted.`
    });
  } catch (err) {
    return handleApiError(res, req, err);
  }
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

router.getOrganizationHolidaysMap = getOrganizationHolidaysMap;
router.generateAttendanceCsv = generateAttendanceCsv;
router.generateIndividualTimesheetCsv = generateIndividualTimesheetCsv;

module.exports = router;
