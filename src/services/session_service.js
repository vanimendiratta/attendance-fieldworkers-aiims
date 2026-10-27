'use strict';

const crypto         = require('crypto');
const { query, pool } = require('../db/database');

let customQueryFn = null;

function setQueryProvider(fn) {
  customQueryFn = fn;
}

async function executeQuery(sql, params) {
  if (customQueryFn) {
    return customQueryFn(sql, params);
  }
  return query(sql, params);
}

/**
 * Session Service — Database-Backed Cryptographic Sessions (PostgreSQL)
 *
 * All methods are async. Manages active sessions for employees and
 * employer administrators:
 *  - 256-bit cryptographically random tokens (crypto.randomBytes)
 *  - Expiration validation (default 24 h employees / 8 h administrators)
 *  - Immediate server-side revocation on logout
 *  - Bulk revocation on credential change or deactivation
 */

const INACTIVITY_TIMEOUT_MS = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MS, 10) || (30 * 60 * 1000); // 30 minutes

// Absolute maximum session ceilings (optional cap, inactivity governs active usage)
const DEFAULT_EMPLOYEE_TTL_HOURS = 24 * 90; // 90 days absolute maximum
const DEFAULT_ADMIN_TTL_HOURS    = 24 * 7;  // 7 days absolute maximum

/**
 * Create a new database-backed session.
 * @param {Object} params
 * @param {string} params.sessionType - 'employee' | 'admin'
 * @param {string} params.userId
 * @param {string} params.employerId
 * @param {string} [params.clientIp]
 * @param {string} [params.userAgent]
 * @param {number} [params.ttlHours]
 * @param {Date|number|string} [params.currentTime] - Test clock injection
 * @returns {Promise<Object>} Created session token + metadata
 */
async function createSession({
  sessionType, userId, employerId,
  clientIp = '127.0.0.1', userAgent = 'Unknown', ttlHours = null,
  currentTime = null
}) {
  if (!sessionType || !userId || !employerId) {
    throw new Error('sessionType, userId, and employerId are required to create a session.');
  }

  const token     = crypto.randomBytes(32).toString('hex');
  const now       = currentTime ? new Date(currentTime) : new Date();
  
  // Initial expiry is set to the 30-minute inactivity timeout window
  const timeoutMs = INACTIVITY_TIMEOUT_MS;
  const expiresAt = new Date(now.getTime() + timeoutMs);

// Clean up any expired or inactive sessions for this user/session type
try {
  const inactivityCutoff = new Date(now.getTime() - INACTIVITY_TIMEOUT_MS).toISOString();
  await executeQuery(
    `UPDATE sessions
       SET is_revoked = 1
     WHERE user_id = $1 AND session_type = $2
       AND is_revoked = 0
       AND (expires_at <= $3 OR last_activity <= $4)`,
    [userId, sessionType, now.toISOString(), inactivityCutoff]
  );
} catch (err) {
  console.error('[SESSION_SERVICE] Failed to clean up expired sessions:', err.message);
  throw err;
}

// After cleanup, check for any still‑active session (not revoked, not expired, recent activity)
try {
  const result = await executeQuery(
    `SELECT 1 FROM sessions
       WHERE user_id = $1 AND session_type = $2
         AND is_revoked = 0
         AND expires_at > $3
         AND last_activity > $4
       LIMIT 1`,
    [userId, sessionType, now.toISOString(), new Date(now.getTime() - INACTIVITY_TIMEOUT_MS).toISOString()]
  );
  if (result && result.rowCount && result.rowCount > 0) {
    const activeErr = new Error('This account is already logged in on another device. Please log out from that device before logging in here.');
    activeErr.code = 'ACTIVE_SESSION_EXISTS';
    activeErr.status = 409;
    throw activeErr;
  }
} catch (err) {
  if (err.code === 'ACTIVE_SESSION_EXISTS') {
    throw err; // propagate expected active session error
  }
  console.error('[SESSION_SERVICE] Failed to check existing active sessions:', err.message);
  throw err;
}

  try {
    await executeQuery(
      `INSERT INTO sessions
         (id, session_type, user_id, employer_id, created_at, expires_at, last_activity, is_revoked, client_ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9)`,
      [
        token, sessionType, userId, employerId,
        now.toISOString(), expiresAt.toISOString(), now.toISOString(),
        clientIp, userAgent
      ]
    );
  } catch (err) {
    // 23505 = PostgreSQL unique_violation, or SQLite / generic UNIQUE constraint error
    const isUniqueViolation = err.code === '23505' ||
      (err.message && (err.message.includes('UNIQUE constraint') || err.message.includes('unique constraint') || err.message.includes('idx_sessions_single_active_user')));
    if (isUniqueViolation) {
      const activeErr = new Error('This account is already logged in on another device. Please log out from that device before logging in here.');
      activeErr.code = 'ACTIVE_SESSION_EXISTS';
      activeErr.status = 409;
      throw activeErr;
    }
    throw err;
  }

  return {
    token,
    sessionType,
    userId,
    employerId,
    createdAt:    now.toISOString(),
    expiresAt:    expiresAt.toISOString(),
    lastActivity: now.toISOString()
  };
}

/**
 * Retrieve and validate an active session by token.
 * Returns null if missing, expired, revoked, or if inactivity >= INACTIVITY_TIMEOUT_MS.
 *
 * @param {string} token
 * @param {Object} [options]
 * @param {Date|number|string} [options.currentTime] - Test clock injection
 * @param {boolean} [options.touch=true] - Whether to update last_activity (false for background/poll requests)
 * @returns {Promise<Object|null>}
 */
async function getSession(token, options = {}) {
  if (!token || typeof token !== 'string') return null;

  let result;
  try {
    result = await executeQuery(
      `SELECT * FROM sessions WHERE id = $1 AND is_revoked = 0`,
      [token]
    );
  } catch (err) {
    console.error('[SESSION_SERVICE] Database failure during session validation (failing closed):', err.message);
    // Re-throw so callers (middleware) can distinguish DB errors from expired/missing sessions
    const dbErr = new Error(err.message);
    dbErr.isSessionDbError = true;
    throw dbErr;
  }

  if (!result || !result.rows || result.rows.length === 0) return null;

  const session = result.rows[0];
  const now     = options.currentTime ? new Date(options.currentTime) : new Date();
  const touch   = options.touch !== false;

  const lastActivityTime = new Date(session.last_activity).getTime();
  const expiresAtTime     = new Date(session.expires_at).getTime();
  const nowTime           = now.getTime();
  const elapsedInactivity = nowTime - lastActivityTime;

  // Fail closed: Inactivity timeout reached (>= 30 mins) or absolute expiry reached
  if (elapsedInactivity >= INACTIVITY_TIMEOUT_MS || nowTime >= expiresAtTime) {
    // Session has expired — immediately revoke in database to fail closed
    await revokeSession(token);
    return null;
  }

  // Update last activity and slide expiration window if meaningful activity (touch === true)
  if (touch) {
    const extendedExpires = new Date(nowTime + INACTIVITY_TIMEOUT_MS);
    const isoNow = now.toISOString();
    const isoExp = extendedExpires.toISOString();

    await executeQuery(
      'UPDATE sessions SET last_activity = $1, expires_at = $2 WHERE id = $3',
      [isoNow, isoExp, token]
    );

    session.last_activity = isoNow;
    session.expires_at    = isoExp;
  }

  return session;
}

/**
 * Revoke a specific session (e.g. on logout).
 * @returns {Promise<boolean>} True if revoked
 */
async function revokeSession(token) {
  if (!token) return false;
  try {
    const result = await executeQuery(
      'UPDATE sessions SET is_revoked = 1 WHERE id = $1',
      [token]
    );
    return result.rowCount > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Revoke all active sessions for a user (e.g. upon password change or account deactivation).
 * @returns {Promise<number>} Count of revoked sessions
 */
async function revokeUserSessions(userId) {
  if (!userId) return 0;
  try {
    const result = await executeQuery(
      'UPDATE sessions SET is_revoked = 1 WHERE user_id = $1 AND is_revoked = 0',
      [userId]
    );
    return result.rowCount;
  } catch (_) {
    return 0;
  }
}

/**
 * Prune expired or revoked sessions older than 7 days.
 */
async function cleanupExpiredSessions() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    await executeQuery(
      'DELETE FROM sessions WHERE expires_at < $1 OR (is_revoked = 1 AND last_activity < $2)',
      [cutoff, cutoff]
    );
  } catch (_) {}
}

/**
 * Return the single active (non-revoked, non-expired) session for a given user identity,
 * or null if no active session exists.
 *
 * Used by login routes to enforce the single-active-session policy.
 * The caller must treat a non-null return as "this account is already logged in".
 *
 * @param {string} userId        - The user_id stored in the sessions table (employee ID or admin username)
 * @param {string} sessionType   - 'employee' | 'admin'
 * @param {Date|string} [now]    - Optional test clock injection
 * @returns {Promise<Object|null>}
 */
async function getActiveSessionForUser(userId, sessionType, optionsOrNow = null) {
  if (!userId || !sessionType) return null;
  let parsedDate;
  if (optionsOrNow && typeof optionsOrNow === 'object' && !(optionsOrNow instanceof Date)) {
    parsedDate = optionsOrNow.currentTime ? new Date(optionsOrNow.currentTime) : new Date();
  } else if (optionsOrNow) {
    parsedDate = new Date(optionsOrNow);
  } else {
    parsedDate = new Date();
  }
  const nowTime = parsedDate.getTime();
  try {
    const result = await executeQuery(
      `SELECT id, created_at, last_activity, expires_at, client_ip
         FROM sessions
        WHERE user_id = $1
          AND session_type = $2
          AND is_revoked = 0
          AND expires_at > $3
        ORDER BY last_activity DESC
        LIMIT 1`,
      [userId, sessionType, new Date(nowTime).toISOString()]
    );
    if (!result || !result.rows || result.rows.length === 0) return null;

    const row = result.rows[0];
    const lastActivityTime = new Date(row.last_activity).getTime();
    const elapsed = nowTime - lastActivityTime;

    // Must also pass the inactivity check — an expired-by-inactivity but not-yet-revoked
    // session should not block a new login.
    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
      // Mark it revoked opportunistically (best effort)
      await revokeSession(row.id).catch(() => {});
      return null;
    }

    return row;
  } catch (err) {
    // Fail open on lookup error: do not block login if the session check itself fails.
    console.error('[SESSION_SERVICE] getActiveSessionForUser lookup error (failing open):', err.message);
    return null;
  }
}

module.exports = {
  createSession,
  getSession,
  revokeSession,
  revokeUserSessions,
  cleanupExpiredSessions,
  getActiveSessionForUser,
  setQueryProvider,
  INACTIVITY_TIMEOUT_MS,
  DEFAULT_EMPLOYEE_TTL_HOURS,
  DEFAULT_ADMIN_TTL_HOURS
};
