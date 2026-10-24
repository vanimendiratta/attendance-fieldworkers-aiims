// server/controllers/authController.js
const AuthService = require('../services/AuthService');
const db = require('../database/db');

exports.login = (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Employee ID/Email and password are required.' });
    }

    const reqMeta = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    };

    const authResult = AuthService.authenticate(identifier, password, reqMeta);
    res.json(authResult);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

exports.getMe = (req, res) => {
  try {
    const user = db.prepare(`
      SELECT u.id, u.employee_id, u.email, u.role, u.must_change_password, u.is_active,
             e.name, e.gender, e.mobile, e.date_of_joining, e.date_of_birth,
             e.department, e.designation, e.employee_category, e.is_field_worker, e.field_location, e.status as employee_status
      FROM users u
      LEFT JOIN employees e ON e.employee_id = u.employee_id
      WHERE u.id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      user: {
        id: user.id,
        employee_id: user.employee_id,
        email: user.email,
        name: user.name || 'System Administrator',
        role: user.role,
        gender: user.gender,
        mobile: user.mobile,
        date_of_joining: user.date_of_joining,
        date_of_birth: user.date_of_birth,
        department: user.department,
        designation: user.designation,
        employee_category: user.employee_category,
        is_field_worker: user.is_field_worker === 1,
        field_location: user.field_location || null,
        employee_status: user.employee_status,
        must_change_password: user.must_change_password === 1
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.changePassword = (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = AuthService.changePassword(req.user.id, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.adminResetPassword = (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ error: 'Employee ID is required.' });
    }

    const result = AuthService.adminResetPassword(employeeId, req.user.email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.logout = (req, res) => {
  try {
    if (req.sessionId) {
      AuthService.revokeSession(req.sessionId);
    }
    const authHeader = req.headers.authorization || req.headers['x-session-token'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (authHeader || req.cookies?.token || req.cookies?.attendance_session);
    if (token) {
      let sessionService = null;
      try { sessionService = require('../../../src/services/session_service'); } catch (_) {}
      if (sessionService) {
        sessionService.revokeSession(token).catch(() => {});
      }
    }
    res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
