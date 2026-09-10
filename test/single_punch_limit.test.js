/**
 * Automated Tests for Single Attendance Per Day Rule & No Checkout Without Checkin
 * 
 * Rules Verified:
 * 1. Without check-in, check-out cannot be done.
 * 2. In one day, one employee can only check in and check out for ONE single time.
 * 3. After completing check-out for the day, any further check-in on the same day is strictly blocked.
 */

const assert = require('assert');
const http = require('http');
const db = require('../src/db/database');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function createUniquePhotoDataUri(variant = 1) {
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
  const entropy = Buffer.from(`\n// salt_${Date.now()}_${Math.random()}_${variant}`);
  const combined = Buffer.concat([base, entropy]);
  return `data:image/png;base64,${combined.toString('base64')}`;
}

function apiRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runSinglePunchLimitTests() {
  console.log('\n===============================================================');
  console.log('🔒 TESTING SINGLE CHECK-IN / CHECK-OUT PER DAY & PRE-REQUISITE ENFORCEMENT');
  console.log('===============================================================\n');

  const testEmpId = 'EMP-1001';
  const testEmployerId = 'ORG-001';

  // Step 0: Ensure test employee exists and clean up prior attendance
  db.prepare(`
    INSERT INTO employees (id, employer_id, name, email, department, designation, password, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET employer_id=excluded.employer_id, department=excluded.department, designation=excluded.designation
  `).run(testEmpId, testEmployerId, 'Dental Officer Test', 'dental.field@aiims.edu', 'Dental', 'PRS-1', 'Password@123', new Date().toISOString());

  db.prepare("DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id = ?)").run(testEmpId);
  db.prepare("DELETE FROM attendance WHERE employee_id = ?").run(testEmpId);

  // Test 1: Checkout without check-in MUST be blocked
  console.log('1. Testing: Without check-in, check-out cannot be done...');
  const resCheckoutWithoutCheckin = await apiRequest('POST', '/api/attendance/check-out', {
    photo: createUniquePhotoDataUri(1),
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 10.0,
    client_timestamp: new Date().toISOString()
  }, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resCheckoutWithoutCheckin.status, 400, 'Expected 400 Bad Request');
  assert.ok(
    resCheckoutWithoutCheckin.data.error.includes('Without check-in, check-out cannot be done') ||
    resCheckoutWithoutCheckin.data.error.includes('check-in session found'),
    `Actual error: ${resCheckoutWithoutCheckin.data.error}`
  );
  console.log('   ✓ Blocked checkout attempt when employee was not checked in');

  // Test 2: Valid single check-in for the day
  console.log('2. Testing: First check-in of the day...');
  const resFirstCheckin = await apiRequest('POST', '/api/attendance/check-in', {
    photo: createUniquePhotoDataUri(2),
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 12.0,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `punch_first_${Date.now()}`,
    work_mode: 'OFFICE'
  }, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resFirstCheckin.status, 200, `First check-in failed: ${JSON.stringify(resFirstCheckin.data)}`);
  assert.strictEqual(resFirstCheckin.data.attendance.attendance_status, 'CHECKED_IN');
  console.log('   ✓ Successfully recorded single check-in for today');

  // Test 3: Attempting double check-in while already active
  console.log('3. Testing: Duplicate check-in while active MUST be blocked...');
  const resDoubleCheckin = await apiRequest('POST', '/api/attendance/check-in', {
    photo: createUniquePhotoDataUri(3),
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 12.0,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `punch_double_${Date.now()}`,
    work_mode: 'OFFICE'
  }, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resDoubleCheckin.status, 400);
  assert.ok(resDoubleCheckin.data.error.includes('already has an active check-in'));
  console.log('   ✓ Duplicate active check-in blocked');

  // Test 4: Check-out of the day
  console.log('4. Testing: Check-out of the single attendance session...');
  const resCheckout = await apiRequest('POST', '/api/attendance/check-out', {
    photo: createUniquePhotoDataUri(4),
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 11.5,
    client_timestamp: new Date().toISOString()
  }, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resCheckout.status, 200, `Checkout failed: ${JSON.stringify(resCheckout.data)}`);
  assert.strictEqual(resCheckout.data.attendance.attendance_status, 'COMPLETED');
  console.log('   ✓ Successfully completed check-out for today');

  // Test 5: Attempting check-out again after session completed
  console.log('5. Testing: Second check-out without new check-in MUST be blocked...');
  const resSecondCheckout = await apiRequest('POST', '/api/attendance/check-out', {
    photo: createUniquePhotoDataUri(5),
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 11.5,
    client_timestamp: new Date().toISOString()
  }, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resSecondCheckout.status, 400);
  assert.ok(
    resSecondCheckout.data.error.includes('Without check-in, check-out cannot be done') ||
    resSecondCheckout.data.error.includes('check-in session found')
  );
  console.log('   ✓ Second check-out blocked because no active session exists');

  // Test 6: Attempting a second check-in on the SAME day MUST be strictly blocked
  console.log('6. Testing: Second check-in on the same day MUST be strictly blocked...');
  const resSecondCheckinSameDay = await apiRequest('POST', '/api/attendance/check-in', {
    photo: createUniquePhotoDataUri(6),
    latitude: 28.5662,
    longitude: 77.2136,
    accuracy: 10.5,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `punch_second_day_${Date.now()}`,
    work_mode: 'OFFICE'
  }, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resSecondCheckinSameDay.status, 400, 'Second checkin on same day should return 400');
  assert.ok(
    resSecondCheckinSameDay.data.error.includes('Daily attendance limit reached') ||
    resSecondCheckinSameDay.data.error.includes('one single time'),
    `Actual error: ${resSecondCheckinSameDay.data.error}`
  );
  console.log('   ✓ Second check-in on same day strictly blocked: Daily single punch limit enforced');

  // Test 7: Verify /attendance/current reports SHIFT_COMPLETED_TODAY and alreadyCompletedToday: true
  console.log('7. Testing: Current status endpoint reports SHIFT_COMPLETED_TODAY...');
  const resCurrentStatus = await apiRequest('GET', `/api/attendance/current?employee_id=${testEmpId}`, null, {
    'x-employee-id': testEmpId,
    'x-employer-id': testEmployerId
  });

  assert.strictEqual(resCurrentStatus.status, 200);
  assert.strictEqual(resCurrentStatus.data.alreadyCompletedToday, true);
  assert.strictEqual(resCurrentStatus.data.status, 'SHIFT_COMPLETED_TODAY');
  assert.strictEqual(resCurrentStatus.data.hasActiveSession, false);
  console.log('   ✓ /attendance/current accurately flags alreadyCompletedToday = true');

  console.log('\n===============================================================');
  console.log('🎉 ALL SINGLE ATTENDANCE PER DAY & PRE-REQUISITE TESTS PASSED 100%!');
  console.log('===============================================================\n');
}

runSinglePunchLimitTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
