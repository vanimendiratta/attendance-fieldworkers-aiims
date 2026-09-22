'use strict';

const crypto         = require('crypto');
const { query, pool } = require('../db/database');

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

const DEFAULT_EMPLOYEE_TTL_HOURS = 24 * 90; // 90 days for field workers
const DEFAULT_ADMIN_TTL_HOURS    = 24 * 7;  // 7 days for administrators

/**
 * Create a new database-backed session.
 * @returns {Promise<Object>} Created session token + metadata
 */
async function createSession({
  sessionType, userId, employerId,
  clientIp = '127.0.0.1', userAgent = 'Unknown', ttlHours = null
}) {
  if (!sessionType || !userId || !employerId) {
    throw new Error('sessionType, userId, and employerId are required to create a session.');
  }

  const token     = crypto.randomBytes(32).toString('hex');
  const now       = new Date();
  const hours     = ttlHours || (sessionType === 'admin' ? DEFAULT_ADMIN_TTL_HOURS : DEFAULT_EMPLOYEE_TTL_HOURS);
  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000);

  await query(
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
    createdAt:  now.toISOString(),
    expiresAt:  expiresAt.toISOString()
  };
}

/**
 * Retrieve and validate an active session by token.
 * Returns null if missing, expired, or revoked.
 * @returns {Promise<Object|null>}
 */
async function getSession(token) {
  if (!token || typeof token !== 'string') return null;

  const result = await query(
    `SELECT * FROM sessions WHERE id = $1 AND is_revoked = 0`,
    [token]
  );

  if (result.rows.length === 0) return null;

  const session = result.rows[0];
  const now     = new Date();

  if (new Date(session.expires_at) <= now) {
    // Session has expired — mark revoked lazily (fire-and-forget)
    revokeSession(token).catch(() => {});
    return null;
  }

  // Update last activity and slide expiration window (keeps active users logged in across days)
  const ttlHours = session.session_type === 'admin' ? DEFAULT_ADMIN_TTL_HOURS : DEFAULT_EMPLOYEE_TTL_HOURS;
  const extendedExpires = new Date(now.getTime() + ttlHours * 3600 * 1000);
  query(
    'UPDATE sessions SET last_activity = $1, expires_at = $2 WHERE id = $3',
    [now.toISOString(), extendedExpires.toISOString(), token]
  ).catch(() => {});

  return session;
}

/**
 * Revoke a specific session (e.g. on logout).
 * @returns {Promise<boolean>} True if revoked
 */
async function revokeSession(token) {
  if (!token) return false;
  try {
    const result = await query(
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
    const result = await query(
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
    await query(
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
  DEFAULT_EMPLOYEE_TTL_HOURS,
  DEFAULT_ADMIN_TTL_HOURS
};
