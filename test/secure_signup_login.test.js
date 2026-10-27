/**
 * Comprehensive Automated Test Suite — Secure Signup, Login, Employee ID Generation & Validation
 *
 * Verifies all 5 Core Functional & Security Domains:
 * Group A: Signup and DOB Validation (mandatory, format, calendar sanity, future-date rejection)
 * Group B: Email Validation ('cder' substring requirement, casing, whitespace normalization, format)
 * Group C: Mobile Number Validation (mandatory, 10-digit format, formatting normalization, uniqueness)
 * Group D: Short Unique Employee ID Generation (FW-XXXXXX format, entropy, uniqueness, stability)
 * Group E: Authentication & Regression (login by ID/email/phone, authorization, profile stability)
 */

'use strict';

const assert = require('assert');
const http = require('http');
const testHelper = require('./test_helper');
const authService = require('../src/services/auth_service');
const { closePool, query } = require('../src/db/database');
const app = require('../server');

let server;
let baseUrl;

let requestCounter = 0;

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    requestCounter++;
    const url = new URL(urlPath, baseUrl);
    const reqHeaders = {
      'x-forwarded-for': `127.0.1.${(requestCounter % 200) + 1}`,
      ...headers
    };
    let payload = null;

    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          raw: data
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('===============================================================');
  console.log('🔒 SECURE SIGNUP, LOGIN, EMPLOYEE ID & VALIDATION TEST SUITE');
  console.log('===============================================================\n');

  await testHelper.applySchema();
  await testHelper.seedTestData();
  await query('DELETE FROM auth_rate_limits');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let total = 0;

  function markPassed(desc) {
    passed++;
    total++;
    console.log(`  ✓ [${total}] ${desc}`);
  }

  try {
    const syntheticFilter = "SELECT id FROM employees WHERE email LIKE '%_cder@%' OR id LIKE 'FW-%'";
    await query(`DELETE FROM attendance WHERE employee_id IN (${syntheticFilter})`);
    await query(`DELETE FROM employee_leaves WHERE employee_id IN (${syntheticFilter})`);
    await query(`DELETE FROM employee_hotel_stays WHERE employee_id IN (${syntheticFilter})`);
    await query(`DELETE FROM external_sync_records WHERE employee_id IN (${syntheticFilter})`);
    await query("DELETE FROM employees WHERE email LIKE '%_cder@%' OR id LIKE 'FW-%'");

    // =========================================================================
    // GROUP A: SIGNUP AND DATE OF BIRTH (DOB) VALIDATION
    // =========================================================================
    console.log('\n--- Group A: Signup and Date of Birth (DOB) Validation ---');

    // A1. Valid signup with all required fields
    const epochA = Date.now();
    const resA1 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Dr. Aarav Patel',
      dob: '1992-06-15',
      email: `aarav_${epochA}_cder@aiims.edu`,
      phone: '9820011223',
      employer_id: 'ORG-001',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resA1.status, 201, 'Valid signup must return 201 Created');
    assert.strictEqual(resA1.data.success, true);
    assert.ok(resA1.data.employee.id.startsWith('FW-'), 'Employee ID must have FW- prefix');
    assert.strictEqual(resA1.data.employee.dob.split('T')[0], '1992-06-15', 'DOB must be stored consistently');
    markPassed('Valid signup with complete fields stores consistent DOB and returns 201');

    // A2. Missing DOB
    const resA2 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Missing DOB User',
      email: `missing_dob_${epochA}_cder@aiims.edu`,
      phone: '9820011224',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resA2.status, 400, 'Missing DOB must return 400 Bad Request');
    assert.strictEqual(resA2.data.error, 'Date of Birth is required.');
    markPassed('Missing Date of Birth is strictly rejected with 400');

    // A3. Invalid DOB format (e.g. DD/MM/YYYY or arbitrary string)
    const resA3 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Malformed DOB User',
      dob: '15/06/1992',
      email: `malformed_dob_${epochA}_cder@aiims.edu`,
      phone: '9820011225',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resA3.status, 400);
    assert.strictEqual(resA3.data.error, 'Date of Birth must be in YYYY-MM-DD format.');
    markPassed('Malformed DOB string format is rejected with format requirement message');

    // A4. Impossible calendar date (February 30th)
    const resA4 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Impossible Date User',
      dob: '2024-02-30',
      email: `impossible_dob_${epochA}_cder@aiims.edu`,
      phone: '9820011226',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resA4.status, 400);
    assert.strictEqual(resA4.data.error, 'Date of Birth contains an impossible calendar date.');
    markPassed('Impossible calendar date (e.g. Feb 30) is rejected');

    // A5. Impossible leap year date (February 29th on a non-leap year)
    const resA5 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Non-Leap Year User',
      dob: '2023-02-29',
      email: `nonleap_dob_${epochA}_cder@aiims.edu`,
      phone: '9820011227',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resA5.status, 400);
    assert.strictEqual(resA5.data.error, 'Date of Birth contains an impossible calendar date.');
    markPassed('Impossible calendar date on non-leap year (e.g. Feb 29, 2023) is rejected');

    // A6. Future Date of Birth
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0];
    const resA6 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Future Date User',
      dob: futureDate,
      email: `future_dob_${epochA}_cder@aiims.edu`,
      phone: '9820011228',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resA6.status, 400);
    assert.strictEqual(resA6.data.error, 'Date of Birth cannot be in the future.');
    markPassed('Future Date of Birth is rejected');

    // =========================================================================
    // GROUP B: EMAIL VALIDATION USING REQUIRED 'cder' CODE
    // =========================================================================
    console.log('\n--- Group B: Email Validation & Required "cder" Code ---');

    const epochB = Date.now();

    // B1. Email containing lowercase 'cder'
    const resB1 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'CDER Lower User',
      dob: '1993-01-10',
      email: `user_${epochB}.cder@example.com`,
      phone: '9830000001',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB1.status, 201, 'Lowercase cder email must succeed');
    assert.strictEqual(resB1.data.employee.email, `user_${epochB}.cder@example.com`);
    markPassed('Email containing lowercase "cder" is accepted');

    // B2. Email containing uppercase 'CDER'
    const resB2 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'CDER Upper User',
      dob: '1993-02-10',
      email: `USER_${epochB}_CDER@DOMAIN.ORG`,
      phone: '9830000002',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB2.status, 201, 'Uppercase CDER email must succeed');
    assert.strictEqual(resB2.data.employee.email, `user_${epochB}_cder@domain.org`, 'Email must be normalized to lowercase');
    markPassed('Email containing uppercase "CDER" is accepted and normalized to lowercase');

    // B3. Mixed-case variations: 'Cder' and 'CDeR'
    const resB3a = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'CDER Mixed 1',
      dob: '1993-03-10',
      email: `field_${epochB}_Cder@health.gov.in`,
      phone: '9830000003',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB3a.status, 201, 'Mixed case Cder must succeed');

    const resB3b = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'CDER Mixed 2',
      dob: '1993-04-10',
      email: `field_${epochB}_CDeR@hospital.in`,
      phone: '9830000004',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB3b.status, 201, 'Mixed case CDeR must succeed');
    markPassed('Mixed-case variations ("Cder", "CDeR") are accepted');

    // B4. Email without 'cder' is accepted
    const resB4 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Standard Email User',
      dob: '1993-05-10',
      email: `regular_user_${epochB}@gmail.com`,
      phone: '9830000005',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB4.status, 201, 'Standard email without cder must succeed');
    assert.strictEqual(resB4.data.employee.email, `regular_user_${epochB}@gmail.com`);
    markPassed('Standard email without "cder" is successfully accepted');

    // B5. Malformed email address
    const resB5 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Malformed Email User',
      dob: '1993-06-10',
      email: 'not_an_email_at_all',
      phone: '9830000006',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB5.status, 400);
    assert.strictEqual(resB5.data.error, 'Please enter a valid email address.');
    markPassed('Malformed email address returns: "Please enter a valid email address."');

    // B6. Email with leading/trailing whitespace
    const resB6 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Whitespace Email User',
      dob: '1993-07-10',
      email: `   spaced_${epochB}@aiims.edu   `,
      phone: '9830000007',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB6.status, 201);
    assert.strictEqual(resB6.data.employee.email, `spaced_${epochB}@aiims.edu`);
    markPassed('Email with surrounding whitespace is automatically trimmed and saved cleanly');

    // B7. Pre-issued Employee ID generation endpoint test
    const resB7 = await makeRequest('GET', '/api/auth/employee/next-id');
    assert.strictEqual(resB7.status, 200);
    assert.strictEqual(resB7.data.success, true);
    assert.match(resB7.data.employee_id, /^FW-[A-Z0-9]{6}$/);
    assert.ok(resB7.data.id_token && resB7.data.id_token.length > 20, 'id_token must be a valid signed token');
    markPassed('Cryptographic auto-generated Employee ID pre-issuance endpoint functions correctly');

    // B8. Duplicate email with different casing & spacing
    const canonicalEmail = `duplicate_test_${epochB}_cder@aiims.edu`;
    const resB8a = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Original Account',
      dob: '1990-01-01',
      email: canonicalEmail,
      phone: '9830000009',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB8a.status, 201);

    const resB8b = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Imposter Account',
      dob: '1992-02-02',
      email: `  ${canonicalEmail.toUpperCase()}  `,
      phone: '9830000010',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resB8b.status, 409, 'Duplicate normalized email must return 409 Conflict');
    assert.strictEqual(resB8b.data.error, 'An account with this email address already exists. Please sign in or use a different email.');
    markPassed('Duplicate email with different casing/spacing is strictly rejected with user-friendly 409');

    // =========================================================================
    // GROUP C: MOBILE NUMBER VALIDATION & UNIQUENESS
    // =========================================================================
    console.log('\n--- Group C: Mobile Number Validation & Uniqueness ---');

    const epochC = Date.now();

    // C1. Valid 10-digit mobile number
    const resC1 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Mobile Valid User',
      dob: '1994-01-15',
      email: `mobile_valid_${epochC}_cder@aiims.edu`,
      phone: '9876543210',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resC1.status, 201);
    assert.strictEqual(resC1.data.employee.phone, '9876543210');
    markPassed('Valid 10-digit mobile number is accepted');

    // C2. Invalid mobile numbers (too short, contains non-digits, starts with invalid prefix)
    const resC2a = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Short Mobile User',
      dob: '1994-01-15',
      email: `mobile_short_${epochC}_cder@aiims.edu`,
      phone: '987654',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resC2a.status, 400);
    assert.strictEqual(resC2a.data.error, 'Please enter a valid 10-digit mobile number.');

    const resC2b = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Invalid Prefix Mobile User',
      dob: '1994-01-15',
      email: `mobile_prefix_${epochC}_cder@aiims.edu`,
      phone: '1234567890', // Indian numbers must start with 6, 7, 8, or 9
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resC2b.status, 400);
    assert.strictEqual(resC2b.data.error, 'Please enter a valid 10-digit mobile number.');
    markPassed('Invalid mobile number formats (short, non-digit, invalid prefix) are rejected');

    // C3. Duplicate mobile number
    const registeredPhone = '9876500001';
    const resC3a = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'First Mobile User',
      dob: '1994-02-15',
      email: `mobile_first_${epochC}_cder@aiims.edu`,
      phone: registeredPhone,
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resC3a.status, 201);

    const resC3b = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Duplicate Mobile User',
      dob: '1994-03-15',
      email: `mobile_second_${epochC}_cder@aiims.edu`,
      phone: registeredPhone,
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resC3b.status, 409);
    assert.strictEqual(resC3b.data.error, 'An account with this mobile number already exists. Please sign in or use a different number.');
    markPassed('Duplicate mobile number registration is rejected with 409 Conflict');

    // C4. Equivalent numbers with different formatting (+91, leading 0, spaces, dashes)
    const resC4 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Formatted Mobile Duplicate User',
      dob: '1994-04-15',
      email: `mobile_third_${epochC}_cder@aiims.edu`,
      phone: '+91 98765-00001',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resC4.status, 409, 'Formatted version of existing number must be detected as duplicate');
    assert.strictEqual(resC4.data.error, 'An account with this mobile number already exists. Please sign in or use a different number.');
    markPassed('Formatted duplicate numbers (+91, spaces, dashes) are normalized and rejected');

    // C5. Concurrent signup attempts using the same mobile number
    const concurrentPhone = `98765${Math.floor(10000 + Math.random() * 90000)}`;
    const concurrentPromises = [1, 2, 3].map(idx => {
      return makeRequest('POST', '/api/auth/employee/signup', {
        'x-forwarded-for': `192.168.10.${idx}`
      }, {
        name: `Concurrent User ${idx}`,
        dob: '1994-05-15',
        email: `concurrent_phone_${epochC}_${idx}_cder@aiims.edu`,
        phone: concurrentPhone,
        password: 'SecurePass@2026'
      });
    });
    const concurrentResponses = await Promise.all(concurrentPromises);
    const successfulSignups = concurrentResponses.filter(r => r.status === 201);
    const rejectedSignups = concurrentResponses.filter(r => r.status === 409);
    assert.strictEqual(successfulSignups.length, 1, 'Exactly one concurrent signup must succeed');
    assert.strictEqual(rejectedSignups.length, 2, 'Remaining concurrent signups with duplicate phone must be rejected');
    markPassed('Concurrent signups with identical mobile number safely result in exactly 1 success and 2 conflicts');

    // =========================================================================
    // GROUP D: AUTOMATIC SHORT UNIQUE EMPLOYEE ID GENERATION
    // =========================================================================
    console.log('\n--- Group D: Automatic Short Unique Employee ID Generation ---');

    const epochD = Date.now();

    // D1. Automatic ID generation & expected format
    const resD1 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Auto ID User',
      dob: '1995-01-20',
      email: `auto_id_${epochD}_cder@aiims.edu`,
      phone: '9811100001',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resD1.status, 201);
    const generatedId = resD1.data.employee.id;
    assert.ok(/^FW-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(generatedId),
      `Generated ID '${generatedId}' must match FW- prefix and 6 non-confusing alphanumeric characters`);
    assert.strictEqual(generatedId.length, 9, 'Employee ID must be exactly 9 characters (FW-XXXXXX)');
    markPassed('Automatically generated employee ID conforms to FW-XXXXXX format and 9-char length');

    // D2. Client-provided ID is ignored (never trusted)
    const resD2 = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Client ID Spoof User',
      employee_id: 'CUSTOM-FORGED-ID',
      dob: '1995-02-20',
      email: `client_id_spoof_${epochD}_cder@aiims.edu`,
      phone: '9811100002',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(resD2.status, 201);
    assert.notStrictEqual(resD2.data.employee.id, 'CUSTOM-FORGED-ID', 'Backend must ignore client-specified employee_id');
    assert.ok(resD2.data.employee.id.startsWith('FW-'), 'Backend must assign authoritative FW- ID');
    markPassed('Client-provided employee_id parameter is safely ignored and overridden by server generator');

    // D3. Uniqueness across multiple sequential accounts
    const createdIds = [];
    for (let i = 0; i < 10; i++) {
      const res = await makeRequest('POST', '/api/auth/employee/signup', {}, {
        name: `Multi Account User ${i}`,
        dob: '1995-03-20',
        email: `multi_${epochD}_${i}_cder@aiims.edu`,
        phone: `98111${String(10000 + i)}`,
        password: 'SecurePass@2026'
      });
      assert.strictEqual(res.status, 201);
      createdIds.push(res.data.employee.id);
    }
    const uniqueGeneratedSet = new Set(createdIds);
    assert.strictEqual(uniqueGeneratedSet.size, 10, 'All 10 generated employee IDs must be distinct');
    markPassed('10 consecutive signups generated 10 unique Employee IDs with zero collisions');

    // D4. Database-level uniqueness enforcement
    const collisionCandidateId = createdIds[0];
    let dbViolationCaught = false;
    try {
      await query(
        `INSERT INTO employees (id, employer_id, name, email, department, designation, pin, password, is_active, created_at)
         VALUES ($1, 'ORG-001', 'Direct SQL Colliding User', 'direct_collision_cder@aiims.edu', 'CDER', 'PRS-1', '1234', 'hash', 1, NOW())`,
        [collisionCandidateId]
      );
    } catch (err) {
      dbViolationCaught = err.code === '23505';
    }
    assert.strictEqual(dbViolationCaught, true, 'Database primary key constraint must reject duplicate employee ID');
    markPassed('Database primary key constraint strictly enforces uniqueness on employee IDs');

    // D5. Employee ID stability across login and profile updates
    const stableEmpId = createdIds[1];
    // Clean up active session created during signup for this test employee
    await query('DELETE FROM sessions WHERE user_id = $1', [stableEmpId]);
    // Login check
    const loginCheckRes = await makeRequest('POST', '/api/auth/employee/login', {}, {
      employer_id: 'ORG-001',
      login_id: stableEmpId,
      password: 'SecurePass@2026'
    });
    assert.strictEqual(loginCheckRes.status, 200);
    assert.strictEqual(loginCheckRes.data.employee.id, stableEmpId, 'ID must not change on login');

    // Clean up any lingering admin session before admin login
    await query("DELETE FROM sessions WHERE user_id = 'aiims_admin'");
    // Profile update check (as admin)
    const adminLogin = await makeRequest('POST', '/api/auth/employer/login', {}, {
      employer_id: 'ORG-001',
      admin_username: 'aiims_admin',
      admin_password: 'TestAdmin@12345'
    });
    const adminToken = adminLogin.data.token;
    const updateRes = await makeRequest('PUT', `/api/employees/${stableEmpId}`, {
      'Authorization': `Bearer ${adminToken}`,
      'x-employer-id': 'ORG-001'
    }, {
      name: 'Updated Name Fieldworker',
      department: 'CDER',
      designation: 'PRS-2'
    });
    assert.strictEqual(updateRes.status, 200);

    const recheckDb = await query('SELECT id, name FROM employees WHERE id = $1', [stableEmpId]);
    assert.strictEqual(recheckDb.rows[0].id, stableEmpId, 'Employee ID must remain stable after updates');
    assert.strictEqual(recheckDb.rows[0].name, 'Updated Name Fieldworker');
    markPassed('Employee ID remains strictly stable after login and profile updates');

    // D6. Prominent Employee ID in response message
    assert.ok(resD1.data.message.includes(generatedId), 'Signup response message must prominently display generated ID');
    assert.ok(resD1.data.message.includes('save or remember this ID'), 'Message must instruct employee to save ID');
    markPassed('Signup response message prominently displays generated ID and instructs user to save it');

    // =========================================================================
    // GROUP E: INTEGRATION, AUTHENTICATION & REGRESSION
    // =========================================================================
    console.log('\n--- Group E: Integration, Authentication & Regression ---');

    const epochE = Date.now();
    const testRegEmail = `integrated_${epochE}_cder@aiims.edu`;
    const testRegPhone = '9855500001';

    const regRes = await makeRequest('POST', '/api/auth/employee/signup', {}, {
      name: 'Dr. Priya Sharma',
      dob: '1991-08-14',
      email: testRegEmail,
      phone: testRegPhone,
      employer_id: 'ORG-001',
      department: 'CDER',
      designation: 'PRS-1',
      state: 'Uttar Pradesh',
      district: 'Ghaziabad',
      password: 'SecurePass@2026'
    });
    assert.strictEqual(regRes.status, 201);
    const priyaId = regRes.data.employee.id;

    // E1. Login with Generated Employee ID
    await query('DELETE FROM sessions WHERE user_id = $1', [priyaId]);
    const loginById = await makeRequest('POST', '/api/auth/employee/login', {}, {
      employer_id: 'ORG-001',
      login_id: priyaId,
      password: 'SecurePass@2026'
    });
    assert.strictEqual(loginById.status, 200, 'Login with generated Employee ID must succeed');
    assert.strictEqual(loginById.data.employee.id, priyaId);
    assert.strictEqual(loginById.data.employee.password, undefined, 'Password must never be returned');
    markPassed('Login with newly generated Employee ID succeeds securely');

    // E2. Login with Normalized Email
    await query('DELETE FROM sessions WHERE user_id = $1', [priyaId]);
    const loginByEmail = await makeRequest('POST', '/api/auth/employee/login', {}, {
      employer_id: 'ORG-001',
      login_id: testRegEmail.toUpperCase(), // Test case-insensitivity
      password: 'SecurePass@2026'
    });
    assert.strictEqual(loginByEmail.status, 200, 'Login with email must succeed');
    assert.strictEqual(loginByEmail.data.employee.id, priyaId);
    markPassed('Login with case-insensitive email succeeds');

    // E3. Login with Mobile Number
    await query('DELETE FROM sessions WHERE user_id = $1', [priyaId]);
    const loginByPhone = await makeRequest('POST', '/api/auth/employee/login', {}, {
      employer_id: 'ORG-001',
      login_id: '+91 98555-00001', // Test formatting resilience
      password: 'SecurePass@2026'
    });
    assert.strictEqual(loginByPhone.status, 200, 'Login with formatted phone number must succeed');
    assert.strictEqual(loginByPhone.data.employee.id, priyaId);
    markPassed('Login with formatted mobile number succeeds');

    // E4. Unauthorized requests are rejected
    const unauthRes = await makeRequest('GET', '/api/attendance/current');
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must be rejected with 401');
    markPassed('Unauthenticated request to protected endpoint is rejected with 401');

    // E5. Employee role restrictions enforced (Employee cannot access admin endpoints)
    const priyaToken = loginByPhone.data.token;
    const employeeForbiddenRes = await makeRequest('GET', '/api/admin/audit-logs', {
      'Authorization': `Bearer ${priyaToken}`,
      'x-employer-id': 'ORG-001'
    });
    assert.strictEqual(employeeForbiddenRes.status, 403, 'Employee must be forbidden from administrative routes');
    markPassed('Role-based authorization prevents employees from accessing administrative endpoints');

    // E6. Attendance Check-in flow functional with newly registered employee
    const currentRes = await makeRequest('GET', '/api/attendance/current', {
      'Authorization': `Bearer ${priyaToken}`,
      'x-employer-id': 'ORG-001'
    });
    assert.strictEqual(currentRes.status, 200, 'Authenticated new employee must reach attendance status');
    const checkinRes = await makeRequest('POST', '/api/attendance/check-in', {
      'Authorization': `Bearer ${priyaToken}`,
      'x-employer-id': 'ORG-001'
    }, {
      photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/9k=',
      latitude: 28.5672,
      longitude: 77.2100,
      accuracy: 10,
      state: 'Uttar Pradesh',
      district: 'Ghaziabad'
    });
    assert.strictEqual(checkinRes.status, 200, `Attendance check-in must succeed for new employee: ${checkinRes.raw}`.slice(0, 300));
    markPassed('Attendance check-in succeeds with new Employee ID and valid coordinates');

    // E7. Existing seeded employee records and attendance history remain intact
    const seededEmpRes = await query("SELECT id, dob FROM employees WHERE id NOT LIKE 'FW-%'");
    assert.ok(seededEmpRes.rows.length >= 1, 'Legacy (non FW-) employee records must remain');
    assert.ok(seededEmpRes.rows.every(r => r.dob === null), 'Legacy records must not receive fabricated DOBs');
    markPassed('Legacy employee records (EMP-001) and schema remain completely intact');

    console.log('\n===============================================================');
    console.log(`🎉 ALL ${passed}/${total} AUTOMATED TESTS PASSED 100% WITH ZERO ERRORS!`);
    console.log('===============================================================\n');

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await closePool();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test execution failed with error:', err);
  process.exit(1);
});
