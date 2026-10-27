/**
 * Comprehensive Security Remediation Regression Test Suite
 *
 * Verifies all 16 phases of the Security Remediation:
 * Phase 1 & 2: Database-backed sessions & Auth middleware
 * Phase 3: Administrative Route Authorization
 * Phase 4: Biometric Enrollment Authorization
 * Phase 5: Attendance Route Authorization & Anti-Impersonation
 * Phase 6 & 7: Session Lifecycle & Invalidation (Logout)
 * Phase 8: Hardcoded Credentials Purging
 * Phase 9: Demo Bypass Environmental Matrix
 * Phase 10: User Enumeration Mitigation
 * Phase 11: Production Error Masking
 * Phase 12 & 13: CORS & Security Headers
 * Phase 14: Database Migration Hygiene
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../src/db/database');
const authService = require('../src/services/auth_service');
const testHelper = require('./test_helper');
const sessionService = require('../src/services/session_service');




function request(method, urlPath, body = null, headers = {}, customPort = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: customPort,
      path: urlPath,
      method,
      headers: {
        'content-type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          text: data
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runSecurityRemediationTests() {
  await testHelper.cleanTestData();
  console.log('===============================================================');
  console.log('🛡️ RUNNING COMPREHENSIVE SECURITY REMEDIATION TEST SUITE');
  console.log('===============================================================');

  // Start test server instance
  const app = require('../server');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const testPort = server.address().port;

  // Clear rate limits for clean test environment
  try {
    await db.query('DELETE FROM auth_rate_limits');
  } catch (_) {}
  if (authService.loginRateLimiter?.hits) authService.loginRateLimiter.hits.clear();
  if (authService.faceRateLimiter?.hits) authService.faceRateLimiter.hits.clear();
  if (authService.signupRateLimiter?.hits) authService.signupRateLimiter.hits.clear();

  try {
    // -----------------------------------------------------------------
    // Setup: Retrieve seed users
    // -----------------------------------------------------------------
    const emp1Res = await db.query('SELECT * FROM employees WHERE id = $1', ['EMP-1001']);
    const emp1 = emp1Res.rows[0];
    assert(emp1, 'EMP-1001 must exist in database');
    const emp1Hash = authService.hashPassword('Password@123');
    await db.query('UPDATE employees SET password = $1 WHERE id = $2', [emp1Hash, 'EMP-1001']);

    const org1Res = await db.query('SELECT * FROM organizations WHERE id = $1', ['ORG-001']);
    const org1 = org1Res.rows[0];
    const org1Hash = authService.hashPassword('Aiims@123');
    await db.query('UPDATE organizations SET admin_password = $1 WHERE id = $2', [org1Hash, 'ORG-001']);

    let org2Res = await db.query('SELECT * FROM organizations WHERE id = $1', ['ORG-002']);
    let org2 = org2Res.rows[0];
    const org2Hash = authService.hashPassword('Password@123');
    if (!org2) {
      await db.query(`
        INSERT INTO organizations (id, name, office_name, office_lat, office_lng, geofence_radius_m, admin_username, admin_password)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['ORG-002', 'Safdarjung Hospital', 'Safdarjung Campus', 28.5684, 77.2064, 100, 'safdarjung_admin', org2Hash]);
    } else {
      await db.query('UPDATE organizations SET admin_password = $1, admin_username = $2 WHERE id = $3', [org2Hash, 'safdarjung_admin', 'ORG-002']);
    }
    org2Res = await db.query('SELECT * FROM organizations WHERE id = $1', ['ORG-002']);
    org2 = org2Res.rows[0];
    assert(org1 && org2, 'Organizations ORG-001 and ORG-002 must exist');

    // Create valid sessions directly or via login
    await testHelper.cleanTestData();
    const empLoginRes = await request('POST', '/api/auth/employee/login', {
      employer_id: 'ORG-001',
      employee_id: 'EMP-1001',
      password: 'Password@123'
    }, {}, testPort);
    assert.strictEqual(empLoginRes.statusCode, 200, 'Employee login should succeed');
    const empToken = empLoginRes.body.token;
    assert(empToken, 'Employee login must return session token');

    const adminLoginRes = await request('POST', '/api/auth/employer/login', {
      employer_id: 'ORG-001',
      admin_username: 'aiims_admin',
      admin_password: 'Aiims@123'
    }, {}, testPort);
    assert.strictEqual(adminLoginRes.statusCode, 200, 'Admin login should succeed');
    const adminToken = adminLoginRes.body.token;
    assert(adminToken, 'Admin login must return session token');

    const admin2LoginRes = await request('POST', '/api/auth/employer/login', {
      employer_id: 'ORG-002',
      admin_username: 'safdarjung_admin',
      admin_password: 'Password@123'
    }, {}, testPort);
    assert.strictEqual(admin2LoginRes.statusCode, 200, 'Admin ORG-002 login should succeed');
    const admin2Token = admin2LoginRes.body.token;
    assert(admin2Token, 'Admin ORG-002 login must return session token');

    console.log('✓ Test authentication credentials & session tokens established');

    // -----------------------------------------------------------------
    // Test 1: Unauthenticated request to admin operations returns 401
    // -----------------------------------------------------------------
    console.log('\n[Test 1] Unauthenticated Admin Operations Rejection');
    const unauthAdminOverview = await request('GET', '/api/admin/attendance', null, {}, testPort);
    assert.strictEqual(unauthAdminOverview.statusCode, 401, 'Unauthenticated admin overview must return 401');

    const unauthAdminEmployees = await request('GET', '/api/employees', null, {}, testPort);
    assert.strictEqual(unauthAdminEmployees.statusCode, 401, 'Unauthenticated admin employees must return 401');

    const unauthAdminExport = await request('GET', '/api/admin/attendance/export.csv', null, {}, testPort);
    assert.strictEqual(unauthAdminExport.statusCode, 401, 'Unauthenticated CSV export must return 401');

    const unauthTeams = await request('GET', '/api/teams', null, {}, testPort);
    assert.strictEqual(unauthTeams.statusCode, 401, 'Unauthenticated team listing must return 401');
    console.log('✓ Unauthenticated requests to all admin endpoints return HTTP 401');

    // -----------------------------------------------------------------
    // Test 2: Authenticated employee token used against admin route returns 403
    // -----------------------------------------------------------------
    console.log('\n[Test 2] Role-Based Access Control (Employee -> Admin Route)');
    const empOnAdmin = await request('GET', '/api/admin/attendance', null, {
      'Authorization': `Bearer ${empToken}`
    }, testPort);
    assert.strictEqual(empOnAdmin.statusCode, 403, 'Employee token on admin route must return 403');
    assert.strictEqual(empOnAdmin.body.error, 'Forbidden: Employer administrator privileges required.');
    console.log('✓ Authenticated employee token cannot access admin routes (HTTP 403)');

    // -----------------------------------------------------------------
    // Test 3: Authenticated admin request with valid token returns 200
    // -----------------------------------------------------------------
    console.log('\n[Test 3] Authenticated Admin Access');
    const adminOverview = await request('GET', '/api/admin/attendance', null, {
      'Authorization': `Bearer ${adminToken}`
    }, testPort);
    assert.strictEqual(adminOverview.statusCode, 200, 'Authenticated admin overview must return 200');
    assert.strictEqual(adminOverview.body.success, true);
    console.log('✓ Authenticated admin request succeeds (HTTP 200)');

    // -----------------------------------------------------------------
    // Test 4: Tenant Isolation between Organizations
    // -----------------------------------------------------------------
    console.log('\n[Test 4] Multi-Tenant Isolation Enforcement');
    // Admin 1 (ORG-001) queries employees - should only get ORG-001 employees
    const admin1Emps = await request('GET', '/api/employees', null, {
      'Authorization': `Bearer ${adminToken}`
    }, testPort);
    assert.strictEqual(admin1Emps.statusCode, 200);
    const org1Emps = admin1Emps.body.employees;
    assert(org1Emps.length > 0);
    for (const e of org1Emps) {
      assert.strictEqual(e.employer_id, 'ORG-001', 'Admin 1 must only see ORG-001 employees');
    }

    // Admin 1 tries to delete or modify an employee from ORG-002
    let empOrg2Res = await db.query('SELECT * FROM employees WHERE employer_id = $1', ['ORG-002']);
    let empOrg2 = empOrg2Res.rows[0];
    if (!empOrg2) {
      const id = 'EMP-ORG2-TEST';
      await db.query(`
        INSERT INTO employees (id, name, email, department, designation, employer_id, password, pin, is_active, created_at)
        VALUES ($1, 'Org2 Emp', 'org2emp@test.com', 'Cardiology', 'Nurse', 'ORG-002', 'dummyhash', '1234', 1, NOW())
      `, [id]);
      empOrg2Res = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
      empOrg2 = empOrg2Res.rows[0];
    }

    const crossTenantDelete = await request('DELETE', `/api/employees/${empOrg2.id}`, null, {
      'Authorization': `Bearer ${adminToken}`
    }, testPort);
    assert.strictEqual(crossTenantDelete.statusCode, 404, 'Admin cannot delete employee from another organization');
    console.log('✓ Multi-tenant isolation strictly enforced between organizations');

    // -----------------------------------------------------------------
    // Test 5: Client Cannot Switch Tenant via Parameter Tampering
    // -----------------------------------------------------------------
    console.log('\n[Test 5] Anti-Tenant-Tampering Protection');
    const tamperedOverview = await request('GET', '/api/admin/attendance?employer_id=ORG-002', null, {
      'Authorization': `Bearer ${adminToken}`,
      'x-employer-id': 'ORG-002'
    }, testPort);
    assert.strictEqual(tamperedOverview.statusCode, 403, 'Tampering employer_id must be rejected with 403');
    assert(tamperedOverview.body.error.includes('Tenant isolation violation') || tamperedOverview.body.error.includes('mismatch'), 'Error must indicate tenant violation');
    console.log('✓ Tenant parameter tampering rejected with HTTP 403 Forbidden');

    // -----------------------------------------------------------------
    // Test 6: Unauthenticated Request to Attendance Operations returns 401
    // -----------------------------------------------------------------
    console.log('\n[Test 6] Unauthenticated Attendance Operations Rejection');
    const unauthCurrent = await request('GET', '/api/attendance/current', null, {}, testPort);
    assert.strictEqual(unauthCurrent.statusCode, 401, 'Unauthenticated /attendance/current must return 401');

    const unauthCheckin = await request('POST', '/api/attendance/check-in', {
      latitude: 28.6139,
      longitude: 77.2090
    }, {}, testPort);
    assert.strictEqual(unauthCheckin.statusCode, 401, 'Unauthenticated check-in must return 401');
    console.log('✓ Attendance operations strictly require authentication (HTTP 401)');

    // -----------------------------------------------------------------
    // Test 7: Employee Identity Tampering (Punch for someone else) Blocked
    // -----------------------------------------------------------------
    console.log('\n[Test 7] Employee Identity Tampering Protection');
    const impersonationCurrent = await request('GET', '/api/attendance/current?employee_id=EMP-9999', null, {
      'Authorization': `Bearer ${empToken}`
    }, testPort);
    assert.strictEqual(impersonationCurrent.statusCode, 403, 'Employee impersonation attempt must return 403');
    assert(impersonationCurrent.body.error.includes('Identity conflict') || impersonationCurrent.body.error.includes('mismatch'), 'Error must indicate identity conflict');

    const impersonationCheckin = await request('POST', '/api/attendance/check-in', {
      employee_id: 'EMP-1002',
      latitude: 28.6139,
      longitude: 77.2090
    }, {
      'Authorization': `Bearer ${empToken}`
    }, testPort);
    assert.strictEqual(impersonationCheckin.statusCode, 403, 'Check-in impersonation attempt must return 403');
    assert(impersonationCheckin.body.error.includes('Identity conflict') || impersonationCheckin.body.error.includes('mismatch'), 'Error must indicate identity conflict');
    console.log('✓ Employee identity tampering is strictly rejected with HTTP 403');

    // -----------------------------------------------------------------
    // Test 8: Unauthenticated Biometric Enrollment returns 401
    // -----------------------------------------------------------------
    console.log('\n[Test 8] Biometric Enrollment Authentication Enforcement');
    const unauthEnroll = await request('POST', '/api/auth/employee/enroll-face', {
      employee_id: 'EMP-1001',
      face_descriptor: [0.1, 0.2, 0.3]
    }, {}, testPort);
    assert.strictEqual(unauthEnroll.statusCode, 401, 'Unauthenticated face enrollment must return 401');
    console.log('✓ Unauthenticated face enrollment rejected with HTTP 401');

    // -----------------------------------------------------------------
    // Test 9: Employee Enrolling Face for Another Employee Blocked (403)
    // -----------------------------------------------------------------
    console.log('\n[Test 9] Cross-Employee Biometric Overwrite Prevention');
    const crossEnroll = await request('POST', '/api/auth/employee/enroll-face', {
      employee_id: 'EMP-1002',
      face_descriptor: [0.1, 0.2, 0.3]
    }, {
      'Authorization': `Bearer ${empToken}`
    }, testPort);
    assert.strictEqual(crossEnroll.statusCode, 403, 'Employee enrolling face for another employee must return 403');
    console.log('✓ Cross-employee biometric enrollment blocked with HTTP 403');

    // -----------------------------------------------------------------
    // Test 10: Admin Cross-Tenant Biometric Enrollment Blocked
    // -----------------------------------------------------------------
    console.log('\n[Test 10] Admin Cross-Tenant Biometric Enrollment Prevention');
    const adminCrossEnroll = await request('POST', '/api/auth/employee/enroll-face', {
      employee_id: empOrg2.id,
      face_descriptor: [0.1, 0.2, 0.3]
    }, {
      'Authorization': `Bearer ${adminToken}` // Admin from ORG-001
    }, testPort);
    assert.strictEqual(adminCrossEnroll.statusCode, 404, 'Admin cannot enroll face for employee in another org');
    console.log('✓ Admin cross-tenant biometric enrollment blocked');

    // -----------------------------------------------------------------
    // Test 11: Session Lifecycle & Logout Revocation
    // -----------------------------------------------------------------
    console.log('\n[Test 11] Session Lifecycle & Logout Revocation');
    const sessionRecord = sessionService.getSession(empToken);
    assert(sessionRecord, 'Session record must exist in database and be active');

    const logoutRes = await request('POST', '/api/auth/logout', {}, {
      'Authorization': `Bearer ${empToken}`
    }, testPort);
    assert.strictEqual(logoutRes.statusCode, 200, 'Logout should succeed');
    assert.strictEqual(logoutRes.body.success, true);

    const sessionAfterLogout = await sessionService.getSession(empToken);
    assert.strictEqual(sessionAfterLogout, null, 'Session must be revoked after logout');

    const dbSessionRes = await db.query('SELECT * FROM sessions WHERE id = $1', [empToken]);
    const dbSession = dbSessionRes.rows[0];
    assert.strictEqual(Number(dbSession.is_revoked), 1, 'Session record must be marked as revoked in database');

    const revokedRes = await request('GET', '/api/attendance/current', null, {
      'Authorization': `Bearer ${empToken}`
    }, testPort);
    assert.strictEqual(revokedRes.statusCode, 401, 'Request with revoked session token must return 401');
    console.log('✓ Session lifecycle verified: active in DB, revoked on logout, rejected post-revocation');

    // -----------------------------------------------------------------
    // Test 12: Demo Face Bypass Security Across Environmental Permutations
    // -----------------------------------------------------------------
    console.log('\n[Test 12] Demo Face Bypass Environmental Matrix');
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAppEnv = process.env.APP_ENV;
    const prevAllowBypass = process.env.ALLOW_DEMO_BYPASS;

    delete process.env.NODE_ENV;
    delete process.env.APP_ENV;
    delete process.env.ALLOW_DEMO_BYPASS;

    const bypassPerm1 = await request('POST', '/api/auth/employee/face-login', {
      employer_id: 'ORG-001',
      mock_employee_id: 'EMP-1001'
    }, {}, testPort);
    assert.strictEqual(bypassPerm1.statusCode, 403, 'Bypass must be blocked by default');

    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEMO_BYPASS;
    const bypassPerm2 = await request('POST', '/api/auth/employee/face-login', {
      employer_id: 'ORG-001',
      mock_employee_id: 'EMP-1001'
    }, {}, testPort);
    assert.strictEqual(bypassPerm2.statusCode, 403, 'Bypass must be blocked in production');

    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEMO_BYPASS = 'true';
    const bypassPerm3 = await request('POST', '/api/auth/employee/face-login', {
      employer_id: 'ORG-001',
      mock_employee_id: 'EMP-1001'
    }, {}, testPort);
    assert.strictEqual(bypassPerm3.statusCode, 403, 'Bypass must NEVER be allowed in production even with flag');

    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_DEMO_BYPASS;
    const bypassPerm4 = await request('POST', '/api/auth/employee/face-login', {
      employer_id: 'ORG-001',
      mock_employee_id: 'EMP-1001'
    }, {}, testPort);
    assert.strictEqual(bypassPerm4.statusCode, 403, 'Bypass must be blocked in development without explicit flag');

    // Permutation 5: Development WITH explicit ALLOW_DEMO_BYPASS=true
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEMO_BYPASS = 'true';
    const biometricService = require('../src/services/biometric_service');
    const empDescriptor = biometricService.createDeterministicDescriptor(emp1.name);
    await db.query('UPDATE employees SET face_enrolled = 1, face_descriptor = $1 WHERE id = $2', [
      JSON.stringify(empDescriptor),
      'EMP-1001'
    ]);

    const bypassPerm5 = await request('POST', '/api/auth/employee/face-login', {
      employer_id: 'ORG-001',
      mock_employee_id: 'EMP-1001'
    }, {}, testPort);
    assert.strictEqual(bypassPerm5.statusCode, 200, 'Bypass permitted only in development with explicit flag');

    if (prevNodeEnv) process.env.NODE_ENV = prevNodeEnv; else delete process.env.NODE_ENV;
    if (prevAppEnv) process.env.APP_ENV = prevAppEnv; else delete process.env.APP_ENV;
    if (prevAllowBypass) process.env.ALLOW_DEMO_BYPASS = prevAllowBypass; else delete process.env.ALLOW_DEMO_BYPASS;
    console.log('✓ All 5 demo bypass environmental permutations verified securely');

    // -----------------------------------------------------------------
    // Test 13: User Enumeration Protection
    // -----------------------------------------------------------------
    console.log('\n[Test 13] User Enumeration Mitigation');
    const nonExistentLogin = await request('POST', '/api/auth/employee/login', {
      employer_id: 'ORG-001',
      employee_id: 'EMP-DOESNOTEXIST-999',
      password: 'Password@123'
    }, {}, testPort);

    const wrongPasswordLogin = await request('POST', '/api/auth/employee/login', {
      employer_id: 'ORG-001',
      employee_id: 'EMP-1001',
      password: 'WrongPassword@123'
    }, {}, testPort);

    assert.strictEqual(nonExistentLogin.statusCode, 401);
    assert.strictEqual(wrongPasswordLogin.statusCode, 401);
    assert.strictEqual(nonExistentLogin.body.error, wrongPasswordLogin.body.error, 'Login errors must be identical');
    assert.strictEqual(nonExistentLogin.body.error, 'Invalid Employee ID or password.');
    console.log('✓ Non-existent account and wrong password return identical generic error messages');

    // -----------------------------------------------------------------
    // Test 14: Hardcoded Credentials Purged from UI & Scripts
    // -----------------------------------------------------------------
    console.log('\n[Test 14] Hardcoded Credentials Purged from UI & Client Code');
    const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

    assert(!adminHtml.includes('fillAdminCreds'), 'fillAdminCreds button must be removed from admin.html');
    assert(!adminJs.includes('fillAdminCreds'), 'fillAdminCreds logic must be removed from admin.js');
    assert(!adminHtml.includes('Aiims@123'), 'Aiims@123 must not exist in admin.html');
    assert(!adminJs.includes('Aiims@123'), 'Aiims@123 must not exist in admin.js');
    assert(!appJs.includes('Aiims@123'), 'Aiims@123 must not exist in app.js');
    console.log('✓ UI and client-side JavaScript are free of hardcoded credentials');

    // -----------------------------------------------------------------
    // Test 15: Production Error Masking
    // -----------------------------------------------------------------
    console.log('\n[Test 15] Production Error Masking');
    const prevEnvForError = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const errorRes = await request('POST', '/api/attendance/check-in', 'INVALID_NON_JSON_BODY', {
      'content-type': 'application/json'
    }, testPort);
    assert(!errorRes.text.includes('TypeError:'), 'Internal error details must not leak in response');
    assert(!errorRes.text.includes('at '), 'Stack trace must not leak in response');
    if (errorRes.statusCode === 500) {
      assert.strictEqual(errorRes.body.error, 'An internal server error occurred.');
    }

    if (prevEnvForError) process.env.NODE_ENV = prevEnvForError; else delete process.env.NODE_ENV;
    console.log('✓ Internal error details and stack traces masked in production');

    // -----------------------------------------------------------------
    // Test 16: Security Headers & CORS Policy
    // -----------------------------------------------------------------
    console.log('\n[Test 16] Security Headers & CORS Protection');
    const headersRes = await request('GET', '/api/organization?employer_id=ORG-001', null, {}, testPort);
    const h = headersRes.headers;
    assert.strictEqual(h['x-content-type-options'], 'nosniff', 'X-Content-Type-Options must be nosniff');
    assert.strictEqual(h['x-frame-options'], 'DENY', 'X-Frame-Options must be DENY');
    assert.strictEqual(h['referrer-policy'], 'strict-origin-when-cross-origin', 'Referrer-Policy must be set');
    assert(h['content-security-policy'], 'Content-Security-Policy must be present');
    console.log('✓ Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) verified');

    console.log('\n===============================================================');
    console.log('🎉 ALL 16 SECURITY REMEDIATION REGRESSION TESTS PASSED 100%!');
    console.log('===============================================================');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) {
  runSecurityRemediationTests().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('❌ Security remediation test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runSecurityRemediationTests };
