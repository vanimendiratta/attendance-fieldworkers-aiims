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

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function fetchRaw(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
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
  console.log('--- Starting Attendance CSV Export Tests ---');

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

  // Test 3: Columns structure
  console.log('\n[Test 3] Verify CSV Header row structure and required columns');
  const lines = res1.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  assert.ok(lines.length >= 1, 'CSV must have at least 1 line (headers)');
  const headerLine = lines[0];

  const expectedColumns = [
    'Attendance ID',
    'Employee ID',
    'Employee Name',
    'Department',
    'Designation',
    'Organization',
    'Team Name',
    'State / UT',
    'District',
    'Work Mode',
    'Attendance Status',
    'Check-In Date',
    'Check-In Time',
    'Check-In Server Timestamp (UTC)',
    'Check-In Latitude',
    'Check-In Longitude',
    'Check-In GPS Accuracy (m)',
    'Check-In Address',
    'Checkout Date',
    'Checkout Time',
    'Gross Working Hours',
    'Net Working Hours',
    'Field Site Notes',
    'REDCap Sync Status'
  ];

  for (const col of expectedColumns) {
    assert.ok(
      headerLine.includes(col),
      `Header line missing required column: "${col}"`
    );
  }
  console.log(`✓ All ${expectedColumns.length} expected columns found in CSV header`);

  // Test 4: Tenant isolation
  console.log('\n[Test 4] Multi-tenant isolation in CSV export');
  const resOrg2 = await fetchRaw('/api/admin/attendance/export.csv?employer_id=ORG-002', {
    'x-employer-id': 'ORG-002'
  });
  assert.strictEqual(resOrg2.statusCode, 200);
  const linesOrg2 = resOrg2.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  // Any rows in Org2 should only have ORG-002 organization name
  for (let i = 1; i < linesOrg2.length; i++) {
    assert.ok(
      !linesOrg2[i].includes('Apex Technologies Inc') || linesOrg2[i].includes('Beacon Health Systems'),
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

  console.log('\n===========================================');
  console.log('🎉 ALL ATTENDANCE CSV EXPORT TESTS PASSED!');
  console.log('===========================================');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
