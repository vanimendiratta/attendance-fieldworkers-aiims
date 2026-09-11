/**
 * SQL Sync Client
 *
 * Stores the 22-field attendance export payload into the SQLite database
 * (`external_sync_records` table) instead of REDCap or a flat JSON file.
 *
 * Drop-in replacement for the REDCap client during pre-REDCap phase.
 * When the real REDCap API is available, this module can be swapped out.
 *
 * API surface is intentionally identical to redcap_client.js so that
 * attendance_service.js requires zero structural change.
 */

const db = require('../db/database');

// isLive is always false — this is the SQL fallback mode
const isLive = false;
const apiUrl = null;

/**
 * Ensure the external_sync_records table exists.
 * Called once on first require via module initialization.
 */
function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_sync_records (
      id TEXT PRIMARY KEY,                      -- attendance_record_id (same as attendance.id)
      employee_id TEXT NOT NULL,
      employer_id TEXT NOT NULL,
      department TEXT,
      designation TEXT,

      -- Check-In fields
      checkin_latitude TEXT,
      checkin_longitude TEXT,
      checkin_accuracy TEXT,
      checkin_location_timestamp TEXT,
      checkin_server_timestamp TEXT,
      checkin_address TEXT,
      checkin_geofence_distance TEXT,
      checkin_geofence_status TEXT,

      -- Check-Out fields
      checkout_latitude TEXT,
      checkout_longitude TEXT,
      checkout_accuracy TEXT,
      checkout_location_timestamp TEXT,
      checkout_server_timestamp TEXT,
      checkout_address TEXT,
      checkout_geofence_distance TEXT,
      checkout_geofence_status TEXT,

      -- Working Hours (all as text for REDCap compatibility)
      gross_working_seconds TEXT,
      break_seconds TEXT,
      net_working_seconds TEXT,
      overtime_seconds TEXT,

      -- Status
      attendance_status TEXT,
      work_mode TEXT DEFAULT 'OFFICE',
      field_site_notes TEXT,

      -- Metadata
      sync_status TEXT DEFAULT 'SYNCED',
      synced_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,

      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (employer_id) REFERENCES organizations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ext_sync_emp ON external_sync_records (employee_id);
    CREATE INDEX IF NOT EXISTS idx_ext_sync_org ON external_sync_records (employer_id);
  `);
}

ensureTable();

/**
 * Upsert an attendance record into the SQL sync table.
 * Mirrors the REDCap importRecord() interface.
 *
 * @param {Object} recordData - 22-field attendance payload
 * @returns {{ success: boolean, mode: string, record_id: string }}
 */
async function importRecord(recordData) {
  try {
    const now = new Date().toISOString();
    const id = recordData.attendance_record_id;

    db.prepare(`
      INSERT INTO external_sync_records (
        id, employee_id, employer_id, department, designation,
        checkin_latitude, checkin_longitude, checkin_accuracy,
        checkin_location_timestamp, checkin_server_timestamp, checkin_address,
        checkin_geofence_distance, checkin_geofence_status,
        checkout_latitude, checkout_longitude, checkout_accuracy,
        checkout_location_timestamp, checkout_server_timestamp, checkout_address,
        checkout_geofence_distance, checkout_geofence_status,
        gross_working_seconds, break_seconds, net_working_seconds, overtime_seconds,
        attendance_status, sync_status, synced_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, 'SYNCED', ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        department             = excluded.department,
        designation            = excluded.designation,
        checkin_latitude       = excluded.checkin_latitude,
        checkin_longitude      = excluded.checkin_longitude,
        checkin_accuracy       = excluded.checkin_accuracy,
        checkin_location_timestamp = excluded.checkin_location_timestamp,
        checkin_server_timestamp   = excluded.checkin_server_timestamp,
        checkin_address        = excluded.checkin_address,
        checkin_geofence_distance  = excluded.checkin_geofence_distance,
        checkin_geofence_status    = excluded.checkin_geofence_status,
        checkout_latitude      = excluded.checkout_latitude,
        checkout_longitude     = excluded.checkout_longitude,
        checkout_accuracy      = excluded.checkout_accuracy,
        checkout_location_timestamp = excluded.checkout_location_timestamp,
        checkout_server_timestamp   = excluded.checkout_server_timestamp,
        checkout_address       = excluded.checkout_address,
        checkout_geofence_distance  = excluded.checkout_geofence_distance,
        checkout_geofence_status    = excluded.checkout_geofence_status,
        gross_working_seconds  = excluded.gross_working_seconds,
        break_seconds          = excluded.break_seconds,
        net_working_seconds    = excluded.net_working_seconds,
        overtime_seconds       = excluded.overtime_seconds,
        attendance_status      = excluded.attendance_status,
        sync_status            = 'SYNCED',
        updated_at             = excluded.updated_at
    `).run(
      id,
      recordData.employee_id || '',
      recordData.employer_id || '',
      recordData.department || null,
      recordData.designation || null,
      recordData.checkin_latitude || null,
      recordData.checkin_longitude || null,
      recordData.checkin_accuracy || null,
      recordData.checkin_location_timestamp || null,
      recordData.checkin_server_timestamp || null,
      recordData.checkin_address || null,
      recordData.checkin_geofence_distance || null,
      recordData.checkin_geofence_status || null,
      recordData.checkout_latitude || null,
      recordData.checkout_longitude || null,
      recordData.checkout_accuracy || null,
      recordData.checkout_location_timestamp || null,
      recordData.checkout_server_timestamp || null,
      recordData.checkout_address || null,
      recordData.checkout_geofence_distance || null,
      recordData.checkout_geofence_status || null,
      recordData.gross_working_seconds || '0',
      recordData.break_seconds || '0',
      recordData.net_working_seconds || '0',
      recordData.overtime_seconds || '0',
      recordData.attendance_status || null,
      now,
      now
    );

    return { success: true, mode: 'SQL_DB', record_id: id };
  } catch (err) {
    console.error('SQL sync importRecord error:', err.message);
    return { success: false, mode: 'SQL_DB', error: err.message };
  }
}

/**
 * Store file reference in the sync record (path stored in the main attendance table).
 * For SQL mode, photos are already stored via photoService — this is a no-op stub
 * that maintains API compatibility with the REDCap client interface.
 *
 * @returns {{ success: boolean, mode: string, field: string }}
 */
async function importFile(recordId, fieldName, filePath) {
  // Photos are already persisted to disk via photoService and referenced
  // in the main `attendance` table. No separate file import step required
  // for SQL storage mode.
  return { success: true, mode: 'SQL_DB', field: fieldName };
}

/**
 * Return all sync records for a given employer (for admin dashboard).
 *
 * @param {string} employerId
 * @returns {Object[]}
 */
function getRecords(employerId) {
  try {
    const query = employerId
      ? db.prepare(`
          SELECT s.*, e.name as employee_name, e.email,
                 COALESCE(t.name, 'Direct Assignment') as team_name,
                 COALESCE(s.state, e.state) as state,
                 COALESCE(s.district, e.district) as district
          FROM external_sync_records s
          JOIN employees e ON s.employee_id = e.id
          LEFT JOIN teams t ON e.team_id = t.id
          WHERE s.employer_id = ?
          ORDER BY s.synced_at DESC
          LIMIT 500
        `).all(employerId)
      : db.prepare(`SELECT * FROM external_sync_records ORDER BY synced_at DESC LIMIT 500`).all();
    return query;
  } catch (err) {
    console.error('SQL sync getRecords error:', err.message);
    return [];
  }
}

/**
 * Legacy stub — kept for API compatibility.
 * Previously returned the JSON flat-file emulator contents.
 */
function getMockData() {
  return { records: [], files: [], audit: [] };
}

/**
 * Generate a plain CSV export of all sync records for an employer.
 *
 * @param {string} employerId
 * @returns {string} UTF-8 CSV with BOM
 */
function generateCsvExport(employerId) {
  const records = getRecords(employerId);
  const headers = [
    'Record ID', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Email',
    'Employer ID', 'Team', 'State', 'District',
    'Check-In Timestamp', 'Check-In Latitude', 'Check-In Longitude',
    'Check-In Accuracy (m)', 'Check-In Geofence Distance (m)', 'Check-In Geofence Status',
    'Check-In Address',
    'Check-Out Timestamp', 'Check-Out Latitude', 'Check-Out Longitude',
    'Check-Out Accuracy (m)', 'Check-Out Geofence Distance (m)', 'Check-Out Geofence Status',
    'Check-Out Address',
    'Gross Working Seconds', 'Break Seconds', 'Net Working Seconds', 'Overtime Seconds',
    'Attendance Status', 'Sync Status', 'Synced At'
  ];

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [headers.map(esc).join(',')];
  for (const r of records) {
    rows.push([
      r.id, r.employee_id, r.employee_name, r.department, r.designation, r.email,
      r.employer_id, r.team_name, r.state, r.district,
      r.checkin_server_timestamp, r.checkin_latitude, r.checkin_longitude,
      r.checkin_accuracy, r.checkin_geofence_distance, r.checkin_geofence_status,
      r.checkin_address,
      r.checkout_server_timestamp, r.checkout_latitude, r.checkout_longitude,
      r.checkout_accuracy, r.checkout_geofence_distance, r.checkout_geofence_status,
      r.checkout_address,
      r.gross_working_seconds, r.break_seconds, r.net_working_seconds, r.overtime_seconds,
      r.attendance_status, r.sync_status, r.synced_at
    ].map(esc).join(','));
  }

  return '\uFEFF' + rows.join('\r\n');
}

module.exports = {
  isLive,
  apiUrl,
  importRecord,
  importFile,
  getRecords,
  getMockData,
  generateCsvExport
};
