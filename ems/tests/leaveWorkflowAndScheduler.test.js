// tests/leaveWorkflowAndScheduler.test.js
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const { runMigrations } = require('../server/database/migrate');
const { seedDatabase } = require('../server/database/seed');
const LeaveRuleEngine = require('../server/services/LeaveRuleEngine');
const LeaveLedgerService = require('../server/services/LeaveLedgerService');
const LeaveCreditScheduler = require('../server/services/LeaveCreditScheduler');

test.before(() => {
  runMigrations();
  seedDatabase();
});

test('Leave Request Workflow - Insufficient Balance Validation', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();
  const empId = 'EMP_LOW_BAL';

  db.prepare(`
    INSERT OR IGNORE INTO employees (employee_id, name, gender, mobile, email, date_of_joining, date_of_birth, designation)
    VALUES (?, 'Low Balance', 'FEMALE', '9888888888', 'lowbal@test.gov.in', '2024-01-01', '1992-05-15', 'Associate')
  `).run(empId);

  // Credit 1 day only
  LeaveLedgerService.recordTransaction({
    employeeId: empId,
    leaveTypeId: clType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 1.0,
    remarks: 'Limited credit'
  });

  const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(empId);

  // Attempt 3 days leave (Tuesday to Thursday)
  const validation = LeaveRuleEngine.validateLeaveEligibility(employee, clType, '2026-06-02', '2026-06-04');
  assert.equal(validation.isValid, false);
  assert.match(validation.errors[0], /Insufficient leave balance/);
});

test('Leave Request Workflow - Overlapping Dates Prevention', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();
  const empId = 'EMP_OVERLAP';

  db.prepare(`
    INSERT OR IGNORE INTO employees (employee_id, name, gender, mobile, email, date_of_joining, date_of_birth, designation)
    VALUES (?, 'Overlap Employee', 'MALE', '9777777777', 'overlap@test.gov.in', '2024-01-01', '1991-03-20', 'Analyst')
  `).run(empId);

  LeaveLedgerService.recordTransaction({
    employeeId: empId,
    leaveTypeId: clType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 8.0,
    remarks: 'Full year'
  });

  const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(empId);

  // Insert existing approved request from 2026-08-10 to 2026-08-12
  db.prepare(`
    INSERT INTO leave_requests (
      request_number, employee_id, leave_type_id, from_date, to_date,
      requested_calendar_days, chargeable_days, reason, status, calculation_snapshot_json
    ) VALUES ('LR-TEST-001', ?, ?, '2026-08-10', '2026-08-12', 3, 3, 'Medical checkup', 'APPROVED', '{}')
  `).run(empId, clType.id);

  // Try to submit overlapping request: 2026-08-11 to 2026-08-13
  const validation = LeaveRuleEngine.validateLeaveEligibility(employee, clType, '2026-08-11', '2026-08-13');
  assert.equal(validation.isValid, false);
  assert.match(validation.errors[0], /conflict with existing request/);
});

test('Credit Scheduler - Strict Idempotency (cannot credit same cycle twice)', () => {
  const elSchedule = db.prepare(`SELECT id, schedule_name FROM leave_credit_schedules WHERE schedule_name LIKE '%EL Half-Yearly%' LIMIT 1`).get();
  assert.ok(elSchedule, 'EL credit schedule must exist in database');

  const customCycleKey = 'EL_TEST_CYCLE_2026_01_01';

  // First run: executes successfully
  const result1 = LeaveCreditScheduler.processSchedule(elSchedule.id, new Date('2026-01-01'), { customCycleKey });
  assert.equal(result1.alreadyExecuted, false);
  assert.equal(result1.success, true);

  // Second run: detected as already executed, does NOT duplicate credit!
  const result2 = LeaveCreditScheduler.processSchedule(elSchedule.id, new Date('2026-01-01'), { customCycleKey });
  assert.equal(result2.alreadyExecuted, true);
  assert.match(result2.message, /already been executed/);
});

test('Sandwich Rule - Configurable Intervening Day Chargeability', () => {
  const elType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'EL'`).get();

  const employee = {
    employee_id: 'EMP_SANDWICH',
    name: 'Sandwich Tester',
    date_of_joining: '2024-01-01',
    employee_category: 'GENERAL',
    department: 'General',
    location: 'ALL',
    is_field_worker: 0
  };

  // Period: Friday (2026-09-04) to Monday (2026-09-07)
  // Calendar days: 4 (Fri, Sat, Sun, Mon). Sat & Sun are 2 weekly offs.
  // Case A: With sandwich rule disabled or not charging intervening days:
  // Chargeable days = 2 (Friday + Monday).
  const calcNormal = LeaveRuleEngine.calculateChargeableDays(employee, elType, '2026-09-04', '2026-09-07');
  assert.equal(calcNormal.calendarDays, 4);
  assert.equal(calcNormal.weeklyOffDays, 2);
  assert.equal(calcNormal.chargeableDays, 2.0);

  // Case B: Enable sandwich rule charging in DB for EL
  const sandwichRule = db.prepare(`SELECT id FROM sandwich_rules LIMIT 1`).get();
  db.prepare(`
    UPDATE sandwich_rules 
    SET applicable_leave_types_json = '["EL"]', charge_intervening_days = 1, is_active = 1
    WHERE id = ?
  `).run(sandwichRule.id);

  // Now, calculateChargeableDays re-evaluates sandwich rule from DB:
  const calcSandwich = LeaveRuleEngine.calculateChargeableDays(employee, elType, '2026-09-04', '2026-09-07');
  assert.equal(calcSandwich.calendarDays, 4);
  assert.equal(calcSandwich.chargeableDays, 4.0); // Sat and Sun charged under Sandwich Rule!
  assert.equal(calcSandwich.sandwichDays, 2.0);

  // Restore rule
  db.prepare(`UPDATE sandwich_rules SET charge_intervening_days = 0 WHERE id = ?`).run(sandwichRule.id);
});
