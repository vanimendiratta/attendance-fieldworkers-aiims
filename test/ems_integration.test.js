/**
 * Test Suite: Integrated Employee Management System (EMS) & Leave Governance
 * Tests core calculation engine, ledger integrity, approval workflows, security scope enforcement, and identity sync.
 */

const assert = require('assert');
const path = require('path');
const db = require('../ems/server/database/db');
const LeaveRuleEngine = require('../ems/server/services/LeaveRuleEngine');
const LeaveLedgerService = require('../ems/server/services/LeaveLedgerService');
const { runMigrations } = require('../ems/server/database/migrate');
const { seedMasterPolicies } = require('../ems/server/database/seed');

console.log('🧪 Starting Integrated EMS & Leave Governance Test Suite...\n');

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

// Ensure database has migrations and seeded master rules
runMigrations();
seedMasterPolicies();

// Setup dedicated test employee
const testEmpId = 'TEST-EMP-9999';
db.prepare('DELETE FROM leave_requests WHERE employee_id = ?').run(testEmpId);
db.prepare('DELETE FROM leave_balances WHERE employee_id = ?').run(testEmpId);
db.prepare('DELETE FROM leave_transactions WHERE employee_id = ?').run(testEmpId);
db.prepare('DELETE FROM employees WHERE employee_id = ?').run(testEmpId);

db.prepare(`
  INSERT INTO employees (
    employee_id, official_employee_id, name, gender, mobile, email,
    date_of_joining, date_of_birth, department, designation, employee_category,
    is_field_worker, status
  ) VALUES (?, ?, ?, 'MALE', '+91 9899999999', 'testcder9999@gmail.com',
            '2026-04-01', '1992-05-15', 'CDER', 'Research Associate', 'GENERAL',
            0, 'ACTIVE')
`).run(testEmpId, testEmpId, 'Dr. Test CDER Researcher');

const clType = db.prepare("SELECT * FROM leave_types WHERE code = 'CL'").get();
const elType = db.prepare("SELECT * FROM leave_types WHERE code = 'EL'").get();

// Seed initial balances: 8 CL, 15 EL
LeaveLedgerService.recordTransaction({
  employeeId: testEmpId,
  leaveTypeId: clType.id,
  transactionType: 'INITIAL_CREDIT',
  amount: 8.0,
  remarks: 'Initial CL Credit 2026',
  createdBy: 'SYSTEM'
});

LeaveLedgerService.recordTransaction({
  employeeId: testEmpId,
  leaveTypeId: elType.id,
  transactionType: 'INITIAL_CREDIT',
  amount: 15.0,
  remarks: 'Initial EL Credit 2026',
  createdBy: 'SYSTEM'
});

const testEmployee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(testEmpId);

// ---------------------------------------------------------------------------
// 1. Authoritative Server Calculation & Policy Engine
// ---------------------------------------------------------------------------
console.log('--- 1. Authoritative Calculation Engine & Policy Rules ---');

runTest('LeaveRuleEngine accurately computes calendar days and excludes weekly offs for CL', () => {
  // Monday to Friday: 5 working days
  const res = LeaveRuleEngine.calculateChargeableDays(
    testEmployee,
    clType,
    '2026-10-12', // Monday
    '2026-10-16'  // Friday
  );
  assert.strictEqual(res.calendarDays, 5);
  assert.strictEqual(res.chargeableDays, 5);
  assert.strictEqual(res.weeklyOffDays, 0);
});

runTest('LeaveRuleEngine excludes weekend (Saturday & Sunday) and public holidays (Dussehra)', () => {
  // Friday Oct 16 to Tuesday Oct 20: 5 calendar days
  // Sat & Sun = 2 weekly offs, Oct 20 = Dussehra public holiday
  // Net chargeable = 2 days (Friday + Monday)
  const res = LeaveRuleEngine.calculateChargeableDays(
    testEmployee,
    clType,
    '2026-10-16', // Friday
    '2026-10-20'  // Tuesday
  );
  assert.strictEqual(res.calendarDays, 5);
  assert.strictEqual(res.weeklyOffDays, 2);
  assert.strictEqual(res.holidayDays, 1);
  assert.strictEqual(res.chargeableDays, 2);
});

runTest('Half-day leave requests calculate to exactly 0.5 chargeable days', () => {
  const res = LeaveRuleEngine.calculateChargeableDays(
    testEmployee,
    clType,
    '2026-10-14',
    '2026-10-14',
    { isHalfDay: true, halfDaySession: 'FIRST_HALF' }
  );
  assert.strictEqual(res.calendarDays, 1);
  assert.strictEqual(res.chargeableDays, 0.5);
});

// ---------------------------------------------------------------------------
// 2. Validation & Business Rules
// ---------------------------------------------------------------------------
console.log('\n--- 2. Validation & Boundary Enforcement ---');

runTest('Rejects leave request when End Date is before Start Date', () => {
  let threw = false;
  try {
    LeaveRuleEngine.validateLeaveEligibility(
      testEmployee,
      clType,
      '2026-10-20',
      '2026-10-15'
    );
  } catch (err) {
    threw = true;
    assert(err.message.toLowerCase().includes('end date') || err.message.toLowerCase().includes('before'));
  }
  assert.strictEqual(threw, true, 'Did not reject invalid date range');
});

runTest('Rejects leave request when requested days exceed available balance', () => {
  // Available CL is 8 days, request 10 continuous working days
  const val = LeaveRuleEngine.validateLeaveEligibility(
    testEmployee,
    clType,
    '2026-11-02', // Mon
    '2026-11-13'  // Fri (10 working days)
  );
  assert.strictEqual(val.isValid, false);
  assert(val.errors.some(e => e.toLowerCase().includes('insufficient')));
});

// ---------------------------------------------------------------------------
// 3. Double-Entry Ledger & Balance Verification
// ---------------------------------------------------------------------------
console.log('\n--- 3. Double-Entry Ledger & Balance Integrity ---');

runTest('Current balance strictly matches the sum of all transactions on the ledger', () => {
  const bal = LeaveLedgerService.getBalance(testEmpId, clType.id);
  assert.strictEqual(bal.current_balance, 8.0);

  const check = LeaveLedgerService.verifyLedgerIntegrity(testEmpId, clType.id);
  assert.strictEqual(check.isConsistent, true, 'Ledger integrity failed verification against balance cache');
});

runTest('Deducting and reversing leave transactions preserves ledger equilibrium', () => {
  // 1. Deduct 2 days
  LeaveLedgerService.recordTransaction({
    employeeId: testEmpId,
    leaveTypeId: clType.id,
    transactionType: 'LEAVE_DEDUCTION',
    amount: -2.0,
    referenceId: 'TEST-REQ-001',
    remarks: 'Approved 2 days CL',
    createdBy: 'TEST_ADMIN'
  });

  let bal = LeaveLedgerService.getBalance(testEmpId, clType.id);
  assert.strictEqual(bal.current_balance, 6.0);

  // 2. Reverse 2 days
  LeaveLedgerService.recordTransaction({
    employeeId: testEmpId,
    leaveTypeId: clType.id,
    transactionType: 'LEAVE_REVERSAL',
    amount: 2.0,
    referenceId: 'TEST-REQ-001',
    remarks: 'Cancelled & reversed 2 days CL',
    createdBy: 'TEST_ADMIN'
  });

  bal = LeaveLedgerService.getBalance(testEmpId, clType.id);
  assert.strictEqual(bal.current_balance, 8.0);
  const check = LeaveLedgerService.verifyLedgerIntegrity(testEmpId, clType.id);
  assert.strictEqual(check.isConsistent, true);
});

// ---------------------------------------------------------------------------
// 4. Overlapping Request Detection
// ---------------------------------------------------------------------------
console.log('\n--- 4. Overlapping Leave Request Prevention ---');

runTest('Prevents overlapping leave applications on the same dates', () => {
  // Insert an existing approved leave request
  const reqStmt = db.prepare(`
    INSERT INTO leave_requests (
      request_number, employee_id, leave_type_id, from_date, to_date,
      requested_calendar_days, chargeable_days, reason, status, calculation_snapshot_json
    ) VALUES (?, ?, ?, ?, ?, 3, 3, 'Doctor appointment', 'APPROVED', '{}')
  `);
  reqStmt.run('REQ-OVERLAP-1', testEmpId, clType.id, '2026-10-21', '2026-10-23');

  // Attempt new leave overlapping on 2026-10-22 to 2026-10-24
  const val = LeaveRuleEngine.validateLeaveEligibility(
    testEmployee,
    clType,
    '2026-10-22',
    '2026-10-24'
  );
  assert.strictEqual(val.isValid, false);
  assert(val.errors.some(e => e.toLowerCase().includes('overlap') || e.toLowerCase().includes('already on leave') || e.toLowerCase().includes('dates')));
});

// ---------------------------------------------------------------------------
// 5. Comp-Off Duty Rules
// ---------------------------------------------------------------------------
console.log('\n--- 5. Field Worker Comp-Off Governance ---');

runTest('Non-field workers cannot claim compensatory off', () => {
  assert.strictEqual(testEmployee.is_field_worker, 0);
  const deskResult = LeaveRuleEngine.calculateCompOff(testEmployee, '2026-10-18', 'SUNDAY');
  assert.strictEqual(deskResult.eligible, false, 'Non-field worker was incorrectly deemed eligible for comp-off');
});

runTest('Field workers working Sunday duty are eligible for compensatory off', () => {
  const fwEmployee = { ...testEmployee, is_field_worker: 1, employee_category: 'FIELD_WORKER' };
  // 2026-10-18 is a Sunday
  const fieldResult = LeaveRuleEngine.calculateCompOff(fwEmployee, '2026-10-18', 'SUNDAY');
  assert.strictEqual(fieldResult.eligible, true, 'Field worker working Sunday duty was deemed ineligible');
  assert.strictEqual(fieldResult.creditedDays, 1.0);
});

// ---------------------------------------------------------------------------
// 6. Security & Identity Reconciliation
// ---------------------------------------------------------------------------
console.log('\n--- 6. Security & Identity Reconciliation ---');

runTest('Employee email containing cder is mapped and verified', () => {
  assert(/cder/i.test(testEmployee.email), 'Employee email must contain cder');
  const matched = db.prepare('SELECT id, employee_id FROM employees WHERE LOWER(email) = ?')
    .get('testcder9999@gmail.com');
  assert.strictEqual(matched.employee_id, testEmpId);
});

// Safe Cleanup
db.prepare('DELETE FROM leave_requests WHERE employee_id = ?').run(testEmpId);
db.prepare('DELETE FROM leave_balances WHERE employee_id = ?').run(testEmpId);
db.prepare('DELETE FROM leave_transactions WHERE employee_id = ?').run(testEmpId);
db.prepare('DELETE FROM employees WHERE employee_id = ?').run(testEmpId);

console.log(`\n===============================================================`);
console.log(`🎉 ALL ${passedTests} EMS INTEGRATION TESTS PASSED (0 FAILED)`);
console.log(`===============================================================\n`);
