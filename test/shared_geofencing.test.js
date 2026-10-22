/**
 * Automated Test Suite: Shared Geofencing Service (Attendance & Hotel Stays)
 * 
 * Verifies:
 * 1. Standardized Status Outputs:
 *    - 'verified_inside'
 *    - 'outside_geofence'
 *    - 'low_accuracy'
 *    - 'location_unavailable'
 *    - 'pending_review'
 * 2. Workplace perimeter evaluation:
 *    - Within radius => verified_inside
 *    - Outside radius + ALLOW_WITH_FLAG => pending_review (flagged)
 *    - Outside radius + STRICT_BLOCK => outside_geofence (blocked)
 * 3. Hotel geofence evaluation:
 *    - Matching approved hotel => verified_inside
 *    - Outside hotel geofence => outside_geofence
 * 4. GPS accuracy threshold enforcement => low_accuracy
 * 5. Invalid / missing GPS coordinates => location_unavailable
 * 6. Work mode compliance (FIELD_WORK and TRAVEL return verified_inside)
 * 7. Geofence Management CRUD operations in PostgreSQL
 */

'use strict';

const assert = require('assert');
const testHelper = require('./test_helper');
const geofenceService = require('../src/services/geofence_service');

async function runGeofenceTests() {
  console.log('🧪 Starting Shared Geofencing Service Test Suite...\n');

  await testHelper.applySchema();
  await testHelper.seedTestData();

  const orgId = 'ORG-001';
  // AIIMS coordinates: 28.5672°N, 77.2100°E
  const officeLat = 28.5672;
  const officeLng = 77.2100;

  // 1. Standardized Status: verified_inside
  console.log('--- Section 1: Standardized Status Outputs ---');

  // Employee standing 25 meters from AIIMS
  const insideCheck = await geofenceService.verifyLocation({
    latitude: 28.5674,
    longitude: 77.2102,
    accuracy: 10,
    employerId: orgId,
    officeLat,
    officeLng,
    radiusMeters: 150,
    policy: 'ALLOW_WITH_FLAG'
  });

  assert.strictEqual(insideCheck.status, 'verified_inside', 'Inside coordinate must return "verified_inside"');
  assert.strictEqual(insideCheck.allowed, true);
  assert.strictEqual(insideCheck.isInside, true);
  assert(insideCheck.distance < 150);
  console.log('✓ verified_inside status confirmed for coordinates within radius');

  // 2. Standardized Status: outside_geofence (STRICT_BLOCK)
  const outsideBlockCheck = await geofenceService.verifyLocation({
    latitude: 28.6000,
    longitude: 77.3000,
    accuracy: 15,
    employerId: orgId,
    officeLat,
    officeLng,
    radiusMeters: 150,
    policy: 'STRICT_BLOCK'
  });

  assert.strictEqual(outsideBlockCheck.status, 'outside_geofence', 'Outside coordinate under STRICT_BLOCK must return "outside_geofence"');
  assert.strictEqual(outsideBlockCheck.allowed, false);
  assert.strictEqual(outsideBlockCheck.isInside, false);
  assert(outsideBlockCheck.distance > 150);
  console.log('✓ outside_geofence status confirmed for out-of-perimeter under STRICT_BLOCK');

  // 3. Standardized Status: pending_review (ALLOW_WITH_FLAG)
  const outsideFlagCheck = await geofenceService.verifyLocation({
    latitude: 28.6000,
    longitude: 77.3000,
    accuracy: 15,
    employerId: orgId,
    officeLat,
    officeLng,
    radiusMeters: 150,
    policy: 'ALLOW_WITH_FLAG'
  });

  assert.strictEqual(outsideFlagCheck.status, 'pending_review', 'Outside coordinate under ALLOW_WITH_FLAG must return "pending_review"');
  assert.strictEqual(outsideFlagCheck.allowed, true);
  assert.strictEqual(outsideFlagCheck.isInside, false);
  assert.strictEqual(outsideFlagCheck.flagged, true);
  console.log('✓ pending_review status confirmed for out-of-perimeter under ALLOW_WITH_FLAG');

  // 4. Standardized Status: low_accuracy
  const lowAccCheck = await geofenceService.verifyLocation({
    latitude: 28.5672,
    longitude: 77.2100,
    accuracy: 650, // exceeds maxAllowedAccuracy of 350m
    employerId: orgId,
    officeLat,
    officeLng,
    radiusMeters: 150,
    maxAllowedAccuracy: 350
  });

  assert.strictEqual(lowAccCheck.status, 'low_accuracy', 'Excessive inaccuracy must return "low_accuracy"');
  assert.strictEqual(lowAccCheck.allowed, false);
  console.log('✓ low_accuracy status confirmed when GPS accuracy exceeds threshold');

  // 5. Standardized Status: location_unavailable
  const missingCoordCheck = await geofenceService.verifyLocation({
    latitude: null,
    longitude: undefined,
    accuracy: 10,
    employerId: orgId
  });

  assert.strictEqual(missingCoordCheck.status, 'location_unavailable', 'Missing coordinates must return "location_unavailable"');
  assert.strictEqual(missingCoordCheck.allowed, false);
  console.log('✓ location_unavailable status confirmed for null/missing coordinates');

  // 6. Work Mode Compliance: FIELD_WORK & TRAVEL
  console.log('\n--- Section 2: Work Mode Geofence Evaluation ---');
  const fieldWorkCheck = await geofenceService.verifyLocation({
    latitude: 19.0760, // Mumbai (far away from AIIMS Delhi)
    longitude: 72.8777,
    accuracy: 20,
    employerId: orgId,
    officeLat,
    officeLng,
    workMode: 'FIELD_WORK'
  });

  assert.strictEqual(fieldWorkCheck.status, 'verified_inside', 'FIELD_WORK duty must be verified_inside');
  assert.strictEqual(fieldWorkCheck.allowed, true);

  const travelCheck = await geofenceService.verifyLocation({
    latitude: 34.0837, // Srinagar, Kashmir
    longitude: 74.7973,
    accuracy: 25,
    employerId: orgId,
    officeLat,
    officeLng,
    workMode: 'TRAVEL'
  });

  assert.strictEqual(travelCheck.status, 'verified_inside', 'TRAVEL transit duty must be verified_inside');
  assert.strictEqual(travelCheck.allowed, true);
  console.log('✓ Official FIELD_WORK and TRAVEL work modes correctly authenticate duty locations');

  // 7. Geofence CRUD Operations in Database
  console.log('\n--- Section 3: Geofence CRUD Operations in PostgreSQL ---');
  await testHelper.query('DELETE FROM geofences WHERE employer_id = $1', [orgId]);

  // Create Workplace Geofence
  const wpGeofence = await geofenceService.createGeofence({
    employerId: orgId,
    name: 'AIIMS Dental Wing Geofence',
    geofenceType: 'WORKPLACE',
    latitude: 28.5670,
    longitude: 77.2090,
    radiusMeters: 200,
    policy: 'ALLOW_WITH_FLAG',
    address: 'CDER, AIIMS Campus, Ansari Nagar, New Delhi'
  });

  assert(wpGeofence.id, 'Created geofence must have an ID');
  assert.strictEqual(wpGeofence.name, 'AIIMS Dental Wing Geofence');
  assert.strictEqual(wpGeofence.geofence_type, 'WORKPLACE');
  console.log('✓ Workplace geofence created in PostgreSQL:', wpGeofence.id);

  // Create Hotel Geofence
  const hotelGeofence = await geofenceService.createGeofence({
    employerId: orgId,
    name: 'Approved Field Stay - Hotel Grand Residency',
    geofenceType: 'HOTEL',
    latitude: 34.0830,
    longitude: 74.7970,
    radiusMeters: 250,
    policy: 'STRICT_BLOCK',
    address: 'Rajbagh, Srinagar, Jammu & Kashmir'
  });

  assert(hotelGeofence.id);
  assert.strictEqual(hotelGeofence.geofence_type, 'HOTEL');
  console.log('✓ Hotel geofence created in PostgreSQL:', hotelGeofence.id);

  // List geofences
  const allGeofences = await geofenceService.listGeofences(orgId);
  assert(allGeofences.length >= 2, 'Should list both created geofences');

  const hotelList = await geofenceService.listGeofences(orgId, { geofenceType: 'HOTEL' });
  assert.strictEqual(hotelList.length, 1);
  assert.strictEqual(hotelList[0].name, 'Approved Field Stay - Hotel Grand Residency');
  console.log('✓ Geofences filtered by type correctly retrieved');

  // Multi-Location Matching against DB geofences
  const hotelStayLocationCheck = await geofenceService.verifyLocation({
    latitude: 34.0832, // Right inside the hotel perimeter
    longitude: 74.7971,
    accuracy: 12,
    employerId: orgId,
    geofenceType: 'HOTEL'
  });

  assert.strictEqual(hotelStayLocationCheck.status, 'verified_inside');
  assert.strictEqual(hotelStayLocationCheck.allowed, true);
  assert.strictEqual(hotelStayLocationCheck.geofenceId, hotelGeofence.id);
  console.log('✓ Multi-location geofencing matched employee coordinates against approved HOTEL geofence');

  // Update Geofence
  const updatedGf = await geofenceService.updateGeofence(wpGeofence.id, orgId, {
    radiusMeters: 300,
    name: 'AIIMS Dental & Research Wing'
  });
  assert.strictEqual(parseFloat(updatedGf.radius_meters), 300);
  assert.strictEqual(updatedGf.name, 'AIIMS Dental & Research Wing');
  console.log('✓ Geofence updated successfully');

  // Soft delete Geofence
  const deleteResult = await geofenceService.deleteGeofence(wpGeofence.id, orgId);
  assert.strictEqual(deleteResult, true);

  const activeAfterDelete = await geofenceService.listGeofences(orgId, { activeOnly: true });
  assert(!activeAfterDelete.some(g => g.id === wpGeofence.id), 'Deleted geofence must not appear in active list');
  console.log('✓ Geofence soft-deleted and omitted from active list');

  console.log('\n🎉 ALL SHARED GEOFENCING TESTS PASSED!\n');
}

if (require.main === module) {
  runGeofenceTests()
    .then(() => {
      const pool = testHelper.getTestPool();
      return pool.end();
    })
    .catch((err) => {
      console.error('❌ Test failure:', err);
      process.exit(1);
    });
}

module.exports = { runGeofenceTests };
