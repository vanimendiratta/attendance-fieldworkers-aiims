// tests/leaveRuleEngine.test.js
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const db = require('../server/database/db');
const { runMigrations } = require('../server/database/migrate');
const { seedDatabase } = require('../server/database/seed');
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
  seedDatabase();
});

test('Casual Leave (CL) - Full Year Employee Entitlement', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();

  // Employee joined on 2024-01-01 (full calendar year)
  const empFullYear = {
    employee_id: 'EMP_FULL',
    name: 'Full Year Employee',
    date_of_joining: '2024-01-01',
    employee_category: 'GENERAL',
    is_field_worker: 0
  };

  const initial = LeaveRuleEngine.calculateInitialCredit(empFullYear, clType.id, new Date('2026-01-01'));
  // Should receive full annual entitlement of 8 days
  assert.equal(initial.amount, 8.0);
  assert.equal(initial.formula, 'FULL_YEAR_ENTITLEMENT');
});

test('Casual Leave (CL) - Alternate Entitlement for Staff without 17 holidays', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();

  const empAlternate = {
    employee_id: 'EMP_ALT',
    name: 'Shift Staff',
    date_of_joining: '2024-01-01',
    employee_category: 'STAFF_WITHOUT_17_HOLIDAYS',
    is_field_worker: 0
  };

  const initial = LeaveRuleEngine.calculateInitialCredit(empAlternate, clType.id, new Date('2026-01-01'));
  // Should receive alternate entitlement of 10 days
  assert.equal(initial.amount, 10.0);
});

test('Casual Leave (CL) - Mid-Year Joining with Pro-Rata Policy', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();

  // Employee joins in July (Month 7 of 2026) -> remaining months = 13 - 7 = 6 months
  const empMidYear = {
    employee_id: 'EMP_MID',
    name: 'Mid Year Employee',
    date_of_joining: '2026-07-01',
    employee_category: 'GENERAL',
    is_field_worker: 0
  };

  const initial = LeaveRuleEngine.calculateInitialCredit(empMidYear, clType.id, new Date('2026-07-01'));
  // (6 / 12) * 8 = 4.0 days
  assert.equal(initial.amount, 4.0);
  assert.equal(initial.remainingMonths, 6);
});

test('Earned Leave (EL) - Mid-Year Completed Month Rate (2.5 days/month)', () => {
  const elType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'EL'`).get();

  // Employee joins on 1st March 2026 -> In H1 (ends June 30), March, April, May, June = 4 completed months
  const empELMid = {
    employee_id: 'EMP_EL_MID',
    name: 'EL Mid Year',
    date_of_joining: '2026-03-01',
    employee_category: 'GENERAL',
    is_field_worker: 0
  };

  const initial = LeaveRuleEngine.calculateInitialCredit(empELMid, elType.id, new Date('2026-03-01'));
  // 4 months * 2.5 = 10.0 days
  assert.equal(initial.amount, 10.0);
  assert.equal(initial.completedMonths, 4);
});

test('Leave Calculation - Excludes Weekly Offs and Public Holidays for CL', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();

  const employee = {
    employee_id: 'EMP_TEST_CALC',
    name: 'Calc Test',
    date_of_joining: '2024-01-01',
    employee_category: 'GENERAL',
    department: 'General',
    location: 'ALL',
    is_field_worker: 0
  };

  // Check Republic Day 2026: 2026-01-26 is a Monday (holiday in seed).
  // Request: 2026-01-23 (Fri) to 2026-01-26 (Mon).
  // Total calendar days: 4 (Fri, Sat, Sun, Mon)
  // Saturday + Sunday = 2 weekly offs
  // Monday 26 Jan = 1 Republic Day holiday
  // Chargeable days for CL = only Friday = 1 day!
  const calc = LeaveRuleEngine.calculateChargeableDays(employee, clType, '2026-01-23', '2026-01-26');
  assert.equal(calc.calendarDays, 4);
  assert.equal(calc.weeklyOffDays, 2);
  assert.equal(calc.holidayDays, 1);
  assert.equal(calc.chargeableDays, 1.0);
});

test('Comp-Off - Field Worker vs Non-Field Worker Eligibility', () => {
  const fieldWorker = {
    employee_id: 'EMP_FIELD',
    name: 'Ramesh Field',
    is_field_worker: 1,
    employee_category: 'FIELD_WORKER'
  };

  const deskWorker = {
    employee_id: 'EMP_DESK',
    name: 'Priya Desk',
    is_field_worker: 0,
    employee_category: 'GENERAL'
  };

  const fieldResult = LeaveRuleEngine.calculateCompOff(fieldWorker, '2026-05-10', 'SUNDAY');
  assert.equal(fieldResult.eligible, true);
  assert.equal(fieldResult.creditedDays, 1.0);

  const deskResult = LeaveRuleEngine.calculateCompOff(deskWorker, '2026-05-10', 'SUNDAY');
  assert.equal(deskResult.eligible, false);
});

test('Leave Ledger - Double-Entry Ledger & Balance Integrity', () => {
  const clType = db.prepare(`SELECT id, code FROM leave_types WHERE code = 'CL'`).get();
  const empId = 'EMP_LEDGER_TEST';

  // Create employee in db
  db.prepare(`
    INSERT INTO employees (employee_id, name, gender, mobile, email, date_of_joining, date_of_birth, designation)
    VALUES (?, 'Ledger Test', 'MALE', '9999999999', 'ledger@test.gov.in', '2024-01-01', '1990-01-01', 'Officer')
  `).run(empId);

  // 1. Initial Credit +8
  LeaveLedgerService.recordTransaction({
    employeeId: empId,
    leaveTypeId: clType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 8.0,
    remarks: 'Annual entitlement'
  });

  // 2. Deduction -2
  LeaveLedgerService.recordTransaction({
    employeeId: empId,
    leaveTypeId: clType.id,
    transactionType: 'LEAVE_DEDUCTION',
    amount: -2.0,
    remarks: 'Leave approved'
  });

  // 3. Admin Adjustment +1
  LeaveLedgerService.recordTransaction({
    employeeId: empId,
    leaveTypeId: clType.id,
    transactionType: 'ADMIN_ADJUSTMENT',
    amount: 1.0,
    remarks: 'Reconciliation'
  });

  // Balance should be exactly 8 - 2 + 1 = 7.0
  const balance = LeaveLedgerService.getBalance(empId, clType.id);
  assert.equal(balance.current_balance, 7.0);
  assert.equal(balance.credited_amount, 8.0);
  assert.equal(balance.used_amount, 2.0);
  assert.equal(balance.adjusted_amount, 1.0);

  // Check ledger integrity
  const integrity = LeaveLedgerService.verifyLedgerIntegrity(empId, clType.id);
  assert.equal(integrity.isConsistent, true);
  assert.equal(integrity.calculatedSum, 7.0);
});

test('Dynamic Rules - Updating Database Rule Changes Future Calculations Without Code Changes', () => {
  const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
  const clRule = db.prepare(`SELECT id FROM leave_rules WHERE leave_type_id = ?`).get(clType.id);

  const emp = {
    employee_id: 'EMP_DYNAMIC',
    name: 'Dynamic Test',
    date_of_joining: '2027-01-01',
    employee_category: 'GENERAL',
    is_field_worker: 0
  };

  // Rule Version 1 had 8 days annual entitlement
  const calcV1 = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, new Date('2026-01-01'));
  assert.equal(calcV1.amount, 8.0);

  // Suppose Admin updates organization policy in DB for 2027: sets annual_entitlement to 12 days
  const newConfig = {
    annual_entitlement: 12.0,
    alternate_entitlement: 14.0,
    max_continuous_days: 6.0,
    mid_year_treatment: 'FULL_CREDIT',
    exclude_weekly_offs: true,
    exclude_public_holidays: true
  };

  const nextVer = (db.prepare('SELECT MAX(version_number) as m FROM leave_rule_versions WHERE leave_rule_id = ?').get(clRule.id).m || 1) + 1;

  db.prepare(`
    INSERT INTO leave_rule_versions (leave_rule_id, version_number, effective_from, status, config_json, created_by)
    VALUES (?, ?, '2027-01-01', 'ACTIVE', ?, 'ADMIN')
  `).run(clRule.id, nextVer, JSON.stringify(newConfig));

  // Future calculation for 2027 now returns 12 days automatically from the DB rule!
  const calcV2 = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, new Date('2027-01-15'));
  assert.equal(calcV2.amount, 12.0);

  // Past calculation for 2026 STILL returns 8 days (Rule versioning preserved!)
  const calcPast = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, new Date('2026-05-01'));
  assert.equal(calcPast.amount, 8.0);
});
