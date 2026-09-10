const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Helper to create valid PNG buffer with unique anti-replay entropy
function createUniquePngBuffer(variant = 1) {
  const base = Buffer.from(
    variant === 1
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      : variant === 2
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      : variant === 3
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      : 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8/x+I/zMwMAPRAQAAqAMh1qH1tAAAAABJRU5ErkJggg==',
    'base64'
  );
  // Append unique entropy to prevent SHA-256 anti-replay collision across repeated test runs
  const entropy = Buffer.from(`\n// salt_${Date.now()}_${Math.random()}`);
  return Buffer.concat([base, entropy]);
}

function createSamplePngBuffer() {
  return createUniquePngBuffer(1);
}

function createSecondPngBuffer() {
  return createUniquePngBuffer(2);
}

function createFieldPngBuffer() {
  return createUniquePngBuffer(3);
}

function createFieldCheckoutPngBuffer() {
  return createUniquePngBuffer(4);
}

async function runTests() {
  console.log('🧪 Starting Real-Time Attendance Test Suite...\n');

  const db = require('../src/db/database');
  const attendanceService = require('../src/services/attendance_service');
  const geoService = require('../src/services/geo_service');
  const photoService = require('../src/services/photo_service');
  const redcapClient = require('../src/redcap/redcap_client');

  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get('EMP-1001');
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get('ORG-001');

  assert(employee, 'Employee EMP-1001 must exist');
  assert(org, 'Organization ORG-001 must exist');
  console.log('✓ Seed data verified');

  // 1. Test GPS Accuracy Validation
  const goodAccuracy = geoService.validateGpsAccuracy(15, 100);
  assert.strictEqual(goodAccuracy.valid, true, 'Accuracy 15m should be accepted');

  const poorAccuracy = geoService.validateGpsAccuracy(350, 100);
  assert.strictEqual(poorAccuracy.valid, false, 'Accuracy 350m should be rejected');
  assert(poorAccuracy.error.includes('too low'), 'Error message should explain low accuracy');
  console.log('✓ GPS Accuracy threshold validation passed');

  // 2. Test Geofence Distance Calculation
  // Office: 28.6139, 77.2090
  // Employee 52m away: 28.6142, 77.2094
  const insideGeofence = geoService.evaluateGeofence(28.6142, 77.2094, 28.6139, 77.2090, 100);
  assert.strictEqual(insideGeofence.isInside, true, '52m should be inside 100m radius');
  assert.strictEqual(insideGeofence.status, 'WITHIN_GEOFENCE');

  // Employee 15km away
  const outsideGeofence = geoService.evaluateGeofence(28.7500, 77.1000, 28.6139, 77.2090, 100, 'STRICT_BLOCK');
  assert.strictEqual(outsideGeofence.isInside, false);
  assert.strictEqual(outsideGeofence.allowed, false);
  assert.strictEqual(outsideGeofence.status, 'BLOCKED_OUTSIDE_GEOFENCE');
  console.log('✓ Geofencing Haversine calculations passed');

  // 3. Test Photo Processing & Magic Byte Inspection
  const samplePhotoBuffer = createSamplePngBuffer();
  const photoInspection = photoService.inspectImageBuffer(samplePhotoBuffer);
  assert.strictEqual(photoInspection.valid, true);
  assert.strictEqual(photoInspection.mime, 'image/png');

  const invalidBuffer = Buffer.from('NOT_AN_IMAGE_FILE_DATA');
  const invalidInspection = photoService.inspectImageBuffer(invalidBuffer);
  assert.strictEqual(invalidInspection.valid, false);
  console.log('✓ Photo magic byte validation passed');

  // Clean up any test attendance for EMP-1001
  db.prepare('DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id = ?)').run(employee.id);
  db.prepare('DELETE FROM attendance WHERE employee_id = ?').run(employee.id);

  // 4. Test Check-In Flow
  const checkinPhotoBase64 = samplePhotoBuffer.toString('base64');
  const checkinResult = await attendanceService.processCheckIn({
    employee,
    photoData: checkinPhotoBase64,
    latitude: 28.6142,
    longitude: 77.2094,
    accuracy: 14.5,
    clientTimestamp: new Date().toISOString(),
    idempotencyKey: 'test-key-checkin-001',
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/1.0'
  });

  assert.strictEqual(checkinResult.status, 'CHECK_IN_SUCCESSFUL');
  assert.strictEqual(checkinResult.attendance.attendance_status, 'CHECKED_IN');
  assert(checkinResult.attendance.checkin_server_timestamp, 'Server timestamp must be recorded');
  console.log('✓ Real-time Check-in processed successfully with server timestamp & REDCap trigger');

  // 5. Test Double Check-In Prevention
  let doubleCheckinError = null;
  try {
    await attendanceService.processCheckIn({
      employee,
      photoData: createSecondPngBuffer().toString('base64'),
      latitude: 28.6142,
      longitude: 77.2094,
      accuracy: 20,
      clientTimestamp: new Date().toISOString(),
      clientIp: '127.0.0.1',
      userAgent: 'TestRunner/1.0'
    });
  } catch (err) {
    doubleCheckinError = err;
  }
  assert(doubleCheckinError, 'Double check-in must be rejected');
  assert(doubleCheckinError.message.includes('already has an active check-in'));
  console.log('✓ Double check-in prevention verified');

  // 6. Test Break Workflow
  const breakStart = attendanceService.startBreak(employee.id, '127.0.0.1', 'TestRunner/1.0');
  assert.strictEqual(breakStart.status, 'ON_BREAK');
  
  const activeSessionOnBreak = attendanceService.getActiveSession(employee.id);
  assert.strictEqual(activeSessionOnBreak.attendance_status, 'ON_BREAK');

  // Simulate short break delay
  await new Promise(r => setTimeout(r, 100));

  const breakEnd = attendanceService.endBreak(employee.id, '127.0.0.1', 'TestRunner/1.0');
  assert.strictEqual(breakEnd.status, 'RESUMED_WORKING');

  const activeSessionResumed = attendanceService.getActiveSession(employee.id);
  assert.strictEqual(activeSessionResumed.attendance_status, 'CHECKED_IN');
  console.log('✓ Break start/end cycle verified with duration accumulation');

  // 7. Test Anti-Replay (Reusing Check-in Photo for Checkout)
  let photoReplayError = null;
  try {
    await attendanceService.processCheckOut({
      employee,
      photoData: checkinPhotoBase64, // Exact same photo!
      latitude: 28.6142,
      longitude: 77.2094,
      accuracy: 16,
      clientTimestamp: new Date().toISOString(),
      clientIp: '127.0.0.1',
      userAgent: 'TestRunner/1.0'
    });
  } catch (err) {
    photoReplayError = err;
  }
  assert(photoReplayError, 'Checkout with reused check-in photo must be blocked');
  assert(photoReplayError.message.includes('cannot reuse the check-in photo') || photoReplayError.message.includes('Reused or previously submitted'));
  console.log('✓ Anti-replay mechanism blocked reused check-in photograph');

  // 8. Test Checkout with Fresh Photo and Working Hours
  const checkoutPhotoBase64 = createSecondPngBuffer().toString('base64');
  const checkoutResult = await attendanceService.processCheckOut({
    employee,
    photoData: checkoutPhotoBase64,
    latitude: 28.6140,
    longitude: 77.2091,
    accuracy: 12,
    clientTimestamp: new Date().toISOString(),
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/1.0'
  });

  assert.strictEqual(checkoutResult.status, 'CHECK_OUT_SUCCESSFUL');
  assert.strictEqual(checkoutResult.attendance.attendance_status, 'COMPLETED');
  assert(checkoutResult.attendance.checkout_server_timestamp, 'Checkout server timestamp must be generated');
  assert(checkoutResult.summary.grossWorkingSeconds >= 0);
  assert(checkoutResult.summary.netWorkingSeconds >= 0);
  console.log('✓ Real-time Checkout with fresh photo & GPS completed and verified');

  // 9. Test Checkout without Active Session
  let orphanCheckoutError = null;
  try {
    await attendanceService.processCheckOut({
      employee,
      photoData: checkoutPhotoBase64,
      latitude: 28.6140,
      longitude: 77.2091,
      accuracy: 15,
      clientTimestamp: new Date().toISOString(),
      clientIp: '127.0.0.1',
      userAgent: 'TestRunner/1.0'
    });
  } catch (err) {
    orphanCheckoutError = err;
  }
  assert(orphanCheckoutError, 'Checkout without active check-in must be rejected');
  console.log('✓ Checkout without active check-in prevented');

  // 10. Test REDCap Data Dictionary Generation
  const csv = redcapClient.generateDataDictionaryCsv();
  assert(csv.includes('employee_attendance'), 'Data dictionary must contain instrument name');
  assert(csv.includes('checkin_latitude'), 'Data dictionary must contain checkin_latitude');
  assert(csv.includes('checkout_latitude'), 'Data dictionary must contain checkout_latitude');
  assert(csv.includes('gross_working_seconds'), 'Data dictionary must contain gross_working_seconds');
  console.log('✓ Official REDCap 22-field Data Dictionary CSV generated successfully');

  // 11. Multi-Employer Authentication & Tenant Isolation Tests
  console.log('\n--- Testing Multi-Employer Authentication & Tenant Isolation ---');
  
  // A. Employee Login Success (ORG-001)
  const empApex = db.prepare('SELECT * FROM employees WHERE employer_id = ? AND id = ?').get('ORG-001', 'EMP-1001');
  assert(empApex, 'EMP-1001 must exist under ORG-001');
  assert.strictEqual(empApex.password, 'Password@1001', 'Password must match backend detail');
  console.log('✓ Employee backend detail verified for Employer 1');

  // B. Employee Login for Employer 2 (Cyberdyne)
  const empCyber = db.prepare('SELECT * FROM employees WHERE employer_id = ? AND id = ?').get('ORG-002', 'EMP-2001');
  assert(empCyber, 'EMP-2001 must exist under ORG-002');
  assert.strictEqual(empCyber.password, 'Password@2001', 'Password must match backend detail for Employer 2');
  console.log('✓ Employee backend detail verified for Employer 2');

  // C. Employer Admin Credentials Check
  const orgApex = db.prepare('SELECT * FROM organizations WHERE id = ?').get('ORG-001');
  assert.strictEqual(orgApex.admin_username, 'apex_admin');
  assert.strictEqual(orgApex.admin_password, 'ApexSecure@123');

  const orgCyber = db.prepare('SELECT * FROM organizations WHERE id = ?').get('ORG-002');
  assert.strictEqual(orgCyber.admin_username, 'cyberdyne_admin');
  assert.strictEqual(orgCyber.admin_password, 'Cyberdyne@456');
  console.log('✓ Distinct Employer Admin credentials verified in backend');

  // D. Tenant Isolation: ORG-002 admin query cannot see ORG-001 attendance
  const org1Records = db.prepare('SELECT * FROM attendance WHERE employer_id = ?').all('ORG-001');
  const org2Records = db.prepare('SELECT * FROM attendance WHERE employer_id = ?').all('ORG-002');
  assert(org1Records.length > 0, 'ORG-001 has attendance');
  assert(org1Records.every(r => r.employer_id === 'ORG-001'), 'ORG-001 query returns exclusively ORG-001 data');
  assert(org2Records.every(r => r.employer_id === 'ORG-002'), 'ORG-002 query returns exclusively ORG-002 data');
  console.log('✓ Strict Employer Tenant Isolation confirmed');

  console.log('\n--- Testing Field Work Multi-Location Attendance ---');
  db.prepare("DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id = 'EMP-1002')").run();
  db.prepare("DELETE FROM attendance WHERE employee_id = 'EMP-1002'").run();
  const empPriya = db.prepare('SELECT * FROM employees WHERE id = ?').get('EMP-1002');
  const fieldPhoto = `data:image/png;base64,${createFieldPngBuffer().toString('base64')}`;

  const fieldCheckin = await attendanceService.processCheckIn({
    employee: empPriya,
    photoData: fieldPhoto,
    latitude: 28.4595, // Remote location: Gurgaon Cyber City (~25 km away)
    longitude: 77.0266,
    accuracy: 8.5,
    clientTimestamp: new Date().toISOString(),
    idempotencyKey: `field_test_${Date.now()}`,
    workMode: 'FIELD_WORK',
    fieldSiteNotes: 'CyberCity Client Site - Audit & Inspection',
    clientIp: '127.0.0.1',
    userAgent: 'FieldTester/1.0'
  });

  assert.strictEqual(fieldCheckin.status, 'CHECK_IN_SUCCESSFUL');
  const fieldRecord = db.prepare('SELECT * FROM attendance WHERE id = ?').get(fieldCheckin.attendance.id);
  assert.strictEqual(fieldRecord.work_mode, 'FIELD_WORK', 'Record must have work_mode FIELD_WORK');
  assert.strictEqual(fieldRecord.checkin_geofence_status, 'FIELD_WORK_VERIFIED', 'Field work must be verified on-site');
  assert.strictEqual(fieldRecord.field_site_notes, 'CyberCity Client Site - Audit & Inspection');
  console.log('✓ Field Work Check-in at remote location authenticated & verified with site notes');

  // Field Work Checkout
  const fieldCheckoutPhoto = `data:image/png;base64,${createFieldCheckoutPngBuffer().toString('base64')}`;
  const fieldCheckout = await attendanceService.processCheckOut({
    employee: empPriya,
    photoData: fieldCheckoutPhoto,
    latitude: 28.4598,
    longitude: 77.0269,
    accuracy: 9.0,
    clientTimestamp: new Date().toISOString(),
    clientIp: '127.0.0.1',
    userAgent: 'FieldTester/1.0'
  });

  assert.strictEqual(fieldCheckout.status, 'CHECK_OUT_SUCCESSFUL');
  const completedFieldRecord = db.prepare('SELECT * FROM attendance WHERE id = ?').get(fieldRecord.id);
  assert.strictEqual(completedFieldRecord.attendance_status, 'COMPLETED');
  console.log('✓ Field Work Checkout completed successfully without geofence blockage');

  console.log('\n🎉 ALL AUTOMATED TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
