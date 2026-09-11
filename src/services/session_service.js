const crypto = require('crypto');
const db = require('../db/database');

/**
 * Session Service — Database-Backed Cryptographic Sessions
 * 
 * Manages active sessions for employees and employer administrators:
 * - 256-bit cryptographically random tokens (crypto.randomBytes)
 * - Expiration validation (default 24h for employees, 8h for administrators)
 * - Immediate server-side revocation on logout
 * - Bulk revocation on credential change or deactivation
 */

const DEFAULT_EMPLOYEE_TTL_HOURS = 24;
const DEFAULT_ADMIN_TTL_HOURS = 8;

/**
 * Create a new database-backed session
 * @param {Object} params
 * @param {'employee'|'admin'} params.sessionType
 * @param {string} params.userId - Employee ID or admin username
 * @param {string} params.employerId - Employer organization ID
 * @param {string} [params.clientIp]
 * @param {string} [params.userAgent]
 * @param {number} [params.ttlHours]
 * @returns {Object} Created session row
 */
function createSession({ sessionType, userId, employerId, clientIp = '127.0.0.1', userAgent = 'Unknown', ttlHours = null }) {
  if (!sessionType || !userId || !employerId) {
    throw new Error('sessionType, userId, and employerId are required to create a session.');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const hours = ttlHours || (sessionType === 'admin' ? DEFAULT_ADMIN_TTL_HOURS : DEFAULT_EMPLOYEE_TTL_HOURS);
  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000);

  const stmt = db.prepare(`
    INSERT INTO sessions (id, session_type, user_id, employer_id, created_at, expires_at, last_activity, is_revoked, client_ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  stmt.run(
    token,
    sessionType,
    userId,
    employerId,
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
    clientIp,
    userAgent
  );

  return {
    token,
    sessionType,
    userId,
    employerId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

/**
 * Retrieve and validate an active session by token
 * @param {string} token
 * @returns {Object|null} Session row or null if missing, expired, or revoked
 */
function getSession(token) {
  if (!token || typeof token !== 'string') return null;

  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE id = ? AND is_revoked = 0
  `).get(token);

  if (!session) return null;

  const now = new Date();
  if (new Date(session.expires_at) <= now) {
    // Session has expired — mark revoked lazily
    revokeSession(token);
    return null;
  }

  // Update last activity asynchronously
  try {
    db.prepare('UPDATE sessions SET last_activity = ? WHERE id = ?').run(now.toISOString(), token);
  } catch (_) {}

  return session;
}

/**
 * Revoke a specific session (e.g. on logout)
 * @param {string} token
 * @returns {boolean} True if revoked
 */
function revokeSession(token) {
  if (!token) return false;
  try {
    const res = db.prepare('UPDATE sessions SET is_revoked = 1 WHERE id = ?').run(token);
    return res.changes > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Revoke all active sessions for a user (e.g. upon password change or account deactivation)
 * @param {string} userId
 * @returns {number} Count of revoked sessions
 */
function revokeUserSessions(userId) {
  if (!userId) return 0;
  try {
    const res = db.prepare('UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND is_revoked = 0').run(userId);
    return res.changes;
  } catch (_) {
    return 0;
  }
}

/**
 * Prune expired or revoked sessions older than 7 days
 */
function cleanupExpiredSessions() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (is_revoked = 1 AND last_activity < ?)').run(cutoff, cutoff);
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
