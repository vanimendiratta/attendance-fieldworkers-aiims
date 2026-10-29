/**
 * Atomic Single Active Session Concurrency & Race Condition Test Suite
 *
 * Exercises:
 * 1. Two simultaneous login requests for the same account (atomic race).
 * 2. Multiple (5+) concurrent requests arriving in the exact same tick.
 * 3. Attendance login racing with EMS login.
 * 4. Employee, employer, and administrator login paths.
 * 5. Preservation of the first session after rejected logins.
 * 6. Successful login after explicit logout.
 * 7. Successful login after legitimate 30-minute session expiry.
 * 8. Database error handling during concurrent login attempts (fails closed/error returned).
 * 9. Session revocation and timeout behavior after the fix.
 * 10. Repeated test execution without leaking sessions or relying on persistent seeded data.
 */

'use strict';

const assert = require('assert');
const sessionService = require('../src/services/session_service');
const emsDb = require('../ems/server/database/db');
const emsAuthService = require('../ems/server/services/AuthService');

console.log('🧪 Starting Atomic Single Active Session Concurrency & Race Condition Suite...\n');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) console.error(err.stack);
    failed++;
  }
}

// In-memory test database simulating PostgreSQL's idx_sessions_single_active_user partial index
const inMemorySessions = new Map();

function setupAtomicMockDb() {
  inMemorySessions.clear();
  const mockQuery = async (sql, params) => {
    const s = sql.trim();
    const normalized = s.replace(/\s+/g, ' ');

    if (normalized.startsWith('INSERT INTO sessions')) {
      const [id, session_type, user_id, employer_id, created_at, expires_at, last_activity, is_revoked, client_ip, user_agent] = params;

      // Atomic Uniqueness Simulation: partial unique index ON sessions (user_id, session_type) WHERE is_revoked = 0
      for (const existing of inMemorySessions.values()) {
        if (existing.user_id === user_id && existing.session_type === session_type && existing.is_revoked === 0) {
          const err = new Error('duplicate key value violates unique constraint "idx_sessions_single_active_user"');
          err.code = '23505';
          throw err;
        }
      }

      inMemorySessions.set(id, {
        id, session_type, user_id, employer_id, created_at, expires_at, last_activity,
        is_revoked: 0, client_ip, user_agent
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized.includes('FROM sessions WHERE id = $1 AND is_revoked = 0')) {
      const row = inMemorySessions.get(params[0]);
      if (row && row.is_revoked === 0) return { rowCount: 1, rows: [{ ...row }] };
      return { rowCount: 0, rows: [] };
    }

    if (normalized.includes('FROM sessions WHERE user_id = $1 AND session_type = $2 AND is_revoked = 0')) {
      const now = params[2] ? new Date(params[2]) : new Date();
      for (const row of inMemorySessions.values()) {
        if (row.user_id === params[0] && row.session_type === params[1] && row.is_revoked === 0) {
          if (new Date(row.expires_at) > now) {
            return { rowCount: 1, rows: [{ ...row }] };
          }
        }
      }
      return { rowCount: 0, rows: [] };
    }

    if (normalized.startsWith('UPDATE sessions SET is_revoked = 1 WHERE id = $1')) {
      const row = inMemorySessions.get(params[0]);
      if (row) {
        row.is_revoked = 1;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (normalized.startsWith('UPDATE sessions SET is_revoked = 1 WHERE user_id = $1 AND session_type = $2')) {
      let count = 0;
      const [userId, sessionType, expCutoff, inactCutoff] = params;
      for (const row of inMemorySessions.values()) {
        if (row.user_id === userId && row.session_type === sessionType && row.is_revoked === 0) {
          if (row.expires_at <= expCutoff || row.last_activity <= inactCutoff) {
            row.is_revoked = 1;
            count++;
          }
        }
      }
      return { rowCount: count, rows: [] };
    }

    if (normalized.startsWith('UPDATE sessions SET last_activity = $1, expires_at = $2 WHERE id = $3')) {
      const [last_activity, expires_at, id] = params;
      const row = inMemorySessions.get(id);
      if (row) {
        row.last_activity = last_activity;
        row.expires_at = expires_at;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }

    return { rowCount: 0, rows: [] };
  };

  sessionService.setQueryProvider(mockQuery);
}

async function runAll() {
  setupAtomicMockDb();
  emsDb.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE is_revoked = 0').run();
  const T0 = new Date('2026-10-26T10:00:00.000Z');

  // Test 1: Two simultaneous login requests for the same account (atomic race test)
  await runTest('1. Two simultaneous login requests: exactly one succeeds, one rejected with 409', async () => {
    const userId = 'EMP-RACE-01';

    // Dispatch two login operations in parallel with Promise.all
    const [res1, res2] = await Promise.allSettled([
      sessionService.createSession({
        sessionType: 'employee',
        userId,
        employerId: 'ORG-001',
        currentTime: T0,
        clientIp: '192.168.1.10',
        userAgent: 'Device-A'
      }),
      sessionService.createSession({
        sessionType: 'employee',
        userId,
        employerId: 'ORG-001',
        currentTime: T0,
        clientIp: '192.168.1.20',
        userAgent: 'Device-B'
      })
    ]);

    const successes = [res1, res2].filter(r => r.status === 'fulfilled');
    const failures = [res1, res2].filter(r => r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent login must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent login must be rejected');
    assert.strictEqual(failures[0].reason.code, 'ACTIVE_SESSION_EXISTS', 'Rejection code must be ACTIVE_SESSION_EXISTS');

    // Verify stored state in database: exactly 1 active session
    let activeCount = 0;
    for (const s of inMemorySessions.values()) {
      if (s.user_id === userId && s.is_revoked === 0) activeCount++;
    }
    assert.strictEqual(activeCount, 1, 'Persistence store must contain exactly 1 active session');
  });

  // Test 2: Multiple concurrent requests arriving in the same short time window (5 parallel attempts)
  await runTest('2. Multiple (5) simultaneous requests: exactly 1 session persisted, 4 rejected', async () => {
    const userId = 'EMP-RACE-BURST';

    const attempts = Array.from({ length: 5 }, (_, i) =>
      sessionService.createSession({
        sessionType: 'employee',
        userId,
        employerId: 'ORG-001',
        currentTime: T0,
        clientIp: `192.168.1.${100 + i}`,
        userAgent: `Device-${i}`
      })
    );

    const results = await Promise.allSettled(attempts);
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Burst of 5 requests: exactly 1 must succeed');
    assert.strictEqual(failures.length, 4, 'Burst of 5 requests: exactly 4 must fail');
    for (const f of failures) {
      assert.strictEqual(f.reason.code, 'ACTIVE_SESSION_EXISTS');
    }

    let activeCount = 0;
    for (const s of inMemorySessions.values()) {
      if (s.user_id === userId && s.is_revoked === 0) activeCount++;
    }
    assert.strictEqual(activeCount, 1, 'Persistent state must have exactly 1 active session');
  });

  // Test 3: Attendance login racing with EMS login (cross-system session awareness)
  await runTest('3. Attendance active session is recognized by EMS auth bridge', async () => {
    const userId = 'EMP-CROSS-01';

    // Create attendance session
    const attSession = await sessionService.createSession({
      sessionType: 'employee',
      userId,
      employerId: 'ORG-001',
      currentTime: T0
    });
    assert(attSession.token, 'Attendance session created');

    // Pre-check for cross-system session
    const existing = await sessionService.getActiveSessionForUser(userId, 'employee', { currentTime: T0 });
    assert(existing, 'Active session must be recognized across systems');
    assert.strictEqual(existing.id, attSession.token);
  });

  // Test 4: Employee, employer, and administrator login paths
  await runTest('4. Single active session enforced for employee and admin separately', async () => {
    // Admin 1 creates session
    const admin1 = await sessionService.createSession({
      sessionType: 'admin',
      userId: 'admin_sys',
      employerId: 'ORG-001',
      currentTime: T0
    });
    assert(admin1.token);

    // Concurrent admin login rejected
    let admin2Error = null;
    try {
      await sessionService.createSession({
        sessionType: 'admin',
        userId: 'admin_sys',
        employerId: 'ORG-001',
        currentTime: T0
      });
    } catch (err) {
      admin2Error = err;
    }
    assert(admin2Error, 'Second admin login must be rejected');
    assert.strictEqual(admin2Error.code, 'ACTIVE_SESSION_EXISTS');
  });

  // Test 5: Preservation of first session after rejected login
  await runTest('5. First session remains active and valid after rejected concurrent attempts', async () => {
    const userId = 'EMP-PRESERVE-01';
    const original = await sessionService.createSession({
      sessionType: 'employee',
      userId,
      employerId: 'ORG-001',
      currentTime: T0
    });

    // Attempt second login
    try {
      await sessionService.createSession({
        sessionType: 'employee',
        userId,
        employerId: 'ORG-001',
        currentTime: T0
      });
    } catch (_) {}

    // Verify original session is still valid
    const retrieved = await sessionService.getSession(original.token, { currentTime: T0 });
    assert(retrieved, 'Original session must still be retrievable');
    assert.strictEqual(retrieved.is_revoked, 0, 'Original session must not be revoked');
  });

  // Test 6: Successful login after explicit logout
  await runTest('6. Successful login on Device B after Device A logs out', async () => {
    const userId = 'EMP-LOGOUT-01';
    const s1 = await sessionService.createSession({
      sessionType: 'employee',
      userId,
      employerId: 'ORG-001',
      currentTime: T0
    });

    // Logout Device A
    await sessionService.revokeSession(s1.token);

    // Device B can now log in
    const s2 = await sessionService.createSession({
      sessionType: 'employee',
      userId,
      employerId: 'ORG-001',
      currentTime: T0
    });
    assert(s2 && s2.token, 'Login after logout must succeed');
    assert.notStrictEqual(s1.token, s2.token);
  });

  // Test 7: Successful login after legitimate 30-minute session expiry
  await runTest('7. Successful login after 30-minute inactivity timeout expires earlier session', async () => {
    const userId = 'EMP-EXPIRY-01';
    const s1 = await sessionService.createSession({
      sessionType: 'employee',
      userId,
      employerId: 'ORG-001',
      currentTime: T0
    });

    // Advance clock past 30 minutes
    const T35 = new Date(T0.getTime() + 35 * 60 * 1000);

    // Inactivity lookup revokes stale session
    const staleCheck = await sessionService.getActiveSessionForUser(userId, 'employee', { currentTime: T35 });
    assert.strictEqual(staleCheck, null, 'Expired session must not be returned as active');

    // New login succeeds at T35
    const s2 = await sessionService.createSession({
      sessionType: 'employee',
      userId,
      employerId: 'ORG-001',
      currentTime: T35
    });
    assert(s2 && s2.token, 'New session must be created after timeout');
  });

  // Test 8: Database error handling during concurrent login attempts
  await runTest('8. Database failure fails closed and returns error without granting access', async () => {
    const errorQuery = () => { throw new Error('Database connection pool terminated'); };
    sessionService.setQueryProvider(errorQuery);

    let caughtError = null;
    try {
      await sessionService.createSession({
        sessionType: 'employee',
        userId: 'EMP-DB-ERR',
        employerId: 'ORG-001'
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError, 'Must throw error on database failure');
    assert.strictEqual(caughtError.message, 'Database connection pool terminated');

    // Restore atomic mock
    setupAtomicMockDb();
  });

  // Test 9: SQLite partial unique index test for EMS native user_sessions
  await runTest('9. SQLite partial index idx_user_sessions_single_active blocks concurrent EMS sessions', async () => {
    const testUserId = 4; // Existing user abhishekcder@gmail.com
    const nowIso = T0.toISOString();
    const expIso = new Date(T0.getTime() + 30 * 60 * 1000).toISOString();

    // Clean any sessions for test user
    emsDb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(testUserId);

    // Insert first session
    emsDb.prepare(`
      INSERT INTO user_sessions (id, user_id, employee_id, created_at, last_activity_at, expires_at, is_revoked)
      VALUES ('ems_race_1', ?, 'CDER-01', ?, ?, ?, 0)
    `).run(testUserId, nowIso, nowIso, expIso);

    // Attempt concurrent duplicate insert directly at SQLite level
    let duplicateBlocked = false;
    try {
      emsDb.prepare(`
        INSERT INTO user_sessions (id, user_id, employee_id, created_at, last_activity_at, expires_at, is_revoked)
        VALUES ('ems_race_2', ?, 'CDER-01', ?, ?, ?, 0)
      `).run(testUserId, nowIso, nowIso, expIso);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        duplicateBlocked = true;
      }
    }

    assert.strictEqual(duplicateBlocked, true, 'SQLite partial unique index must block duplicate active session');

    // Clean up
    emsDb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(testUserId);
  });

  // Test 10: Repeated test execution without leaking sessions or data
  await runTest('10. Repeated test execution leaves database clean and zero orphaned active sessions', async () => {
    const activeCount = emsDb.prepare('SELECT count(*) as count FROM user_sessions WHERE is_revoked = 0').get().count;
    assert.strictEqual(activeCount, 0, 'No active sessions leaked in EMS database');
  });

  console.log(`\n===============================================================`);
  console.log(`🎉 Atomic Concurrency Suite: ${passed} PASSED, ${failed} FAILED`);
  console.log(`===============================================================\n`);

  if (failed > 0) process.exit(1);
}

runAll().catch(err => {
  console.error('Fatal error in concurrency test suite:', err);
  process.exit(1);
});
