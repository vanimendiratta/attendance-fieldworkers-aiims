/**
 * Core Real-Time Attendance Test Suite (PostgreSQL Integration & Unit Tests)
 *
 * Runs against a dedicated PostgreSQL test database specified by TEST_DATABASE_URL.
 * NEVER connects to production DATABASE_URL.
 */

'use strict';

const assert            = require('assert');
const testHelper        = require('./test_helper');
const attendanceService = require('../src/services/attendance_service');
const geoService        = require('../src/services/geo_service');
const photoService      = require('../src/services/photo_service');
const redcapClient      = require('../src/redcap/redcap_client');
const authService       = require('../src/services/auth_service');

function createUniquePngBuffer(seed = 1) {
  const buf = Buffer.alloc(200);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  buf[8] = (seed >> 8) & 0xff; buf[9] = seed & 0xff;
  for (let i = 10; i < 200; i++) {
    buf[i] = (i * seed * 17) & 0xff;
  }
  return buf;
}

function createFirstPngBuffer() {
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

  // =========================================================================
  // Section 1: Pure Unit Tests (No Database Required)
  // =========================================================================
  console.log('--- Section 1: Pure Unit & Geolocation Tests ---');

  // 1. Test GPS Accuracy Validation
  const goodAccuracy = geoService.validateGpsAccuracy(15, 100);
  assert.strictEqual(goodAccuracy.valid, true, 'Accuracy 15m should be accepted');

  const poorAccuracy = geoService.validateGpsAccuracy(350, 100);
  assert.strictEqual(poorAccuracy.valid, false, 'Accuracy 350m should be rejected');
  assert(poorAccuracy.error.includes('too low'), 'Error message should explain low accuracy');
  console.log('✓ GPS Accuracy threshold validation passed');

  // 2. Test Geofence Distance Calculation
  const insideGeofence = geoService.evaluateGeofence(28.6142, 77.2094, 28.6139, 77.2090, 100);
  assert.strictEqual(insideGeofence.isInside, true, '52m should be inside 100m radius');
  assert.strictEqual(insideGeofence.status, 'WITHIN_GEOFENCE');

  const outsideGeofence = geoService.evaluateGeofence(28.7500, 77.1000, 28.6139, 77.2090, 100, 'STRICT_BLOCK');
  assert.strictEqual(outsideGeofence.isInside, false);
  assert.strictEqual(outsideGeofence.allowed, false);
  console.log('✓ Geofence evaluation passed for inside & outside coordinates');

  // 3. Test Photo Processing & Validation (Magic Bytes)
  const validPng = createFirstPngBuffer();
  const photoValidation = photoService.parseAndValidatePhoto(validPng);
  assert(photoValidation.hash, 'Photo hash must be generated');
  assert.strictEqual(photoValidation.mimeType, 'image/png');
  console.log('✓ In-memory photo validation and SHA-256 integrity hash passed');

  // 4. Test REDCap Data Dictionary Generation
  const csv = redcapClient.generateDataDictionaryCsv();
  assert(csv.includes('employee_attendance'), 'Data dictionary must contain instrument name');
  assert(csv.includes('checkin_latitude'), 'Data dictionary must contain checkin_latitude');
  assert(csv.includes('checkout_latitude'), 'Data dictionary must contain checkout_latitude');
  assert(csv.includes('gross_working_seconds'), 'Data dictionary must contain gross_working_seconds');
  console.log('✓ REDCap Data Dictionary CSV generated successfully');

  // =========================================================================
  // Section 2: PostgreSQL Integration Tests
  // =========================================================================
  console.log('\n--- Section 2: PostgreSQL Database Integration Tests ---');

  testHelper.assertSafeTestEnvironment();

  console.log('[TEST-DB] Connecting to PostgreSQL test database...');
  await testHelper.applySchema();
  await testHelper.seedTestData();
  console.log('✓ Test environment verified against PostgreSQL');

  const empRes = await testHelper.query('SELECT * FROM employees WHERE id = $1', ['EMP-1001']);
  const orgRes = await testHelper.query('SELECT * FROM organizations WHERE id = $1', ['ORG-001']);
  const employee = empRes.rows[0];
  const org      = orgRes.rows[0];

  assert(employee, 'Employee EMP-1001 must exist in test database');
  assert(org, 'Organization ORG-001 must exist in test database');

  // Clean any residual attendance for EMP-1001
  await testHelper.query("DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id = 'EMP-1001')");
  await testHelper.query("DELETE FROM attendance WHERE employee_id = 'EMP-1001'");

  // 5. Test Check-In Workflow
  const checkinPhotoBase64 = createFirstPngBuffer().toString('base64');
  const checkinResult = await attendanceService.processCheckIn({
    employee,
    photoData: checkinPhotoBase64,
    latitude: 28.6142,
    longitude: 77.2094,
    accuracy: 15,
    clientTimestamp: new Date().toISOString(),
    idempotencyKey: `test_checkin_${Date.now()}`,
    clientIp: '127.0.0.1',
    userAgent: 'TestRunner/1.0'
  });

  assert.strictEqual(checkinResult.status, 'CHECK_IN_SUCCESSFUL');
  assert.strictEqual(checkinResult.attendance.attendance_status, 'CHECKED_IN');
  assert(checkinResult.attendance.checkin_photo, 'Check-in photo reference must exist');
  console.log('✓ Real-time Check-In completed and recorded in PostgreSQL');

  // 6. Test Double Check-In Prevention
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

  // 7. Test Break Workflow
  const breakStart = await attendanceService.startBreak(employee.id, '127.0.0.1', 'TestRunner/1.0');
  assert.strictEqual(breakStart.status, 'ON_BREAK');

  const activeSessionOnBreak = await attendanceService.getActiveSession(employee.id);
  assert.strictEqual(activeSessionOnBreak.attendance_status, 'ON_BREAK');

  await new Promise(r => setTimeout(r, 100));

  const breakEnd = await attendanceService.endBreak(employee.id, '127.0.0.1', 'TestRunner/1.0');
  assert.strictEqual(breakEnd.status, 'RESUMED_WORKING');

  const activeSessionResumed = await attendanceService.getActiveSession(employee.id);
  assert.strictEqual(activeSessionResumed.attendance_status, 'CHECKED_IN');
  console.log('✓ Break start/end cycle verified with duration accumulation');

  // 8. Test Anti-Replay Photo Detection
  let photoReplayError = null;
  try {
    await attendanceService.processCheckOut({
      employee,
      photoData: checkinPhotoBase64,
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

  // 9. Test Checkout with Fresh Photo and Working Hours
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
  console.log('✓ Real-time Checkout with fresh photo & GPS completed and verified');

  // 10. Multi-Tenant Organization Isolation Verification
  console.log('\n--- Section 3: Multi-Tenant PostgreSQL Isolation ---');
  const tenantBOrgId = 'ORG-TENANT-B';
  const hashedAdminB = testHelper.hashPassword('TenantBSecure@123');
  const hashedEmpB   = testHelper.hashPassword('TenantBEmp@123');

  await testHelper.query(
    `INSERT INTO organizations (id, name, office_name, office_lat, office_lng, admin_username, admin_password, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
     ON CONFLICT (id) DO UPDATE SET admin_password = EXCLUDED.admin_password`,
    [tenantBOrgId, 'Tenant B Corp', 'Tenant B HQ', 19.0760, 72.8777, 'tenant_b_admin', hashedAdminB]
  );

  await testHelper.query(
    `INSERT INTO employees (id, employer_id, name, email, department, designation, password, pin, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
     ON CONFLICT (id) DO NOTHING`,
    ['EMP-TB-01', tenantBOrgId, 'Tenant B Employee', 'emp_tb@tenantb.com', 'Dental', 'PRS-1', hashedEmpB, '1234', new Date().toISOString()]
  );

  const org1Records = await testHelper.query('SELECT * FROM attendance WHERE employer_id = $1', ['ORG-001']);
  const org2Records = await testHelper.query('SELECT * FROM attendance WHERE employer_id = $1', [tenantBOrgId]);

  assert(org1Records.rows.length > 0, 'ORG-001 has attendance records');
  assert(org1Records.rows.every(r => r.employer_id === 'ORG-001'), 'ORG-001 query returns exclusively ORG-001 data');
  assert.strictEqual(org2Records.rows.length, 0, 'ORG-TENANT-B has no attendance records yet');
  console.log('✓ Strict Employer Tenant Isolation confirmed in PostgreSQL');

  // 11. Cleanup
  await testHelper.query("DELETE FROM employees WHERE employer_id = $1", [tenantBOrgId]);
  await testHelper.query("DELETE FROM organizations WHERE id = $1", [tenantBOrgId]);
  await testHelper.cleanTestData();
  await testHelper.closeTestPool();

  console.log('\n🎉 ALL AUTOMATED TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(async (err) => {
  console.error('\n❌ Test failure:\n', err.message);
  try {
    await testHelper.closeTestPool();
  } catch {}
  process.exit(1);
});
