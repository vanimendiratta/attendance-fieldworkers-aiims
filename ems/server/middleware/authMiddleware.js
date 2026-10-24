// server/middleware/authMiddleware.js
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../database/db');

let sessionService = null;
try {
  sessionService = require('../../../src/services/session_service');
} catch (_) {}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // CRITICAL: Without a secret, jwt.verify will throw on every call, rejecting all tokens.
  // This intentionally breaks authentication when JWT_SECRET is missing so the server
  // fails loudly rather than silently accepting forged tokens signed with a known default.
  console.error('[EMS_AUTH_CRITICAL] JWT_SECRET environment variable is not set. All EMS authentication will fail until it is configured.');
}

const AuthService = require('../services/AuthService');

function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

async function requireAuth(req, res, next) {
  setNoCacheHeaders(res);
  const authHeader = req.headers.authorization || req.headers['x-session-token'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (authHeader || req.cookies?.token || req.cookies?.attendance_session);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required.', code: 'AUTH_REQUIRED' });
  }

  const isBackground = req.headers['x-background-request'] === 'true' || req.headers['x-session-touch'] === 'false';
  const currentTime = (process.env.NODE_ENV !== 'production' && req.headers['x-test-current-time'])
    ? req.headers['x-test-current-time']
    : null;

  // 1. Try native EMS JWT
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.sessionId) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session token format.', code: 'SESSION_EXPIRED' });
    }

    const session = AuthService.validateSession(decoded.sessionId, { touch: !isBackground, currentTime });
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Session expired due to inactivity. Please log in again.', code: 'SESSION_EXPIRED' });
    }

    const user = db.prepare('SELECT id, employee_id, email, role, must_change_password, is_active FROM users WHERE id = ?').get(decoded.id);
    if (user && user.is_active === 1) {
      req.user = user;
      req.sessionId = decoded.sessionId;
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: User account is inactive or not found.', code: 'USER_INACTIVE' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Session expired due to inactivity or token expiration.', code: 'SESSION_EXPIRED' });
    }
    // Not an EMS JWT, proceed to check parent session
  }

  // 2. Try parent attendance session via sessionService (PostgreSQL / async)
  if (sessionService) {
    try {
      const session = await sessionService.getSession(token, { touch: !isBackground, currentTime });
      if (session) {
        if (session.session_type === 'admin') {
          let adminUser = db.prepare("SELECT * FROM users WHERE role = 'ADMIN'").get();
          if (!adminUser) {
            adminUser = { id: 1, employee_id: null, email: 'admin@ems.gov.in', role: 'ADMIN', is_active: 1 };
          }
          req.user = {
            id: adminUser.id,
            employee_id: null,
            email: adminUser.email || 'admin@ems.gov.in',
            name: 'AIIMS Administrator',
            role: 'ADMIN',
            is_active: 1
          };
          req.session = session;
          return next();
        } else if (session.session_type === 'employee') {
          let parentEmp = null;
          try {
            const { query } = require('../../../src/db/database');
            const empRes = await query('SELECT * FROM employees WHERE id = $1', [session.user_id]);
            parentEmp = empRes.rows[0];
          } catch (_) {}

          if (!parentEmp) {
            // Check local SQLite attendance.db
            try {
              const Database = require('better-sqlite3');
              const attDbPath = path.resolve(__dirname, '../../../attendance.db');
              if (fs.existsSync(attDbPath)) {
                const attDb = new Database(attDbPath, { readonly: true });
                parentEmp = attDb.prepare('SELECT * FROM employees WHERE id = ?').get(session.user_id);
                attDb.close();
              }
            } catch (_) {}
          }

          if (parentEmp && (parentEmp.is_active === 1 || parentEmp.is_active === true)) {
            const empSync = reconcileOrSyncEmployee(parentEmp);
            req.user = empSync;
            req.session = session;
            return next();
          }
        }
      }
    } catch (e) {
      // Continue to local SQLite check
    }
  }

  // 3. Fallback: Check local SQLite attendance.db directly
  try {
    const Database = require('better-sqlite3');
    const attDbPath = path.resolve(__dirname, '../../../attendance.db');
    if (fs.existsSync(attDbPath)) {
      const attDb = new Database(attDbPath);
      const localSession = attDb.prepare('SELECT * FROM sessions WHERE id = ? AND is_revoked = 0').get(token);
      if (localSession) {
        const now = currentTime ? new Date(currentTime) : new Date();
        const nowTime = now.getTime();
        const lastActTime = new Date(localSession.last_activity).getTime();
        const expTime = new Date(localSession.expires_at).getTime();
        const elapsed = nowTime - lastActTime;
        const timeoutMs = 30 * 60 * 1000;

        if (elapsed >= timeoutMs || nowTime >= expTime) {
          attDb.prepare('UPDATE sessions SET is_revoked = 1 WHERE id = ?').run(token);
          attDb.close();
          return res.status(401).json({ error: 'Unauthorized: Session expired due to inactivity. Please log in again.', code: 'SESSION_EXPIRED' });
        }

        if (!isBackground) {
          const extendedExpires = new Date(nowTime + timeoutMs).toISOString();
          attDb.prepare('UPDATE sessions SET last_activity = ?, expires_at = ? WHERE id = ?').run(now.toISOString(), extendedExpires, token);
        }

        if (localSession.session_type === 'admin') {
          attDb.close();
          let adminUser = db.prepare("SELECT * FROM users WHERE role = 'ADMIN'").get();
          if (!adminUser) {
            adminUser = { id: 1, employee_id: null, email: 'admin@ems.gov.in', role: 'ADMIN', is_active: 1 };
          }
          req.user = {
            id: adminUser.id,
            employee_id: null,
            email: adminUser.email || 'admin@ems.gov.in',
            name: 'AIIMS Administrator',
            role: 'ADMIN',
            is_active: 1
          };
          req.session = localSession;
          return next();
        } else if (localSession.session_type === 'employee') {
          const parentEmp = attDb.prepare('SELECT * FROM employees WHERE id = ?').get(localSession.user_id);
          attDb.close();
          if (parentEmp && parentEmp.is_active) {
            const empSync = reconcileOrSyncEmployee(parentEmp);
            req.user = empSync;
            req.session = localSession;
            return next();
          }
        }
      } else {
        attDb.close();
      }
    }
  } catch (_) {}

  return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.', code: 'SESSION_EXPIRED' });
}

function reconcileOrSyncEmployee(parentEmp) {
  const normEmail = (parentEmp.email || '').toLowerCase().trim();
  let emsEmp = db.prepare('SELECT * FROM employees WHERE employee_id = ? OR LOWER(email) = ? OR official_employee_id = ?')
    .get(parentEmp.id, normEmail, parentEmp.id);

  if (!emsEmp) {
    const insertEmp = db.prepare(`
      INSERT INTO employees (
        employee_id, official_employee_id, name, gender, mobile, email,
        date_of_joining, date_of_birth, department, designation, employee_category,
        is_field_worker, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);
    const doj = parentEmp.created_at ? String(parentEmp.created_at).split('T')[0] : '2026-04-01';
    const isFw = (parentEmp.territory || parentEmp.team_id) ? 1 : 0;
    insertEmp.run(
      parentEmp.id,
      parentEmp.id,
      parentEmp.name,
      parentEmp.gender || 'OTHER',
      parentEmp.phone || '+91 0000000000',
      normEmail,
      doj,
      parentEmp.date_of_birth || '1995-01-01',
      parentEmp.department || 'CDER',
      parentEmp.designation || 'Field Worker',
      isFw ? 'FIELD_WORKER' : 'GENERAL',
      isFw
    );
    emsEmp = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(parentEmp.id);

    try {
      const LeaveLedgerService = require('../services/LeaveLedgerService');
      const clType = db.prepare("SELECT id FROM leave_types WHERE code = 'CL'").get();
      const elType = db.prepare("SELECT id FROM leave_types WHERE code = 'EL'").get();
      if (clType) {
        LeaveLedgerService.recordTransaction({
          employeeId: parentEmp.id,
          leaveTypeId: clType.id,
          transactionType: 'INITIAL_CREDIT',
          amount: 8.0,
          remarks: 'Initial CL Entitlement (Auto-Synced from Attendance Profile)',
          createdBy: 'SYSTEM'
        });
      }
      if (elType) {
        LeaveLedgerService.recordTransaction({
          employeeId: parentEmp.id,
          leaveTypeId: elType.id,
          transactionType: 'INITIAL_CREDIT',
          amount: 15.0,
          remarks: 'Initial EL Entitlement (Auto-Synced from Attendance Profile)',
          createdBy: 'SYSTEM'
        });
      }
    } catch (ledgerErr) {
      console.warn('[EMS_LEDGER_INIT_WARNING]', ledgerErr.message);
    }
  }

  let emsUser = db.prepare('SELECT * FROM users WHERE employee_id = ?').get(emsEmp.employee_id);
  if (!emsUser) {
    db.prepare(`
      INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
      VALUES (?, ?, 'PARENT_AUTH_MANAGED', 'EMPLOYEE', 0, 1)
    `).run(emsEmp.employee_id, emsEmp.email);
    emsUser = db.prepare('SELECT * FROM users WHERE employee_id = ?').get(emsEmp.employee_id);
  }

  return {
    id: emsUser ? emsUser.id : emsEmp.id,
    employee_id: emsEmp.employee_id,
    email: emsEmp.email,
    name: emsEmp.name,
    role: 'EMPLOYEE',
    is_field_worker: emsEmp.is_field_worker,
    is_active: 1
  };
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
    }
    next();
  });
}

/**
 * Ensures an employee can only access their own records unless they are an ADMIN
 */
function enforceEmployeeScope(paramName = 'employeeId') {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (req.user.role === 'ADMIN') {
        return next();
      }
      const targetEmpId = req.params[paramName] || req.body[paramName] || req.query[paramName];
      if (targetEmpId && targetEmpId !== req.user.employee_id) {
        return res.status(403).json({
          error: 'Access denied: You are not authorized to view or modify records of another employee.'
        });
      }
      next();
    });
  };
}

module.exports = {
  requireAuth,
  requireAdmin,
  enforceEmployeeScope
};
