// server/controllers/notificationController.js
const NotificationService = require('../services/NotificationService');

exports.getMyNotifications = (req, res) => {
  try {
    const notifications = NotificationService.getNotifications(req.user.id, 50);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markRead = (req, res) => {
  try {
    const { id } = req.params;
    NotificationService.markAsRead(id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markAllRead = (req, res) => {
  try {
    NotificationService.markAllAsRead(req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
