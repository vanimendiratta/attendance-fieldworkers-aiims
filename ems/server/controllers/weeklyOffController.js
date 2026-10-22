// server/controllers/weeklyOffController.js
const db = require('../database/db');
const AuditService = require('../services/AuditService');

exports.getAllWeeklyOffRules = (req, res) => {
  try {
    const rules = db.prepare(`SELECT * FROM weekly_off_rules ORDER BY id ASC`).all();
    const formatted = rules.map(r => {
      let pattern = {};
      try { pattern = JSON.parse(r.pattern_json); } catch (e) {}
      return { ...r, pattern };
    });
    res.json({ rules: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createWeeklyOffRule = (req, res) => {
  try {
    const { rule_name, days = [0, 6], department = 'ALL', applicable_category = 'ALL' } = req.body;
    if (!rule_name || !Array.isArray(days)) {
      return res.status(400).json({ error: 'rule_name and days array (e.g. [0, 6]) are required.' });
    }

    const patternJson = JSON.stringify({ days });
    const stmt = db.prepare(`
      INSERT INTO weekly_off_rules (rule_name, pattern_json, department, applicable_category, is_active)
      VALUES (?, ?, ?, ?, 1)
    `);

    const result = stmt.run(rule_name.trim(), patternJson, department, applicable_category);
    const created = db.prepare('SELECT * FROM weekly_off_rules WHERE id = ?').get(result.lastInsertRowid);

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'CREATE_WEEKLY_OFF_RULE',
      entityType: 'WEEKLY_OFF_RULE',
      entityId: created.id,
      newValues: created,
      remarks: `Created weekly off rule: ${created.rule_name}`
    });

    res.status(201).json({ success: true, rule: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
