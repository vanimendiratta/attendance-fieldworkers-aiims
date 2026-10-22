// server/services/EmailService.js
/**
 * Production-ready email dispatcher with SMTP configuration and safe development fallback
 */
class EmailService {
  static isConfigured() {
    return Boolean(
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD
    );
  }

  static async sendEmail({ to, subject, text, html }) {
    const from = process.env.FROM_EMAIL || 'no-reply@ems.gov.in';

    if (this.isConfigured()) {
      // Production SMTP dispatch
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT, 10) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
          }
        });

        const info = await transporter.sendMail({
          from,
          to,
          subject,
          text,
          html: html || text
        });

        console.log(`[EMAIL_SERVICE: SMTP] Dispatched to ${to} (MessageID: ${info.messageId})`);
        return { success: true, messageId: info.messageId, mode: 'SMTP' };
      } catch (err) {
        console.error(`[EMAIL_SERVICE: ERROR] Failed to send via SMTP:`, err.message);
        throw err;
      }
    } else {
      // Safe development fallback: log event without exposing sensitive credentials in production
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[EMAIL_SERVICE: DEV_FALLBACK] Simulated dispatch to ${to} | Subject: "${subject}"`);
      }
      return { success: true, mode: 'DEV_FALLBACK' };
    }
  }
}

module.exports = EmailService;
