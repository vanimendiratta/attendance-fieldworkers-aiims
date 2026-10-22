/**
 * Unified Shared Geofencing Service
 * 
 * Supports both WORKPLACE and HOTEL geofences across AIIMS Fieldworker Attendance.
 * Provides standardized verification statuses:
 *   - 'verified_inside'
 *   - 'outside_geofence'
 *   - 'low_accuracy'
 *   - 'location_unavailable'
 *   - 'pending_review'
 * 
 * Server-authoritative validation for check-in, checkout, hotel registration, and multi-location field operations.
 */

'use strict';

const crypto = require('crypto');
const { query } = require('../db/database');
const geoService = require('./geo_service');

const STATUS = {
  VERIFIED_INSIDE: 'verified_inside',
  OUTSIDE_GEOFENCE: 'outside_geofence',
  LOW_ACCURACY: 'low_accuracy',
  LOCATION_UNAVAILABLE: 'location_unavailable',
  PENDING_REVIEW: 'pending_review'
};

// Earth radius in meters
const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate accurate distance in meters between two coordinates using the Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

class GeofenceService {
  constructor() {
    this.STATUS = STATUS;
  }

  /**
   * Validate GPS accuracy against threshold
   */
  validateAccuracy(accuracy, maxAllowedAccuracy = 350) {
    const acc = parseFloat(accuracy);
    if (isNaN(acc) || acc < 0) {
      return {
        valid: false,
        status: STATUS.LOW_ACCURACY,
        error: 'Invalid GPS accuracy reported by device.'
      };
    }

    if (acc > maxAllowedAccuracy) {
      return {
        valid: false,
        status: STATUS.LOW_ACCURACY,
        accuracy: acc,
        maxAllowed: maxAllowedAccuracy,
        error: `Location accuracy too low (${Math.round(acc)}m). Maximum allowed is ${maxAllowedAccuracy}m.`
      };
    }

    return {
      valid: true,
      accuracy: acc,
      maxAllowed: maxAllowedAccuracy
    };
  }

  /**
   * Core server-side geofence location verification
   * Evaluates employee coordinates against target geofence(s) or organization office
   */
  async verifyLocation({
    latitude,
    longitude,
    accuracy,
    employerId,
    geofenceType = 'WORKPLACE',
    geofenceId = null,
    officeLat = null,
    officeLng = null,
    radiusMeters = null,
    policy = 'ALLOW_WITH_FLAG',
    workMode = 'OFFICE',
    maxAllowedAccuracy = 350,
    hotelName = null,
    hotelAddress = null
  }) {
    // 1. Verify coordinate presence and numerical validity
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return {
        allowed: false,
        isInside: false,
        status: STATUS.LOCATION_UNAVAILABLE,
        legacyStatus: 'LOCATION_UNAVAILABLE',
        distance: null,
        radiusMeters: radiusMeters || 100,
        reason: 'GPS coordinates unavailable, invalid, or out of range.'
      };
    }

    // 2. Validate accuracy
    const accValidation = this.validateAccuracy(accuracy, maxAllowedAccuracy);
    if (!accValidation.valid) {
      return {
        allowed: false,
        isInside: false,
        status: STATUS.LOW_ACCURACY,
        legacyStatus: 'LOW_GPS_ACCURACY',
        accuracy: accValidation.accuracy,
        maxAllowed: maxAllowedAccuracy,
        distance: null,
        radiusMeters: radiusMeters || 100,
        reason: accValidation.error
      };
    }

    // 3. Work mode overrides for official travel & field work
    if (workMode === 'FIELD_WORK') {
      const refLat = officeLat !== null ? parseFloat(officeLat) : lat;
      const refLng = officeLng !== null ? parseFloat(officeLng) : lng;
      const dist = calculateDistance(lat, lng, refLat, refLng);
      return {
        allowed: true,
        isInside: true,
        status: STATUS.VERIFIED_INSIDE,
        legacyStatus: 'FIELD_WORK_VERIFIED',
        distance: dist,
        radiusMeters: radiusMeters || 100,
        reason: `Field work attendance authenticated on-site (${Math.round(dist)}m from registered base).`
      };
    }

    if (workMode === 'TRAVEL') {
      const refLat = officeLat !== null ? parseFloat(officeLat) : lat;
      const refLng = officeLng !== null ? parseFloat(officeLng) : lng;
      const dist = calculateDistance(lat, lng, refLat, refLng);
      return {
        allowed: true,
        isInside: true,
        status: STATUS.VERIFIED_INSIDE,
        legacyStatus: 'TRAVEL_DUTY_VERIFIED',
        distance: dist,
        radiusMeters: radiusMeters || 100,
        reason: `Official travel / transit duty authenticated (${Math.round(dist)}m from registered base).`
      };
    }

    // 4. Candidate geofence collection
    let candidateGeofences = [];

    // If specific geofence ID requested
    if (geofenceId && employerId) {
      const specificRes = await query(
        'SELECT * FROM geofences WHERE id = $1 AND employer_id = $2 AND is_active = 1',
        [geofenceId, employerId]
      );
      if (specificRes.rows.length > 0) {
        candidateGeofences.push(specificRes.rows[0]);
      }
    }

    // If explicit office coordinates passed, prioritize as explicit target
    if (officeLat !== null && officeLng !== null) {
      candidateGeofences.push({
        id: 'office-target',
        name: 'Workplace Base',
        geofence_type: geofenceType,
        latitude: parseFloat(officeLat),
        longitude: parseFloat(officeLng),
        radius_meters: parseFloat(radiusMeters || 100),
        policy: policy || 'ALLOW_WITH_FLAG'
      });
    }

    // Look up active geofences in DB for employer & type if no explicit coordinates
    if (candidateGeofences.length === 0 && employerId) {
      const dbGeofences = await query(
        'SELECT * FROM geofences WHERE employer_id = $1 AND geofence_type = $2 AND is_active = 1',
        [employerId, geofenceType]
      );
      if (dbGeofences.rows.length > 0) {
        candidateGeofences.push(...dbGeofences.rows);
      }
    }

    // If still no geofences available, load organization defaults
    if (candidateGeofences.length === 0 && employerId) {
      const orgRes = await query(
        'SELECT office_lat, office_lng, geofence_radius_m, geofence_policy, office_name FROM organizations WHERE id = $1',
        [employerId]
      );
      if (orgRes.rows.length > 0 && orgRes.rows[0].office_lat != null) {
        candidateGeofences.push({
          id: 'org-office',
          name: orgRes.rows[0].office_name || 'Organization Base',
          geofence_type: 'WORKPLACE',
          latitude: parseFloat(orgRes.rows[0].office_lat),
          longitude: parseFloat(orgRes.rows[0].office_lng),
          radius_meters: parseFloat(orgRes.rows[0].geofence_radius_m || 100),
          policy: orgRes.rows[0].geofence_policy || 'ALLOW_WITH_FLAG'
        });
      }
    }

    // If zero geofences defined anywhere, allow with review flag
    if (candidateGeofences.length === 0) {
      return {
        allowed: true,
        isInside: true,
        status: STATUS.VERIFIED_INSIDE,
        legacyStatus: 'WITHIN_GEOFENCE',
        distance: 0,
        radiusMeters: radiusMeters || 100,
        reason: 'No geofence restrictions configured for organization.'
      };
    }

    // 5. Evaluate against candidate geofences
    let closestGeofence = null;
    let minDistance = Infinity;
    let matchedInsideGeofence = null;

    for (const gf of candidateGeofences) {
      const gfLat = parseFloat(gf.latitude);
      const gfLng = parseFloat(gf.longitude);
      const gfRadius = parseFloat(gf.radius_meters || 100);
      const dist = calculateDistance(lat, lng, gfLat, gfLng);

      if (dist < minDistance) {
        minDistance = dist;
        closestGeofence = gf;
      }

      if (dist <= gfRadius) {
        matchedInsideGeofence = gf;
        minDistance = dist;
        break; // Found an approved geofence the user is inside
      }
    }

    const target = matchedInsideGeofence || closestGeofence;
    const targetRadius = parseFloat(target.radius_meters || 100);
    const effectivePolicy = target.policy || policy || 'ALLOW_WITH_FLAG';
    const isInside = minDistance <= targetRadius;

    if (isInside) {
      return {
        allowed: true,
        isInside: true,
        status: STATUS.VERIFIED_INSIDE,
        legacyStatus: 'WITHIN_GEOFENCE',
        distance: minDistance,
        radiusMeters: targetRadius,
        geofenceId: target.id,
        geofenceName: target.name,
        reason: `Within approved ${target.geofence_type.toLowerCase()} perimeter (${minDistance}m <= ${targetRadius}m at ${target.name}).`
      };
    }

    // Outside geofence
    if (effectivePolicy === 'STRICT_BLOCK') {
      return {
        allowed: false,
        isInside: false,
        status: STATUS.OUTSIDE_GEOFENCE,
        legacyStatus: 'BLOCKED_OUTSIDE_GEOFENCE',
        distance: minDistance,
        radiusMeters: targetRadius,
        geofenceId: target.id,
        geofenceName: target.name,
        reason: `Attendance blocked: You are ${Math.round(minDistance)}m from approved perimeter (${target.name}). Maximum allowed radius is ${targetRadius}m.`
      };
    }

    // Outside geofence but policy allows with review flag
    return {
      allowed: true,
      isInside: false,
      status: STATUS.PENDING_REVIEW,
      legacyStatus: 'OUTSIDE_GEOFENCE_ALLOWED',
      distance: minDistance,
      radiusMeters: targetRadius,
      geofenceId: target.id,
      geofenceName: target.name,
      flagged: true,
      reason: `Recorded outside approved perimeter (${Math.round(minDistance)}m away from ${target.name}). Flagged for administrative review.`
    };
  }

  // ---------------------------------------------------------------------------
  // Geofence Management CRUD
  // ---------------------------------------------------------------------------

  /**
   * List geofences for an employer
   */
  async listGeofences(employerId, { geofenceType = null, activeOnly = true } = {}) {
    let sql = 'SELECT * FROM geofences WHERE employer_id = $1';
    const params = [employerId];

    if (activeOnly) {
      params.push(1);
      sql += ` AND is_active = $${params.length}`;
    }

    if (geofenceType) {
      params.push(geofenceType.toUpperCase());
      sql += ` AND geofence_type = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';
    const res = await query(sql, params);
    return res.rows;
  }

  /**
   * Get single geofence by ID
   */
  async getGeofenceById(id, employerId) {
    const res = await query(
      'SELECT * FROM geofences WHERE id = $1 AND employer_id = $2',
      [id, employerId]
    );
    return res.rows[0] || null;
  }

  /**
   * Create a new geofence
   */
  async createGeofence({
    employerId,
    name,
    geofenceType = 'WORKPLACE',
    latitude,
    longitude,
    radiusMeters = 150,
    policy = 'ALLOW_WITH_FLAG',
    address = ''
  }) {
    if (!employerId || !name) {
      throw new Error('employerId and name are required.');
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radius = parseFloat(radiusMeters);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid latitude or longitude coordinates.');
    }
    if (isNaN(radius) || radius <= 0 || radius > 50000) {
      throw new Error('Radius must be between 1 and 50,000 meters.');
    }

    const validTypes = ['WORKPLACE', 'HOTEL'];
    const type = validTypes.includes(String(geofenceType).toUpperCase())
      ? String(geofenceType).toUpperCase()
      : 'WORKPLACE';

    const validPolicies = ['STRICT_BLOCK', 'ALLOW_WITH_FLAG'];
    const pol = validPolicies.includes(policy) ? policy : 'ALLOW_WITH_FLAG';

    const id = 'geo_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();

    const res = await query(
      `INSERT INTO geofences (
         id, employer_id, name, geofence_type, latitude, longitude,
         radius_meters, policy, address, is_active, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11)
       RETURNING *`,
      [id, employerId, name.trim(), type, lat, lng, radius, pol, address ? address.trim() : null, now, now]
    );
    return res.rows[0];
  }

  /**
   * Update an existing geofence
   */
  async updateGeofence(id, employerId, updates) {
    const existing = await this.getGeofenceById(id, employerId);
    if (!existing) {
      throw new Error('Geofence not found or unauthorized.');
    }

    const name = updates.name !== undefined ? updates.name.trim() : existing.name;
    const geofenceType = updates.geofenceType !== undefined
      ? String(updates.geofenceType).toUpperCase()
      : existing.geofence_type;
    const latitude = updates.latitude !== undefined ? parseFloat(updates.latitude) : parseFloat(existing.latitude);
    const longitude = updates.longitude !== undefined ? parseFloat(updates.longitude) : parseFloat(existing.longitude);
    const radiusMeters = updates.radiusMeters !== undefined ? parseFloat(updates.radiusMeters) : parseFloat(existing.radius_meters);
    const policy = updates.policy !== undefined ? updates.policy : existing.policy;
    const address = updates.address !== undefined ? (updates.address ? updates.address.trim() : null) : existing.address;
    const isActive = updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : existing.is_active;

    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error('Invalid coordinates.');
    }
    if (isNaN(radiusMeters) || radiusMeters <= 0) {
      throw new Error('Invalid radius.');
    }

    const now = new Date().toISOString();
    const res = await query(
      `UPDATE geofences SET
         name = $1, geofence_type = $2, latitude = $3, longitude = $4,
         radius_meters = $5, policy = $6, address = $7, is_active = $8, updated_at = $9
       WHERE id = $10 AND employer_id = $11
       RETURNING *`,
      [name, geofenceType, latitude, longitude, radiusMeters, policy, address, isActive, now, id, employerId]
    );
    return res.rows[0];
  }

  /**
   * Delete (soft-delete) a geofence
   */
  async deleteGeofence(id, employerId) {
    const res = await query(
      'UPDATE geofences SET is_active = 0, updated_at = NOW() WHERE id = $1 AND employer_id = $2 RETURNING id, name',
      [id, employerId]
    );
    return res.rows.length > 0;
  }
}

module.exports = new GeofenceService();
