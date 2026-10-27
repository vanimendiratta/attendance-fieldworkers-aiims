// server/services/AuthService.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const NotificationService = require('./NotificationService');
const AuditService = require('./AuditService');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[EMS_AUTH_CRITICAL] JWT_SECRET environment variable is not set. Token generation will fail until configured.');
}

const INACTIVITY_TIMEOUT_MS = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MS, 10) || (30 * 60 * 1000); // 30 minutes

class AuthService {
  static get INACTIVITY_TIMEOUT_MS() {
    return INACTIVITY_TIMEOUT_MS;
  }

  /**
   * Validate a server-side session with 30-minute inactivity check.
   */
  static validateSession(sessionId, options = {}) {
    if (!sessionId || typeof sessionId !== 'string') return null;
    try {
      const session = db.prepare('SELECT * FROM user_sessions WHERE id = ? AND is_revoked = 0').get(sessionId);
      if (!session) return null;

      const now = options.currentTime ? new Date(options.currentTime) : new Date();
      const touch = options.touch !== false;

      const lastActivityTime = new Date(session.last_activity_at).getTime();
      const expiresAtTime     = new Date(session.expires_at).getTime();
      const nowTime           = now.getTime();
      const elapsed           = nowTime - lastActivityTime;

      // Fail closed: Inactivity timeout reached (>= 30 mins) or absolute expiry reached
      if (elapsed >= INACTIVITY_TIMEOUT_MS || nowTime >= expiresAtTime) {
        db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?').run(sessionId);
        return null;
      }

      if (touch) {
        const extendedExpires = new Date(nowTime + INACTIVITY_TIMEOUT_MS);
        const isoNow = now.toISOString();
        const isoExp = extendedExpires.toISOString();
        db.prepare('UPDATE user_sessions SET last_activity_at = ?, expires_at = ? WHERE id = ?').run(isoNow, isoExp, sessionId);
        session.last_activity_at = isoNow;
        session.expires_at       = isoExp;
      }

      return session;
    } catch (err) {
      console.error('[EMS_AUTH] Session validation database error (failing closed):', err.message);
      return null;
    }
  }

  /**
   * Revoke a server-side session.
   */
  static revokeSession(sessionId) {
    if (!sessionId) return false;
    try {
      const res = db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?').run(sessionId);
      return res.changes > 0;
    } catch (_) {
      return false;
    }
  }

  /**
   * Revoke all active sessions for a user (e.g. on password change).
   */
  static revokeAllUserSessions(userId) {
    if (!userId) return 0;
    try {
      const res = db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ? AND is_revoked = 0').run(userId);
      return res.changes;
    } catch (_) {
      return 0;
    }
  }
  /**
   * Generate a random cryptographically secure temporary password
   */
  static generateTemporaryPassword(length = 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      pwd += chars[bytes[i] % chars.length];
    }
    return pwd;
  }

  /**
   * Create an employee user account with temporary credentials and notification
   */
  static createEmployeeAccount(employee, options = {}) {
    const tempPassword = options.temporaryPassword || this.generateTemporaryPassword(10);
    const passwordHash = bcrypt.hashSync(tempPassword, 10);

    const stmt = db.prepare(`
      INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
      VALUES (?, ?, ?, 'EMPLOYEE', 1, 1)
    `);

    const result = stmt.run(employee.employee_id, employee.email, passwordHash);
    const userId = result.lastInsertRowid;

    // Send credential welcome notification
    NotificationService.dispatch('ACCOUNT_CREATED', userId, {
      employee_name: employee.name,
      employee_id: employee.employee_id,
      email: employee.email
    }, {
      title: 'Welcome to EMS — Account Credentials Generated',
      message: `Your EMS account has been created. Your Employee ID is ${employee.employee_id}. Temporary Password: ${tempPassword}. Please change your password upon your first login.`,
      type: 'ACTION_REQUIRED'
    });

    console.log(`[AUTH] Account created for ${employee.email} (Emp ID: ${employee.employee_id}). Temp Password: ${tempPassword}`);

    return {
      userId,
      email: employee.email,
      temporaryPassword: tempPassword
    };
  }

  /**
   * Login user with Employee ID / Email and password
   */
  static authenticate(loginIdentifier, password, reqMeta = {}) {
    const rawId = (loginIdentifier || '').trim();
    let normOfficial = null;
    const numMatch = rawId.match(/^(?:CDER[-_\s]?)?0*(\d{1,2})$/i);
    if (numMatch) {
      normOfficial = `CDER-${String(numMatch[1]).padStart(2, '0')}`;
    }

    // Can login with official_employee_id (e.g. CDER-01), sys employee_id, or email (case-insensitive)
    const user = db.prepare(`
      SELECT u.*, e.name as employee_name, e.department, e.designation, e.is_field_worker, e.status as employee_status, e.official_employee_id
      FROM users u
      LEFT JOIN employees e ON e.employee_id = u.employee_id
      WHERE (
        u.email = ? COLLATE NOCASE 
        OR u.employee_id = ? COLLATE NOCASE 
        OR e.official_employee_id = ? COLLATE NOCASE
        OR (? IS NOT NULL AND e.official_employee_id = ? COLLATE NOCASE)
      ) AND u.is_active = 1
    `).get(rawId, rawId, rawId, normOfficial, normOfficial);

    if (!user) {
      AuditService.log({
        action: 'LOGIN_FAILED',
        entityType: 'AUTH',
        remarks: `Failed login attempt for identifier: ${loginIdentifier}`,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent
      });
      throw new Error('Invalid login credentials or account is deactivated.');
    }

    if (user.role === 'EMPLOYEE' && user.employee_status && user.employee_status !== 'ACTIVE') {
      throw new Error(`Your employee account is ${user.employee_status}. Please contact the HR/Administrator.`);
    }

    let isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid && user.role === 'EMPLOYEE' && user.employee_name) {
      const allowed = AuthService.getPermittedDefaultPasswords(user.employee_name, user.official_employee_id || user.employee_id);
      if (allowed.some(p => p === password || p.toLowerCase() === password.toLowerCase())) {
        isValid = true;
        const newHash = bcrypt.hashSync(password, 10);
        db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`).run(newHash, user.id);
      }
    }

    if (!isValid) {
      AuditService.log({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'LOGIN_FAILED_PASSWORD',
        entityType: 'AUTH',
        remarks: 'Incorrect password entered',
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent
      });
      throw new Error('Invalid login credentials or account is deactivated.');
    }

    // Update last login
    db.prepare(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);

    // Audit log
    AuditService.log({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'LOGIN_SUCCESS',
      entityType: 'AUTH',
      entityId: user.id,
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent
    });

    const secret = process.env.JWT_SECRET || JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not configured on the server.');
    }

// Single-Active-Session Policy: reject new login if the account is already actively logged in.
const existingSession = db.prepare(`
  SELECT id, last_activity_at, expires_at FROM user_sessions
   WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?
   ORDER BY last_activity_at DESC LIMIT 1
`).get(user.id, new Date().toISOString());
if (existingSession) {
  const elapsed = new Date().getTime() - new Date(existingSession.last_activity_at).getTime();
  if (elapsed < INACTIVITY_TIMEOUT_MS) {
    const err = new Error('This account is already logged in on another device. Please log out from that device before logging in here.');
    err.code = 'ACTIVE_SESSION_EXISTS';
    throw err;
  }
  // Revoke stale session
  db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?').run(existingSession.id);
}

const sessionId = crypto.randomBytes(24).toString('hex');
const now = reqMeta.currentTime ? new Date(reqMeta.currentTime) : new Date();
const expiresAt = new Date(now.getTime() + INACTIVITY_TIMEOUT_MS);

    try {
      db.prepare(`
        INSERT INTO user_sessions (id, user_id, employee_id, created_at, last_activity_at, expires_at, is_revoked, client_ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        sessionId,
        user.id,
        user.employee_id,
        now.toISOString(),
        now.toISOString(),
        expiresAt.toISOString(),
        reqMeta.ip || null,
        reqMeta.userAgent || null
      );
    } catch (dbErr) {
      if (dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' || (dbErr.message && dbErr.message.includes('UNIQUE constraint'))) {
        const activeErr = new Error('This account is already logged in on another device. Please log out from that device before logging in here.');
        activeErr.code = 'ACTIVE_SESSION_EXISTS';
        throw activeErr;
      }
      console.error('[EMS_AUTH] Failed to record user_sessions record:', dbErr.message);
      throw new Error('Failed to establish secure session.');
    }

    const token = jwt.sign(
      {
        id: user.id,
        employee_id: user.employee_id,
        email: user.email,
        role: user.role,
        sessionId,
        must_change_password: user.must_change_password
      },
      secret,
      { expiresIn: '30m' }
    );

    return {
      token,
      sessionId,
      user: {
        id: user.id,
        employee_id: user.employee_id,
        email: user.email,
        name: user.employee_name || 'System Administrator',
        role: user.role,
        department: user.department,
        designation: user.designation,
        is_field_worker: user.is_field_worker === 1,
        must_change_password: user.must_change_password === 1
      }
    };
  }

  /**
   * Change user password (especially on first login or user profile)
   */
  static changePassword(userId, currentPassword, newPassword) {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!user) throw new Error('User not found.');

    if (user.must_change_password !== 1) {
      const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
      if (!isValid) throw new Error('Current password is incorrect.');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters in length.');
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare(`
      UPDATE users 
      SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(newHash, userId);

    AuditService.log({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: user.id,
      remarks: 'User successfully changed password'
    });

    return { success: true, message: 'Password updated successfully.' };
  }

  /**
   * Admin Reset Password for an employee
   */
  static adminResetPassword(employeeId, adminEmail = 'ADMIN') {
    const user = db.prepare(`SELECT * FROM users WHERE employee_id = ?`).get(employeeId);
    if (!user) throw new Error('Employee user account not found.');

    const tempPassword = this.generateTemporaryPassword(10);
    const hash = bcrypt.hashSync(tempPassword, 10);

    db.prepare(`
      UPDATE users 
      SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(hash, user.id);

    NotificationService.dispatch('PASSWORD_RESET', user.id, {
      employee_id: employeeId
    }, {
      title: 'EMS Account Password Reset',
      message: `Your password has been reset by the Administrator. Temporary Password: ${tempPassword}. You must change it upon logging in.`,
      type: 'ACTION_REQUIRED'
    });

    AuditService.log({
      actorEmail: adminEmail,
      action: 'ADMIN_RESET_PASSWORD',
      entityType: 'USER',
      entityId: user.id,
      remarks: `Admin reset password for employee ${employeeId}`
    });

    return {
      success: true,
      temporaryPassword: tempPassword,
      message: `Password reset. Temporary password generated and sent to employee.`
    };
  }

  /**
   * Generate default password in format: First 3 letters of name (Capitalized) + '@' + Employee ID number (e.g. Abh@01)
   */
  static generateDefaultPassword(name, officialId) {
    const idNum = officialId ? (officialId.includes('-') ? officialId.split('-')[1] : officialId) : '01';
    let cleanName = (name || '').replace(/^Dr\.?\s+/i, '').trim();
    let tokens = cleanName.split(/\s+/);
    let firstNameToken = tokens[0] || 'Emp';
    if (firstNameToken.replace(/[^a-zA-Z]/g, '').length < 3 && tokens.length > 1) {
      firstNameToken = tokens[1];
    }
    const lettersOnly = firstNameToken.replace(/[^a-zA-Z]/g, '') || 'Emp';
    const prefix = lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1, 3).toLowerCase();
    return `${prefix}@${idNum}`;
  }

  /**
   * Permitted default passwords including alias fallbacks (e.g. Abh@01, Abh@CDER-01, etc.)
   */
  static getPermittedDefaultPasswords(name, officialId) {
    const primary = this.generateDefaultPassword(name, officialId);
    const idNum = officialId ? (officialId.includes('-') ? officialId.split('-')[1] : officialId) : '01';
    const set = new Set([primary]);

    if (officialId) {
      const prefix = primary.split('@')[0];
      set.add(`${prefix}@${officialId}`);
    }

    let cleanName = (name || '').replace(/^Dr\.?\s+/i, '').trim();
    let tokens = cleanName.split(/\s+/);
    for (const token of tokens) {
      const letters = token.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 3) {
        const p = letters.charAt(0).toUpperCase() + letters.slice(1, 3).toLowerCase();
        set.add(`${p}@${idNum}`);
        if (officialId) set.add(`${p}@${officialId}`);
      }
    }

    return Array.from(set);
  }
}

module.exports = AuthService;
