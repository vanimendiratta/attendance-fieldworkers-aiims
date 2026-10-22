// server/controllers/leaveRuleController.js
const db = require('../database/db');
const AuditService = require('../services/AuditService');

exports.getAllRules = (req, res) => {
  try {
    const rules = db.prepare(`
      SELECT 
        r.id as rule_id,
        r.rule_code,
        r.rule_name,
        r.description,
        r.is_active,
        lt.id as leave_type_id,
        lt.code as leave_type_code,
        lt.name as leave_type_name,
        v.id as active_version_id,
        v.version_number as active_version_number,
        v.effective_from,
        v.effective_to,
        v.config_json
      FROM leave_rules r
      JOIN leave_types lt ON lt.id = r.leave_type_id
      LEFT JOIN leave_rule_versions v ON v.leave_rule_id = r.id AND v.status = 'ACTIVE'
      ORDER BY r.id ASC
    `).all();

    const formatted = rules.map(r => {
      let config = {};
      try {
        config = r.config_json ? JSON.parse(r.config_json) : {};
      } catch (e) {}
      return {
        ...r,
        config
      };
    });

    res.json({ rules: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getRuleVersions = (req, res) => {
  try {
    const { ruleId } = req.params;
    const versions = db.prepare(`
      SELECT v.*, r.rule_code, r.rule_name, lt.code as leave_code
      FROM leave_rule_versions v
      JOIN leave_rules r ON r.id = v.leave_rule_id
      JOIN leave_types lt ON lt.id = r.leave_type_id
      WHERE v.leave_rule_id = ?
      ORDER BY v.version_number DESC
    `).all(ruleId);

    const formatted = versions.map(v => {
      let parsed = {};
      try {
        parsed = JSON.parse(v.config_json);
      } catch (e) {}
      return {
        ...v,
        config: parsed
      };
    });

    res.json({ versions: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createRuleVersion = (req, res) => {
  try {
    const { ruleId } = req.params;
    const { effective_from, effective_to, config, makeActive = true } = req.body;

    if (!effective_from || !config) {
      return res.status(400).json({ error: 'effective_from and config JSON are required.' });
    }

    const rule = db.prepare('SELECT * FROM leave_rules WHERE id = ?').get(ruleId);
    if (!rule) {
      return res.status(404).json({ error: 'Leave rule not found.' });
    }

    // Get max version number for this rule
    const maxVer = db.prepare('SELECT COALESCE(MAX(version_number), 0) as max_v FROM leave_rule_versions WHERE leave_rule_id = ?').get(ruleId);
    const newVersionNumber = maxVer.max_v + 1;

    let createdVersion;

    const versionTransaction = db.transaction(() => {
      if (makeActive) {
        // If making active, archive previous active versions or set effective_to
        db.prepare(`
          UPDATE leave_rule_versions 
          SET status = 'DEPRECATED', effective_to = date(?, '-1 day')
          WHERE leave_rule_id = ? AND status = 'ACTIVE'
        `).run(effective_from, ruleId);
      }

      const stmt = db.prepare(`
        INSERT INTO leave_rule_versions (
          leave_rule_id, version_number, effective_from, effective_to,
          status, config_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const configStr = typeof config === 'string' ? config : JSON.stringify(config);
      const result = stmt.run(
        ruleId,
        newVersionNumber,
        effective_from,
        effective_to || null,
        makeActive ? 'ACTIVE' : 'DRAFT',
        configStr,
        req.user?.email || 'ADMIN'
      );

      createdVersion = db.prepare('SELECT * FROM leave_rule_versions WHERE id = ?').get(result.lastInsertRowid);

      AuditService.log({
        actorUserId: req.user?.id,
        actorEmail: req.user?.email,
        action: 'CREATE_RULE_VERSION',
        entityType: 'LEAVE_RULE_VERSION',
        entityId: createdVersion.id,
        newValues: createdVersion,
        remarks: `Created Version ${newVersionNumber} for rule ${rule.rule_code}`
      });
    });

    versionTransaction();

    res.status(201).json({
      success: true,
      message: `Version ${newVersionNumber} created successfully. Historical data remains unaffected.`,
      version: createdVersion
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
