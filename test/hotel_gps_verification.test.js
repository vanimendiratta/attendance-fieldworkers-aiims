/**
 * Automated Test Suite — Hotel Stay GPS Verification, Map Pinning & Hotel Location Matching
 *
 * Covers:
 * 1. Unit Tests:
 *    - Text normalization & token similarity algorithms.
 *    - Haversine geographic distance calculations.
 *    - GPS accuracy validation (< 150m accepted, >= 150m rejected as LOW_ACCURACY).
 *    - GPS capture freshness checks (> 10m rejected as stale).
 *    - Cryptographic HMAC-SHA256 signature generation, validation, and anti-tamper rejection.
 *    - Location matching logic (VERIFIED, LOCATION_MISMATCH, NAME_MISMATCH, AMBIGUOUS, UNVERIFIABLE).
 *
 * 2. Backend & Security API Tests:
 *    - Unauthenticated verification requests are rejected (401).
 *    - Verification endpoint evaluates coordinates & candidates with synthetic mock provider.
 *    - Direct save without verification token is blocked (400).
 *    - Forged / tampered verification tokens (coordinate or hotel name swap) are rejected (400).
 *    - Verification token from employee A cannot be used by employee B.
 *    - Verified hotel stays persist all audit metadata (accuracy, distance, matched place, timestamp).
 *    - Unverifiable stays can be submitted for manual review (PENDING_REVIEW).
 *    - Admin override endpoint authorizes manual approval with audit flags.
 */

'use strict';

const assert = require('assert');
const http = require('http');
const testHelper = require('./test_helper');
const authService = require('../src/services/auth_service');
const hotelVerificationService = require('../src/services/hotel_verification_service');
const app = require('../server');

let server;
let baseUrl;
let requestCounter = 0;

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    requestCounter++;
    const url = new URL(urlPath, baseUrl);
    const reqHeaders = {
      'x-forwarded-for': `127.0.2.${(requestCounter % 200) + 1}`,
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
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function extractCookie(headers, cookieName) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookies) {
    const match = c.match(new RegExp(`^${cookieName}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function runTestSuite() {
  console.log('🧪 Starting Hotel Stay GPS Verification Test Suite...\n');

  // =========================================================================
  // Section 1: Pure Unit Tests (Algorithms & Matching Engine)
  // =========================================================================
  console.log('--- Section 1: Verification Engine Unit Tests ---');

  // 1.1 Text Normalization
  const norm1 = hotelVerificationService.normalizePlaceText('  Hotel Radisson Blu, New Delhi!  ');
  assert.strictEqual(norm1, 'hotel radisson blu new delhi', 'Should strip punctuation, extra whitespace, and lowercase');

  const norm2 = hotelVerificationService.normalizePlaceText('The Grand Hyatt Res & Suites');
  assert.strictEqual(norm2, 'the grand hyatt residency suites', 'Should expand abbreviations like res -> residency');
  console.log('✓ Text normalization and token sanitization passed');

  // 1.2 Token Jaccard Similarity
  const simHigh = hotelVerificationService.calculateTokenSimilarity('Hotel Maurya Palace', 'Maurya Palace Inn');
  assert(simHigh >= 0.5, 'Shared tokens Maurya and Palace should produce high similarity');

  const simLow = hotelVerificationService.calculateTokenSimilarity('Taj Vivanta', 'Ginger Budget Hotel');
  assert.strictEqual(simLow, 0, 'Completely different names should have zero similarity');
  console.log('✓ Token similarity calculation passed');

  // 1.3 Haversine Distance
  // AIIMS New Delhi (28.5672, 77.2100) to Safdarjung Hospital (28.5695, 77.2075) ~ 350-400m
  const distance = hotelVerificationService.calculateHaversineDistance(28.5672, 77.2100, 28.5695, 77.2075);
  assert(distance > 300 && distance < 450, `Calculated distance should be ~360m, got ${distance}`);
  console.log(`✓ Haversine distance calculation verified (${distance}m)`);

  // 1.4 GPS Accuracy Threshold
  const highAccResult = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'AIIMS Guest House',
    hotelAddress: 'Ansari Nagar',
    latitude: 28.5672,
    longitude: 77.2100,
    accuracy: 30, // Good accuracy
    captureTimestamp: Date.now()
  });
  // Since mock isn't set yet, it returns UNVERIFIABLE or match, but NOT LOW_ACCURACY
  assert.notStrictEqual(highAccResult.status, 'LOW_ACCURACY', 'Good accuracy must not trigger LOW_ACCURACY');

  const lowAccResult = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'AIIMS Guest House',
    hotelAddress: 'Ansari Nagar',
    latitude: 28.5672,
    longitude: 77.2100,
    accuracy: 250, // Exceeds default 150m threshold
    captureTimestamp: Date.now()
  });
  assert.strictEqual(lowAccResult.status, 'LOW_ACCURACY', 'GPS accuracy >= 150m must be rejected as LOW_ACCURACY');
  console.log('✓ GPS accuracy threshold enforcement passed');

  // 1.5 GPS Freshness Check
  const staleResult = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'AIIMS Guest House',
    hotelAddress: 'Ansari Nagar',
    latitude: 28.5672,
    longitude: 77.2100,
    accuracy: 20,
    captureTimestamp: Date.now() - 15 * 60 * 1000 // 15 minutes old (exceeds 10m threshold)
  });
  assert.strictEqual(staleResult.status, 'LOW_ACCURACY', 'Stale GPS reading must be rejected');
  assert(staleResult.reason.includes('stale') || staleResult.reason.includes('older than'), 'Reason should identify stale reading');
  console.log('✓ Stale GPS reading rejection passed');

  // 1.6 HMAC Token Signing & Tamper Detection
  const validTokenPayload = {
    employeeId: 'EMP-001',
    hotelName: 'Hotel Leela Palace',
    latitude: 28.5789,
    longitude: 77.1950,
    accuracy: 15,
    placeId: 'osm-12345',
    verifiedPlaceName: 'The Leela Palace New Delhi',
    verifiedAddress: 'Chanakyapuri, Diplomatic Enclave, New Delhi',
    distanceMeters: 45
  };
  const token = hotelVerificationService.signVerificationToken(validTokenPayload);
  assert(typeof token === 'string' && token.length > 30, 'HMAC token must be a non-empty string');

  const decoded = hotelVerificationService.verifyVerificationToken(token, {
    employeeId: 'EMP-001',
    hotelName: 'Hotel Leela Palace',
    latitude: 28.5789,
    longitude: 77.1950
  });
  assert.strictEqual(decoded.valid, true, 'Original payload with matching verification details must be valid');

  // Tamper test 1: Employee ID mismatch
  const tamperedEmp = hotelVerificationService.verifyVerificationToken(token, {
    employeeId: 'EMP-002',
    hotelName: 'Hotel Leela Palace',
    latitude: 28.5789,
    longitude: 77.1950
  });
  assert.strictEqual(tamperedEmp.valid, false, 'Token used by a different employee must be rejected');

  // Tamper test 2: Hotel Name mismatch
  const tamperedName = hotelVerificationService.verifyVerificationToken(token, {
    employeeId: 'EMP-001',
    hotelName: 'Different Hotel',
    latitude: 28.5789,
    longitude: 77.1950
  });
  assert.strictEqual(tamperedName.valid, false, 'Token with altered hotel name must be rejected');

  // Tamper test 3: Coordinate tampering
  const tamperedCoords = hotelVerificationService.verifyVerificationToken(token, {
    employeeId: 'EMP-001',
    hotelName: 'Hotel Leela Palace',
    latitude: 28.6000,
    longitude: 77.2000
  });
  assert.strictEqual(tamperedCoords.valid, false, 'Token with altered coordinates must be rejected');
  console.log('✓ HMAC cryptographic signing and anti-tampering validation passed');

  // =========================================================================
  // Section 2: Mock-Provider Matching Logic Tests
  // =========================================================================
  console.log('\n--- Section 2: Synthetic Place Matching Logic Tests ---');

  // 2.1 VERIFIED Match
  hotelVerificationService.setPlaceLookupProvider(async (lat, lng, query) => {
    return [
      {
        placeId: 'mock-1',
        name: 'Hotel Maurya Pride',
        displayName: 'Hotel Maurya Pride, Ring Road, Delhi',
        latitude: lat + 0.0003, // ~35 meters away
        longitude: lng + 0.0002,
        type: 'hotel'
      }
    ];
  });

  const verifiedMatch = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'Maurya Pride Hotel',
    hotelAddress: 'Ring Road, Delhi',
    latitude: 28.5670,
    longitude: 77.2100,
    accuracy: 25,
    captureTimestamp: Date.now()
  });
  assert.strictEqual(verifiedMatch.status, 'VERIFIED', 'Nearby candidate with similar name must be VERIFIED');
  assert(verifiedMatch.verificationToken, 'VERIFIED result must include HMAC verification token');
  assert(verifiedMatch.distanceMeters < 100, 'Distance should be less than 100m');
  console.log(`✓ VERIFIED match confirmed (distance: ${verifiedMatch.distanceMeters}m)`);

  // 2.2 LOCATION_MISMATCH (Name matches, but place is far away)
  hotelVerificationService.setPlaceLookupProvider(async (lat, lng, query) => {
    return [
      {
        placeId: 'mock-2',
        name: 'Hotel Maurya Pride',
        displayName: 'Hotel Maurya Pride, Sector 62, Noida',
        latitude: lat + 0.05, // ~5.5 km away
        longitude: lng + 0.05,
        type: 'hotel'
      }
    ];
  });

  const distantMatch = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'Hotel Maurya Pride',
    hotelAddress: 'Delhi',
    latitude: 28.5670,
    longitude: 77.2100,
    accuracy: 25,
    captureTimestamp: Date.now()
  });
  assert.strictEqual(distantMatch.status, 'LOCATION_MISMATCH', 'Matching name at excessive distance must be LOCATION_MISMATCH');
  assert(!distantMatch.verificationToken, 'LOCATION_MISMATCH must not return a verification token');
  console.log(`✓ LOCATION_MISMATCH confirmed (distance: ${distantMatch.distanceMeters}m)`);

  // 2.3 NAME_MISMATCH (Place is nearby, but completely different name)
  hotelVerificationService.setPlaceLookupProvider(async (lat, lng, query) => {
    return [
      {
        placeId: 'mock-3',
        name: 'Apollo Pharmacy & Clinic',
        displayName: 'Apollo Pharmacy, Ansari Nagar',
        latitude: lat + 0.0001,
        longitude: lng + 0.0001,
        type: 'pharmacy'
      }
    ];
  });

  const nameMismatch = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'ITC Maurya Luxury Hotel',
    hotelAddress: 'Ansari Nagar',
    latitude: 28.5670,
    longitude: 77.2100,
    accuracy: 25,
    captureTimestamp: Date.now()
  });
  assert.strictEqual(nameMismatch.status, 'NAME_MISMATCH', 'Nearby place with different name must be NAME_MISMATCH');
  console.log('✓ NAME_MISMATCH confirmed');

  // 2.4 UNVERIFIABLE (No candidates returned by provider)
  hotelVerificationService.setPlaceLookupProvider(async () => []);

  const unverifiable = await hotelVerificationService.verifyHotelLocation({
    employeeId: 'EMP-1',
    hotelName: 'Remote Rural Rest House',
    hotelAddress: 'Village Kalan',
    latitude: 28.5670,
    longitude: 77.2100,
    accuracy: 25,
    captureTimestamp: Date.now()
  });
  assert.strictEqual(unverifiable.status, 'UNVERIFIABLE', 'No candidate records must yield UNVERIFIABLE');
  assert.strictEqual(unverifiable.canRequestManualReview, true, 'UNVERIFIABLE must allow manual review');
  console.log('✓ UNVERIFIABLE result with manual review option confirmed');

  // Reset provider
  hotelVerificationService.setPlaceLookupProvider(null);

  // =========================================================================
  // Section 3: Full Integration HTTP & Database Tests
  // =========================================================================
  console.log('\n--- Section 3: Integration HTTP API & Database Tests ---');

  // Setup test database and seed user
  await testHelper.applySchema();
  await testHelper.seedTestData();
  await testHelper.cleanTestData();

  // Start HTTP server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // 3.1 Unauthenticated requests are rejected
  const unauthVerify = await makeRequest('POST', '/api/employee/hotel-stay/verify-location', {}, {
    hotelName: 'Test Hotel',
    hotelAddress: 'Delhi',
    latitude: 28.5670,
    longitude: 77.2100,
    accuracy: 20
  });
  assert.strictEqual(unauthVerify.status, 401, 'Unauthenticated verify-location must return 401');

  const unauthSave = await makeRequest('POST', '/api/employee/hotel-stay', {}, {
    hotelName: 'Test Hotel',
    hotelAddress: 'Delhi',
    checkinDate: '2026-10-21'
  });
  assert.strictEqual(unauthSave.status, 401, 'Unauthenticated save hotel stay must return 401');
  console.log('✓ Unauthenticated request rejection verified (401)');

  // 3.2 Login as Employee
  const loginRes = await makeRequest('POST', '/api/auth/employee/login', {}, {
    employer_id: 'ORG-001',
    login_id: 'EMP-1001',
    password: 'TestEmp@12345'
  });
  assert.strictEqual(loginRes.status, 200, 'Employee login must succeed');
  const empToken = loginRes.data.token || extractCookie(loginRes.headers, 'attendance_session');
  assert(empToken, 'Employee session token must be returned');
  const authHeaders = {
    'Authorization': `Bearer ${empToken}`,
    'Cookie': `attendance_session=${empToken}`
  };

  // 3.3 Endpoint: /api/employee/hotel-stay/verify-location with Mock Provider
  hotelVerificationService.setPlaceLookupProvider(async (lat, lng, query) => {
    return [
      {
        placeId: 'osm-hotel-456',
        name: 'The Park Hotel',
        displayName: 'The Park Hotel, Connaught Place, New Delhi',
        latitude: 28.6280,
        longitude: 77.2180,
        type: 'hotel'
      }
    ];
  });

  const apiVerifyRes = await makeRequest('POST', '/api/employee/hotel-stay/verify-location', authHeaders, {
    hotelName: 'Park Hotel',
    hotelAddress: 'Connaught Place',
    latitude: 28.6282,
    longitude: 77.2181,
    accuracy: 18,
    captureTimestamp: Date.now()
  });

  assert.strictEqual(apiVerifyRes.status, 200, 'Verification API should return 200');
  assert.strictEqual(apiVerifyRes.data.success, true);
  assert.strictEqual(apiVerifyRes.data.result.status, 'VERIFIED');
  assert(apiVerifyRes.data.result.verificationToken, 'Must provide verificationToken');
  const validApiToken = apiVerifyRes.data.result.verificationToken;
  console.log('✓ Authenticated hotel verification API returned VERIFIED and signed token');

  // 3.4 Direct Save Attempt WITHOUT Verification Token -> Must be rejected (400)
  const unverifiedSaveRes = await makeRequest('POST', '/api/employee/hotel-stay', authHeaders, {
    hotelName: 'Park Hotel',
    hotelAddress: 'Connaught Place',
    checkinDate: '2026-10-21',
    hotelLatitude: 28.6282,
    hotelLongitude: 77.2181,
    hotelAccuracy: 18
  });
  assert.strictEqual(unverifiedSaveRes.status, 400, 'Save without verification token must return 400');
  assert(unverifiedSaveRes.data.error.includes('Verification required'), 'Error must specify verification required');
  console.log('✓ Direct save without verification token blocked');

  // 3.5 Save with TAMPERED Coordinates -> Must be rejected (400)
  const tamperedSaveRes = await makeRequest('POST', '/api/employee/hotel-stay', authHeaders, {
    hotelName: 'Park Hotel',
    hotelAddress: 'Connaught Place',
    checkinDate: '2026-10-21',
    hotelLatitude: 28.7000, // Tampered latitude
    hotelLongitude: 77.2181,
    hotelAccuracy: 18,
    verificationToken: validApiToken
  });
  assert.strictEqual(tamperedSaveRes.status, 400, 'Save with altered coordinates must return 400');
  assert(tamperedSaveRes.data.error.includes('Verification details mismatch') || tamperedSaveRes.data.error.includes('Invalid or expired'), 'Error must detect mismatch');
  console.log('✓ Coordinate tampering blocked on save');

  // 3.6 Save with VALID Verification Token -> Must succeed (200) and persist metadata
  const validSaveRes = await makeRequest('POST', '/api/employee/hotel-stay', authHeaders, {
    hotelName: 'Park Hotel',
    hotelAddress: 'Connaught Place',
    roomNumber: '402',
    hotelContact: '011-23743000',
    checkinDate: '2026-10-21',
    checkoutDate: '2026-10-24',
    bookingReference: 'AIIMS-PROJ-778',
    hotelLatitude: 28.6282,
    hotelLongitude: 77.2181,
    hotelAccuracy: 18,
    gpsCaptureTimestamp: Date.now(),
    verificationToken: validApiToken
  });

  assert.strictEqual(validSaveRes.status, 200, 'Valid save should succeed with 200');
  assert.strictEqual(validSaveRes.data.success, true);
  const stayId = validSaveRes.data.stayId;
  assert(stayId, 'Stay ID must be returned');

  // Verify DB record
  const dbRecord = await testHelper.query('SELECT * FROM employee_hotel_stays WHERE id = $1', [stayId]);
  assert.strictEqual(dbRecord.rows.length, 1);
  const row = dbRecord.rows[0];
  assert.strictEqual(row.verification_status, 'VERIFIED');
  assert.strictEqual(row.verified_place_name, 'The Park Hotel');
  assert.strictEqual(row.place_id, 'osm-hotel-456');
  assert(row.distance_meters !== null, 'Distance must be stored');
  assert.strictEqual(row.is_manual_override, false);
  console.log('✓ Verified hotel stay saved to database with full GPS & matching audit trail');

  // 3.7 Manual Review Workflow for UNVERIFIABLE Lodging
  const manualReviewSaveRes = await makeRequest('POST', '/api/employee/hotel-stay', authHeaders, {
    hotelName: 'Rural PHC Guest House',
    hotelAddress: 'Block C, Remote Tehsil',
    checkinDate: '2026-10-25',
    hotelLatitude: 28.1234,
    hotelLongitude: 77.4321,
    hotelAccuracy: 25,
    gpsCaptureTimestamp: Date.now(),
    requestManualReview: true,
    verificationStatus: 'UNVERIFIABLE'
  });
  assert.strictEqual(manualReviewSaveRes.status, 200, 'Manual review request save must succeed');
  const manualStayId = manualReviewSaveRes.data.stayId;

  const dbManualRow = await testHelper.query('SELECT * FROM employee_hotel_stays WHERE id = $1', [manualStayId]);
  assert.strictEqual(dbManualRow.rows[0].verification_status, 'PENDING_REVIEW');
  assert.strictEqual(dbManualRow.rows[0].is_manual_override, false);
  console.log('✓ Unverifiable hotel saved as PENDING_REVIEW for administrator auditing');

  // 3.8 Admin Manual Override Workflow
  // Login as Employer / Admin
  const adminLoginRes = await makeRequest('POST', '/api/auth/employer/login', {}, {
    employer_id: 'ORG-001',
    admin_username: 'aiims_admin',
    admin_password: 'TestAdmin@12345'
  });
  assert.strictEqual(adminLoginRes.status, 200, 'Admin login must succeed');
  const adminToken = adminLoginRes.data.token || extractCookie(adminLoginRes.headers, 'attendance_session');
  assert(adminToken, 'Admin session token must be returned');
  const adminHeaders = {
    'Authorization': `Bearer ${adminToken}`,
    'Cookie': `attendance_session=${adminToken}`
  };

  // Non-admin attempt to override -> 403
  const forbiddenOverride = await makeRequest('POST', `/api/admin/hotel-stays/${manualStayId}/verify-override`, authHeaders, {
    decision: 'APPROVED',
    notes: 'Employee trying to approve self'
  });
  assert.strictEqual(forbiddenOverride.status, 403, 'Employee cannot override hotel stay');

  // Admin approves stay
  const adminApprove = await makeRequest('POST', `/api/admin/hotel-stays/${manualStayId}/verify-override`, adminHeaders, {
    decision: 'APPROVED',
    notes: 'Verified via project coordination phone call with District Medical Officer'
  });
  assert.strictEqual(adminApprove.status, 200, 'Admin approval must succeed');

  const dbApprovedRow = await testHelper.query('SELECT * FROM employee_hotel_stays WHERE id = $1', [manualStayId]);
  assert.strictEqual(dbApprovedRow.rows[0].verification_status, 'ADMIN_APPROVED');
  assert.strictEqual(dbApprovedRow.rows[0].is_manual_override, true);
  assert(dbApprovedRow.rows[0].verification_notes.includes('District Medical Officer'));
  console.log('✓ Admin manual override workflow tested and verified');

  // Cleanup
  hotelVerificationService.setPlaceLookupProvider(null);
  await new Promise(r => server.close(r));
  await testHelper.closeTestPool();
  console.log('\n🎉 ALL HOTEL GPS VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('\n❌ Test Suite Failed:', err);
    if (server) server.close();
    process.exit(1);
  });
}

module.exports = { runTestSuite };
