'use strict';

/**
 * AIIMS Attendance System — Daily Backup & Email Service
 * 
 * Manages SMTP transport, generates Excel-compatible attendance CSV backups,
 * and delivers scheduled or on-demand backup emails to administrators.
 */

const nodemailer = require('nodemailer');
const { query } = require('../db/database');

/**
 * Check whether SMTP email service has been configured in environment variables
 * @returns {boolean}
 */
function isEmailConfigured() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return Boolean(user && pass && user.trim() && pass.trim());
}

const DEFAULT_BACKUP_RECIPIENT = 'vanicder01@gmail.com';

/**
 * Get configured backup recipient email address
 * @returns {string}
 */
function getBackupRecipient() {
  return (process.env.BACKUP_EMAIL_RECIPIENT || DEFAULT_BACKUP_RECIPIENT).trim();
}


/**
 * Create a reusable Nodemailer SMTP transporter
 * @returns {import('nodemailer').Transporter}
 */
function createSmtpTransporter() {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || (host.includes('gmail') ? '465' : '587'), 10);
  const secure = process.env.SMTP_SECURE != null
    ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
    : port === 465;

  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    // Safe timeout limits for serverless / lambda execution
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

/**
 * Helper to escape CSV values according to RFC 4180
 * @param {any} val
 * @returns {string}
 */
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (/^[\s\t\r]*[=+\-@\t\r|%]/.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate complete Excel-compatible attendance CSV with UTF-8 BOM
 * @param {Array<object>} records
 * @returns {string}
 */
function generateAttendanceCsv(records) {
  const headers = [
    'Attendance ID', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Email',
    'Organization', 'Team Name', 'State / UT', 'District', 'Work Mode', 'Attendance Status',
    'Check-In Date', 'Check-In Time', 'Check-In Server Timestamp (UTC)',
    'Check-In Latitude', 'Check-In Longitude', 'Check-In GPS Accuracy (m)',
    'Check-In Geofence Distance (m)', 'Check-In Geofence Status', 'Check-In Address',
    'Checkout Date', 'Checkout Time', 'Checkout Server Timestamp (UTC)',
    'Checkout Latitude', 'Checkout Longitude', 'Checkout GPS Accuracy (m)',
    'Checkout Geofence Distance (m)', 'Checkout Geofence Status', 'Checkout Address',
    'Gross Working Hours', 'Break Minutes', 'Net Working Hours', 'Overtime Hours',
    'Field Site Notes', 'DB Sync Status', 'Created At'
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];
  for (const r of records) {
    const checkinDate  = r.checkin_server_timestamp  ? new Date(r.checkin_server_timestamp).toISOString().split('T')[0]  : '';
    const checkinTime  = r.checkin_server_timestamp  ? new Date(r.checkin_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    const checkoutDate = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toISOString().split('T')[0] : '';
    const checkoutTime = r.checkout_server_timestamp ? new Date(r.checkout_server_timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
    rows.push([
      r.id, r.employee_id, r.employee_name, r.department, r.designation, r.email,
      r.employer_name, r.team_name || 'Direct Assignment', r.state, r.district,
      r.work_mode === 'FIELD_WORK' ? 'Field Work' : 'Office Duty', r.attendance_status,
      checkinDate, checkinTime, r.checkin_server_timestamp || '',
      r.checkin_lat   != null ? Number(r.checkin_lat).toFixed(6)   : '',
      r.checkin_lng   != null ? Number(r.checkin_lng).toFixed(6)   : '',
      r.checkin_accuracy  != null ? Number(r.checkin_accuracy).toFixed(1)  : '',
      r.checkin_geofence_distance != null ? Number(r.checkin_geofence_distance).toFixed(1) : '',
      r.checkin_geofence_status || '', r.checkin_address || '',
      checkoutDate, checkoutTime, r.checkout_server_timestamp || '',
      r.checkout_lat  != null ? Number(r.checkout_lat).toFixed(6)  : '',
      r.checkout_lng  != null ? Number(r.checkout_lng).toFixed(6)  : '',
      r.checkout_accuracy != null ? Number(r.checkout_accuracy).toFixed(1) : '',
      r.checkout_geofence_distance != null ? Number(r.checkout_geofence_distance).toFixed(1) : '',
      r.checkout_geofence_status || '', r.checkout_address || '',
      r.gross_working_seconds != null ? (r.gross_working_seconds / 3600).toFixed(2) : '0.00',
      r.break_seconds != null ? Math.round(r.break_seconds / 60) : '0',
      r.net_working_seconds  != null ? (r.net_working_seconds  / 3600).toFixed(2) : '0.00',
      r.overtime_seconds     != null ? (r.overtime_seconds     / 3600).toFixed(2) : '0.00',
      r.field_site_notes || '', r.redcap_sync_status || 'PENDING', r.created_at || ''
    ].map(escapeCsvCell).join(','));
  }

  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Fetch all attendance records for the given employer organization
 * @param {string} employerId
 * @returns {Promise<Array<object>>}
 */
async function fetchOrganizationAttendance(employerId) {
  const res = await query(
    `SELECT a.*, e.name AS employee_name, e.department, e.designation, e.email,
            COALESCE(t.name, 'Direct Assignment') AS team_name,
            COALESCE(a.state, e.state, t.state, 'National Jurisdiction') AS state,
            COALESCE(a.district, e.district, t.district, 'Central Operations') AS district,
            o.name AS employer_name
     FROM attendance a
     JOIN employees e ON a.employee_id = e.id
     LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
     JOIN organizations o ON a.employer_id = o.id
     WHERE a.employer_id = $1
     ORDER BY a.checkin_server_timestamp DESC`,
    [employerId]
  );
  return res.rows;
}

/**
 * Send the daily attendance backup CSV to the recipient email address
 * 
 * @param {object} options
 * @param {string} [options.employerId]
 * @param {string} [options.recipientEmail]
 * @param {string} [options.dateStr]
 * @returns {Promise<{ success: boolean, message: string, recordCount: number, recipient: string, filename: string }>}
 */
async function sendDailyAttendanceBackup(options = {}) {
  const employerId = options.employerId || 'ORG-001';
  const recipient = (options.recipientEmail || getBackupRecipient()).trim();

  if (!recipient) {
    throw new Error('No recipient email address specified. Please configure BACKUP_EMAIL_RECIPIENT or provide an email.');
  }

  if (!isEmailConfigured()) {
    throw new Error('SMTP email is not configured. Please set SMTP_USER and SMTP_PASS (Gmail App Password) in your environment variables.');
  }

  const now = new Date();
  const dateStr = options.dateStr || now.toISOString().split('T')[0];

  // 1. Fetch organization details
  const orgRes = await query('SELECT id, name, office_name FROM organizations WHERE id = $1', [employerId]);
  const org = orgRes.rows[0] || { name: 'AIIMS', office_name: 'AIIMS Operations' };

  // 2. Fetch all attendance records
  const records = await fetchOrganizationAttendance(employerId);

  // 3. Calculate summary metrics
  const totalRecords = records.length;
  const completedCount = records.filter(r => r.attendance_status === 'COMPLETED').length;
  const onBreakCount = records.filter(r => r.attendance_status === 'ON_BREAK').length;
  const workingCount = records.filter(r => r.attendance_status === 'CHECKED_IN').length;
  const fieldCount = records.filter(r => r.work_mode === 'FIELD_WORK').length;
  const officeCount = totalRecords - fieldCount;

  const totalNetHours = (records.reduce((acc, r) => acc + (Number(r.net_working_seconds) || 0), 0) / 3600).toFixed(2);

  // 4. Generate CSV
  const csvContent = generateAttendanceCsv(records);
  const csvBuffer = Buffer.from(csvContent, 'utf-8');
  const filename = `attendance_backup_${employerId}_${dateStr}.csv`;

  // 5. Build HTML Email Template
  const fromAddress = process.env.SMTP_FROM || `"AIIMS Attendance" <${process.env.SMTP_USER}>`;
  const subject = `[AIIMS] Daily Attendance Backup — ${dateStr} (${totalRecords} Records)`;

  const htmlBody = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background: #0f172a; color: #ffffff; padding: 24px; text-align: left; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
        .header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; }
        .content { padding: 24px; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
        .metric-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
        .metric-number { font-size: 20px; font-weight: 700; color: #0f172a; }
        .metric-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-top: 4px; }
        .details-table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px; }
        .details-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
        .details-table td:first-child { color: #64748b; font-weight: 500; }
        .details-table td:last-child { text-align: right; font-weight: 600; color: #0f172a; }
        .attachment-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 13px; color: #166534; display: flex; align-items: center; justify-content: space-between; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 12px; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${org.name} Attendance Backup</h1>
          <p>Automated Daily Report & Database Snapshot &middot; ${dateStr}</p>
        </div>
        <div class="content">
          <p style="font-size: 14px; line-height: 1.5; margin-top: 0;">
            Hello Administrator,<br><br>
            Please find attached the official attendance backup for <strong>${org.name} (${org.office_name})</strong> for <strong>${dateStr}</strong>.
            This export includes all check-ins, GPS coordinates, geofence validations, break periods, and working hours.
          </p>

          <div class="summary-grid">
            <div class="metric-box">
              <div class="metric-number">${totalRecords}</div>
              <div class="metric-label">Total Records</div>
            </div>
            <div class="metric-box">
              <div class="metric-number">${completedCount}</div>
              <div class="metric-label">Completed Shifts</div>
            </div>
            <div class="metric-box">
              <div class="metric-number">${totalNetHours}h</div>
              <div class="metric-label">Total Working</div>
            </div>
          </div>

          <table class="details-table">
            <tr>
              <td>Organization</td>
              <td>${org.name} (${employerId})</td>
            </tr>
            <tr>
              <td>Active / In Progress</td>
              <td>${workingCount} working, ${onBreakCount} on break</td>
            </tr>
            <tr>
              <td>Work Mode Distribution</td>
              <td>${officeCount} Office Duty &middot; ${fieldCount} Field Work</td>
            </tr>
            <tr>
              <td>Backup File Name</td>
              <td style="font-family: monospace;">${filename}</td>
            </tr>
            <tr>
              <td>Export Generated At</td>
              <td>${now.toUTCString()}</td>
            </tr>
          </table>

          <div class="attachment-banner">
            <span><strong>Attached:</strong> ${filename}</span>
            <span>(${(csvBuffer.length / 1024).toFixed(1)} KB)</span>
          </div>

          <p style="font-size: 12px; color: #64748b; line-height: 1.4;">
            This backup file can be directly opened in Microsoft Excel, Google Sheets, or imported into REDCap and analytical platforms.
          </p>
        </div>
        <div class="footer">
          Automated by AIIMS Real-Time Fieldworkers Attendance System &middot; Confidential &amp; Protected Health System Data
        </div>
      </div>
    </body>
    </html>
  `;

  // 6. Send email via Nodemailer
  const transporter = createSmtpTransporter();
  await transporter.sendMail({
    from: fromAddress,
    to: recipient,
    subject,
    html: htmlBody,
    attachments: [
      {
        filename,
        content: csvBuffer,
        contentType: 'text/csv; charset=utf-8'
      }
    ]
  });

  return {
    success: true,
    message: `Attendance backup (${totalRecords} records) successfully sent to ${recipient}`,
    recordCount: totalRecords,
    recipient,
    filename
  };
}

module.exports = {
  isEmailConfigured,
  getBackupRecipient,
  generateAttendanceCsv,
  sendDailyAttendanceBackup
};
