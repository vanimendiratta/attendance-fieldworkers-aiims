const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const geoService = require('./geo_service');
const photoService = require('./photo_service');
const redcapClient = require('./sql_sync_client');
const { matchStateAndDistrict, getDistrictsForState } = require('../data/india_states_districts');

class AttendanceService {
  /**
   * Helper to write structured immutable audit logs
   */
  logAudit(eventType, employeeId, employerId, action, status, details, clientIp = '127.0.0.1', userAgent = 'Unknown') {
    try {
      const stmt = db.prepare(`
        INSERT INTO audit_logs (id, event_type, employee_id, employer_id, action, status, details_json, client_ip, user_agent, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        uuidv4(),
        eventType,
        employeeId || null,
        employerId || null,
        action,
        status,
        typeof details === 'object' ? JSON.stringify(details) : String(details),
        clientIp,
        userAgent,
        new Date().toISOString()
      );
    } catch (err) {
      console.error('Audit logging failure:', err);
    }
  }

  /**
   * Get active attendance session for an employee
   */
  getActiveSession(employeeId) {
    return db.prepare(`
      SELECT a.*, e.name as employee_name, e.department, e.designation,
             COALESCE(t.name, 'Direct Assignment') as team_name,
             COALESCE(a.state, e.state, t.state) as state,
             COALESCE(a.district, e.district, t.district) as district,
             o.name as employer_name, o.office_name, o.timezone
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      JOIN organizations o ON a.employer_id = o.id
      WHERE a.employee_id = ? AND a.attendance_status IN ('CHECKED_IN', 'ON_BREAK')
      ORDER BY a.created_at DESC
      LIMIT 1
    `).get(employeeId);
  }

  /**
   * Helper to format a date into YYYY-MM-DD for a specific timezone
   */
  getLocalDateString(dateObj, timeZone = 'Asia/Kolkata') {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(dateObj);
    } catch (e) {
      return dateObj.toISOString().slice(0, 10);
    }
  }

  /**
   * Check In process
   */
  async processCheckIn({
    employee,
    photoData,
    latitude,
    longitude,
    accuracy,
    clientTimestamp,
    idempotencyKey,
    workMode = 'OFFICE',
    fieldSiteNotes = null,
    teamId = null,
    state = null,
    district = null,
    clientIp,
    userAgent
  }) {
    // 1. Authenticate employee and organization
    if (!employee || !employee.id) {
      throw new Error('Authentication required.');
    }
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(employee.employer_id);
    if (!org) {
      throw new Error('Associated employer organization not found.');
    }

    // 2. Idempotency Check
    if (idempotencyKey) {
      const existingIdempotent = db.prepare('SELECT * FROM attendance WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingIdempotent) {
        return {
          status: 'SUCCESS',
          replayed: true,
          attendance: existingIdempotent
        };
      }
    }

    // 3. Single Daily Attendance Enforcement & Active Session Check
    // In one day, an employee can only check in and check out for one single time.
    const orgTimezone = org.timezone || 'Asia/Kolkata';
    const todayStr = this.getLocalDateString(new Date(), orgTimezone);

    // A. Verify active check-in does not already exist
    const activeSession = this.getActiveSession(employee.id);
    if (activeSession) {
      this.logAudit('CHECK_IN_REJECTED_ALREADY_ACTIVE', employee.id, org.id, 'CHECK_IN', 'BLOCKED', { existingSessionId: activeSession.id }, clientIp, userAgent);
      throw new Error('Employee already has an active check-in. Please check out before checking in again.');
    }

    // B. Verify employee has not already completed attendance today
    const recentRecords = db.prepare(`
      SELECT id, attendance_status, checkin_server_timestamp, checkout_server_timestamp
      FROM attendance
      WHERE employee_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(employee.id);

    const completedToday = recentRecords.find(rec => {
      if (!rec.checkin_server_timestamp) return false;
      const recDate = this.getLocalDateString(new Date(rec.checkin_server_timestamp), orgTimezone);
      return recDate === todayStr && (rec.attendance_status === 'COMPLETED' || rec.checkout_server_timestamp !== null);
    });

    if (completedToday) {
      this.logAudit('CHECK_IN_REJECTED_DAILY_LIMIT', employee.id, org.id, 'CHECK_IN', 'BLOCKED', { todayStr, existingRecordId: completedToday.id }, clientIp, userAgent);
      throw new Error('Daily attendance limit reached: In one day, an employee can only check in and check out for one single time. You have already completed your attendance for today.');
    }

    // 4. Validate GPS accuracy
    const accuracyCheck = geoService.validateGpsAccuracy(accuracy, org.max_gps_accuracy_m);
    if (!accuracyCheck.valid) {
      this.logAudit('CHECK_IN_LOW_ACCURACY', employee.id, org.id, 'CHECK_IN', 'BLOCKED', { accuracy, maxAllowed: org.max_gps_accuracy_m }, clientIp, userAgent);
      throw new Error(accuracyCheck.error);
    }

    // 5. Geofence evaluation with Work Mode support (Office vs Field Work)
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid GPS coordinates provided.');
    }

    const mode = workMode === 'FIELD_WORK' ? 'FIELD_WORK' : 'OFFICE';
    const geofenceResult = geoService.evaluateGeofence(lat, lng, org.office_lat, org.office_lng, org.geofence_radius_m, org.geofence_policy, mode);
    if (!geofenceResult.allowed) {
      this.logAudit('CHECK_IN_GEOFENCE_BLOCKED', employee.id, org.id, 'CHECK_IN', 'BLOCKED', geofenceResult, clientIp, userAgent);
      throw new Error(geofenceResult.reason);
    }

    // 6. Photo processing & anti-replay verification
    const photoResult = photoService.processCapturedPhoto(photoData, 'checkins');
    
    // Check if photo hash was previously submitted anywhere
    const existingPhoto = db.prepare('SELECT id FROM attendance WHERE checkin_photo_hash = ? OR checkout_photo_hash = ?').get(photoResult.hash, photoResult.hash);
    if (existingPhoto) {
      this.logAudit('PHOTO_REPLAY_DETECTED', employee.id, org.id, 'CHECK_IN', 'BLOCKED', { hash: photoResult.hash }, clientIp, userAgent);
      throw new Error('Tampering detected: Reused or previously submitted attendance photo cannot be accepted.');
    }

    // 7. Generate official server-side timestamp in UTC and street-level reverse geocoding
    const serverTimestamp = new Date().toISOString();
    const reverseAddress = await geoService.reverseGeocode(lat, lng);

    // 8. Resolve State, District, and Team for this attendance session
    let finalTeamId = teamId || employee.team_id || null;
    let finalState = state ? String(state).trim() : null;
    let finalDistrict = district ? String(district).trim() : null;

    if (finalTeamId && (!finalState || !finalDistrict)) {
      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(finalTeamId);
      if (team) {
        if (!finalState) finalState = team.state;
        if (!finalDistrict) finalDistrict = team.district;
      }
    }

    if (!finalState && employee.state) finalState = employee.state;
    if (!finalDistrict && employee.district) finalDistrict = employee.district;

    // Automatic reverse-geocoded state/district fallback
    if (!finalState || !finalDistrict) {
      const parsedLocation = matchStateAndDistrict({ state: reverseAddress, city: reverseAddress });
      if (parsedLocation.state && !finalState) finalState = parsedLocation.state;
      if (parsedLocation.district && !finalDistrict) finalDistrict = parsedLocation.district;
    }

    // 9. Create attendance record
    const attendanceId = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO attendance (
        id, employee_id, employer_id, attendance_status,
        checkin_photo, checkin_photo_hash, checkin_lat, checkin_lng, checkin_accuracy,
        checkin_location_timestamp, checkin_server_timestamp, checkin_address,
        checkin_geofence_distance, checkin_geofence_status,
        work_mode, field_site_notes, team_id, state, district,
        idempotency_key, redcap_sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      attendanceId,
      employee.id,
      org.id,
      'CHECKED_IN',
      photoResult.relativePath,
      photoResult.hash,
      lat,
      lng,
      accuracyCheck.accuracy,
      clientTimestamp || serverTimestamp,
      serverTimestamp,
      reverseAddress,
      geofenceResult.distance,
      geofenceResult.status,
      mode,
      fieldSiteNotes ? String(fieldSiteNotes).trim() : null,
      finalTeamId,
      finalState,
      finalDistrict,
      idempotencyKey || null,
      'PENDING',
      serverTimestamp,
      serverTimestamp
    );

    // 10. Write audit log
    this.logAudit('CHECK_IN_SUCCESS', employee.id, org.id, 'CHECK_IN', 'SUCCESS', {
      attendanceId,
      workMode: mode,
      fieldSiteNotes,
      teamId: finalTeamId,
      state: finalState,
      district: finalDistrict,
      distance: geofenceResult.distance,
      geofenceStatus: geofenceResult.status,
      accuracy: accuracyCheck.accuracy,
      address: reverseAddress,
      serverTimestamp
    }, clientIp, userAgent);

    // 11. Sync to REDCap (asynchronously safe)
    this.syncToREDCap(attendanceId, photoResult.fullPath, 'checkin_photo');

    const createdRecord = db.prepare(`
      SELECT a.*, 
             COALESCE(t.name, 'Direct Assignment') as team_name,
             COALESCE(a.state, e.state, t.state) as state,
             COALESCE(a.district, e.district, t.district) as district
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      WHERE a.id = ?
    `).get(attendanceId);

    return {
      status: 'CHECK_IN_SUCCESSFUL',
      message: 'Check-in confirmed and verified by server.',
      attendance: createdRecord,
      geofence: geofenceResult
    };
  }

  /**
   * Start Break
   */
  startBreak(employeeId, clientIp, userAgent) {
    const session = this.getActiveSession(employeeId);
    if (!session) {
      throw new Error('No active attendance session found.');
    }

    if (session.attendance_status === 'ON_BREAK') {
      throw new Error('Already on break.');
    }

    const breakId = uuidv4();
    const serverTimestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO breaks (id, attendance_id, start_server_timestamp)
      VALUES (?, ?, ?)
    `).run(breakId, session.id, serverTimestamp);

    db.prepare(`
      UPDATE attendance
      SET attendance_status = 'ON_BREAK', updated_at = ?
      WHERE id = ?
    `).run(serverTimestamp, session.id);

    this.logAudit('BREAK_START', employeeId, session.employer_id, 'START_BREAK', 'SUCCESS', {
      attendanceId: session.id,
      breakId,
      start: serverTimestamp
    }, clientIp, userAgent);

    this.syncToREDCap(session.id);

    return {
      status: 'ON_BREAK',
      message: 'Break started.',
      breakId,
      startTime: serverTimestamp
    };
  }

  /**
   * End Break
   */
  endBreak(employeeId, clientIp, userAgent) {
    const session = this.getActiveSession(employeeId);
    if (!session) {
      throw new Error('No active attendance session found.');
    }

    if (session.attendance_status !== 'ON_BREAK') {
      throw new Error('Employee is not currently on break.');
    }

    const openBreak = db.prepare(`
      SELECT * FROM breaks
      WHERE attendance_id = ? AND end_server_timestamp IS NULL
      ORDER BY start_server_timestamp DESC
      LIMIT 1
    `).get(session.id);

    const serverTimestamp = new Date().toISOString();
    let breakDuration = 0;

    if (openBreak) {
      const startTime = new Date(openBreak.start_server_timestamp).getTime();
      const endTime = new Date(serverTimestamp).getTime();
      breakDuration = Math.max(0, Math.round((endTime - startTime) / 1000));

      db.prepare(`
        UPDATE breaks
        SET end_server_timestamp = ?, duration_seconds = ?
        WHERE id = ?
      `).run(serverTimestamp, breakDuration, openBreak.id);
    }

    // Recalculate total breaks for attendance
    const totalBreaks = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) as total_break_seconds
      FROM breaks
      WHERE attendance_id = ?
    `).get(session.id).total_break_seconds;

    db.prepare(`
      UPDATE attendance
      SET attendance_status = 'CHECKED_IN',
          break_seconds = ?,
          updated_at = ?
      WHERE id = ?
    `).run(totalBreaks, serverTimestamp, session.id);

    this.logAudit('BREAK_END', employeeId, session.employer_id, 'END_BREAK', 'SUCCESS', {
      attendanceId: session.id,
      breakDurationSeconds: breakDuration,
      totalBreakSeconds: totalBreaks
    }, clientIp, userAgent);

    this.syncToREDCap(session.id);

    return {
      status: 'RESUMED_WORKING',
      message: 'Break ended. Working resumed.',
      breakDurationSeconds: breakDuration,
      totalBreakSeconds: totalBreaks
    };
  }

  /**
   * Check Out process
   */
  async processCheckOut({
    employee,
    photoData,
    latitude,
    longitude,
    accuracy,
    clientTimestamp,
    clientIp,
    userAgent
  }) {
    if (!employee || !employee.id) {
      throw new Error('Authentication required.');
    }

    const session = this.getActiveSession(employee.id);
    if (!session) {
      this.logAudit('CHECK_OUT_REJECTED_NO_ACTIVE', employee.id, employee.employer_id, 'CHECK_OUT', 'BLOCKED', {}, clientIp, userAgent);
      throw new Error('Without check-in, check-out cannot be done. Please check in first.');
    }

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(session.employer_id);

    // If currently on break, auto close break
    if (session.attendance_status === 'ON_BREAK') {
      this.endBreak(employee.id, clientIp, userAgent);
    }

    // Validate GPS accuracy
    const accuracyCheck = geoService.validateGpsAccuracy(accuracy, org.max_gps_accuracy_m);
    if (!accuracyCheck.valid) {
      this.logAudit('CHECK_OUT_LOW_ACCURACY', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', { accuracy, maxAllowed: org.max_gps_accuracy_m }, clientIp, userAgent);
      throw new Error(accuracyCheck.error);
    }

    // Validate coordinates
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid GPS coordinates provided.');
    }

    const activeWorkMode = session.work_mode || 'OFFICE';
    const geofenceResult = geoService.evaluateGeofence(lat, lng, org.office_lat, org.office_lng, org.geofence_radius_m, org.geofence_policy, activeWorkMode);
    if (!geofenceResult.allowed) {
      this.logAudit('CHECK_OUT_GEOFENCE_BLOCKED', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', geofenceResult, clientIp, userAgent);
      throw new Error(geofenceResult.reason);
    }

    // Process fresh checkout photo
    const photoResult = photoService.processCapturedPhoto(photoData, 'checkouts');

    // Anti-replay: cannot reuse checkin photo or another checkout photo
    if (photoResult.hash === session.checkin_photo_hash) {
      this.logAudit('CHECK_OUT_PHOTO_REUSED_CHECKIN', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', {}, clientIp, userAgent);
      throw new Error('Tampering detected: Checkout requires a newly captured camera photo. You cannot reuse the check-in photo.');
    }

    const existingPhoto = db.prepare('SELECT id FROM attendance WHERE checkin_photo_hash = ? OR checkout_photo_hash = ?').get(photoResult.hash, photoResult.hash);
    if (existingPhoto) {
      this.logAudit('PHOTO_REPLAY_DETECTED', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', { hash: photoResult.hash }, clientIp, userAgent);
      throw new Error('Tampering detected: Reused or previously submitted attendance photo cannot be accepted.');
    }

    // Check location anomaly
    const anomalyCheck = geoService.checkLocationAnomalies(session, lat, lng, new Date().toISOString());

    // Server-side timestamp
    const checkoutServerTimestamp = new Date().toISOString();
    const reverseAddress = await geoService.reverseGeocode(lat, lng);

    // Working hours calculation exclusively from official server timestamps
    const checkinTimeMs = new Date(session.checkin_server_timestamp).getTime();
    const checkoutTimeMs = new Date(checkoutServerTimestamp).getTime();
    const grossWorkingSeconds = Math.max(0, Math.round((checkoutTimeMs - checkinTimeMs) / 1000));
    
    // Total breaks
    const totalBreaks = db.prepare(`
      SELECT COALESCE(SUM(duration_seconds), 0) as total_break_seconds
      FROM breaks
      WHERE attendance_id = ?
    `).get(session.id).total_break_seconds;

    const netWorkingSeconds = Math.max(0, grossWorkingSeconds - totalBreaks);
    const requiredShiftSeconds = Math.round(org.shift_hours * 3600);
    const overtimeSeconds = Math.max(0, netWorkingSeconds - requiredShiftSeconds);

    const finalStatus = anomalyCheck.isAnomalous ? 'ANOMALY_FLAGGED' : 'COMPLETED';

    db.prepare(`
      UPDATE attendance
      SET attendance_status = ?,
          checkout_photo = ?,
          checkout_photo_hash = ?,
          checkout_lat = ?,
          checkout_lng = ?,
          checkout_accuracy = ?,
          checkout_location_timestamp = ?,
          checkout_server_timestamp = ?,
          checkout_address = ?,
          checkout_geofence_distance = ?,
          checkout_geofence_status = ?,
          gross_working_seconds = ?,
          break_seconds = ?,
          net_working_seconds = ?,
          overtime_seconds = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      finalStatus,
      photoResult.relativePath,
      photoResult.hash,
      lat,
      lng,
      accuracyCheck.accuracy,
      clientTimestamp || checkoutServerTimestamp,
      checkoutServerTimestamp,
      reverseAddress,
      geofenceResult.distance,
      geofenceResult.status,
      grossWorkingSeconds,
      totalBreaks,
      netWorkingSeconds,
      overtimeSeconds,
      checkoutServerTimestamp,
      session.id
    );

    this.logAudit('CHECK_OUT_SUCCESS', employee.id, org.id, 'CHECK_OUT', finalStatus, {
      attendanceId: session.id,
      grossWorkingSeconds,
      breakSeconds: totalBreaks,
      netWorkingSeconds,
      overtimeSeconds,
      anomaly: anomalyCheck
    }, clientIp, userAgent);

    // Sync to REDCap
    this.syncToREDCap(session.id, photoResult.fullPath, 'checkout_photo');

    const completedRecord = db.prepare(`
      SELECT a.*, 
             COALESCE(t.name, 'Direct Assignment') as team_name,
             COALESCE(a.state, e.state, t.state) as state,
             COALESCE(a.district, e.district, t.district) as district
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
      WHERE a.id = ?
    `).get(session.id);
    return {
      status: 'CHECK_OUT_SUCCESSFUL',
      message: 'Checkout successfully verified and recorded.',
      attendance: completedRecord,
      summary: {
        grossWorkingSeconds,
        breakSeconds: totalBreaks,
        netWorkingSeconds,
        overtimeSeconds,
        grossHours: (grossWorkingSeconds / 3600).toFixed(2),
        netHours: (netWorkingSeconds / 3600).toFixed(2),
        overtimeHours: (overtimeSeconds / 3600).toFixed(2)
      }
    };
  }

  /**
   * Sync an attendance session to the SQL external_sync_records table
   * (replaces REDCap until the live API is configured)
   */
  async syncToREDCap(attendanceId, newPhotoFilePath = null, photoField = null) {
    try {
      const record = db.prepare(`
        SELECT a.*, e.department, e.designation
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        WHERE a.id = ?
      `).get(attendanceId);

      if (!record) return;

      const mapGeofence = (s) => {
        if (s === 'WITHIN_GEOFENCE' || s === 'FIELD_WORK_VERIFIED') return '1';
        if (s === 'OUTSIDE_GEOFENCE_ALLOWED') return '2';
        return '3';
      };

      const mapStatus = (s) => {
        if (s === 'CHECKED_IN') return '1';
        if (s === 'ON_BREAK') return '2';
        if (s === 'COMPLETED') return '3';
        return '4';
      };

      const redcapPayload = {
        attendance_record_id: record.id,
        employee_id: record.employee_id,
        employer_id: record.employer_id,
        department: record.department,
        designation: record.designation,
        checkin_latitude: String(record.checkin_lat || ''),
        checkin_longitude: String(record.checkin_lng || ''),
        checkin_accuracy: String(record.checkin_accuracy || ''),
        checkin_location_timestamp: String(record.checkin_location_timestamp || ''),
        checkin_server_timestamp: String(record.checkin_server_timestamp || ''),
        checkin_address: String(record.checkin_address || ''),
        checkin_geofence_distance: String(record.checkin_geofence_distance || ''),
        checkin_geofence_status: mapGeofence(record.checkin_geofence_status),
        checkout_latitude: String(record.checkout_lat || ''),
        checkout_longitude: String(record.checkout_lng || ''),
        checkout_accuracy: String(record.checkout_accuracy || ''),
        checkout_location_timestamp: String(record.checkout_location_timestamp || ''),
        checkout_server_timestamp: String(record.checkout_server_timestamp || ''),
        checkout_address: String(record.checkout_address || ''),
        checkout_geofence_distance: String(record.checkout_geofence_distance || ''),
        checkout_geofence_status: mapGeofence(record.checkout_geofence_status),
        gross_working_seconds: String(record.gross_working_seconds || 0),
        break_seconds: String(record.break_seconds || 0),
        net_working_seconds: String(record.net_working_seconds || 0),
        overtime_seconds: String(record.overtime_seconds || 0),
        attendance_status: mapStatus(record.attendance_status)
      };

      const syncResult = await redcapClient.importRecord(redcapPayload);

      if (newPhotoFilePath && photoField) {
        await redcapClient.importFile(record.id, photoField, newPhotoFilePath);
      }

      db.prepare(`
        UPDATE attendance
        SET redcap_sync_status = 'SYNCED',
            redcap_synced_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), record.id);
    } catch (err) {
      console.error('REDCap sync error:', err.message);
      db.prepare(`
        UPDATE attendance
        SET redcap_sync_status = 'SYNC_ERROR'
        WHERE id = ?
      `).run(attendanceId);
    }
  }
}

module.exports = new AttendanceService();
