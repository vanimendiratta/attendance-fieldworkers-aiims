'use strict';

/**
 * SQL Sync Client (PostgreSQL async version)
 *
 * Stores the attendance export payload into the PostgreSQL
 * `external_sync_records` table. Table creation is managed by the
 * Supabase migration — ensureTable() has been removed.
 *
 * API surface is intentionally identical to redcap_client.js.
 */

const { query } = require('../db/database');

const isLive = false;
const apiUrl  = null;

// ---------------------------------------------------------------------------
// Upsert an attendance record into the SQL sync table
// ---------------------------------------------------------------------------
/**
 * @param {Object} recordData — 22-field attendance payload
 * @returns {Promise<{ success: boolean, mode: string, record_id: string }>}
 */
async function importRecord(recordData) {
  try {
    const now = new Date().toISOString();
    const id  = recordData.attendance_record_id;

    await query(
      `INSERT INTO external_sync_records (
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
         $1,$2,$3,$4,$5,
         $6,$7,$8,
         $9,$10,$11,
         $12,$13,
         $14,$15,$16,
         $17,$18,$19,
         $20,$21,
         $22,$23,$24,$25,
         $26,'SYNCED',$27,$28
       )
       ON CONFLICT (id) DO UPDATE SET
         department             = EXCLUDED.department,
         designation            = EXCLUDED.designation,
         checkin_latitude       = EXCLUDED.checkin_latitude,
         checkin_longitude      = EXCLUDED.checkin_longitude,
         checkin_accuracy       = EXCLUDED.checkin_accuracy,
         checkin_location_timestamp = EXCLUDED.checkin_location_timestamp,
         checkin_server_timestamp   = EXCLUDED.checkin_server_timestamp,
         checkin_address        = EXCLUDED.checkin_address,
         checkin_geofence_distance  = EXCLUDED.checkin_geofence_distance,
         checkin_geofence_status    = EXCLUDED.checkin_geofence_status,
         checkout_latitude      = EXCLUDED.checkout_latitude,
         checkout_longitude     = EXCLUDED.checkout_longitude,
         checkout_accuracy      = EXCLUDED.checkout_accuracy,
         checkout_location_timestamp = EXCLUDED.checkout_location_timestamp,
         checkout_server_timestamp   = EXCLUDED.checkout_server_timestamp,
         checkout_address       = EXCLUDED.checkout_address,
         checkout_geofence_distance  = EXCLUDED.checkout_geofence_distance,
         checkout_geofence_status    = EXCLUDED.checkout_geofence_status,
         gross_working_seconds  = EXCLUDED.gross_working_seconds,
         break_seconds          = EXCLUDED.break_seconds,
         net_working_seconds    = EXCLUDED.net_working_seconds,
         overtime_seconds       = EXCLUDED.overtime_seconds,
         attendance_status      = EXCLUDED.attendance_status,
         sync_status            = 'SYNCED',
         updated_at             = EXCLUDED.updated_at`,
      [
        id,
        recordData.employee_id  || '',
        recordData.employer_id  || '',
        recordData.department   || null,
        recordData.designation  || null,
        recordData.checkin_latitude               || null,
        recordData.checkin_longitude              || null,
        recordData.checkin_accuracy               || null,
        recordData.checkin_location_timestamp     || null,
        recordData.checkin_server_timestamp       || null,
        recordData.checkin_address                || null,
        recordData.checkin_geofence_distance      || null,
        recordData.checkin_geofence_status        || null,
        recordData.checkout_latitude              || null,
        recordData.checkout_longitude             || null,
        recordData.checkout_accuracy              || null,
        recordData.checkout_location_timestamp    || null,
        recordData.checkout_server_timestamp      || null,
        recordData.checkout_address               || null,
        recordData.checkout_geofence_distance     || null,
        recordData.checkout_geofence_status       || null,
        recordData.gross_working_seconds          || '0',
        recordData.break_seconds                  || '0',
        recordData.net_working_seconds            || '0',
        recordData.overtime_seconds               || '0',
        recordData.attendance_status              || null,
        now,
        now
      ]
    );

    return { success: true, mode: 'SQL_DB', record_id: id };
  } catch (err) {
    console.error('SQL sync importRecord error:', err.message);
    return { success: false, mode: 'SQL_DB', error: err.message };
  }
}

/**
 * No-op stub — maintains API compatibility with the REDCap client interface.
 * Photos are persisted to disk via photoService and referenced in `attendance`.
 * @returns {Promise<{ success: boolean, mode: string, field: string }>}
 */
async function importFile(recordId, fieldName, filePath) {
  return { success: true, mode: 'SQL_DB', field: fieldName };
}

/**
 * Return all sync records for a given employer (for admin dashboard).
 *
 * state / district are now properly included (columns added in schema fix).
 * @returns {Promise<Array>}
 */
async function getRecords(employerId) {
  try {
    let result;
    if (employerId) {
      result = await query(
        `SELECT s.*, e.name AS employee_name, e.email,
                COALESCE(t.name, 'Direct Assignment') AS team_name,
                COALESCE(s.state, e.state) AS state,
                COALESCE(s.district, e.district) AS district
         FROM external_sync_records s
         JOIN employees e ON s.employee_id = e.id
         LEFT JOIN teams t ON e.team_id = t.id
         WHERE s.employer_id = $1
         ORDER BY s.synced_at DESC
         LIMIT 500`,
        [employerId]
      );
    } else {
      result = await query(
        'SELECT * FROM external_sync_records ORDER BY synced_at DESC LIMIT 500',
        []
      );
    }
    return result.rows;
  } catch (err) {
    console.error('SQL sync getRecords error:', err.message);
    return [];
  }
}

/**
 * Legacy stub — kept for API compatibility.
 */
function getMockData() {
  return { records: [], files: [], audit: [] };
}

/**
 * Generate a plain CSV export of all sync records for an employer.
 * @returns {Promise<string>} UTF-8 CSV with BOM
 */
async function generateCsvExport(employerId) {
  const records = await getRecords(employerId);
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

module.exports = { isLive, apiUrl, importRecord, importFile, getRecords, getMockData, generateCsvExport };
