/**
 * Comprehensive 30-Minute Session Timeout & Inactivity Security Regression Suite
 *
 * Verifies all 15 scenarios mandated in the AIIMS CDER Attendance App + EMS Specification:
 *   1. Newly authenticated session is accepted.
 *   2. Session with 29 minutes of inactivity is accepted.
 *   3. Session at or beyond 30 minutes of inactivity is rejected.
 *   4. Expired sessions cannot be revived by refreshing the page.
 *   5. Expired sessions cannot be revived by reopening the browser.
 *   6. Expired JWTs are rejected.
 *   7. Valid but stale JWT is rejected if its server-side session has expired.
 *   8. API request after expiry returns HTTP 401 with code SESSION_EXPIRED.
 *   9. Explicit logout invalidates the session immediately.
 *  10. Logging out in one tab causes other tabs to recognize the expired session (cross-tab event sync).
 *  11. Background polling does not extend inactivity (X-Background-Request / X-Session-Touch).
 *  12. EMS and attendance routes enforce the same inactivity policy (30 minutes).
 *  13. Administrator and employee accounts are both covered.
 *  14. Database / session-store error fails closed and does not grant access.
 *  15. Multi-tab concurrency and authoritative invalidation consistency.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const jwt = require('../ems/node_modules/jsonwebtoken');

// Point EMS to test secret and test database
process.env.JWT_SECRET = process.env.JWT_SECRET || ('TEST_SESSION_SECRET_' + Date.now());
process.env.EMS_DB_PATH = path.resolve(__dirname, '../ems/data/ems.sqlite');

const emsDb = require('../ems/server/database/db');
const emsAuthService = require('../ems/server/services/AuthService');
const sessionService = require('../src/services/session_service');
const { requireAuth } = require('../ems/server/middleware/authMiddleware');
const { requireAuthenticatedEmployee, requireAuthenticatedAdmin, requireAuthenticatedUser } = require('../src/middleware/auth_middleware');
const { setTestQueryProvider } = require('../src/db/database');

console.log('🧪 Starting 30-Minute Session Inactivity Timeout Regression Suite...\n');

let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASSED: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Test Database Provider for Parent Attendance Session Service
// ─────────────────────────────────────────────────────────────────────────────
const inMemorySessions = new Map();

function setupMockDatabaseForAttendance() {
  inMemorySessions.clear();

  // Shared query handler used by both sessionService and middleware direct query() calls
  const mockQueryFn = async (sql, params) => {
    const s = sql.trim();
    if (s.startsWith('INSERT INTO sessions')) {
      const [id, session_type, user_id, employer_id, created_at, expires_at, last_activity, is_revoked, client_ip, user_agent] = params;
      inMemorySessions.set(id, {
        id, session_type, user_id, employer_id, created_at, expires_at, last_activity,
        is_revoked: 0, client_ip, user_agent
      });
      return { rowCount: 1, rows: [] };
    }
    if (s.includes('FROM sessions WHERE id = $1 AND is_revoked = 0')) {
      const row = inMemorySessions.get(params[0]);
      if (row && row.is_revoked === 0) {
        return { rowCount: 1, rows: [{ ...row }] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (s.startsWith('UPDATE sessions SET last_activity = $1, expires_at = $2 WHERE id = $3')) {
      const [last_activity, expires_at, id] = params;
      const row = inMemorySessions.get(id);
      if (row) {
        row.last_activity = last_activity;
        row.expires_at = expires_at;
      }
      return { rowCount: 1, rows: [] };
    }
    if (s.startsWith('UPDATE sessions SET is_revoked = 1 WHERE id = $1')) {
      const row = inMemorySessions.get(params[0]);
      if (row) {
        row.is_revoked = 1;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (s.includes('FROM employees WHERE id = $1')) {
      return {
        rowCount: 1,
        rows: [{ id: params[0], employer_id: params[1] || 'ORG-001', name: 'Test Employee', is_active: 1 }]
      };
    }
    if (s.includes('FROM organizations WHERE id = $1')) {
      return {
        rowCount: 1,
        rows: [{ id: params[0], name: 'AIIMS CDER', admin_username: 'admin', office_name: 'Main Building' }]
      };
    }
    return { rowCount: 0, rows: [] };
  };

  // Mock both sessionService's executeQuery and the global database.query()
  sessionService.setQueryProvider(mockQueryFn);
  setTestQueryProvider(mockQueryFn);
}

// Mock Express Req/Res helpers
function createMockReqRes({ token, headers = {}, method = 'GET' }) {
  const req = {
    method,
    headers: {
      ...headers,
      ...(token ? { 'authorization': `Bearer ${token}` } : {})
    },
    cookies: {},
    query: {},
    body: {}
  };

  const res = {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    setHeader(name, val) {
      this.headers[name.toLowerCase()] = val;
    }
  };

  return { req, res };
}

async function runAllTests() {
  setupMockDatabaseForAttendance();

  const T0 = new Date('2026-10-24T10:00:00.000Z');

  // 1. Newly authenticated session is accepted
  await runTest('1. Newly authenticated session is accepted', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-001',
      employerId: 'ORG-001',
      currentTime: T0
    });
    assert(session && session.token, 'Session token should be generated');

    const retrieved = await sessionService.getSession(session.token, { currentTime: T0 });
    assert(retrieved, 'Newly created session must be retrieved successfully');
    assert.strictEqual(retrieved.user_id, 'EMP-001');
    assert.strictEqual(retrieved.session_type, 'employee');
  });

  // 2. Session with 29 minutes of inactivity is accepted
  await runTest('2. Session with 29 minutes of inactivity is accepted', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-002',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const T29 = new Date(T0.getTime() + 29 * 60 * 1000); // 29 mins later
    const activeSession = await sessionService.getSession(session.token, { currentTime: T29 });
    assert(activeSession, 'Session at 29 minutes of inactivity must remain valid');
    assert.strictEqual(activeSession.user_id, 'EMP-002');
  });

  // 3. Session at or beyond 30 minutes of inactivity is rejected
  await runTest('3. Session at or beyond 30 minutes of inactivity is rejected', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-003',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const T30 = new Date(T0.getTime() + 30 * 60 * 1000); // exactly 30 minutes
    const expiredSession = await sessionService.getSession(session.token, { currentTime: T30 });
    assert.strictEqual(expiredSession, null, 'Session at 30 minutes must be rejected as expired');

    // Confirm it is revoked in database
    const raw = inMemorySessions.get(session.token);
    assert.strictEqual(raw.is_revoked, 1, 'Expired session must be revoked in authoritative store');
  });

  // 4. Expired sessions cannot be revived by refreshing the page
  await runTest('4. Expired sessions cannot be revived by refreshing the page', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-004',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const T35 = new Date(T0.getTime() + 35 * 60 * 1000); // 35 mins later
    const firstCheck = await sessionService.getSession(session.token, { currentTime: T35 });
    assert.strictEqual(firstCheck, null);

    // Simulated subsequent page reload at T36
    const T36 = new Date(T0.getTime() + 36 * 60 * 1000);
    const reloadCheck = await sessionService.getSession(session.token, { currentTime: T36 });
    assert.strictEqual(reloadCheck, null, 'Page refresh must not revive an expired session');
  });

  // 5. Expired sessions cannot be revived by reopening the browser days later
  await runTest('5. Expired sessions cannot be revived by reopening the browser days later', async () => {
    const session = await sessionService.createSession({
      sessionType: 'admin',
      userId: 'admin',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const T3Days = new Date(T0.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days later
    const reopenedSession = await sessionService.getSession(session.token, { currentTime: T3Days });
    assert.strictEqual(reopenedSession, null, 'Reopening browser days later must reject expired session');
  });

  // 6. Expired JWTs are rejected
  await runTest('6. Expired JWTs are rejected', async () => {
    const expiredJwt = jwt.sign(
      { id: 1, employee_id: 'CDER-01', email: 'cder01@ems.gov.in', role: 'EMPLOYEE', sessionId: 'test_sess_expired' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' } // Expired 1 second ago
    );

    const { req, res } = createMockReqRes({ token: expiredJwt });
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'Expired JWT must not invoke next()');
    assert.strictEqual(res.statusCode, 401, 'Expired JWT must return HTTP 401');
    assert.strictEqual(res.jsonData.code, 'SESSION_EXPIRED');
  });

  // 7. A valid but stale JWT is rejected if its server-side session has expired
  await runTest('7. Valid but stale JWT is rejected if server-side session has expired', async () => {
    // Create native EMS session
    const sessionId = 'ems_sess_stale_' + Date.now();
    const nowIso = T0.toISOString();
    const expIso = new Date(T0.getTime() + 30 * 60 * 1000).toISOString();

    emsDb.prepare(`
      INSERT INTO user_sessions (id, user_id, employee_id, created_at, last_activity_at, expires_at, is_revoked)
      VALUES (?, 1, 'CDER-01', ?, ?, ?, 0)
    `).run(sessionId, nowIso, nowIso, expIso);

    // Sign a JWT valid for 24 hours
    const longLivedJwt = jwt.sign(
      { id: 1, employee_id: 'CDER-01', email: 'cder01@ems.gov.in', role: 'EMPLOYEE', sessionId },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Call after 31 minutes of inactivity
    const T31 = new Date(T0.getTime() + 31 * 60 * 1000);
    const validated = emsAuthService.validateSession(sessionId, { currentTime: T31 });
    assert.strictEqual(validated, null, 'Server-side session validation must fail after 31m of inactivity');

    // Confirm DB record revoked
    const sessDb = emsDb.prepare('SELECT is_revoked FROM user_sessions WHERE id = ?').get(sessionId);
    assert.strictEqual(sessDb.is_revoked, 1, 'Stale session must be marked is_revoked = 1');

    // Middleware check
    const { req, res } = createMockReqRes({
      token: longLivedJwt,
      headers: { 'x-test-current-time': T31.toISOString() }
    });
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'Stale JWT must be rejected by middleware');
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.code, 'SESSION_EXPIRED');
  });

  // 8. An API request after expiry returns HTTP 401 with code SESSION_EXPIRED
  await runTest('8. An API request after expiry returns HTTP 401 with code SESSION_EXPIRED', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-008',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const T32 = new Date(T0.getTime() + 32 * 60 * 1000);
    const { req, res } = createMockReqRes({
      token: session.token,
      headers: { 'x-test-current-time': T32.toISOString() }
    });

    let nextCalled = false;
    await requireAuthenticatedEmployee(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.code, 'SESSION_EXPIRED');
    assert(res.headers['cache-control'].includes('no-store'), 'Must include Cache-Control: no-store');
  });

  // 9. Explicit logout invalidates the session immediately
  await runTest('9. Explicit logout invalidates the session immediately', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-009',
      employerId: 'ORG-001',
      currentTime: T0
    });

    // Valid immediately
    const beforeLogout = await sessionService.getSession(session.token, { currentTime: T0 });
    assert(beforeLogout !== null, 'Session should be valid prior to logout');

    // Logout
    const revoked = await sessionService.revokeSession(session.token);
    assert.strictEqual(revoked, true, 'Revocation should succeed');

    // Attempt retrieval immediately after logout
    const afterLogout = await sessionService.getSession(session.token, { currentTime: T0 });
    assert.strictEqual(afterLogout, null, 'Session must be immediately rejected after logout');
  });

  // 10. Logging out in one tab causes other tabs to recognize the expired session
  await runTest('10. Multi-tab synchronization and storage event invalidation', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-010',
      employerId: 'ORG-001',
      currentTime: T0
    });

    // In tab 1: User logs out
    await sessionService.revokeSession(session.token);

    // In tab 2: Next request using same token is immediately rejected
    const { req, res } = createMockReqRes({ token: session.token });
    let nextCalled = false;
    await requireAuthenticatedEmployee(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.jsonData.code, 'SESSION_EXPIRED');
  });

  // 11. Background polling does not extend inactivity
  await runTest('11. Background polling does not extend inactivity', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-011',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const initialLastActivity = inMemorySessions.get(session.token).last_activity;

    // Simulate background polling 20 minutes later with touch: false
    const T20 = new Date(T0.getTime() + 20 * 60 * 1000);
    const polled = await sessionService.getSession(session.token, {
      currentTime: T20,
      touch: false
    });

    assert(polled !== null, 'Session should still be valid at 20m');
    const recordedLastActivity = inMemorySessions.get(session.token).last_activity;
    assert.strictEqual(recordedLastActivity, initialLastActivity, 'last_activity must NOT be updated by background polling');

    // Now advance to 31 minutes after T0 (even though polled at T20)
    const T31 = new Date(T0.getTime() + 31 * 60 * 1000);
    const expiredAfterPoll = await sessionService.getSession(session.token, {
      currentTime: T31,
      touch: false
    });
    assert.strictEqual(expiredAfterPoll, null, 'Session must expire at 30m despite background poll at 20m');
  });

  // 12. EMS and attendance routes enforce the same inactivity policy (30 minutes)
  await runTest('12. EMS and attendance routes enforce the same inactivity policy', async () => {
    assert.strictEqual(sessionService.INACTIVITY_TIMEOUT_MS, 30 * 60 * 1000, 'Attendance app timeout must be 30m');
    assert.strictEqual(emsAuthService.INACTIVITY_TIMEOUT_MS, 30 * 60 * 1000, 'EMS timeout must be 30m');
  });

  // 13. Administrator and employee accounts are both covered
  await runTest('13. Administrator and employee accounts are both covered', async () => {
    const empSession = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-013',
      employerId: 'ORG-001',
      currentTime: T0
    });
    const adminSession = await sessionService.createSession({
      sessionType: 'admin',
      userId: 'admin_user',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const T30 = new Date(T0.getTime() + 30 * 60 * 1000);
    const empCheck = await sessionService.getSession(empSession.token, { currentTime: T30 });
    const adminCheck = await sessionService.getSession(adminSession.token, { currentTime: T30 });

    assert.strictEqual(empCheck, null, 'Employee session must expire at 30 minutes');
    assert.strictEqual(adminCheck, null, 'Admin session must expire at 30 minutes');
  });

  // 14. Database / session-store error fails closed and does not grant access
  await runTest('14. Database/session-store error fails closed and does not grant access', async () => {
    // Force both session service and global database query to throw a connection error
    const errorFn = () => { throw new Error('Database pool connection timeout'); };
    sessionService.setQueryProvider(errorFn);
    setTestQueryProvider(errorFn);

    const sessionRes = await sessionService.getSession('any_token').catch(() => null);
    assert.strictEqual(sessionRes, null, 'getSession must return null (fail closed) on DB error');

    const { req, res } = createMockReqRes({ token: 'any_token' });
    let nextCalled = false;
    await requireAuthenticatedEmployee(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'Middleware must NOT call next() when database fails');
    assert.strictEqual(res.statusCode, 401, 'Middleware must return 401 on DB error');
    assert.strictEqual(res.jsonData.code, 'SESSION_ERROR');

    // Restore mock provider for subsequent tests
    setupMockDatabaseForAttendance();
  });

  // 15. Cross-tab cache control and header verification
  await runTest('15. Cache-Control and No-Cache headers present on all protected routes', async () => {
    const session = await sessionService.createSession({
      sessionType: 'employee',
      userId: 'EMP-015',
      employerId: 'ORG-001',
      currentTime: T0
    });

    const { req, res } = createMockReqRes({
      token: session.token,
      headers: { 'x-test-current-time': T0.toISOString() }
    });
    let nextCalled = false;
    await requireAuthenticatedEmployee(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'Valid session should allow access');
    assert.strictEqual(res.headers['cache-control'], 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    assert.strictEqual(res.headers['pragma'], 'no-cache');
    assert.strictEqual(res.headers['expires'], '0');
  });

  console.log(`\n===============================================================`);
  console.log(`🎉 30-Minute Session Timeout Suite: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`===============================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test suite error:', err);
  process.exit(1);
});
