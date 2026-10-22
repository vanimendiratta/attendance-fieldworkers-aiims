'use strict';

const { randomUUID }                         = require('crypto');
const { query }                                = require('../db/database');
const geoService                               = require('./geo_service');
const geofenceService                          = require('./geofence_service');
const photoService                             = require('./photo_service');
const storageService                           = require('./storage_service');
const redcapClient                             = require('./sql_sync_client');
const { matchStateAndDistrict }                = require('../data/india_states_districts');

/**
 * Attendance Service (PostgreSQL async version)
 *
 * All methods that access the database are async.
 * Timestamps are stored and compared as ISO 8601 TEXT strings.
 * Timezone-aware date comparison uses Intl.DateTimeFormat (Asia/Kolkata).
 * No SQLite-specific syntax remains.
 */
class AttendanceService {

  // ---------------------------------------------------------------------------
  // Audit logging — fire-and-forget (async, errors swallowed internally)
  // ---------------------------------------------------------------------------
  async logAudit(eventType, employeeId, employerId, action, status, details, clientIp = '127.0.0.1', userAgent = 'Unknown') {
    try {
      await query(
        `INSERT INTO audit_logs
           (id, event_type, employee_id, employer_id, action, status, details_json, client_ip, user_agent, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          eventType,
          employeeId || null,
          employerId || null,
          action,
          status,
          typeof details === 'object' ? JSON.stringify(details) : String(details),
          clientIp,
          userAgent,
          new Date().toISOString()
        ]
      );
    } catch (err) {
      console.error('Audit logging failure:', err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Get active attendance session for an employee
  // ---------------------------------------------------------------------------
  async getActiveSession(employeeId) {
    const result = await query(
      `SELECT a.*,
              e.name AS employee_name, e.department, e.designation,
              COALESCE(t.name, 'Direct Assignment') AS team_name,
              COALESCE(a.state, e.state, t.state) AS state,
              COALESCE(a.district, e.district, t.district) AS district,
              o.name AS employer_name, o.office_name, o.timezone
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
       JOIN organizations o ON a.employer_id = o.id
       WHERE a.employee_id = $1 AND a.attendance_status IN ('CHECKED_IN', 'ON_BREAK')
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [employeeId]
    );
    return result.rows[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Timezone-aware date string helper (pure — no DB)
  // ---------------------------------------------------------------------------
  getLocalDateString(dateObj, timeZone = 'Asia/Kolkata') {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year:  'numeric',
        month: '2-digit',
        day:   '2-digit'
      }).format(dateObj);
    } catch (_) {
      return dateObj.toISOString().slice(0, 10);
    }
  }

  // ---------------------------------------------------------------------------
  // Check In
  // ---------------------------------------------------------------------------
  async processCheckIn({
    employee, photoData, latitude, longitude, accuracy,
    clientTimestamp, idempotencyKey, workMode = 'OFFICE',
    fieldSiteNotes = null, teamId = null, state = null, district = null,
    punchLocationType = 'FIELD_SITE', hotelStayId = null, hotelName = null, hotelRoom = null, hotelPhone = null,
    clientIp, userAgent
  }) {
    if (!employee || !employee.id) throw new Error('Authentication required.');

    // 1. Load org
    const orgRes = await query('SELECT * FROM organizations WHERE id = $1', [employee.employer_id]);
    const org    = orgRes.rows[0];
    if (!org) throw new Error('Associated employer organization not found.');

    // 2. Idempotency
    if (idempotencyKey) {
      const idemRes = await query('SELECT * FROM attendance WHERE idempotency_key = $1', [idempotencyKey]);
      if (idemRes.rows.length > 0) {
        return { status: 'SUCCESS', replayed: true, attendance: idemRes.rows[0] };
      }
    }

    // 3. Daily attendance enforcement
    const orgTimezone = org.timezone || 'Asia/Kolkata';
    const todayStr    = this.getLocalDateString(new Date(), orgTimezone);

    const activeSession = await this.getActiveSession(employee.id);
    if (activeSession) {
      this.logAudit('CHECK_IN_REJECTED_ALREADY_ACTIVE', employee.id, org.id, 'CHECK_IN', 'BLOCKED',
        { existingSessionId: activeSession.id }, clientIp, userAgent);
      throw new Error('Employee already has an active check-in. Please check out before checking in again.');
    }

    const recentRes = await query(
      `SELECT id, attendance_status, checkin_server_timestamp, checkout_server_timestamp
       FROM attendance WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [employee.id]
    );
    const recentRecords = recentRes.rows;

    const completedToday = recentRecords.find(rec => {
      if (!rec.checkin_server_timestamp) return false;
      const recDate = this.getLocalDateString(new Date(rec.checkin_server_timestamp), orgTimezone);
      return recDate === todayStr &&
        (rec.attendance_status === 'COMPLETED' || rec.checkout_server_timestamp !== null);
    });

    if (completedToday) {
      this.logAudit('CHECK_IN_REJECTED_DAILY_LIMIT', employee.id, org.id, 'CHECK_IN', 'BLOCKED',
        { todayStr, existingRecordId: completedToday.id }, clientIp, userAgent);
      throw new Error('Daily attendance limit reached: In one day, an employee can only check in and check out for one single time. You have already completed your attendance for today.');
    }

    // 4. GPS accuracy (informational only — never block check-in)
    const accuracyCheck = geoService.validateGpsAccuracy(accuracy, org.max_gps_accuracy_m);
    if (!accuracyCheck.valid) {
      this.logAudit('CHECK_IN_LOW_ACCURACY', employee.id, org.id, 'CHECK_IN', 'WARNING',
        { accuracy, maxAllowed: org.max_gps_accuracy_m }, clientIp, userAgent);
    }

    // 5. Coordinate validation
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid GPS coordinates provided.');
    }

    // 6. Geofence
    const mode           = (workMode === 'TRAVEL' || workMode === 'FIELD_WORK') ? workMode : 'OFFICE';
    const geofenceResult = await geofenceService.verifyLocation({
      latitude: lat,
      longitude: lng,
      accuracy: accuracyCheck.accuracy,
      employerId: org.id,
      geofenceType: 'WORKPLACE',
      officeLat: org.office_lat,
      officeLng: org.office_lng,
      radiusMeters: org.geofence_radius_m,
      policy: org.geofence_policy,
      workMode: mode,
      maxAllowedAccuracy: org.max_gps_accuracy_m
    });
    if (!geofenceResult.allowed) {
      this.logAudit('CHECK_IN_GEOFENCE_BLOCKED', employee.id, org.id, 'CHECK_IN', 'BLOCKED', geofenceResult, clientIp, userAgent);
      throw new Error(geofenceResult.reason);
    }

    // 7. Photo processing & anti-replay
    const photoResult  = photoService.processCapturedPhoto(photoData, 'checkins');
    const photoHashRes = await query(
      'SELECT id FROM attendance WHERE checkin_photo_hash = $1 OR checkout_photo_hash = $2',
      [photoResult.hash, photoResult.hash]
    );
    if (photoHashRes.rows.length > 0) {
      this.logAudit('PHOTO_REPLAY_DETECTED', employee.id, org.id, 'CHECK_IN', 'BLOCKED',
        { hash: photoResult.hash }, clientIp, userAgent);
      throw new Error('Tampering detected: Reused or previously submitted attendance photo cannot be accepted.');
    }

    // 8. Server timestamp, detailed geocode & exact Google Maps coordinates
    const serverTimestamp = new Date().toISOString();
    const reverseDetails  = await geoService.reverseGeocodeDetailed(lat, lng);
    const reverseAddress  = reverseDetails.address;
    const exactCoordinatesUrl = `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;

    // Hotel proximity & stay resolution
    let resolvedLocationType = punchLocationType || (mode === 'TRAVEL' ? 'TRAVEL_TRANSIT' : 'FIELD_SITE');
    let resolvedHotelStayId  = hotelStayId || null;
    let resolvedHotelName    = hotelName ? String(hotelName).trim() : null;
    let resolvedHotelRoom    = hotelRoom ? String(hotelRoom).trim() : null;
    let resolvedHotelPhone   = hotelPhone ? String(hotelPhone).trim() : null;

    // Check active hotel stay in DB for this employee
    try {
      const activeStayRes = await query(
        `SELECT * FROM employee_hotel_stays 
         WHERE employee_id = $1 AND stay_status = 'ACTIVE' 
         ORDER BY created_at DESC LIMIT 1`,
        [employee.id]
      );
      if (activeStayRes.rows.length > 0) {
        const activeStay = activeStayRes.rows[0];
        if (!resolvedHotelStayId) resolvedHotelStayId = activeStay.id;
        if (!resolvedHotelName) resolvedHotelName = activeStay.hotel_name;
        if (!resolvedHotelRoom) resolvedHotelRoom = activeStay.room_number;
        if (!resolvedHotelPhone) resolvedHotelPhone = activeStay.hotel_phone;

        // If hotel coordinates are registered, evaluate proximity
        if (activeStay.hotel_lat && activeStay.hotel_lng) {
          const distToHotel = geoService.calculateHaversineDistance(
            Number(activeStay.hotel_lat), Number(activeStay.hotel_lng),
            lat, lng
          );
          if (distToHotel <= 150) {
            resolvedLocationType = 'HOTEL_STAY';
          }
        }
      }
    } catch (e) {
      // Ignore if table not yet initialized
    }

    // If reverse geocoding identified lodging and user hasn't explicitly set it
    if (reverseDetails.isLodging && resolvedLocationType !== 'HOTEL_STAY' && mode !== 'TRAVEL') {
      resolvedLocationType = 'HOTEL_STAY';
      if (!resolvedHotelName) resolvedHotelName = reverseDetails.placeName;
    }

    // 9. Resolve team / state / district
    let finalTeamId  = teamId || employee.team_id || null;
    let finalState   = state    ? String(state).trim()    : null;
    let finalDistrict = district ? String(district).trim() : null;

    if (finalTeamId && (!finalState || !finalDistrict)) {
      const teamRes = await query('SELECT * FROM teams WHERE id = $1', [finalTeamId]);
      const team    = teamRes.rows[0];
      if (team) {
        if (!finalState)    finalState    = team.state;
        if (!finalDistrict) finalDistrict = team.district;
      }
    }

    if (!finalState    && employee.state)    finalState    = employee.state;
    if (!finalDistrict && employee.district) finalDistrict = employee.district;

    if (!finalState || !finalDistrict) {
      const parsed = matchStateAndDistrict({ state: reverseAddress, city: reverseAddress });
      if (parsed.state    && !finalState)    finalState    = parsed.state;
      if (parsed.district && !finalDistrict) finalDistrict = parsed.district;
    }

    // 10. Upload to storage (or local disk in dev) & create attendance record
    const attendanceId = randomUUID();
    let photoPath = photoResult.relativePath;
    let isRemoteStorage = false;

    if (storageService.isStorageConfigured()) {
      try {
        const storageUpload = await storageService.uploadAttendancePhoto({
          buffer:       photoResult.buffer,
          employerId:   org.id,
          employeeId:   employee.id,
          attendanceId,
          photoType:    'checkin',
          mimeType:     photoResult.mimeType,
          ext:          photoResult.ext
        });
        photoPath       = storageUpload.storagePath;
        isRemoteStorage = storageUpload.isRemote;
      } catch (storageErr) {
        console.warn('[AttendanceService] Remote photo upload failed (check-in retained):', storageErr.message);
      }
    }

    try {
      await query(
        `INSERT INTO attendance (
           id, employee_id, employer_id, attendance_status,
           checkin_photo, checkin_photo_hash, checkin_lat, checkin_lng, checkin_accuracy,
           checkin_location_timestamp, checkin_server_timestamp, checkin_address,
           checkin_geofence_distance, checkin_geofence_status,
           work_mode, field_site_notes, team_id, state, district,
           punch_location_type, hotel_stay_id, hotel_name, hotel_room, hotel_phone,
           location_place_name, location_place_type, exact_coordinates_url,
           idempotency_key, redcap_sync_status, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,
           $5,$6,$7,$8,$9,
           $10,$11,$12,
           $13,$14,
           $15,$16,$17,$18,$19,
           $20,$21,$22,$23,$24,
           $25,$26,$27,
           $28,$29,$30,$31
         )`,
        [
          attendanceId, employee.id, org.id, 'CHECKED_IN',
          photoPath, photoResult.hash, lat, lng, accuracyCheck.accuracy,
          clientTimestamp || serverTimestamp, serverTimestamp, reverseAddress,
          geofenceResult.distance, geofenceResult.legacyStatus || geofenceResult.status,
          mode, fieldSiteNotes ? String(fieldSiteNotes).trim() : null,
          finalTeamId, finalState, finalDistrict,
          resolvedLocationType, resolvedHotelStayId, resolvedHotelName, resolvedHotelRoom, resolvedHotelPhone,
          reverseDetails.placeName || null, reverseDetails.placeType || null, exactCoordinatesUrl,
          idempotencyKey || null, 'PENDING', serverTimestamp, serverTimestamp
        ]
      );
    } catch (dbErr) {
      if (isRemoteStorage && photoPath) {
        storageService.deleteAttendancePhoto(photoPath).catch(() => {});
      }
      throw dbErr;
    }

    // 11. Audit log
    this.logAudit('CHECK_IN_SUCCESS', employee.id, org.id, 'CHECK_IN', 'SUCCESS', {
      attendanceId, workMode: mode, fieldSiteNotes, teamId: finalTeamId,
      state: finalState, district: finalDistrict, distance: geofenceResult.distance,
      geofenceStatus: geofenceResult.status, accuracy: accuracyCheck.accuracy,
      address: reverseAddress, serverTimestamp
    }, clientIp, userAgent);

    // 12. REDCap sync (fire-and-forget)
    this.syncToREDCap(attendanceId, photoResult.fullPath, 'checkin_photo').catch(() => {});

    const createdRes = await query(
      `SELECT a.*,
              COALESCE(t.name, 'Direct Assignment') AS team_name,
              COALESCE(a.state, e.state, t.state) AS state,
              COALESCE(a.district, e.district, t.district) AS district
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
       WHERE a.id = $1`,
      [attendanceId]
    );

    return {
      status:     'CHECK_IN_SUCCESSFUL',
      message:    'Check-in confirmed and verified by server.',
      attendance: createdRes.rows[0],
      geofence:   geofenceResult
    };
  }

  // ---------------------------------------------------------------------------
  // Start Break
  // ---------------------------------------------------------------------------
  async startBreak(employeeId, clientIp, userAgent) {
    const session = await this.getActiveSession(employeeId);
    if (!session) throw new Error('No active attendance session found.');
    if (session.attendance_status === 'ON_BREAK') throw new Error('Already on break.');

    const breakId        = randomUUID();
    const serverTimestamp = new Date().toISOString();

    await query(
      'INSERT INTO breaks (id, attendance_id, start_server_timestamp) VALUES ($1,$2,$3)',
      [breakId, session.id, serverTimestamp]
    );
    await query(
      "UPDATE attendance SET attendance_status = 'ON_BREAK', updated_at = $1 WHERE id = $2",
      [serverTimestamp, session.id]
    );

    this.logAudit('BREAK_START', employeeId, session.employer_id, 'START_BREAK', 'SUCCESS', {
      attendanceId: session.id, breakId, start: serverTimestamp
    }, clientIp, userAgent);

    this.syncToREDCap(session.id).catch(() => {});

    return { status: 'ON_BREAK', message: 'Break started.', breakId, startTime: serverTimestamp };
  }

  // ---------------------------------------------------------------------------
  // End Break
  // ---------------------------------------------------------------------------
  async endBreak(employeeId, clientIp, userAgent) {
    const session = await this.getActiveSession(employeeId);
    if (!session) throw new Error('No active attendance session found.');
    if (session.attendance_status !== 'ON_BREAK') throw new Error('Employee is not currently on break.');

    const openBreakRes = await query(
      `SELECT * FROM breaks
       WHERE attendance_id = $1 AND end_server_timestamp IS NULL
       ORDER BY start_server_timestamp DESC LIMIT 1`,
      [session.id]
    );
    const openBreak = openBreakRes.rows[0] || null;

    const serverTimestamp = new Date().toISOString();
    let breakDuration     = 0;

    if (openBreak) {
      const startTime   = new Date(openBreak.start_server_timestamp).getTime();
      const endTime     = new Date(serverTimestamp).getTime();
      breakDuration     = Math.max(0, Math.round((endTime - startTime) / 1000));

      await query(
        'UPDATE breaks SET end_server_timestamp = $1, duration_seconds = $2 WHERE id = $3',
        [serverTimestamp, breakDuration, openBreak.id]
      );
    }

    // Recalculate total breaks
    const sumRes     = await query(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total_break_seconds
       FROM breaks WHERE attendance_id = $1`,
      [session.id]
    );
    const totalBreaks = parseInt(sumRes.rows[0].total_break_seconds, 10) || 0;

    await query(
      `UPDATE attendance
       SET attendance_status = 'CHECKED_IN', break_seconds = $1, updated_at = $2
       WHERE id = $3`,
      [totalBreaks, serverTimestamp, session.id]
    );

    this.logAudit('BREAK_END', employeeId, session.employer_id, 'END_BREAK', 'SUCCESS', {
      attendanceId: session.id, breakDurationSeconds: breakDuration, totalBreakSeconds: totalBreaks
    }, clientIp, userAgent);

    this.syncToREDCap(session.id).catch(() => {});

    return {
      status:             'RESUMED_WORKING',
      message:            'Break ended. Working resumed.',
      breakDurationSeconds: breakDuration,
      totalBreakSeconds:  totalBreaks
    };
  }

  // ---------------------------------------------------------------------------
  // Check Out
  // ---------------------------------------------------------------------------
  async processCheckOut({
    employee, photoData, latitude, longitude, accuracy,
    clientTimestamp, clientAddress, clientIp, userAgent
  }) {
    if (!employee || !employee.id) throw new Error('Authentication required.');

    const session = await this.getActiveSession(employee.id);
    if (!session) {
      this.logAudit('CHECK_OUT_REJECTED_NO_ACTIVE', employee.id, employee.employer_id, 'CHECK_OUT', 'BLOCKED', {}, clientIp, userAgent);
      throw new Error('Without check-in, check-out cannot be done. Please check in first.');
    }

    const orgRes = await query('SELECT * FROM organizations WHERE id = $1', [session.employer_id]);
    const org    = orgRes.rows[0];

    // Auto-close break if on break
    if (session.attendance_status === 'ON_BREAK') {
      await this.endBreak(employee.id, clientIp, userAgent);
    }

    // GPS accuracy
    const accuracyCheck = geoService.validateGpsAccuracy(accuracy, org.max_gps_accuracy_m);
    if (!accuracyCheck.valid) {
      this.logAudit('CHECK_OUT_LOW_ACCURACY', employee.id, org.id, 'CHECK_OUT', 'WARNING',
        { accuracy, maxAllowed: org.max_gps_accuracy_m }, clientIp, userAgent);
    }

    // Coordinates
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid GPS coordinates provided.');
    }

    const activeWorkMode = session.work_mode || 'OFFICE';
    const geofenceResult = await geofenceService.verifyLocation({
      latitude: lat,
      longitude: lng,
      accuracy: accuracyCheck.accuracy,
      employerId: org.id,
      geofenceType: 'WORKPLACE',
      officeLat: org.office_lat,
      officeLng: org.office_lng,
      radiusMeters: org.geofence_radius_m,
      policy: org.geofence_policy,
      workMode: activeWorkMode,
      maxAllowedAccuracy: org.max_gps_accuracy_m
    });
    if (!geofenceResult.allowed) {
      this.logAudit('CHECK_OUT_GEOFENCE_BLOCKED', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', geofenceResult, clientIp, userAgent);
      throw new Error(geofenceResult.reason);
    }

    // Photo
    const photoResult = photoService.processCapturedPhoto(photoData, 'checkouts');
    if (photoResult.hash === session.checkin_photo_hash) {
      this.logAudit('CHECK_OUT_PHOTO_REUSED_CHECKIN', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', {}, clientIp, userAgent);
      throw new Error('Tampering detected: Checkout requires a newly captured camera photo. You cannot reuse the check-in photo.');
    }

    const existingPhotoRes = await query(
      'SELECT id FROM attendance WHERE checkin_photo_hash = $1 OR checkout_photo_hash = $2',
      [photoResult.hash, photoResult.hash]
    );
    if (existingPhotoRes.rows.length > 0) {
      this.logAudit('PHOTO_REPLAY_DETECTED', employee.id, org.id, 'CHECK_OUT', 'BLOCKED', { hash: photoResult.hash }, clientIp, userAgent);
      throw new Error('Tampering detected: Reused or previously submitted attendance photo cannot be accepted.');
    }

    // Anomaly + timestamps
    const anomalyCheck          = geoService.checkLocationAnomalies(session, lat, lng, new Date().toISOString());
    const checkoutServerTimestamp = new Date().toISOString();
    let reverseAddress          = await geoService.reverseGeocode(lat, lng);
    if ((!reverseAddress || reverseAddress.startsWith('Field Coordinates')) && clientAddress && typeof clientAddress === 'string' && clientAddress.trim()) {
      reverseAddress = clientAddress.trim();
    }

    // Working hours
    const checkinTimeMs      = new Date(session.checkin_server_timestamp).getTime();
    const checkoutTimeMs     = new Date(checkoutServerTimestamp).getTime();
    const grossWorkingSeconds = Math.max(0, Math.round((checkoutTimeMs - checkinTimeMs) / 1000));

    const sumRes     = await query(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total_break_seconds
       FROM breaks WHERE attendance_id = $1`,
      [session.id]
    );
    const totalBreaks = parseInt(sumRes.rows[0].total_break_seconds, 10) || 0;

    const netWorkingSeconds    = Math.max(0, grossWorkingSeconds - totalBreaks);
    const shiftHours           = parseFloat(org.shift_hours) || 8.0;
    const requiredShiftSeconds = Math.round(shiftHours * 3600);
    const overtimeSeconds      = Math.max(0, netWorkingSeconds - requiredShiftSeconds);
    const finalStatus          = anomalyCheck.isAnomalous ? 'ANOMALY_FLAGGED' : 'COMPLETED';

    let checkoutPhotoPath = photoResult.relativePath;
    let isRemoteStorage = false;

    if (storageService.isStorageConfigured()) {
      try {
        const storageUpload = await storageService.uploadAttendancePhoto({
          buffer:       photoResult.buffer,
          employerId:   org.id,
          employeeId:   employee.id,
          attendanceId: session.id,
          photoType:    'checkout',
          mimeType:     photoResult.mimeType,
          ext:          photoResult.ext
        });
        checkoutPhotoPath = storageUpload.storagePath;
        isRemoteStorage   = storageUpload.isRemote;
      } catch (storageErr) {
        console.warn('[AttendanceService] Remote photo upload failed (check-out retained):', storageErr.message);
      }
    }

    try {
      await query(
        `UPDATE attendance
         SET attendance_status          = $1,
             checkout_photo             = $2,
             checkout_photo_hash        = $3,
             checkout_lat               = $4,
             checkout_lng               = $5,
             checkout_accuracy          = $6,
             checkout_location_timestamp = $7,
             checkout_server_timestamp  = $8,
             checkout_address           = $9,
             checkout_geofence_distance = $10,
             checkout_geofence_status   = $11,
             gross_working_seconds      = $12,
             break_seconds              = $13,
             net_working_seconds        = $14,
             overtime_seconds           = $15,
             updated_at                 = $16
         WHERE id = $17`,
        [
          finalStatus,
          checkoutPhotoPath, photoResult.hash,
          lat, lng, accuracyCheck.accuracy,
          clientTimestamp || checkoutServerTimestamp,
          checkoutServerTimestamp, reverseAddress,
          geofenceResult.distance, geofenceResult.legacyStatus || geofenceResult.status,
          grossWorkingSeconds, totalBreaks, netWorkingSeconds, overtimeSeconds,
          checkoutServerTimestamp,
          session.id
        ]
      );
    } catch (dbErr) {
      if (isRemoteStorage && checkoutPhotoPath) {
        storageService.deleteAttendancePhoto(checkoutPhotoPath).catch(() => {});
      }
      throw dbErr;
    }

    this.logAudit('CHECK_OUT_SUCCESS', employee.id, org.id, 'CHECK_OUT', finalStatus, {
      attendanceId:     session.id,
      grossWorkingSeconds,
      breakSeconds:     totalBreaks,
      netWorkingSeconds,
      overtimeSeconds,
      anomaly:          anomalyCheck
    }, clientIp, userAgent);

    this.syncToREDCap(session.id, photoResult.fullPath, 'checkout_photo').catch(() => {});

    const completedRes = await query(
      `SELECT a.*,
              COALESCE(t.name, 'Direct Assignment') AS team_name,
              COALESCE(a.state, e.state, t.state) AS state,
              COALESCE(a.district, e.district, t.district) AS district
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN teams t ON a.team_id = t.id OR e.team_id = t.id
       WHERE a.id = $1`,
      [session.id]
    );

    return {
      status:   'CHECK_OUT_SUCCESSFUL',
      message:  'Checkout successfully verified and recorded.',
      attendance: completedRes.rows[0],
      summary: {
        grossWorkingSeconds,
        breakSeconds:  totalBreaks,
        netWorkingSeconds,
        overtimeSeconds,
        grossHours:    (grossWorkingSeconds / 3600).toFixed(2),
        netHours:      (netWorkingSeconds   / 3600).toFixed(2),
        overtimeHours: (overtimeSeconds     / 3600).toFixed(2)
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Sync to REDCap / SQL external_sync_records (fire-and-forget)
  // ---------------------------------------------------------------------------
  async syncToREDCap(attendanceId, newPhotoFilePath = null, photoField = null) {
    try {
      const recordRes = await query(
        `SELECT a.*, e.department, e.designation
         FROM attendance a
         JOIN employees e ON a.employee_id = e.id
         WHERE a.id = $1`,
        [attendanceId]
      );
      const record = recordRes.rows[0];
      if (!record) return;

      const mapGeofence = (s) => {
        if (s === 'WITHIN_GEOFENCE' || s === 'FIELD_WORK_VERIFIED') return '1';
        if (s === 'OUTSIDE_GEOFENCE_ALLOWED') return '2';
        return '3';
      };
      const mapStatus = (s) => {
        if (s === 'CHECKED_IN')  return '1';
        if (s === 'ON_BREAK')    return '2';
        if (s === 'COMPLETED')   return '3';
        return '4';
      };

      const redcapPayload = {
        attendance_record_id:          record.id,
        employee_id:                   record.employee_id,
        employer_id:                   record.employer_id,
        department:                    record.department,
        designation:                   record.designation,
        checkin_latitude:              String(record.checkin_lat   || ''),
        checkin_longitude:             String(record.checkin_lng   || ''),
        checkin_accuracy:              String(record.checkin_accuracy || ''),
        checkin_location_timestamp:    String(record.checkin_location_timestamp || ''),
        checkin_server_timestamp:      String(record.checkin_server_timestamp   || ''),
        checkin_address:               String(record.checkin_address || ''),
        checkin_geofence_distance:     String(record.checkin_geofence_distance  || ''),
        checkin_geofence_status:       mapGeofence(record.checkin_geofence_status),
        checkout_latitude:             String(record.checkout_lat   || ''),
        checkout_longitude:            String(record.checkout_lng   || ''),
        checkout_accuracy:             String(record.checkout_accuracy || ''),
        checkout_location_timestamp:   String(record.checkout_location_timestamp || ''),
        checkout_server_timestamp:     String(record.checkout_server_timestamp   || ''),
        checkout_address:              String(record.checkout_address || ''),
        checkout_geofence_distance:    String(record.checkout_geofence_distance  || ''),
        checkout_geofence_status:      mapGeofence(record.checkout_geofence_status),
        gross_working_seconds:         String(record.gross_working_seconds || 0),
        break_seconds:                 String(record.break_seconds         || 0),
        net_working_seconds:           String(record.net_working_seconds   || 0),
        overtime_seconds:              String(record.overtime_seconds      || 0),
        attendance_status:             mapStatus(record.attendance_status)
      };

      await redcapClient.importRecord(redcapPayload);

      if (newPhotoFilePath && photoField) {
        await redcapClient.importFile(record.id, photoField, newPhotoFilePath);
      }

      await query(
        "UPDATE attendance SET redcap_sync_status = 'SYNCED', redcap_synced_at = $1 WHERE id = $2",
        [new Date().toISOString(), record.id]
      );
    } catch (err) {
      console.error('REDCap sync error:', err.message);
      await query(
        "UPDATE attendance SET redcap_sync_status = 'SYNC_ERROR' WHERE id = $1",
        [attendanceId]
      ).catch(() => {});
    }
  }
}

module.exports = new AttendanceService();
