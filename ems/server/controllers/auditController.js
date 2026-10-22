// server/controllers/auditController.js
const AuditService = require('../services/AuditService');

exports.getAuditLogs = (req, res) => {
  try {
    const { entityType, entityId, action, actorEmail, limit = 50, offset = 0 } = req.query;
    const logs = AuditService.getLogs({
      entityType,
      entityId,
      action,
      actorEmail,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

    const formatted = logs.map(l => {
      let oldVal = null;
      let newVal = null;
      try { oldVal = l.old_values_json ? JSON.parse(l.old_values_json) : null; } catch(e){}
      try { newVal = l.new_values_json ? JSON.parse(l.new_values_json) : null; } catch(e){}
      return {
        ...l,
        old_values: oldVal,
        new_values: newVal
      };
    });

    res.json({ logs: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
