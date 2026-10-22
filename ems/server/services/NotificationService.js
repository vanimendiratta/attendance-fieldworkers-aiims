// server/services/NotificationService.js
const db = require('../database/db');

class NotificationService {
  /**
   * Dispatch a notification using database templates
   */
  static dispatch(eventCode, recipientUserId, contextData = {}, options = {}) {
    // 1. Fetch template from database
    const template = db.prepare(`
      SELECT * FROM notification_templates 
      WHERE event_code = ? AND is_active = 1
    `).get(eventCode);

    let title = options.title || eventCode;
    let message = options.message || '';

    if (template) {
      title = this.interpolate(template.subject_template, contextData);
      message = this.interpolate(template.body_template, contextData);
    }

    // 2. Insert In-App Notification
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, link_url)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = insertNotif.run(
      recipientUserId,
      title,
      message,
      options.type || 'INFO',
      options.linkUrl || null
    );

    // 3. Mock/Simulate Email Dispatch (in real setup would use nodemailer / SMTP)
    const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(recipientUserId);
    if (user) {
      console.log(`[EMAIL_DISPATCH] Sent email to ${user.email} | Subject: "${title}" | Body: "${message}"`);
    }

    return {
      notificationId: result.lastInsertRowid,
      recipientUserId,
      title,
      message
    };
  }

  /**
   * Helper to replace placeholders like {request_number} with context values
   */
  static interpolate(templateStr, data) {
    if (!templateStr) return '';
    return templateStr.replace(/\{(\w+)\}/g, (match, key) => {
      return data[key] !== undefined ? data[key] : match;
    });
  }

  /**
   * Get unread notifications for a user
   */
  static getNotifications(userId, limit = 20) {
    return db.prepare(`
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY id DESC 
      LIMIT ?
    `).all(userId, limit);
  }

  /**
   * Mark notification as read
   */
  static markAsRead(notificationId, userId) {
    return db.prepare(`
      UPDATE notifications SET is_read = 1 
      WHERE id = ? AND user_id = ?
    `).run(notificationId, userId);
  }

  /**
   * Mark all as read
   */
  static markAllAsRead(userId) {
    return db.prepare(`
      UPDATE notifications SET is_read = 1 
      WHERE user_id = ?
    `).run(userId);
  }
}

module.exports = NotificationService;
