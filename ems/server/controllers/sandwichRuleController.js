// server/controllers/sandwichRuleController.js
const db = require('../database/db');
const AuditService = require('../services/AuditService');

exports.getAllSandwichRules = (req, res) => {
  try {
    const rules = db.prepare(`SELECT * FROM sandwich_rules ORDER BY id DESC`).all();
    const formatted = rules.map(r => {
      let applicable = [];
      try { applicable = JSON.parse(r.applicable_leave_types_json); } catch (e) {}
      return { ...r, applicable_leave_types: applicable };
    });
    res.json({ rules: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateSandwichRule = (req, res) => {
  try {
    const { id } = req.params;
    const {
      rule_name,
      applicable_leave_types,
      include_weekly_offs,
      include_public_holidays,
      charge_intervening_days,
      condition_description,
      is_active,
      effective_from
    } = req.body;

    const oldRecord = db.prepare('SELECT * FROM sandwich_rules WHERE id = ?').get(id);
    if (!oldRecord) {
      return res.status(404).json({ error: 'Sandwich rule not found.' });
    }

    const appTypesJson = applicable_leave_types ? JSON.stringify(applicable_leave_types) : oldRecord.applicable_leave_types_json;

    db.prepare(`
      UPDATE sandwich_rules SET
        rule_name = COALESCE(?, rule_name),
        applicable_leave_types_json = COALESCE(?, applicable_leave_types_json),
        include_weekly_offs = COALESCE(?, include_weekly_offs),
        include_public_holidays = COALESCE(?, include_public_holidays),
        charge_intervening_days = COALESCE(?, charge_intervening_days),
        condition_description = COALESCE(?, condition_description),
        is_active = COALESCE(?, is_active),
        effective_from = COALESCE(?, effective_from)
      WHERE id = ?
    `).run(
      rule_name,
      appTypesJson,
      include_weekly_offs !== undefined ? (include_weekly_offs ? 1 : 0) : null,
      include_public_holidays !== undefined ? (include_public_holidays ? 1 : 0) : null,
      charge_intervening_days !== undefined ? (charge_intervening_days ? 1 : 0) : null,
      condition_description,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      effective_from,
      id
    );

    const updated = db.prepare('SELECT * FROM sandwich_rules WHERE id = ?').get(id);

    AuditService.log({
      actorUserId: req.user?.id,
      actorEmail: req.user?.email,
      action: 'UPDATE_SANDWICH_RULE',
      entityType: 'SANDWICH_RULE',
      entityId: id,
      oldValues: oldRecord,
      newValues: updated,
      remarks: `Updated sandwich rule configuration: ${updated.rule_name}`
    });

    res.json({ success: true, rule: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
