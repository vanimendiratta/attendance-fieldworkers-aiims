// server/controllers/holidayController.js
const db = require('../database/db');
const AuditService = require('../services/AuditService');

exports.getAllHolidays = (req, res) => {
  try {
    const { year, type } = req.query;
    let sql = `SELECT * FROM holidays WHERE 1=1`;
    const params = [];

    if (year) {
      sql += ` AND strftime('%Y', holiday_date) = ?`;
      params.push(String(year));
    }
    if (type && type !== 'ALL') {
      sql += ` AND holiday_type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY holiday_date ASC`;
    const rows = db.prepare(sql).all(...params);

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const holidays = rows.map(h => {
      const dt = new Date(h.holiday_date + 'T00:00:00');
      const dayName = isNaN(dt.getTime()) ? '' : days[dt.getDay()];
      return {
        ...h,
        day_of_week: dayName,
        is_gazetted: h.holiday_type === 'PUBLIC' || h.holiday_type === 'NATIONAL',
        is_restricted: h.holiday_type === 'RESTRICTED',
        compoff_eligible: h.holiday_type === 'PUBLIC' || h.holiday_type === 'NATIONAL'
      };
    });

    res.json({ holidays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createHoliday = (req, res) => {
  try {
    const { holiday_date, holiday_name, holiday_type = 'PUBLIC', location = 'ALL', department = 'ALL', applicable_category = 'ALL' } = req.body;

    if (!holiday_date || !holiday_name) {
      return res.status(400).json({ error: 'Holiday date and name are required.' });
    }

    const stmt = db.prepare(`
      INSERT INTO holidays (holiday_date, holiday_name, holiday_type, location, department, applicable_category, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(holiday_date, holiday_name.trim(), holiday_type, location, department, applicable_category);
    const created = db.prepare('SELECT * FROM holidays WHERE id = ?').get(result.lastInsertRowid);

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'CREATE_HOLIDAY',
      entityType: 'HOLIDAY',
      entityId: created.id,
      newValues: created,
      remarks: `Added holiday: ${created.holiday_name} on ${created.holiday_date}`
    });

    res.status(201).json({ success: true, holiday: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteHoliday = (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM holidays WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Holiday not found.' });
    }

    db.prepare('DELETE FROM holidays WHERE id = ?').run(id);

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'DELETE_HOLIDAY',
      entityType: 'HOLIDAY',
      entityId: id,
      oldValues: existing,
      remarks: `Deleted holiday: ${existing.holiday_name}`
    });

    res.json({ success: true, message: 'Holiday deleted successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
