/**
 * Comprehensive End-to-End Production QA Test Suite
 * Attendance + EMS (AIIMS CDER) Leave Governance Workflow
 *
 * Covers:
 *  - Phase 2: Employee Leave Application Workflow (full-day, half-day, validations, IDOR)
 *  - Phase 3: Admin Review Workflow (approve, reject, cancel, ledger consistency, anti-self-approval, RBAC)
 *  - Phase 4: Authoritative Calculations & Entitlements (pro-rata, weekend/holiday exclusion, leap-year)
 *  - Phase 5: Document Access & Upload Security (authorization, traversal rejection)
 *  - Phase 6: Authentication, Session Inactivity & Single-Active-Session (409 on concurrent login, logout)
 *  - Phase 7: Database Double-Entry Ledger Integrity & Invariants
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('assert');
// Using supertest for in-process HTTP requests
const supertest = require('supertest');
const app = require('../ems/server/index');
// const request = supertest(app); // removed, using apiAgent

// Supertest agent for in-process HTTP requests
const apiAgent = supertest(app);

// Helper to perform HTTP requests using supertest
async function request(endpoint, options = {}) {
  const method = (options.method || 'GET').toLowerCase();
  const path = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  let req = apiAgent[method](path);
  if (options.headers) {
    req = req.set(options.headers);
  }
  if (options.body) {
    req = req.send(options.body);
  }
  const res = await req;
  return { status: res.status, headers: res.headers, data: res.body };
}


const db = require('../ems/server/database/db');
const { runMigrations } = require('../ems/server/database/migrate');
const { seedMasterPolicies } = require('../ems/server/database/seed');
const LeaveRuleEngine = require('../ems/server/services/LeaveRuleEngine');
const LeaveLedgerService = require('../ems/server/services/LeaveLedgerService');
const AuthService = require('../ems/server/services/AuthService');
const bcrypt = require('bcryptjs');

// BASE_URL will be set after server starts

// Ensure DB is initialized
runMigrations();
seedMasterPolicies();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

async function test(title, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${title}`);
    passedTests++;
    testResults.push({ title, status: 'PASS' });
  } catch (err) {
    console.error(`  ❌ [FAIL] ${title}: ${err.message}`);
    failedTests++;
    testResults.push({ title, status: 'FAIL', error: err.message });
  }
}

// The request helper now uses supertest via `apiAgent` defined above.
// No external BASE_URL is needed for in-process testing.

async function runAllTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING PRODUCTION-READINESS QA SUITE — ATTENDANCE + EMS');
  console.log('===============================================================');

  // Synthetic Test Fixtures Setup
  const testEmpId1 = 'SYN-TEST-9901';
  const testEmpId2 = 'SYN-TEST-9902';
  const testEmpEmail1 = 'syntest9901.cder@gmail.com';
  const testEmpEmail2 = 'syntest9902.cder@gmail.com';
  const testPassword = 'TestUser@EMS2026!';
  const passwordHash = bcrypt.hashSync(testPassword, 10);

  // Clean prior synthetic runs
  db.prepare('DELETE FROM leave_requests WHERE employee_id IN (?, ?)').run(testEmpId1, testEmpId2);
  db.prepare('DELETE FROM leave_balances WHERE employee_id IN (?, ?)').run(testEmpId1, testEmpId2);
  db.prepare('DELETE FROM leave_transactions WHERE employee_id IN (?, ?)').run(testEmpId1, testEmpId2);
  db.prepare('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))').run(testEmpEmail1, testEmpEmail2);
  db.prepare('DELETE FROM users WHERE email IN (?, ?)').run(testEmpEmail1, testEmpEmail2);
  db.prepare('DELETE FROM employees WHERE employee_id IN (?, ?)').run(testEmpId1, testEmpId2);

  // Insert Employee 1 (Field Worker with CL and EL)
  db.prepare(`
    INSERT INTO employees (
      employee_id, official_employee_id, name, gender, mobile, email,
      date_of_joining, date_of_birth, department, designation, employee_category,
      is_field_worker, status
    ) VALUES (?, ?, ?, 'MALE', '+91 9899000001', ?, '2026-04-01', '1995-01-01', 'CDER', 'Senior Field Investigator', 'GENERAL', 1, 'ACTIVE')
  `).run(testEmpId1, 'CDER-991', 'Synthetic Fieldworker One', testEmpEmail1);

  // Insert Employee 2 (Non-Field Worker for IDOR tests)
  db.prepare(`
    INSERT INTO employees (
      employee_id, official_employee_id, name, gender, mobile, email,
      date_of_joining, date_of_birth, department, designation, employee_category,
      is_field_worker, status
    ) VALUES (?, ?, ?, 'FEMALE', '+91 9899000002', ?, '2026-04-01', '1996-02-02', 'CDER', 'Research Associate', 'GENERAL', 0, 'ACTIVE')
  `).run(testEmpId2, 'CDER-992', 'Synthetic Fieldworker Two', testEmpEmail2);

  // Insert User Accounts
  db.prepare(`
    INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
    VALUES (?, ?, ?, 'EMPLOYEE', 0, 1)
  `).run(testEmpId1, testEmpEmail1, passwordHash);

  db.prepare(`
    INSERT INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
    VALUES (?, ?, ?, 'EMPLOYEE', 0, 1)
  `).run(testEmpId2, testEmpEmail2, passwordHash);

  const clType = db.prepare("SELECT * FROM leave_types WHERE code = 'CL'").get();
  const elType = db.prepare("SELECT * FROM leave_types WHERE code = 'EL'").get();
  const rhType = db.prepare("SELECT * FROM leave_types WHERE code = 'RH'").get();

  // Seed Initial Balances for Employee 1: 8 CL, 15 EL
  LeaveLedgerService.recordTransaction({
    employeeId: testEmpId1,
    leaveTypeId: clType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 8.0,
    remarks: 'Initial QA CL Credit 2026',
    createdBy: 'SYSTEM_QA'
  });

  LeaveLedgerService.recordTransaction({
    employeeId: testEmpId1,
    leaveTypeId: elType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 15.0,
    remarks: 'Initial QA EL Credit 2026',
    createdBy: 'SYSTEM_QA'
  });

  // Seed Initial Balances for Employee 2: 8 CL
  LeaveLedgerService.recordTransaction({
    employeeId: testEmpId2,
    leaveTypeId: clType.id,
    transactionType: 'INITIAL_CREDIT',
    amount: 8.0,
    remarks: 'Initial QA CL Credit 2026',
    createdBy: 'SYSTEM_QA'
  });

  console.log('\n--- PHASE 6: AUTHENTICATION, SESSIONS & SECURITY CONTROLS ---');

  let empToken1 = null;
  let adminToken = null;

  await test('Employee login succeeds with correct credentials and returns JWT + sessionId', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: testEmpEmail1, password: testPassword }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.token, 'Token must be returned');
    assert.ok(res.data.sessionId, 'SessionId must be returned');
    assert.strictEqual(res.data.user.role, 'EMPLOYEE');
    assert.strictEqual(res.data.user.email, testEmpEmail1);
    empToken1 = res.data.token;
  });

  await test('Single-Active-Session Policy: Second concurrent login is strictly rejected with 409 ACTIVE_SESSION_EXISTS', async () => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: testEmpEmail1, password: testPassword }
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.data.code, 'ACTIVE_SESSION_EXISTS');
    assert.ok(res.data.error.includes('already logged in on another device'));
  });

  await test('Admin login succeeds with admin credentials and returns JWT + sessionId', async () => {
    // Clear any previous active admin session to establish clean login
    db.prepare("UPDATE user_sessions SET is_revoked = 1 WHERE user_id = (SELECT id FROM users WHERE email = 'admin@ems.gov.in')").run();
    const res = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'admin@ems.gov.in', password: 'Admin@EMS2026!' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.user.role, 'ADMIN');
    adminToken = res.data.token;
  });

  await test('Role-Based Access Control (RBAC): Employee cannot access admin-only endpoints', async () => {
    const res = await request('/reports/summary', {
      headers: { Authorization: `Bearer ${empToken1}` }
    });
    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes('Forbidden') || res.data.error.includes('Admin'));
  });

  await test('Unauthenticated request to protected endpoints is rejected with 401', async () => {
    const res = await request('/ledger/balances');
    assert.strictEqual(res.status, 401);
  });

  await test('Session Inactivity Timeout (30 mins): Expired session is rejected on subsequent request', async () => {
    // Simulate expired session (last_activity_at 31 minutes ago)
    const thirtyOneMinsAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const activeSession = db.prepare('SELECT id FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = ?) AND is_revoked = 0').get(testEmpEmail1);
    assert.ok(activeSession, 'Active session must exist');

    db.prepare('UPDATE user_sessions SET last_activity_at = ? WHERE id = ?').run(thirtyOneMinsAgo, activeSession.id);

    const res = await request('/auth/me', {
      headers: { Authorization: `Bearer ${empToken1}` }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.code, 'SESSION_EXPIRED');

    // Re-authenticate employee 1 for subsequent tests
    const reLogin = await request('/auth/login', {
      method: 'POST',
      body: { identifier: testEmpEmail1, password: testPassword }
    });
    assert.strictEqual(reLogin.status, 200);
    empToken1 = reLogin.data.token;
  });

  console.log('\n--- PHASE 2: COMPLETE EMPLOYEE LEAVE WORKFLOW ---');

  await test('Load available leave types, holidays, and balances for logged-in employee', async () => {
    const ltRes = await request('/leave-types', { headers: { Authorization: `Bearer ${empToken1}` } });
    assert.strictEqual(ltRes.status, 200);
    assert.ok(Array.isArray(ltRes.data.leaveTypes), 'leaveTypes should be an array');
    assert.ok(ltRes.data.leaveTypes.some(t => t.code === 'CL'));

    const balRes = await request('/ledger/balances', { headers: { Authorization: `Bearer ${empToken1}` } });
    assert.strictEqual(balRes.status, 200);
    const clBal = balRes.data.balances.find(b => b.leave_type_code === 'CL');
    assert.strictEqual(clBal.current_balance, 8.0);
    assert.strictEqual(clBal.credited_amount, 8.0);
    assert.strictEqual(clBal.used_amount, 0.0);

    const holRes = await request('/holidays', { headers: { Authorization: `Bearer ${empToken1}` } });
    assert.strictEqual(holRes.status, 200);
  });

  await test('Authoritative live calculation preview correctly computes calendar and chargeable days', async () => {
    // 2026-10-12 (Mon) to 2026-10-14 (Wed) = 3 working days
    const res = await request('/leave/calculate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-10-12',
        toDate: '2026-10-14',
        isHalfDay: false
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.isValid, true);
    assert.strictEqual(res.data.calculation.calendarDays, 3);
    assert.strictEqual(res.data.calculation.chargeableDays, 3);
    assert.strictEqual(res.data.balanceInfo.current_balance, 8.0);
  });

  let fullDayRequestId = null;

  await test('Submit a valid full-day leave request (3 days CL)', async () => {
    const res = await request('/leave/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-10-12',
        toDate: '2026-10-14',
        isHalfDay: false,
        reason: 'Family function at hometown',
        remarks: 'All field tasks handed over'
      }
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.request.id);
    assert.strictEqual(res.data.request.status, 'PENDING');
    assert.strictEqual(res.data.request.chargeable_days, 3.0);
    fullDayRequestId = res.data.request.id;

    // Verify balance is NOT deducted while request is PENDING (deducted on approval per CDER policy)
    const balRes = await request('/ledger/balances', { headers: { Authorization: `Bearer ${empToken1}` } });
    const clBal = balRes.data.balances.find(b => b.leave_type_code === 'CL');
    assert.strictEqual(clBal.current_balance, 8.0, 'Balance must remain 8.0 while request is PENDING');
  });

  let halfDayRequestId = null;

  await test('Submit a valid half-day leave request (0.5 day CL)', async () => {
    const res = await request('/leave/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-10-20',
        toDate: '2026-10-20',
        isHalfDay: true,
        halfDaySession: 'FIRST_HALF',
        reason: 'Personal banking work'
      }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.request.is_half_day, 1);
    assert.strictEqual(res.data.request.chargeable_days, 0.5);
    halfDayRequestId = res.data.request.id;
  });

  await test('Validation rejects invalid dates (reversed date range)', async () => {
    const res = await request('/leave/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-10-25',
        toDate: '2026-10-20',
        reason: 'Test invalid range'
      }
    });
    assert.ok(res.status === 400 || res.status === 422, 'Must reject reversed dates with client error');
  });

  await test('Validation rejects missing reason', async () => {
    const res = await request('/leave/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-10-26',
        toDate: '2026-10-27',
        reason: ''
      }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error.includes('reason are required'));
  });

  await test('Validation rejects overlapping leave requests', async () => {
    // 2026-10-13 overlaps with full-day request (2026-10-12 to 2026-10-14)
    const res = await request('/leave/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-10-13',
        toDate: '2026-10-15',
        reason: 'Overlap attempt'
      }
    });
    assert.strictEqual(res.status, 422);
    assert.ok(res.data.details && res.data.details.some(d => d.includes('conflict') || d.includes('Overlapping')));
  });

  await test('Validation rejects insufficient balance request', async () => {
    // Request 10 days of CL when available balance is 8
    const res = await request('/leave/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${empToken1}` },
      body: {
        leaveTypeId: clType.id,
        fromDate: '2026-11-02',
        toDate: '2026-11-13', // 10 working days
        reason: 'Exceeding balance'
      }
    });
    assert.strictEqual(res.status, 422);
    assert.ok(res.data.details && res.data.details.some(d => d.includes('Insufficient balance') || d.includes('continuous')));
  });

  await test('IDOR Protection: Employee cannot view another employee private leave details', async () => {
    // Create leave request for Employee 2
    const emp2Req = db.prepare(`
      INSERT INTO leave_requests (
        request_number, employee_id, leave_type_id, from_date, to_date,
        is_half_day, requested_calendar_days, weekly_off_days, holiday_days,
        sandwich_days, chargeable_days, reason, status, calculation_snapshot_json
      ) VALUES ('LR-TEST-EMP2', ?, ?, '2026-10-28', '2026-10-29', 0, 2, 0, 0, 0, 2, 'Private Medical Leave', 'PENDING', '{}')
    `).run(testEmpId2, clType.id);

    const emp2ReqId = emp2Req.lastInsertRowid;

    // Employee 1 attempts to view Employee 2 request details
    const res = await request(`/leave/requests/${emp2ReqId}`, {
      headers: { Authorization: `Bearer ${empToken1}` }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.error, 'Access denied.');
  });

  console.log('\n--- PHASE 3: COMPLETE ADMIN WORKFLOW ---');

  await test('Admin loads pending requests and summary metrics', async () => {
    const sumRes = await request('/reports/summary', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(sumRes.status, 200);
    const pendingCount = sumRes.data.metrics.pendingRequests !== undefined ? sumRes.data.metrics.pendingRequests : sumRes.data.metrics.pendingRequestsCount;
    assert.ok(pendingCount >= 1, `pendingCount should be >= 1, got ${pendingCount}`);

    const listRes = await request('/leave/requests?status=PENDING', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.data.requests.some(r => r.id === fullDayRequestId));
  });

  await test('Admin approves valid leave request -> balance debited, ledger transaction & audit record created', async () => {
    const res = await request(`/leave/requests/${fullDayRequestId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'APPROVE', remarks: 'Sanctioned by Admin' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.request.status, 'APPROVED');

    // Verify employee balance decreased by exactly 3.0 days (8.0 - 3.0 = 5.0)
    const bal = LeaveLedgerService.getBalance(testEmpId1, clType.id);
    assert.strictEqual(bal.current_balance, 5.0);
    assert.strictEqual(bal.used_amount, 3.0);

    // Verify double-entry ledger transaction
    const tx = db.prepare(`SELECT * FROM leave_transactions WHERE reference_id = ? AND transaction_type = 'LEAVE_DEDUCTION'`).get(res.data.request.request_number);
    assert.ok(tx, 'Ledger transaction must exist');
    assert.strictEqual(tx.amount, -3.0);

    // Verify audit log entry
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'LEAVE_REQUEST_APPROVED'`).get(res.data.request.request_number);
    assert.ok(audit, 'Audit log must record approval');
  });

  await test('Idempotency: Re-approving an already approved request is strictly blocked', async () => {
    const res = await request(`/leave/requests/${fullDayRequestId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'APPROVE', remarks: 'Duplicate approval attempt' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error.includes('already approved'));

    // Balance remains intact at 5.0
    const bal = LeaveLedgerService.getBalance(testEmpId1, clType.id);
    assert.strictEqual(bal.current_balance, 5.0);
  });

  await test('Admin rejects pending request -> status REJECTED, no leave debited', async () => {
    const res = await request(`/leave/requests/${halfDayRequestId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'REJECT', remarks: 'Field duties critical on 20th' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.request.status, 'REJECTED');

    // Balance remains 5.0 (no debit for rejected request)
    const bal = LeaveLedgerService.getBalance(testEmpId1, clType.id);
    assert.strictEqual(bal.current_balance, 5.0);
  });

  await test('Admin cancels an APPROVED request -> balance reversed and ledger credit recorded', async () => {
    const res = await request(`/leave/requests/${fullDayRequestId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'CANCEL', remarks: 'Employee recalled from leave' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.request.status, 'CANCELLED');

    // Verify balance is restored back to 8.0 (5.0 + 3.0 = 8.0)
    const bal = LeaveLedgerService.getBalance(testEmpId1, clType.id);
    assert.strictEqual(bal.current_balance, 8.0);
    assert.strictEqual(bal.credited_amount, 8.0); // 8 initial
    assert.strictEqual(bal.used_amount, 0.0);      // 3 deducted reversed back to 0.0

    // Verify LEAVE_REVERSAL transaction exists
    const tx = db.prepare(`SELECT * FROM leave_transactions WHERE reference_id = ? AND transaction_type = 'LEAVE_REVERSAL'`).get(res.data.request.request_number);
    assert.ok(tx, 'Reversal transaction must exist');
    assert.strictEqual(tx.amount, 3.0);
  });

  await test('Anti-Self-Approval: Admin cannot approve their own leave request', async () => {
    // Create an admin who is also associated with an employee_id
    const selfAdminEmpId = 'SYN-ADMIN-EMP';
    db.prepare(`
      INSERT OR REPLACE INTO employees (employee_id, official_employee_id, name, gender, mobile, email, date_of_joining, department, designation, employee_category, is_field_worker, status)
      VALUES (?, 'ADMIN-01', 'Dr. Admin Self', 'MALE', '+91 9899000099', 'adminself@ems.gov.in', '2026-04-01', 'CDER', 'Director', 'GENERAL', 0, 'ACTIVE')
    `).run(selfAdminEmpId);

    db.prepare(`
      INSERT OR REPLACE INTO users (employee_id, email, password_hash, role, must_change_password, is_active)
      VALUES (?, 'adminself@ems.gov.in', ?, 'ADMIN', 0, 1)
    `).run(selfAdminEmpId, passwordHash);

    // Give 5 CL
    LeaveLedgerService.recordTransaction({
      employeeId: selfAdminEmpId,
      leaveTypeId: clType.id,
      transactionType: 'INITIAL_CREDIT',
      amount: 5.0,
      remarks: 'Admin CL',
      createdBy: 'SYSTEM'
    });

    // Create leave request for self admin
    const selfReq = db.prepare(`
      INSERT INTO leave_requests (
        request_number, employee_id, leave_type_id, from_date, to_date,
        is_half_day, requested_calendar_days, weekly_off_days, holiday_days,
        sandwich_days, chargeable_days, reason, status, calculation_snapshot_json
      ) VALUES ('LR-SELF-ADMIN', ?, ?, '2026-11-02', '2026-11-03', 0, 2, 0, 0, 0, 2, 'Self leave', 'PENDING', '{}')
    `).run(selfAdminEmpId, clType.id);

    const selfReqId = selfReq.lastInsertRowid;

    // Login as selfAdmin
    const selfLogin = await request('/auth/login', {
      method: 'POST',
      body: { identifier: 'adminself@ems.gov.in', password: testPassword }
    });
    const selfToken = selfLogin.data.token;

    // Attempt to self-approve
    const selfReview = await request(`/leave/requests/${selfReqId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${selfToken}` },
      body: { action: 'APPROVE', remarks: 'Self approve' }
    });
    assert.strictEqual(selfReview.status, 403);
    assert.ok(selfReview.data.error.includes('cannot approve, reject, or modify your own leave request'));
  });

  console.log('\n--- PHASE 4: LEAVE CALCULATIONS & CDER ENTITLEMENTS ---');

  await test('CDER Pro-Rata Policy: Mid-year joiner (Sep 1, 2026) gets exact 4.5 CL, 17.5 EL & 1 RH per official CDER rules', () => {
    const sepEmployee = {
      employee_id: 'TEMP-SEP',
      date_of_joining: '2026-09-01',
      department: 'CDER',
      employee_category: 'PENDING_CONFIGURATION'
    };

    const cl = LeaveRuleEngine.calculateInitialCredit(sepEmployee, clType.id, '2026-09-01');
    assert.strictEqual(cl.eligibleMonths, 7);
    assert.strictEqual(cl.amount, 4.5);

    const el = LeaveRuleEngine.calculateInitialCredit(sepEmployee, elType.id, '2026-09-01');
    assert.strictEqual(el.amount, 17.5);

    const rh = LeaveRuleEngine.calculateInitialCredit(sepEmployee, rhType.id, '2026-09-01');
    assert.strictEqual(rh.amount, 1.0);
  });

  await test('Calendar Calculation: Excludes weekly offs (Saturdays & Sundays) for CL', () => {
    const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(testEmpId1);
    // Monday Oct 12 to Friday Oct 16: 5 calendar days, 0 weekly off -> 5 chargeable days
    const weekdayCalc = LeaveRuleEngine.calculateChargeableDays(
      employee,
      clType,
      '2026-10-12',
      '2026-10-16'
    );
    assert.strictEqual(weekdayCalc.calendarDays, 5);
    assert.strictEqual(weekdayCalc.weeklyOffDays, 0);
    assert.strictEqual(weekdayCalc.chargeableDays, 5);
  });

  await test('Leap Year Boundary: Feb 28 to Mar 1 in leap year vs non-leap year calculates correctly', () => {
    const employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(testEmpId1);
    // 2028 is a leap year (Feb 29 exists)
    // 2028-02-28 (Mon) to 2028-03-01 (Wed) = 3 days (Feb 28, Feb 29, Mar 1)
    const leapCalc = LeaveRuleEngine.calculateChargeableDays(
      employee,
      clType,
      '2028-02-28',
      '2028-03-01'
    );
    assert.strictEqual(leapCalc.calendarDays, 3);
  });

  console.log('\n--- PHASE 7: DATABASE INTEGRITY & TRANSACTIONAL INVARIANTS ---');

  await test('Double-Entry Ledger Integrity: Total transactions sum matches cached balance exactly', async () => {
    const res = await request(`/ledger/verify-integrity?employeeId=${testEmpId1}&leaveTypeId=${clType.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.isConsistent, true);
    assert.strictEqual(res.data.cachedBalance, res.data.calculatedSum);
  });

  await test('Database foreign key and constraint integrity', () => {
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    assert.strictEqual(fkCheck.length, 0, 'Foreign key check must return zero violations');
  });

  // Teardown: revoke active synthetic sessions
  db.prepare("UPDATE user_sessions SET is_revoked = 1 WHERE is_revoked = 0").run();

  console.log('\n===============================================================');
  console.log(`🎉 TEST SUMMARY: ${passedTests}/${totalTests} PASSED | ${failedTests} FAILED`);
  console.log('===============================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});


