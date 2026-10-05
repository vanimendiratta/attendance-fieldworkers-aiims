/**
 * Automated Tests for Excel-Compatible Attendance CSV Export
 *
 * Requirements Verified:
 * 1. GET /api/admin/attendance/export.csv returns 200 OK with Content-Type: text/csv; charset=utf-8
 * 2. UTF-8 Byte Order Mark (\uFEFF) is present at index 0 for native Microsoft Excel compatibility
 * 3. Content-Disposition header contains an attachment with a valid filename
 * 4. Header row contains all requisite enterprise attendance columns
 * 5. Multi-tenant isolation: only records belonging to the requested employer are exported
 * 6. Work mode, state, district, status, and search filters are properly applied in CSV export
 */

const assert = require('assert');
const http = require('http');
const app = require('../server');
const db = require('../src/db/database');

let BASE_URL = process.env.TEST_BASE_URL || '';
let serverInstance = null;
let adminToken = '';

function fetchRaw(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBuffer: buffer,
          text: buffer.toString('utf-8')
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  if (!BASE_URL) {
    serverInstance = app.listen(0);
    const port = serverInstance.address().port;
    BASE_URL = `http://localhost:${port}`;
  }

  const sessionService = require('../src/services/session_service');
  const adminSession = await sessionService.createSession({
    sessionType: 'admin',
    userId: 'aiims_admin',
    employerId: 'ORG-001'
  });
  adminToken = adminSession.token;

  console.log('--- Starting Attendance CSV Export Tests ---');

  try {
  // Test 1: Basic CSV Export endpoint check
  console.log('\n[Test 1] GET /api/admin/attendance/export.csv returns 200 and text/csv headers');
  const res1 = await fetchRaw('/api/admin/attendance/export.csv?employer_id=ORG-001', {
    'x-employer-id': 'ORG-001'
  });

  assert.strictEqual(res1.statusCode, 200, `Expected status 200, got ${res1.statusCode}`);
  assert.ok(
    res1.headers['content-type'] && res1.headers['content-type'].includes('text/csv'),
    `Expected text/csv content-type, got ${res1.headers['content-type']}`
  );
  assert.ok(
    res1.headers['content-disposition'] && res1.headers['content-disposition'].includes('attachment'),
    `Expected attachment content-disposition, got ${res1.headers['content-disposition']}`
  );
  assert.ok(
    res1.headers['content-disposition'].includes('.csv'),
    `Expected .csv in filename, got ${res1.headers['content-disposition']}`
  );
  console.log('✓ Headers and status 200 verified');

  // Test 2: UTF-8 Byte Order Mark for Excel
  console.log('\n[Test 2] Verify Excel UTF-8 Byte Order Mark (\\uFEFF / EF BB BF)');
  assert.strictEqual(
    res1.rawBuffer[0], 0xEF,
    'First byte must be 0xEF (BOM byte 1)'
  );
  assert.strictEqual(
    res1.rawBuffer[1], 0xBB,
    'Second byte must be 0xBB (BOM byte 2)'
  );
  assert.strictEqual(
    res1.rawBuffer[2], 0xBF,
    'Third byte must be 0xBF (BOM byte 3)'
  );
  assert.ok(
    res1.text.startsWith('\uFEFF'),
    'Decoded text must start with UTF-8 BOM character'
  );
  console.log('✓ Excel BOM is present at index 0');

  // Test 3: Complete 37 Columns Structure
  console.log('\n[Test 3] Verify complete 37-column enterprise CSV header structure');
  const lines = res1.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  assert.ok(lines.length >= 1, 'CSV must have at least 1 line (headers)');
  const headerLine = lines[0];
  const headerColumns = headerLine.split(',');

  const authoritativeColumns = [
    'Attendance ID','Employee ID','Employee Name','Department','Designation','Email',
    'Organization','Team Name','State / UT','District','Work Mode','Attendance Status',
    'Location Classification','Hotel / Stay Name','Hotel Room Number','Hotel Contact Phone',
    'Holiday / Sunday Duty','Holiday Name','Comp-Off Credit',
    'Check-In Date','Check-In Time','Check-In Server Timestamp (UTC)',
    'Check-In Latitude','Check-In Longitude','Check-In GPS Accuracy (m)',
    'Exact Google Maps Satellite Pin URL',
    'Check-In Geofence Distance (m)','Check-In Geofence Status','Check-In Address',
    'Checkout Date','Checkout Time','Checkout Server Timestamp (UTC)',
    'Checkout Latitude','Checkout Longitude','Checkout GPS Accuracy (m)',
    'Checkout Geofence Distance (m)','Checkout Geofence Status','Checkout Address',
    'Gross Working Hours','Break Minutes','Net Working Hours','Overtime Hours',
    'Shift Variance vs Target (Dec)','Field Site Notes','DB Sync Status','Created At'
  ];

  assert.strictEqual(
    headerColumns.length, authoritativeColumns.length,
    `Authoritative enterprise attendance CSV must have exactly ${authoritativeColumns.length} columns, but found ${headerColumns.length}`
  );

  for (let i = 0; i < authoritativeColumns.length; i++) {
    assert.strictEqual(
      headerColumns[i], authoritativeColumns[i],
      `Column ${i + 1} mismatch: expected "${authoritativeColumns[i]}", got "${headerColumns[i]}"`
    );
  }
  console.log(`✓ All ${authoritativeColumns.length} authoritative enterprise columns verified in exact sequence`);

  // Test 4: Tenant isolation
  console.log('\n[Test 4] Multi-tenant isolation in CSV export');
  await db.query(`
    INSERT INTO organizations (id, name, office_name, office_lat, office_lng, geofence_radius_m, geofence_policy, max_gps_accuracy_m, shift_hours, timezone, admin_username, admin_password, is_active, updated_at)
    VALUES ('ORG-002', 'Cyberdyne', 'Cyberdyne HQ', 19.0760, 72.8777, 500, 'ALLOW_WITH_FLAG', 500, 8.0, 'Asia/Kolkata', 'org2_admin', 'hash', 1, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  const org2Session = await sessionService.createSession({
    sessionType: 'admin',
    userId: 'org2_admin',
    employerId: 'ORG-002'
  });

  const resOrg2 = await fetchRaw('/api/admin/attendance/export.csv?employer_id=ORG-002', {
    'Authorization': `Bearer ${org2Session.token}`
  });
  assert.strictEqual(resOrg2.statusCode, 200);
  const linesOrg2 = resOrg2.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  for (let i = 1; i < linesOrg2.length; i++) {
    assert.ok(
      !linesOrg2[i].includes('AIIMS') || linesOrg2[i].includes('Cyberdyne'),
      'Org 2 CSV should not leak Org 1 records'
    );
  }
  console.log('✓ Tenant isolation maintained in CSV export');

  // Test 5: Filter by work_mode
  console.log('\n[Test 5] Filter CSV export by work_mode=FIELD_WORK');
  const resField = await fetchRaw('/api/admin/attendance/export.csv?employer_id=ORG-001&work_mode=FIELD_WORK', {
    'x-employer-id': 'ORG-001'
  });
  assert.strictEqual(resField.statusCode, 200);
  const linesField = resField.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  console.log(`✓ Found ${linesField.length - 1} field work records in exported CSV`);
  for (let i = 1; i < linesField.length; i++) {
    assert.ok(
      linesField[i].includes('Field Work'),
      'Filtered CSV rows should only contain Field Work records'
    );
  }

  // Test 6: Search filter
  console.log('\n[Test 6] Filter CSV export by search query');
  const resSearch = await fetchRaw('/api/admin/attendance/export.csv?employer_id=ORG-001&search=Aarav', {
    'x-employer-id': 'ORG-001'
  });
  assert.strictEqual(resSearch.statusCode, 200);
  const linesSearch = resSearch.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  for (let i = 1; i < linesSearch.length; i++) {
    assert.ok(
      linesSearch[i].includes('Aarav'),
      'Search filtered CSV should match Aarav'
    );
  }
  console.log(`✓ Search filter correctly exported ${linesSearch.length - 1} matching records`);

  // Test 7: CSV / Excel Formula Injection Sanitization
  console.log('\n[Test 7] Verify CSV / Excel formula injection sanitization (=, +, -, @)');
  const testAttId = 'TEST-FORMULA-ATT-' + Date.now();
  await db.query(`
    INSERT INTO attendance (
      id, employee_id, employer_id, attendance_status, checkin_photo,
      checkin_lat, checkin_lng, checkin_accuracy, checkin_server_timestamp,
      work_mode, field_site_notes, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [
    testAttId, 'EMP-1001', 'ORG-001', 'CHECKED_IN', 'data:image/png;base64,test',
    28.5662, 77.2136, 10, new Date().toISOString(),
    'FIELD_WORK', '=SUM(1+1)*cmd|', new Date().toISOString(), new Date().toISOString()
  ]);

  const resFormula = await fetchRaw(`/api/admin/attendance/export.csv?employer_id=ORG-001&search=${encodeURIComponent('=SUM')}`, {
    'x-employer-id': 'ORG-001'
  });
  assert.strictEqual(resFormula.statusCode, 200);
  assert.ok(
    resFormula.text.includes("'=SUM(1+1)*cmd|"),
    'Formula injection must be safely prefixed with single quote in CSV output'
  );
  // Cleanup test record
  await db.query('DELETE FROM attendance WHERE id = $1', [testAttId]);
  console.log('✓ Excel formula injection strictly neutralized with leading quote escape');

  console.log('\n===========================================');
  console.log('🎉 ALL ATTENDANCE CSV EXPORT TESTS PASSED!');
  console.log('===========================================');
  } finally {
    if (serverInstance) serverInstance.close();
  }
}

runTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ Test failed:', err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
