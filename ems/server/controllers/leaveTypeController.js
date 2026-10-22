// server/controllers/leaveTypeController.js
const db = require('../database/db');
const AuditService = require('../services/AuditService');

exports.getAllLeaveTypes = (req, res) => {
  try {
    const { includeInactive } = req.query;
    let sql = `SELECT * FROM leave_types`;
    if (!includeInactive || includeInactive === 'false') {
      sql += ` WHERE is_active = 1`;
    }
    sql += ` ORDER BY id ASC`;
    const leaveTypes = db.prepare(sql).all();
    res.json({ leaveTypes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createLeaveType = (req, res) => {
  try {
    const {
      code,
      name,
      description,
      is_paid = 1,
      requires_approval = 1,
      allow_half_day = 1,
      allow_hourly = 0,
      min_days_per_request = 0.5,
      max_days_per_request = null
    } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'Leave code and name are required.' });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM leave_types WHERE code = ?').get(cleanCode);
    if (existing) {
      return res.status(400).json({ error: `Leave type with code '${cleanCode}' already exists.` });
    }

    const stmt = db.prepare(`
      INSERT INTO leave_types (
        code, name, description, is_paid, requires_approval,
        allow_half_day, allow_hourly, min_days_per_request, max_days_per_request, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(
      cleanCode,
      name.trim(),
      description,
      is_paid ? 1 : 0,
      requires_approval ? 1 : 0,
      allow_half_day ? 1 : 0,
      allow_hourly ? 1 : 0,
      min_days_per_request || 0.5,
      max_days_per_request || null
    );

    const created = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(result.lastInsertRowid);

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'CREATE_LEAVE_TYPE',
      entityType: 'LEAVE_TYPE',
      entityId: created.id,
      newValues: created,
      remarks: `Created leave type: ${created.name} (${created.code})`
    });

    res.status(201).json({ success: true, leaveType: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateLeaveType = (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      is_paid,
      requires_approval,
      allow_half_day,
      allow_hourly,
      min_days_per_request,
      max_days_per_request,
      is_active
    } = req.body;

    const oldRecord = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id);
    if (!oldRecord) {
      return res.status(404).json({ error: 'Leave type not found.' });
    }

    db.prepare(`
      UPDATE leave_types SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        is_paid = COALESCE(?, is_paid),
        requires_approval = COALESCE(?, requires_approval),
        allow_half_day = COALESCE(?, allow_half_day),
        allow_hourly = COALESCE(?, allow_hourly),
        min_days_per_request = COALESCE(?, min_days_per_request),
        max_days_per_request = COALESCE(?, max_days_per_request),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name, description,
      is_paid !== undefined ? (is_paid ? 1 : 0) : null,
      requires_approval !== undefined ? (requires_approval ? 1 : 0) : null,
      allow_half_day !== undefined ? (allow_half_day ? 1 : 0) : null,
      allow_hourly !== undefined ? (allow_hourly ? 1 : 0) : null,
      min_days_per_request, max_days_per_request,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      id
    );

    const updated = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id);

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'UPDATE_LEAVE_TYPE',
      entityType: 'LEAVE_TYPE',
      entityId: id,
      oldValues: oldRecord,
      newValues: updated,
      remarks: `Updated leave type ${updated.code}`
    });

    res.json({ success: true, leaveType: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
