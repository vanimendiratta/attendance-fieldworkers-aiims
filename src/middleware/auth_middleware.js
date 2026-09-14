'use strict';

const sessionService = require('../services/session_service');
const { query }      = require('../db/database');

/**
 * Authentication & Authorization Middleware Suite (PostgreSQL async version)
 *
 * All middleware functions are now async because sessionService.getSession()
 * and database lookups are async (pg).
 *
 * Rules:
 *  1. Tokens extracted from Authorization header (Bearer), x-session-token, or cookie.
 *  2. Identity derived exclusively from validated database session.
 *  3. Client identity assertions cannot override session identity.
 *  4. Conflicting assertions trigger HTTP 403.
 */

// ---------------------------------------------------------------------------
// Token extraction helper (synchronous — no DB access)
// ---------------------------------------------------------------------------
function extractToken(req) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
  }

  // 2. Custom header: x-session-token
  const customHeader = req.headers['x-session-token'];
  if (customHeader && typeof customHeader === 'string') {
    return customHeader.trim();
  }

  // 3. Cookie: attendance_session=<token>
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)attendance_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1].trim());
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware: Require an active Employee session
// ---------------------------------------------------------------------------
async function requireAuthenticatedEmployee(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in with your employee credentials.'
      });
    }

    const session = await sessionService.getSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Session invalid or expired. Please sign in again.'
      });
    }

    if (session.session_type !== 'employee') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Employee credentials required for this operation.'
      });
    }

    const empResult = await query(
      'SELECT * FROM employees WHERE id = $1 AND employer_id = $2',
      [session.user_id, session.employer_id]
    );
    const employee = empResult.rows[0];

    if (!employee) {
      return res.status(403).json({ success: false, error: 'Forbidden: Employee record not found.' });
    }

    if (!employee.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Employee account has been deactivated.'
      });
    }

    // Check for identity conflict / tampering
    const requestedEmpId = req.headers['x-employee-id'] || req.query.employee_id || req.body?.employee_id;
    if (requestedEmpId && String(requestedEmpId).trim() !== employee.id) {
      return res.status(403).json({
        success: false,
        error: `Identity conflict: Cannot perform action for employee '${requestedEmpId}'. Authenticated as '${employee.id}'.`
      });
    }

    req.session    = session;
    req.employee   = employee;
    req.employerId = employee.employer_id;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Middleware: Require an active Employer Administrator session
// ---------------------------------------------------------------------------
async function requireAuthenticatedAdmin(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Administrator authentication required. Please sign in to the operations portal.'
      });
    }

    const session = await sessionService.getSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Admin session invalid or expired. Please sign in again.'
      });
    }

    if (session.session_type !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Employer administrator privileges required.'
      });
    }

    const orgResult = await query(
      'SELECT * FROM organizations WHERE id = $1',
      [session.employer_id]
    );
    const employer = orgResult.rows[0];

    if (!employer) {
      return res.status(403).json({ success: false, error: 'Forbidden: Employer organization not found.' });
    }

    // Enforce Tenant Isolation
    const requestedEmployerId = req.headers['x-employer-id'] || req.query.employer_id || req.body?.employer_id;
    if (requestedEmployerId && String(requestedEmployerId).trim() !== employer.id) {
      return res.status(403).json({
        success: false,
        error: `Tenant isolation violation: Authenticated admin belongs to '${employer.id}' and cannot access or modify '${requestedEmployerId}'.`
      });
    }

    const { admin_password: _, ...safeEmployer } = employer;
    req.session    = session;
    req.admin      = { username: session.user_id, employer_id: employer.id, employer: safeEmployer };
    req.employerId = employer.id;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Middleware: Require either an authenticated Employee OR Administrator session
// ---------------------------------------------------------------------------
async function requireAuthenticatedUser(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const session = await sessionService.getSession(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session invalid or expired. Please sign in again.' });
    }

    if (session.session_type === 'employee') {
      const empResult = await query(
        'SELECT * FROM employees WHERE id = $1 AND employer_id = $2 AND is_active = 1',
        [session.user_id, session.employer_id]
      );
      const employee = empResult.rows[0];
      if (!employee) {
        return res.status(403).json({ success: false, error: 'Forbidden: Active employee record not found.' });
      }
      req.session    = session;
      req.employee   = employee;
      req.employerId = employee.employer_id;
      req.userType   = 'employee';
      return next();
    }

    if (session.session_type === 'admin') {
      const orgResult = await query(
        'SELECT * FROM organizations WHERE id = $1',
        [session.employer_id]
      );
      const employer = orgResult.rows[0];
      if (!employer) {
        return res.status(403).json({ success: false, error: 'Forbidden: Organization not found.' });
      }
      req.session    = session;
      req.admin      = { username: session.user_id, employer_id: employer.id };
      req.employerId = employer.id;
      req.userType   = 'admin';
      return next();
    }

    return res.status(403).json({ success: false, error: 'Forbidden: Invalid session type.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  extractToken,
  requireAuthenticatedEmployee,
  requireAuthenticatedAdmin,
  requireAuthenticatedUser
};
