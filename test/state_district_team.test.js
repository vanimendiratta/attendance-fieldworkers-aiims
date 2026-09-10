/**
 * Comprehensive Automated Tests for Indian States, Districts, Regional Teams,
 * and Simultaneous Multi-State Attendance Operations.
 */

const assert = require('assert');
const http = require('http');
const { STATE_DISTRICTS_MAP, getAllStates, getDistrictsForState, matchStateAndDistrict } = require('../src/data/india_states_districts');
const db = require('../src/db/database');
const teamService = require('../src/services/team_service');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function createUniquePhotoDataUri(variant = 1) {
  const base = Buffer.from(
    variant === 1
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      : variant === 2
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      : variant === 3
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      : 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8/x+I/zMwMAPRAQAAqAMh1qH1tAAAAABJRU5ErkJggg==',
    'base64'
  );
  const entropy = Buffer.from(`\n// salt_${Date.now()}_${Math.random()}_${variant}`);
  const combined = Buffer.concat([base, entropy]);
  return `data:image/png;base64,${combined.toString('base64')}`;
}

function apiRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runStateDistrictTeamTests() {
  console.log('\n===============================================================');
  console.log('🇮🇳 TESTING INDIAN STATES, DISTRICTS & REGIONAL TEAMS OPERATIONS');
  console.log('===============================================================\n');

  // Test 1: Validate Indian States & Districts Dictionary
  console.log('1. Testing State & District Dictionary...');
  const states = getAllStates();
  assert.strictEqual(states.length, 36, `Expected exactly 36 States and UTs, found ${states.length}`);
  assert.ok(states.includes('Delhi'), 'Delhi should be in states list');
  assert.ok(states.includes('Maharashtra'), 'Maharashtra should be in states list');
  assert.ok(states.includes('Karnataka'), 'Karnataka should be in states list');
  assert.ok(states.includes('Tamil Nadu'), 'Tamil Nadu should be in states list');
  assert.ok(states.includes('Gujarat'), 'Gujarat should be in states list');

  const delhiDistricts = getDistrictsForState('Delhi');
  assert.ok(delhiDistricts.length >= 11, 'Delhi should have at least 11 districts');
  assert.ok(delhiDistricts.includes('New Delhi'), 'New Delhi should be in Delhi districts');
  assert.ok(delhiDistricts.includes('South Delhi'), 'South Delhi should be in Delhi districts');

  const maharashtraDistricts = getDistrictsForState('Maharashtra');
  assert.ok(maharashtraDistricts.includes('Mumbai City'), 'Mumbai City should be in Maharashtra');
  assert.ok(maharashtraDistricts.includes('Pune'), 'Pune should be in Maharashtra');

  // Test address reverse-geocoding matching
  const matchResult1 = matchStateAndDistrict('Connaught Place, New Delhi, Delhi, 110001, India');
  assert.strictEqual(matchResult1.state, 'Delhi');
  assert.strictEqual(matchResult1.district, 'New Delhi');

  const matchResult2 = matchStateAndDistrict('Bandra Kurla Complex, Mumbai Suburban, Maharashtra, 400051, India');
  assert.strictEqual(matchResult2.state, 'Maharashtra');
  assert.strictEqual(matchResult2.district, 'Mumbai Suburban');
  console.log('   ✓ Indian State and District dictionary and NLP pattern matcher passed');

  // Test 2: Geo API Endpoints
  console.log('2. Testing Geo HTTP Endpoints...');
  const resStates = await apiRequest('GET', '/api/geo/states');
  assert.strictEqual(resStates.status, 200);
  assert.strictEqual(resStates.data.states.length, 36);

  const resDistricts = await apiRequest('GET', '/api/geo/districts?state=Karnataka');
  assert.strictEqual(resDistricts.status, 200);
  assert.ok(resDistricts.data.districts.includes('Bengaluru Urban'));

  const resAllMap = await apiRequest('GET', '/api/geo/states-districts');
  assert.strictEqual(resAllMap.status, 200);
  assert.strictEqual(resAllMap.data.totalStates, 36);
  console.log('   ✓ Geo API endpoints returned full 36 states and dynamic districts');

  // Test 3: Regional Team Creation & Validation
  console.log('3. Testing Regional Team Creation & Validation...');
  const resCreateInvalid = await apiRequest('POST', '/api/teams', {
    employer_id: 'ORG-001',
    name: 'Invalid District Team',
    state: 'Karnataka',
    district: 'NonExistentDistrictName',
    description: 'Should fail validation'
  });
  assert.strictEqual(resCreateInvalid.status, 400, 'Invalid district should be rejected');
  assert.ok(resCreateInvalid.data.error.includes('does not belong to State "Karnataka"'));

  const uniqueSuffix = Date.now();
  const resCreateValid = await apiRequest('POST', '/api/teams', {
    employer_id: 'ORG-001',
    name: `Chennai Coastal Squad ${uniqueSuffix}`,
    state: 'Tamil Nadu',
    district: 'Chennai',
    description: 'Field operations team for Chennai district'
  });
  assert.strictEqual(resCreateValid.status, 201);
  assert.ok(resCreateValid.data.team.id);
  assert.strictEqual(resCreateValid.data.team.state, 'Tamil Nadu');
  assert.strictEqual(resCreateValid.data.team.district, 'Chennai');
  const createdTeamId = resCreateValid.data.team.id;
  console.log('   ✓ Team creation with strict state-district validation passed');

  // Test 4: Assign Employee to Regional Team
  console.log('4. Testing Employee Team Assignment...');
  const resAssign = await apiRequest('POST', '/api/teams/assign', {
    employer_id: 'ORG-001',
    employee_id: 'EMP-1003',
    team_id: createdTeamId
  });
  assert.strictEqual(resAssign.status, 200);
  assert.strictEqual(resAssign.data.team_id, createdTeamId);
  assert.strictEqual(resAssign.data.state, 'Tamil Nadu');
  assert.strictEqual(resAssign.data.district, 'Chennai');
  console.log('   ✓ Employee assigned to team and territorial profile synchronized');

  // Test 5: Simultaneous Multi-State Attendance Tracking
  console.log('5. Testing Simultaneous Multi-State Attendance Tracking...');
  
  // Clear any existing attendance for the test employees so they can record their single daily punch
  db.prepare("DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id IN ('EMP-1001', 'EMP-1002', 'EMP-1003'))").run();
  db.prepare("DELETE FROM attendance WHERE employee_id IN ('EMP-1001', 'EMP-1002', 'EMP-1003')").run();

  // Employee 1 punches check-in for Delhi (Delhi Regional Headquarters)
  const punchDelhi = await apiRequest('POST', '/api/attendance/check-in', {
    photo: createUniquePhotoDataUri(1),
    latitude: 28.5672,
    longitude: 77.2100,
    accuracy: 14.5,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `punch_delhi_${Date.now()}`,
    work_mode: 'FIELD_WORK',
    field_site_notes: 'Connaught Place Client Audit',
    state: 'Delhi',
    district: 'New Delhi',
    team_id: 'TEAM-101'
  }, {
    'x-employee-id': 'EMP-1001',
    'x-employer-id': 'ORG-001'
  });
  assert.strictEqual(punchDelhi.status, 200, `Delhi punch failed: ${JSON.stringify(punchDelhi.data)}`);
  assert.strictEqual(punchDelhi.data.attendance.state, 'Delhi');
  assert.strictEqual(punchDelhi.data.attendance.district, 'New Delhi');
  assert.strictEqual(punchDelhi.data.attendance.team_id, 'TEAM-101');

  // Employee 2 punches check-in for Maharashtra (Maharashtra West Operations)
  const punchMumbai = await apiRequest('POST', '/api/attendance/check-in', {
    photo: createUniquePhotoDataUri(2),
    latitude: 19.0760,
    longitude: 72.8777,
    accuracy: 18.2,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `punch_mumbai_${Date.now()}`,
    work_mode: 'FIELD_WORK',
    field_site_notes: 'BKC Corporate Branch Inspection',
    state: 'Maharashtra',
    district: 'Mumbai Suburban',
    team_id: 'TEAM-103'
  }, {
    'x-employee-id': 'EMP-1002',
    'x-employer-id': 'ORG-001'
  });
  assert.strictEqual(punchMumbai.status, 200, `Mumbai punch failed: ${JSON.stringify(punchMumbai.data)}`);
  assert.strictEqual(punchMumbai.data.attendance.state, 'Maharashtra');
  assert.strictEqual(punchMumbai.data.attendance.district, 'Mumbai Suburban');
  assert.strictEqual(punchMumbai.data.attendance.team_id, 'TEAM-103');

  // Employee 3 punches check-in for Tamil Nadu (Chennai Coastal Squad)
  const punchChennai = await apiRequest('POST', '/api/attendance/check-in', {
    photo: createUniquePhotoDataUri(3),
    latitude: 13.0827,
    longitude: 80.2707,
    accuracy: 12.0,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `punch_chennai_${Date.now()}`,
    work_mode: 'FIELD_WORK',
    field_site_notes: 'Marina Harbor Client Deployment',
    state: 'Tamil Nadu',
    district: 'Chennai',
    team_id: createdTeamId
  }, {
    'x-employee-id': 'EMP-1003',
    'x-employer-id': 'ORG-001'
  });
  assert.strictEqual(punchChennai.status, 200, `Chennai punch failed: ${JSON.stringify(punchChennai.data)}`);
  assert.strictEqual(punchChennai.data.attendance.state, 'Tamil Nadu');
  assert.strictEqual(punchChennai.data.attendance.district, 'Chennai');
  console.log('   ✓ Simultaneous check-ins across Delhi, Maharashtra, and Tamil Nadu accepted');

  // Test 6: Multi-State Regional Operations Matrix
  console.log('6. Testing Multi-State Operations Matrix API...');
  const resMatrix = await apiRequest('GET', '/api/admin/attendance/matrix?employer_id=ORG-001');
  assert.strictEqual(resMatrix.status, 200);
  assert.ok(resMatrix.data.success);
  assert.ok(resMatrix.data.totalActive >= 3, `Expected at least 3 active employees, got ${resMatrix.data.totalActive}`);
  assert.ok(resMatrix.data.activeStatesCount >= 3, `Expected at least 3 active states, got ${resMatrix.data.activeStatesCount}`);

  const stateNames = resMatrix.data.matrix.states.map(m => m.state);
  assert.ok(stateNames.includes('Delhi'), 'Matrix should report Delhi');
  assert.ok(stateNames.includes('Maharashtra'), 'Matrix should report Maharashtra');
  assert.ok(stateNames.includes('Tamil Nadu'), 'Matrix should report Tamil Nadu');

  const delhiMatrix = resMatrix.data.matrix.states.find(m => m.state === 'Delhi');
  assert.ok(delhiMatrix.total_active >= 1);
  const mumbaiMatrix = resMatrix.data.matrix.states.find(m => m.state === 'Maharashtra');
  assert.ok(mumbaiMatrix.total_active >= 1);
  const tnMatrix = resMatrix.data.matrix.states.find(m => m.state === 'Tamil Nadu');
  assert.ok(tnMatrix.total_active >= 1);
  console.log(`   ✓ Live Matrix calculated: ${resMatrix.data.totalActive} active across ${resMatrix.data.activeStatesCount} states concurrently`);

  // Test 7: Attendance Filtering by State and District
  console.log('7. Testing Attendance State/District Filtering...');
  const resFilterDelhi = await apiRequest('GET', '/api/admin/attendance?employer_id=ORG-001&state=Delhi');
  assert.strictEqual(resFilterDelhi.status, 200);
  assert.ok(resFilterDelhi.data.records.every(r => r.state === 'Delhi'));

  const resFilterMumbai = await apiRequest('GET', '/api/admin/attendance?employer_id=ORG-001&state=Maharashtra&district=Mumbai+Suburban');
  assert.strictEqual(resFilterMumbai.status, 200);
  assert.ok(resFilterMumbai.data.records.every(r => r.state === 'Maharashtra' && r.district === 'Mumbai Suburban'));

  const resFilterTeam = await apiRequest('GET', `/api/admin/attendance?employer_id=ORG-001&team_id=${createdTeamId}`);
  assert.strictEqual(resFilterTeam.status, 200);
  assert.ok(resFilterTeam.data.records.every(r => r.team_id === createdTeamId));
  console.log('   ✓ Granular filtering by State, District, and Team validated');

  // Clean up active test sessions
  db.prepare("UPDATE attendance SET attendance_status = 'CHECKED_OUT' WHERE attendance_status IN ('CHECKED_IN', 'ON_BREAK')").run();

  console.log('\n===============================================================');
  console.log('🎉 ALL INDIAN STATES, DISTRICTS & TEAM TESTS PASSED WITH 100% SUCCESS!');
  console.log('===============================================================\n');
}

runStateDistrictTeamTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
