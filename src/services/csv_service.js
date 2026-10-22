'use strict';

/**
 * CSV Service — Reusable, secure CSV generation utility
 *
 * Security policies:
 *  - Formula injection protection: prepends a single quote to cells starting
 *    with =, +, -, @, tab, carriage-return, |, % (standard DLP prefix).
 *  - Proper RFC 4180 quoting: fields containing commas, double-quotes, or
 *    newlines are double-quoted; embedded double-quotes are doubled ("").
 *  - UTF-8 BOM (\uFEFF) prepended for correct Microsoft Excel display.
 *  - Passwords, hashes, tokens, and secrets are NEVER included.
 *  - All date/time values use IST (Asia/Kolkata) where human-readable display
 *    is required; raw UTC ISO strings are retained in "UTC" columns.
 *
 * Exported functions:
 *  escapeCsvCell(val)             — sanitize + quote a single cell value
 *  buildCsv(headers, rows)        — build a full CSV string from arrays
 *  todayDateStr()                 — "YYYY-MM-DD" in UTC (for filenames)
 *  setCsvHeaders(res, filename)   — set Express response headers for download
 *  formatIstDateTime(isoStr)      — format ISO timestamp to IST display string
 *  secondsToHours(sec)            — convert seconds to "H.HH" decimal hours
 *  secondsToHhMm(sec)             — convert seconds to "Xh YYm" string
 */

// ---------------------------------------------------------------------------
// Dangerous leading characters per OWASP CSV injection DLP policy
// ---------------------------------------------------------------------------
const FORMULA_INJECTION_PATTERN = /^[\s\t\r]*[=+\-@\t\r|%]/;

/**
 * Sanitize and quote a single CSV cell value.
 *
 * @param {*} val  — any value; null/undefined become empty string
 * @returns {string} — safe, properly quoted CSV cell
 */
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // Formula injection prevention: prefix with single quote
  if (FORMULA_INJECTION_PATTERN.test(str)) {
    str = "'" + str;
  }

  // RFC 4180 quoting: quote if the value contains , " \n \r
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Build a complete CSV string (with UTF-8 BOM for Excel).
 *
 * @param {string[]} headers  — array of header strings
 * @param {Array<Array<*>>} dataRows  — array of row arrays (each cell is raw value)
 * @returns {string} — complete CSV content with BOM
 */
function buildCsv(headers, dataRows) {
  const lines = [];
  lines.push(headers.map(escapeCsvCell).join(','));
  for (const row of dataRows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Returns today's date as YYYY-MM-DD (UTC).
 */
function todayDateStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Set appropriate Express response headers for a CSV download.
 *
 * @param {object} res       — Express response object
 * @param {string} filename  — desired download filename (e.g. "employees_2026-10-21.csv")
 */
function setCsvHeaders(res, filename) {
  // Sanitize filename to prevent header injection
  const safeFilename = filename.replace(/[^\w.\-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/**
 * Format an ISO UTC timestamp to a human-readable IST string.
 * Returns empty string for null/undefined/invalid inputs.
 *
 * @param {string|null} isoStr
 * @returns {string}
 */
function formatIstDateTime(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
  } catch {
    return isoStr;
  }
}

/**
 * Convert seconds to decimal hours string (e.g. "7.50").
 */
function secondsToHours(sec) {
  if (sec == null || isNaN(Number(sec))) return '0.00';
  return (Number(sec) / 3600).toFixed(2);
}

/**
 * Convert seconds to "Xh YYm" string.
 */
function secondsToHhMm(totalSec) {
  if (totalSec == null || isNaN(totalSec) || Number(totalSec) <= 0) return '0h 00m';
  const s = Math.round(Number(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------------------
// Dataset-specific CSV generators
// All column documentation is inline; sensitive fields are explicitly excluded.
// ---------------------------------------------------------------------------

/**
 * Generate Employees CSV.
 *
 * Columns (no passwords, no hashes, no tokens):
 *   Employee ID, Employee Name, Email, Mobile, Department, Designation,
 *   Team, State / UT, District, Role, Account Status, Date of Birth,
 *   Registered At (IST), Employer ID
 *
 * @param {object[]} employees
 * @returns {string} CSV content
 */
function generateEmployeesCsv(employees) {
  const headers = [
    'Employee ID', 'Employee Name', 'Email Address', 'Mobile Number',
    'Department', 'Designation', 'Team / Unit', 'State / UT', 'District',
    'Role', 'Account Status', 'Date of Birth', 'Registered At (IST)', 'Employer ID'
  ];

  const rows = (employees || []).map(e => [
    e.id,
    e.name,
    e.email,
    e.phone || '',
    e.department || '',
    e.designation || '',
    e.team_name || 'Unassigned',
    e.state || '',
    e.district || '',
    e.is_admin ? 'Administrator' : 'Field Worker',
    e.is_active ? 'Active' : 'Inactive',
    e.dob || '',
    formatIstDateTime(e.created_at),
    e.employer_id
  ]);

  return buildCsv(headers, rows);
}

/**
 * Generate Hotel Stays CSV.
 *
 * Columns:
 *   Stay ID, Employee ID, Employee Name, Department, Designation, Team,
 *   Hotel Name, Room Number, Hotel Address, Hotel Phone, Check-In Date,
 *   Checkout Date, Booking Reference, Hotel Latitude, Hotel Longitude,
 *   GPS Accuracy (m), Verification Status, Verified Place Name, Verified Address,
 *   Distance from Approved Geofence (m), Is Manual Override, Stay Status,
 *   GPS Capture Timestamp (IST), Verification Timestamp (IST), Notes,
 *   Created At (IST)
 *
 * @param {object[]} stays
 * @returns {string} CSV content
 */
function generateHotelStaysCsv(stays) {
  const headers = [
    'Stay ID', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Team',
    'Hotel Name', 'Room Number', 'Hotel Address', 'Hotel Phone',
    'Check-In Date', 'Checkout Date', 'Booking Reference',
    'Hotel Latitude', 'Hotel Longitude', 'GPS Accuracy (m)',
    'Verification Status', 'Verified Place Name', 'Verified Address',
    'Distance from Geofence (m)', 'Manual Override',
    'Stay Status', 'GPS Capture Timestamp (IST)',
    'Verification Timestamp (IST)', 'Notes', 'Created At (IST)'
  ];

  const rows = (stays || []).map(s => [
    s.id,
    s.employee_id,
    s.employee_name || '',
    s.department || '',
    s.designation || '',
    s.team_name || 'Unassigned',
    s.hotel_name,
    s.room_number || '',
    s.hotel_address,
    s.hotel_phone || '',
    s.checkin_date || '',
    s.checkout_date || '',
    s.booking_ref || '',
    s.hotel_lat != null ? Number(s.hotel_lat).toFixed(7) : '',
    s.hotel_lng != null ? Number(s.hotel_lng).toFixed(7) : '',
    s.hotel_accuracy != null ? Number(s.hotel_accuracy).toFixed(1) : '',
    s.verification_status || 'PENDING',
    s.verified_place_name || '',
    s.verified_address || '',
    s.distance_meters != null ? Number(s.distance_meters).toFixed(1) : '',
    s.is_manual_override ? 'Yes' : 'No',
    s.stay_status || 'ACTIVE',
    formatIstDateTime(s.gps_capture_timestamp),
    formatIstDateTime(s.verification_timestamp),
    s.notes || '',
    formatIstDateTime(s.created_at)
  ]);

  return buildCsv(headers, rows);
}

/**
 * Generate Leaves / Absences CSV.
 *
 * Columns:
 *   Leave ID, Employee ID, Employee Name, Department, Designation, Team,
 *   State / UT, District, Leave Date, Leave Type, Status, Reason,
 *   Applied By, Admin Remarks, Regularized Attendance ID, Created At (IST)
 *
 * @param {object[]} leaves
 * @returns {string} CSV content
 */
function generateLeavesCsv(leaves) {
  const headers = [
    'Leave ID', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Team',
    'State / UT', 'District', 'Leave Date', 'Leave Type', 'Status', 'Reason',
    'Applied By', 'Admin Remarks', 'Regularized Attendance ID', 'Created At (IST)'
  ];

  const rows = (leaves || []).map(l => [
    l.id,
    l.employee_id,
    l.employee_name || '',
    l.department || '',
    l.designation || '',
    l.team_name || 'Unassigned',
    l.state || '',
    l.district || '',
    l.leave_date || '',
    l.leave_type || 'UNMARKED_ABSENCE',
    l.status || 'PENDING',
    l.reason || '',
    l.applied_by || 'SYSTEM',
    l.admin_remarks || '',
    l.regularized_attendance_id || '',
    formatIstDateTime(l.created_at)
  ]);

  return buildCsv(headers, rows);
}

/**
 * Generate Teams CSV.
 *
 * Columns:
 *   Team ID, Team Name, State / UT, District, Description,
 *   Employer ID, Created At (IST)
 *
 * @param {object[]} teams
 * @returns {string} CSV content
 */
function generateTeamsCsv(teams) {
  const headers = [
    'Team ID', 'Team Name', 'State / UT', 'District',
    'Description', 'Employer ID', 'Created At (IST)'
  ];

  const rows = (teams || []).map(t => [
    t.id,
    t.name,
    t.state || '',
    t.district || '',
    t.description || '',
    t.employer_id,
    formatIstDateTime(t.created_at)
  ]);

  return buildCsv(headers, rows);
}

/**
 * Generate Geofences CSV.
 * Restricted to admin role only (enforced at route level).
 *
 * Columns:
 *   Geofence ID, Name, Type, Latitude, Longitude, Radius (m),
 *   Policy, Address, Is Active, Employer ID, Created At (IST), Updated At (IST)
 *
 * @param {object[]} geofences
 * @returns {string} CSV content
 */
function generateGeofencesCsv(geofences) {
  const headers = [
    'Geofence ID', 'Name', 'Type', 'Latitude', 'Longitude', 'Radius (m)',
    'Policy', 'Address', 'Is Active', 'Employer ID',
    'Created At (IST)', 'Updated At (IST)'
  ];

  const rows = (geofences || []).map(g => [
    g.id,
    g.name,
    g.geofence_type || 'WORKPLACE',
    g.latitude != null ? Number(g.latitude).toFixed(7) : '',
    g.longitude != null ? Number(g.longitude).toFixed(7) : '',
    g.radius_meters != null ? Number(g.radius_meters).toFixed(1) : '',
    g.policy || 'ALLOW_WITH_FLAG',
    g.address || '',
    g.is_active ? 'Yes' : 'No',
    g.employer_id,
    formatIstDateTime(g.created_at),
    formatIstDateTime(g.updated_at)
  ]);

  return buildCsv(headers, rows);
}

/**
 * Generate Audit Logs CSV.
 * Restricted to admin role only (enforced at route level).
 *
 * Columns:
 *   Log ID, Timestamp (IST), Event Type, Action, Status,
 *   Employee ID, Employee Name, Client IP, User Agent
 *
 * NOTE: details_json is intentionally excluded to prevent leaking internal
 * implementation details or sensitive data embedded in log payloads.
 *
 * @param {object[]} logs
 * @returns {string} CSV content
 */
function generateAuditLogsCsv(logs) {
  const headers = [
    'Log ID', 'Timestamp (IST)', 'Event Type', 'Action', 'Status',
    'Employee ID', 'Employee Name', 'Client IP', 'User Agent'
  ];

  const rows = (logs || []).map(l => [
    l.id,
    formatIstDateTime(l.timestamp),
    l.event_type || '',
    l.action || '',
    l.status || '',
    l.employee_id || '',
    l.employee_name || '',
    l.client_ip || '',
    l.user_agent || ''
  ]);

  return buildCsv(headers, rows);
}

module.exports = {
  escapeCsvCell,
  buildCsv,
  todayDateStr,
  setCsvHeaders,
  formatIstDateTime,
  secondsToHours,
  secondsToHhMm,
  generateEmployeesCsv,
  generateHotelStaysCsv,
  generateLeavesCsv,
  generateTeamsCsv,
  generateGeofencesCsv,
  generateAuditLogsCsv
};
