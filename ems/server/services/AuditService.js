// server/services/AuditService.js
const db = require('../database/db');

class AuditService {
  /**
   * Log an administrative, user, or system action
   */
  static log({
    actorUserId = null,
    actorEmail = 'SYSTEM',
    action,
    entityType,
    entityId = null,
    oldValues = null,
    newValues = null,
    ipAddress = null,
    userAgent = null,
    remarks = null
  }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO audit_logs (
          actor_user_id, actor_email, action, entity_type, entity_id,
          old_values_json, new_values_json, ip_address, user_agent, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        actorUserId,
        actorEmail,
        action,
        entityType,
        String(entityId),
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress,
        userAgent,
        remarks
      );
    } catch (err) {
      console.error('[AUDIT_ERROR] Failed to write audit log:', err.message);
    }
  }

  /**
   * Retrieve audit logs with filters
   */
  static getLogs(filters = {}) {
    let sql = `SELECT * FROM audit_logs WHERE 1=1`;
    const params = [];

    if (filters.entityType) {
      sql += ` AND entity_type = ?`;
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      sql += ` AND entity_id = ?`;
      params.push(String(filters.entityId));
    }
    if (filters.action) {
      sql += ` AND action = ?`;
      params.push(filters.action);
    }
    if (filters.actorEmail) {
      sql += ` AND actor_email LIKE ?`;
      params.push(`%${filters.actorEmail}%`);
    }

    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(filters.limit || 100, filters.offset || 0);

    return db.prepare(sql).all(...params);
  }
}

module.exports = AuditService;
