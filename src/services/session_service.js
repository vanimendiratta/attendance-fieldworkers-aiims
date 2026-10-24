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

module.exports = {
  createSession,
  getSession,
  revokeSession,
  revokeUserSessions,
  cleanupExpiredSessions,
  setQueryProvider,
  INACTIVITY_TIMEOUT_MS,
  DEFAULT_EMPLOYEE_TTL_HOURS,
  DEFAULT_ADMIN_TTL_HOURS
};
