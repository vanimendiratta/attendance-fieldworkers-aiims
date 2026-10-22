// tests/auditAndDynamicRuleVerification.test.js
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const { runMigrations } = require('../server/database/migrate');
const { seedMasterPolicies } = require('../server/database/seed');
const LeaveRuleEngine = require('../server/services/LeaveRuleEngine');
const LeaveLedgerService = require('../server/services/LeaveLedgerService');
const LeaveCreditScheduler = require('../server/services/LeaveCreditScheduler');

test.before(() => {
  runMigrations();
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DELETE FROM credit_schedule_executions;
    DELETE FROM leave_request_status_history;
    DELETE FROM leave_requests;
    DELETE FROM leave_balances;
    DELETE FROM leave_transactions;
    DELETE FROM comp_off_records;
    DELETE FROM notifications;
    DELETE FROM audit_logs;
    DELETE FROM users;
    DELETE FROM employees;
  `);
  db.pragma('foreign_keys = ON');
  seedMasterPolicies();
});

test('Employee-Specific Rule Resolution - Employee A vs B vs C', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();
  const elType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'EL'`).get();

  // Employee A: DOJ 01-Jan, Field Worker: No
  const empA = {
    employee_id: 'AUDIT_EMP_A',
    name: 'Employee A',
    date_of_joining: '2026-01-01',
    employee_category: 'GENERAL',
    department: 'General',
    is_field_worker: 0
  };

  // Employee B: DOJ 15-Jul, Field Worker: No
  const empB = {
    employee_id: 'AUDIT_EMP_B',
    name: 'Employee B',
    date_of_joining: '2026-07-15',
    employee_category: 'GENERAL',
    department: 'General',
    is_field_worker: 0
  };

  // Employee C: DOJ 15-Jul, Field Worker: Yes
  const empC = {
    employee_id: 'AUDIT_EMP_C',
    name: 'Employee C',
    date_of_joining: '2026-07-15',
    employee_category: 'FIELD_WORKER',
    department: 'Field Operations',
    is_field_worker: 1
  };

  // 1. CL Initial Entitlement:
  // Employee A (Full Year) -> 8 days
  const clA = LeaveRuleEngine.calculateInitialCredit(empA, clType.id, new Date('2026-01-01'));
  assert.equal(clA.amount, 8.0, 'Full year employee A receives full annual entitlement');

  // Employee B (Joined 15-Jul, 6 remaining months in 2026 under PRO_RATA) -> (6/12)*8 = 4.0 days
  const clB = LeaveRuleEngine.calculateInitialCredit(empB, clType.id, new Date('2026-07-15'));
  assert.equal(clB.amount, 4.0, 'Mid-year employee B receives pro-rata 4.0 days');

  // Employee C (Joined 15-Jul, Field Worker) -> 4.0 days CL
  const clC = LeaveRuleEngine.calculateInitialCredit(empC, clType.id, new Date('2026-07-15'));
  assert.equal(clC.amount, 4.0);

  // 2. Comp-Off Eligibility:
  // Employee A (Not field worker) -> Ineligible
  const compOffA = LeaveRuleEngine.calculateCompOff(empA, '2026-08-02', 'SUNDAY');
  assert.equal(compOffA.eligible, false, 'Desk employee A cannot claim comp-off');

  // Employee B (Not field worker) -> Ineligible
  const compOffB = LeaveRuleEngine.calculateCompOff(empB, '2026-08-02', 'SUNDAY');
  assert.equal(compOffB.eligible, false, 'Desk employee B cannot claim comp-off');

  // Employee C (Field worker) -> Eligible for Comp-off
  const compOffC = LeaveRuleEngine.calculateCompOff(empC, '2026-08-02', 'SUNDAY');
  assert.equal(compOffC.eligible, true, 'Field worker C is eligible for comp-off');
  assert.equal(compOffC.creditedDays, 1.0);

  // 3. Weekly Off Exclusions:
  // For Employee A (General): Saturday (6) and Sunday (0) are weekly offs
  assert.equal(LeaveRuleEngine.isWeeklyOff('2026-05-09', empA), true, 'Saturday is weekly off for General staff');
  assert.equal(LeaveRuleEngine.isWeeklyOff('2026-05-10', empA), true, 'Sunday is weekly off for General staff');

  // For Employee C (Field worker): Saturday is a working day, Sunday is weekly off
  assert.equal(LeaveRuleEngine.isWeeklyOff('2026-05-09', empC), false, 'Saturday is working day for Field staff');
  assert.equal(LeaveRuleEngine.isWeeklyOff('2026-05-10', empC), true, 'Sunday is weekly off for Field staff');
});

test('Date of Joining Calculations Across Distinct Policy Treatments', () => {
  const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
  const clRule = db.prepare(`SELECT id FROM leave_rules WHERE leave_type_id = ?`).get(clType.id);

  const testDOJs = [
    { doj: '2026-01-01', month: 1, day: 1 },
    { doj: '2026-01-31', month: 1, day: 31 },
    { doj: '2026-07-01', month: 7, day: 1 },
    { doj: '2026-07-15', month: 7, day: 15 },
    { doj: '2026-12-31', month: 12, day: 31 }
  ];

  // Case 1: Database configured as FULL_CREDIT
  const vFull = {
    annual_entitlement: 8.0,
    mid_year_treatment: 'FULL_CREDIT'
  };
  const vFullId = db.prepare(`
    INSERT INTO leave_rule_versions (leave_rule_id, version_number, effective_from, status, config_json, created_by)
    VALUES (?, (SELECT COALESCE(MAX(version_number),0)+1 FROM leave_rule_versions WHERE leave_rule_id = ?), '2026-01-01', 'ACTIVE', ?, 'TEST')
  `).run(clRule.id, clRule.id, JSON.stringify(vFull)).lastInsertRowid;

  testDOJs.forEach(({ doj }) => {
    const emp = { employee_id: 'DOJ_TEST', date_of_joining: doj, employee_category: 'GENERAL' };
    const res = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, new Date(doj));
    assert.equal(res.amount, 8.0, `FULL_CREDIT policy must award 8 days regardless of mid-year date (${doj})`);
  });

  // Case 2: Database configured as NOT_APPLICABLE
  const vNone = {
    annual_entitlement: 8.0,
    mid_year_treatment: 'NOT_APPLICABLE'
  };
  db.prepare(`UPDATE leave_rule_versions SET config_json = ? WHERE id = ?`).run(JSON.stringify(vNone), vFullId);

  // For 1 Jan (Full year), still receives annual entitlement
  const resJan1 = LeaveRuleEngine.calculateInitialCredit({ date_of_joining: '2025-01-01', employee_category: 'GENERAL' }, clType.id, new Date('2026-01-01'));
  assert.equal(resJan1.amount, 8.0);

  // For mid-year dates (e.g. 15 Jul), NOT_APPLICABLE yields 0
  const resJul15 = LeaveRuleEngine.calculateInitialCredit({ date_of_joining: '2026-07-15', employee_category: 'GENERAL' }, clType.id, new Date('2026-07-15'));
  assert.equal(resJul15.amount, 0, 'NOT_APPLICABLE policy must award 0 for mid-year joiner');

  // Case 3: Database configured as DEPARTMENTAL_DISCRETION
  const vDisc = {
    annual_entitlement: 8.0,
    mid_year_treatment: 'DEPARTMENTAL_DISCRETION'
  };
  db.prepare(`UPDATE leave_rule_versions SET config_json = ? WHERE id = ?`).run(JSON.stringify(vDisc), vFullId);

  const resDisc = LeaveRuleEngine.calculateInitialCredit({ date_of_joining: '2026-07-15', employee_category: 'GENERAL' }, clType.id, new Date('2026-07-15'));
  assert.equal(resDisc.amount, 0);
  assert.equal(resDisc.requiresManualAction, true);
  assert.equal(resDisc.formula, 'DEPARTMENTAL_DISCRETION');

  // Clean up test version
  db.prepare(`DELETE FROM leave_rule_versions WHERE id = ?`).run(vFullId);
});

test('Dynamic Rules Verification - Entitlement, Max Continuous, and Holiday Exclusions', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();
  const clRule = db.prepare(`SELECT id FROM leave_rules WHERE leave_type_id = ?`).get(clType.id);

  const emp = {
    employee_id: 'EMP_DYNAMIC_TEST',
    name: 'Dynamic Policy Test',
    date_of_joining: '2026-01-01',
    employee_category: 'GENERAL',
    department: 'General',
    location: 'ALL',
    is_field_worker: 0,
    status: 'ACTIVE'
  };

  db.prepare(`
    INSERT OR IGNORE INTO employees (employee_id, name, gender, mobile, email, date_of_joining, date_of_birth, designation, status)
    VALUES (?, 'Dynamic Policy Test', 'MALE', '9999999999', 'dynamic@test.gov.in', '2026-01-01', '1990-01-01', 'Staff', 'ACTIVE')
  `).run(emp.employee_id);

  // Credit enough balance (20 days) so balance is not the limiting factor
  LeaveLedgerService.recordTransaction({
    employeeId: emp.employee_id,
    leaveTypeId: clType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 20.0,
    remarks: 'Test balance'
  });

  // 1. Initial State: Max continuous days = 5. A 6-day request must be rejected.
  const valReject = LeaveRuleEngine.validateLeaveEligibility(emp, clType, '2026-06-01', '2026-06-08'); // Mon to Mon minus weekend = 6 days
  // 6 chargeable days exceeds max_continuous_days = 5
  assert.equal(valReject.isValid, false);
  assert.match(valReject.errors[0], /maximum of 5 continuous days/);

  // 2. Organization changes rule in database: updates active version to max_continuous_days = 8
  const currentVer = db.prepare(`SELECT id, config_json FROM leave_rule_versions WHERE leave_rule_id = ? AND status = 'ACTIVE' LIMIT 1`).get(clRule.id);
  const cfg = JSON.parse(currentVer.config_json);
  cfg.max_continuous_days = 8.0;
  db.prepare(`UPDATE leave_rule_versions SET config_json = ? WHERE id = ?`).run(JSON.stringify(cfg), currentVer.id);

  // 3. Re-run validation without code change: now valid!
  const valAccept = LeaveRuleEngine.validateLeaveEligibility(emp, clType, '2026-06-01', '2026-06-08');
  assert.equal(valAccept.isValid, true, 'Increasing max_continuous_days in database immediately permits request');

  // 4. Dynamically insert a new Holiday in the database:
  // Let 2026-06-03 (Wednesday) be declared a Special Holiday
  const insertHol = db.prepare(`
    INSERT INTO holidays (holiday_date, holiday_name, holiday_type, location, department, applicable_category, is_active)
    VALUES ('2026-06-03', 'Special Administrative Holiday', 'PUBLIC', 'ALL', 'ALL', 'ALL', 1)
  `).run();

  // Re-calculate chargeable days: Wednesday is now excluded from deduction automatically!
  const calcWithHoliday = LeaveRuleEngine.calculateChargeableDays(emp, clType, '2026-06-01', '2026-06-08');
  assert.equal(calcWithHoliday.holidayDays, 1, 'New holiday in DB is automatically recognized and excluded');
  assert.equal(calcWithHoliday.chargeableDays, 5.0, 'Chargeable days decreased from 6 to 5 due to new DB holiday');

  // Restore rule config and remove test holiday
  cfg.max_continuous_days = 5.0;
  db.prepare(`UPDATE leave_rule_versions SET config_json = ? WHERE id = ?`).run(JSON.stringify(cfg), currentVer.id);
  db.prepare(`DELETE FROM holidays WHERE id = ?`).run(insertHol.lastInsertRowid);
});

test('Leave Ledger Integrity - Total Transactions Sum Exactly Matches Cached Balance', () => {
  const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
  const empId = 'AUDIT_INTEGRITY_EMP';

  db.prepare(`
    INSERT INTO employees (employee_id, name, gender, mobile, email, date_of_joining, date_of_birth, designation)
    VALUES (?, 'Integrity Emp', 'MALE', '9898989898', 'integrity@ems.gov.in', '2026-01-01', '1990-01-01', 'Auditor')
  `).run(empId);

  // Execute a sequence of transactions
  LeaveLedgerService.recordTransaction({ employeeId: empId, leaveTypeId: clType.id, transactionType: 'INITIAL_CREDIT', amount: 8.0, remarks: 'Opening' });
  LeaveLedgerService.recordTransaction({ employeeId: empId, leaveTypeId: clType.id, transactionType: 'LEAVE_DEDUCTION', amount: -2.5, remarks: 'Leave taken' });
  LeaveLedgerService.recordTransaction({ employeeId: empId, leaveTypeId: clType.id, transactionType: 'ADMIN_ADJUSTMENT', amount: 1.0, remarks: 'Reconciliation' });
  LeaveLedgerService.recordTransaction({ employeeId: empId, leaveTypeId: clType.id, transactionType: 'LEAVE_REVERSAL', amount: 0.5, remarks: 'Partial return' });

  // Verify integrity
  const check = LeaveLedgerService.verifyLedgerIntegrity(empId, clType.id);
  assert.equal(check.isConsistent, true);
  assert.equal(check.calculatedSum, 7.0);
  assert.equal(check.cachedBalance, 7.0);
});

test('Dynamic Field Worker Toggle - Doctors Returning to Hospital Duty Disables Comp-Off Dynamically', () => {
  const doctorEmpId = 'DOC_FIELD_TOGGLE_TEST';
  
  // 1. Create doctor initially active on Field Duty from 2026-05-01
  db.prepare(`
    INSERT INTO employees (
      employee_id, name, gender, mobile, email,
      date_of_joining, date_of_birth, department, designation,
      employee_category, is_field_worker, field_worker_effective_date, status
    ) VALUES (?, 'Dr. Sunita Rao', 'FEMALE', '9811223344', 'sunita.rao@ems.gov.in',
      '2025-01-01', '1985-05-15', 'Field Epidemiology', 'Senior Medical Officer',
      'FIELD_WORKER', 1, '2026-05-01', 'ACTIVE')
  `).run(doctorEmpId);

  // Record initial period in history: Field Duty from 2026-05-01 to 2026-05-20
  db.prepare(`
    INSERT INTO employee_field_status_history (employee_id, is_field_worker, effective_from, effective_to, remarks)
    VALUES (?, 1, '2026-05-01', '2026-05-20', 'Assigned to field outbreak unit')
  `).run(doctorEmpId);

  let doc = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(doctorEmpId);

  // 2. Work done on Sunday 2026-05-17 (during field duty period) -> Comp-Off IS provided
  const fieldEligible = LeaveRuleEngine.calculateCompOff(doc, '2026-05-17', 'SUNDAY');
  assert.equal(fieldEligible.eligible, true, 'Doctor on field duty on 2026-05-17 is eligible for Comp-Off');
  assert.equal(fieldEligible.creditedDays, 1.0);

  // 3. Field project finishes on 2026-05-20: Doctor returns to Hospital Duty on 2026-05-21
  // Admin marks Field Worker as NO effective from 2026-05-21
  db.prepare(`
    INSERT INTO employee_field_status_history (employee_id, is_field_worker, effective_from, effective_to, remarks)
    VALUES (?, 0, '2026-05-21', NULL, 'Field project finished, returned to hospital clinic')
  `).run(doctorEmpId);
  db.prepare(`UPDATE employees SET is_field_worker = 0, field_worker_effective_date = '2026-05-21' WHERE employee_id = ?`).run(doctorEmpId);
  doc = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(doctorEmpId);
  assert.equal(doc.is_field_worker, 0);

  // 4. Doctor works Sunday 2026-05-24 at the hospital (after return date 2026-05-21) -> Comp-Off strictly NOT provided
  const hospitalDenied = LeaveRuleEngine.calculateCompOff(doc, '2026-05-24', 'SUNDAY');
  assert.equal(hospitalDenied.eligible, false, 'Comp-off is strictly denied for duty performed after returning to hospital');
  assert.match(hospitalDenied.reason, /Hospital \/ Desk Duty/);

  // 5. Even when submitted later, duty performed on 2026-05-10 (while in the field) remains eligible!
  const pastFieldDuty = LeaveRuleEngine.calculateCompOff(doc, '2026-05-10', 'SUNDAY');
  assert.equal(pastFieldDuty.eligible, true, 'Work performed while assigned to the field remains eligible');

  // 6. Doctor is redeployed to Field Operations effective 2026-06-01
  db.prepare(`UPDATE employee_field_status_history SET effective_to = '2026-05-31' WHERE employee_id = ? AND effective_to IS NULL`).run(doctorEmpId);
  db.prepare(`
    INSERT INTO employee_field_status_history (employee_id, is_field_worker, effective_from, effective_to, remarks)
    VALUES (?, 1, '2026-06-01', NULL, 'Reassigned to field surveillance')
  `).run(doctorEmpId);
  db.prepare(`UPDATE employees SET is_field_worker = 1, field_worker_effective_date = '2026-06-01' WHERE employee_id = ?`).run(doctorEmpId);
  doc = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(doctorEmpId);

  // Duty on 2026-05-31 (last day of hospital duty) -> NOT eligible
  const lastHospitalDay = LeaveRuleEngine.calculateCompOff(doc, '2026-05-31', 'SUNDAY');
  assert.equal(lastHospitalDay.eligible, false, 'Last day of hospital duty is not eligible for Comp-Off');

  // Duty on 2026-06-07 (after field redeployment) -> IS eligible
  const redeployedEligible = LeaveRuleEngine.calculateCompOff(doc, '2026-06-07', 'SUNDAY');
  assert.equal(redeployedEligible.eligible, true, 'Eligible for Comp-Off for work on 2026-06-07 following field redeployment');

  // Clean up
  db.prepare('DELETE FROM employee_field_status_history WHERE employee_id = ?').run(doctorEmpId);
  db.prepare('DELETE FROM employees WHERE employee_id = ?').run(doctorEmpId);
});

