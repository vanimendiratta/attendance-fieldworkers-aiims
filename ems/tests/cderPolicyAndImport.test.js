// tests/cderPolicyAndImport.test.js
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const { runMigrations } = require('../server/database/migrate');
const { seedMasterPolicies } = require('../server/database/seed');
const LeaveRuleEngine = require('../server/services/LeaveRuleEngine');
const CderImportService = require('../server/services/CderImportService');

test.before(() => {
  runMigrations();
  seedMasterPolicies();
});

test('Test A: CDER Policy - Joining Date 01/09/2026', () => {
  const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
  const elType = db.prepare(`SELECT id FROM leave_types WHERE code = 'EL'`).get();
  const rhType = db.prepare(`SELECT id FROM leave_types WHERE code = 'RH'`).get();

  const emp = {
    employee_id: 'CDER_TEST_A',
    name: 'Test Staff A',
    date_of_joining: '2026-09-01',
    department: 'CDER',
    employee_category: 'PENDING_CONFIGURATION'
  };

  const cl = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, '2026-09-01');
  const el = LeaveRuleEngine.calculateInitialCredit(emp, elType.id, '2026-09-01');
  const rh = LeaveRuleEngine.calculateInitialCredit(emp, rhType.id, '2026-09-01');

  assert.equal(cl.eligibleMonths, 7, 'Eligible months must be 7');
  assert.equal(cl.amount, 4.5, 'CL must be 4.5 days (rounded from 4.67)');
  assert.equal(el.amount, 17.5, 'EL must be 17.5 days (2.5 * 7)');
  assert.equal(rh.amount, 1, 'RH must be 1 (01 for a six-month period)');
});

test('Test B: CDER Policy - Joining Date 05/09/2026', () => {
  const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
  const elType = db.prepare(`SELECT id FROM leave_types WHERE code = 'EL'`).get();
  const rhType = db.prepare(`SELECT id FROM leave_types WHERE code = 'RH'`).get();

  const emp = {
    employee_id: 'CDER_TEST_B',
    name: 'Test Staff B',
    date_of_joining: '2026-09-05',
    department: 'CDER',
    employee_category: 'PENDING_CONFIGURATION'
  };

  const cl = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, '2026-09-05');
  const el = LeaveRuleEngine.calculateInitialCredit(emp, elType.id, '2026-09-05');
  const rh = LeaveRuleEngine.calculateInitialCredit(emp, rhType.id, '2026-09-05');

  assert.equal(cl.leaveStartDate, '2026-09-01', 'Leave start must be 01/09/2026 because joining <= 25/09/2026');
  assert.equal(cl.eligibleMonths, 7, 'Eligible months must be 7');
  assert.equal(cl.amount, 4.5, 'CL must be 4.5 days');
  assert.equal(el.amount, 17.5, 'EL must be 17.5 days');
  assert.equal(rh.amount, 1, 'RH must be 1');
});

test('Test C: CDER Policy - Joining Date 29/09/2026', () => {
  const clType = db.prepare(`SELECT id FROM leave_types WHERE code = 'CL'`).get();
  const elType = db.prepare(`SELECT id FROM leave_types WHERE code = 'EL'`).get();
  const rhType = db.prepare(`SELECT id FROM leave_types WHERE code = 'RH'`).get();

  const emp = {
    employee_id: 'CDER_TEST_C',
    name: 'Test Staff C',
    date_of_joining: '2026-09-29',
    department: 'CDER',
    employee_category: 'PENDING_CONFIGURATION'
  };

  const cl = LeaveRuleEngine.calculateInitialCredit(emp, clType.id, '2026-09-29');
  const el = LeaveRuleEngine.calculateInitialCredit(emp, elType.id, '2026-09-29');
  const rh = LeaveRuleEngine.calculateInitialCredit(emp, rhType.id, '2026-09-29');

  assert.equal(cl.leaveStartDate, '2026-10-01', 'Because joining is after 25/09/2026, Leave Start must be 01/10/2026');
  assert.equal(cl.eligibleMonths, 6, 'Eligible months must be 6');
  assert.equal(cl.amount, 4.0, 'CL must be 4.00 days');
  assert.equal(el.amount, 15.0, 'EL must be 15.0 days');
  assert.equal(rh.amount, 1, 'RH must be 1');
});

test('Test D: Duplicate Import Idempotency', () => {
  // First run
  const run1 = CderImportService.importOfficialCderData();
  const empCount1 = db.prepare(`SELECT COUNT(*) as c FROM employees WHERE import_source = 'CDER_DOCX_2026'`).get().c;
  const txCount1 = db.prepare(`SELECT COUNT(*) as c FROM leave_transactions WHERE created_by = 'CDER_DOCX_IMPORT'`).get().c;
  const userCount1 = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'EMPLOYEE' AND email LIKE '%cder%'`).get().c;

  assert.equal(empCount1, 44, 'Should have exactly 44 CDER employees');
  assert.equal(txCount1, 193, 'Should have exactly 193 CDER transactions');

  // Second run
  const run2 = CderImportService.importOfficialCderData();
  const empCount2 = db.prepare(`SELECT COUNT(*) as c FROM employees WHERE import_source = 'CDER_DOCX_2026'`).get().c;
  const txCount2 = db.prepare(`SELECT COUNT(*) as c FROM leave_transactions WHERE created_by = 'CDER_DOCX_IMPORT'`).get().c;
  const userCount2 = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'EMPLOYEE' AND email LIKE '%cder%'`).get().c;

  assert.equal(empCount2, empCount1, 'Second run must not create duplicate employees');
  assert.equal(txCount2, txCount1, 'Second run must not create duplicate ledger entries');
  assert.equal(userCount2, userCount1, 'Second run must not create duplicate user accounts');
  assert.equal(run2.stats.employeesImported, 0, 'Second run should report 0 new employees imported');
  assert.equal(run2.stats.transactionsCreated, 0, 'Second run should report 0 new transactions created');
});

test('Test E: Balance Reconciliation Against Document Snapshot', () => {
  const recon = CderImportService.runReconciliation();
  assert.equal(recon.totalRecordsAudited, 176, '44 employees * 4 leave types = 176 records');
  assert.equal(recon.mismatchCount, 0, 'There must be 0 mismatches');
  assert.equal(recon.matchCount, 176, 'All 176 balances must match 100%');
  assert.equal(recon.isFullyReconciled, true, 'Import must be fully reconciled');
});
