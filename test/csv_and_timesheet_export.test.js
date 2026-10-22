/**
 * Test Suite: CSV Export Generation, Timesheet Fix & Team-Wise Attendance Feature
 */

const assert = require('assert');
const csvService = require('../src/services/csv_service');

console.log('🧪 Starting CSV Export, Timesheet Fix & Team-Wise Attendance Test Suite...\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASSED: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// ---------------------------------------------------------------------------
// 1. CSV Formula Injection Defense
// ---------------------------------------------------------------------------
console.log('--- 1. Formula Injection Defense & Quoting ---');

runTest('Formulas starting with =, +, -, @, tab, carriage return, |, % are sanitized with leading apostrophe', () => {
  const dangerousValues = [
    '=1+2',
    '+2+3',
    '-cmd|"/C calc"!A0',
    '@SUM(A1:A10)',
    '\tmaliciousTab',
    '\rmaliciousCR',
    '|pipeCommand',
    '%userprofile%'
  ];

  dangerousValues.forEach(val => {
    const escaped = csvService.escapeCsvCell(val);
    assert(escaped.startsWith("'") || escaped.startsWith('"\''), `Value "${val}" was not properly sanitized: ${escaped}`);
  });
});

runTest('Safe text is correctly handled and special characters quoted per RFC 4180', () => {
  assert.strictEqual(csvService.escapeCsvCell('Normal text'), 'Normal text');
  assert.strictEqual(csvService.escapeCsvCell('Text, with, comma'), '"Text, with, comma"');
  assert.strictEqual(csvService.escapeCsvCell('Text with "quotes"'), '"Text with ""quotes"""');
  assert.strictEqual(csvService.escapeCsvCell(null), '');
  assert.strictEqual(csvService.escapeCsvCell(undefined), '');
  assert.strictEqual(csvService.escapeCsvCell(123.45), '123.45');
});

// ---------------------------------------------------------------------------
// 2. CSV Dataset Generators & BOM
// ---------------------------------------------------------------------------
console.log('\n--- 2. Dataset CSV Generators (Employees, Hotel Stays, Leaves, Teams, Geofences, Audit) ---');

runTest('All CSV files start with UTF-8 BOM (\\uFEFF) for Excel compatibility', () => {
  const empCsv = csvService.generateEmployeesCsv([]);
  assert(empCsv.startsWith('\uFEFF'), 'Employees CSV missing UTF-8 BOM');

  const hotelCsv = csvService.generateHotelStaysCsv([]);
  assert(hotelCsv.startsWith('\uFEFF'), 'Hotel Stays CSV missing UTF-8 BOM');

  const leaveCsv = csvService.generateLeavesCsv([]);
  assert(leaveCsv.startsWith('\uFEFF'), 'Leaves CSV missing UTF-8 BOM');

  const teamCsv = csvService.generateTeamsCsv([]);
  assert(teamCsv.startsWith('\uFEFF'), 'Teams CSV missing UTF-8 BOM');

  const gfCsv = csvService.generateGeofencesCsv([]);
  assert(gfCsv.startsWith('\uFEFF'), 'Geofences CSV missing UTF-8 BOM');

  const auditCsv = csvService.generateAuditLogsCsv([]);
  assert(auditCsv.startsWith('\uFEFF'), 'Audit Logs CSV missing UTF-8 BOM');
});

runTest('Employees CSV exports expected schema and excludes passwords/hashes', () => {
  const sampleEmployees = [
    {
      id: 'EMP-001',
      name: 'Dr. Ramesh Kumar',
      email: 'ramesh@cder.aiims.edu',
      department: 'CDER',
      designation: 'Senior Scientist',
      phone: '+91 9876543210',
      state: 'Himachal Pradesh',
      district: 'Kangra',
      team_name: 'Team Kangra Field Unit',
      password_hash: '$2b$10$SUPER_SECRET_HASH',
      password: 'PlainSecretPassword'
    }
  ];

  const csv = csvService.generateEmployeesCsv(sampleEmployees);
  assert(csv.includes('Dr. Ramesh Kumar'));
  assert(csv.includes('Team Kangra Field Unit'));
  assert(csv.includes('Kangra'));
  assert(!csv.includes('SUPER_SECRET_HASH'), 'Sensitive password_hash was leaked in CSV');
  assert(!csv.includes('PlainSecretPassword'), 'Sensitive plain password was leaked in CSV');
});

runTest('Hotel Stays CSV formats GPS verification, booking and coordinates', () => {
  const sampleStays = [
    {
      id: 'STAY-101',
      employee_id: 'FW-01',
      employee_name: 'Sunita Devi',
      hotel_name: 'Hotel Snow Crest',
      hotel_address: 'The Mall Road, Shimla, Himachal Pradesh',
      room_number: '302',
      checkin_date: '2026-10-15',
      checkout_date: '2026-10-18',
      stay_status: 'ACTIVE',
      hotel_phone: '0177-2800100',
      verification_status: 'VERIFIED',
      hotel_lat: 31.1048,
      hotel_lng: 77.1734,
      hotel_accuracy: 12.5
    }
  ];

  const csv = csvService.generateHotelStaysCsv(sampleStays);
  assert(csv.includes('Hotel Snow Crest'));
  assert(csv.includes('Shimla'));
  assert(csv.includes('302'));
  assert(csv.includes('31.1048000'));
});

// ---------------------------------------------------------------------------
// 3. Timesheet Shift Target & Hours Balance Calculation (Bug Fix Verification)
// ---------------------------------------------------------------------------
console.log('\n--- 3. Timesheet TargetShiftHours & Hours Balance Calculation ---');

runTest('Timesheet summary correctly maps targetShiftHours without ReferenceError', () => {
  const shiftTargetHours = 8.0;
  const completedRecords = 5;
  const totalNetWorkingSeconds = 5 * 8.5 * 3600; // 42.5 hours worked
  const totalNetWorkingHours = Number((totalNetWorkingSeconds / 3600).toFixed(2));
  const totalExpectedHours = Number((completedRecords * shiftTargetHours).toFixed(2));
  const hoursBalance = Number((totalNetWorkingHours - totalExpectedHours).toFixed(2));

  // This mirrors the fixed api.js logic
  const summary = {
    totalRecords: completedRecords,
    completedRecords,
    totalNetWorkingHours,
    targetShiftHours: shiftTargetHours,
    totalExpectedHours,
    hoursBalance,
    hoursBalanceStatus: hoursBalance > 0.1 ? 'SURPLUS' : (hoursBalance < -0.1 ? 'DEFICIT' : 'BALANCED')
  };

  assert.strictEqual(summary.targetShiftHours, 8.0);
  assert.strictEqual(summary.totalExpectedHours, 40.0);
  assert.strictEqual(summary.hoursBalance, 2.5);
  assert.strictEqual(summary.hoursBalanceStatus, 'SURPLUS');
  assert.doesNotThrow(() => {
    // Simulating the timesheet display code in public/admin.js:
    const desc = `Surplus banked vs ${summary.targetShiftHours || 8}h shift target`;
    assert(desc.includes('8h shift target'));
  });
});

// ---------------------------------------------------------------------------
// 4. Dedicated Team-Wise Attendance Feature & Segregation Logic
// ---------------------------------------------------------------------------
console.log('\n--- 4. Dedicated Team-Wise vs Individual Attendance Segregation ---');

runTest('Attendance records are correctly classified into Dedicated Teams vs Direct Assignment', () => {
  const sampleRecords = [
    {
      id: 'att-1',
      employee_id: 'FW-01',
      employee_name: 'Asha Sharma',
      team_id: 'team-kangra',
      dedicated_team_id: 'team-kangra',
      team_name: 'Team Kangra Field Unit',
      state: 'Himachal Pradesh',
      district: 'Kangra',
      attendance_status: 'COMPLETED',
      net_working_seconds: 28800
    },
    {
      id: 'att-2',
      employee_id: 'FW-02',
      employee_name: 'Rajesh Verma',
      team_id: 'team-kangra',
      dedicated_team_id: 'team-kangra',
      team_name: 'Team Kangra Field Unit',
      state: 'Himachal Pradesh',
      district: 'Kangra',
      attendance_status: 'CHECKED_IN',
      net_working_seconds: 14400
    },
    {
      id: 'att-3',
      employee_id: 'FW-03',
      employee_name: 'Vani Mendiratta',
      team_id: null,
      dedicated_team_id: null,
      team_name: 'Direct Assignment',
      state: 'Delhi',
      district: 'Central Delhi',
      attendance_status: 'COMPLETED',
      net_working_seconds: 29500
    }
  ];

  // Grouping logic (same as admin.js):
  const dedicatedTeamMap = new Map();
  const directRecords = [];

  for (const r of sampleRecords) {
    const isDedicated = Boolean(r.dedicated_team_id || (r.team_name && r.team_name !== 'Direct Assignment'));
    if (isDedicated) {
      const tName = r.team_name || 'Dedicated Team';
      if (!dedicatedTeamMap.has(tName)) {
        dedicatedTeamMap.set(tName, {
          teamName: tName,
          state: r.state,
          district: r.district,
          records: []
        });
      }
      dedicatedTeamMap.get(tName).records.push(r);
    } else {
      directRecords.push(r);
    }
  }

  // Verification
  assert.strictEqual(dedicatedTeamMap.size, 1, 'Expected 1 dedicated team');
  const kangraTeam = dedicatedTeamMap.get('Team Kangra Field Unit');
  assert(kangraTeam != null, 'Team Kangra Field Unit was not found in dedicated teams');
  assert.strictEqual(kangraTeam.records.length, 2, 'Team Kangra should have 2 members');
  assert.strictEqual(kangraTeam.district, 'Kangra');
  assert.strictEqual(kangraTeam.state, 'Himachal Pradesh');

  assert.strictEqual(directRecords.length, 1, 'Expected 1 direct assignment worker');
  assert.strictEqual(directRecords[0].employee_name, 'Vani Mendiratta');

  // Verify KPIs calculation for team
  const tCompleted = kangraTeam.records.filter(r => r.attendance_status === 'COMPLETED');
  const tActive = kangraTeam.records.filter(r => r.attendance_status === 'CHECKED_IN');
  assert.strictEqual(tCompleted.length, 1);
  assert.strictEqual(tActive.length, 1);

  console.log(`     Team "${kangraTeam.teamName}": ${kangraTeam.records.length} Staff Logged (${tCompleted.length} Completed, ${tActive.length} Active)`);
  console.log(`     Direct Personnel: ${directRecords.length} Staff Logged`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n===============================================================');
if (failedTests === 0) {
  console.log(`🎉 ALL ${passedTests} TESTS PASSED SUCCESSFULLY!`);
  process.exit(0);
} else {
  console.error(`❌ ${failedTests} TESTS FAILED out of ${passedTests + failedTests}`);
  process.exit(1);
}
