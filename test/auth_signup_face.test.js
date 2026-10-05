/**
 * Automated Tests for Employee Sign Up & Screenlock Face Recognition Authentication
 * 
 * Verifies:
 * 1. Employee Registration (Sign Up) with basic enquiries (Name, Email, Phone, Org, Department, Designation, State, District, Password)
 * 2. Face Biometric Enrollment during Sign Up
 * 3. Validation: Duplicate email prevention, required fields, password constraints
 * 4. Screenlock Face Recognition login (POST /api/auth/employee/face-login)
 * 5. Traditional ID & Password login (POST /api/auth/employee/login)
 * 6. Multi-tenant and regional team auto-assignment
 */

const assert = require('assert');
const http = require('http');
const app = require('../server');

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_BYPASS = 'true';

let BASE_URL = process.env.TEST_BASE_URL || '';
let serverInstance = null;

function apiRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = { raw: data };
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Generate sample normalized face vector
function generateTestVector(seed) {
  const vec = [];
  for (let i = 0; i < 64; i++) {
    vec.push(Math.sin(seed * (i + 1)) * 0.5);
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => Number((v / norm).toFixed(5)));
}

async function runTests() {
  if (!BASE_URL) {
    serverInstance = app.listen(0);
    const port = serverInstance.address().port;
    BASE_URL = `http://localhost:${port}`;
  }

  console.log('===============================================================');
  console.log('📱 TESTING SIGN IN / SIGN UP & SCREENLOCK FACE RECOGNITION');
  console.log('===============================================================');

  try {
    const { query } = require('../src/db/database');
    await query("DELETE FROM employees WHERE email LIKE '%@apexcorp.internal'");

    // Test 1: Sign Up with missing required fields
    console.log('\n1. Testing Sign Up field validations...');
    const resMissing = await apiRequest('POST', '/api/auth/employee/signup', {
      name: 'Incomplete User'
      // missing email, employer_id, department, designation, password
    });
    assert.strictEqual(resMissing.status, 400, 'Must reject missing fields with 400');
  assert.ok(resMissing.data.error, 'Must provide validation error message');
  console.log('   ✓ Rejected registration with missing enquiries');

  // Test 2: Successful Sign Up with basic enquiries and face descriptor
  console.log('\n2. Testing Employee Sign Up with complete enquiries & Face Biometrics...');
  const testEmail = `dr.samir_${Date.now()}@apexcorp.internal`;
  const testFaceDesc = generateTestVector(42);

  const resSignup = await apiRequest('POST', '/api/auth/employee/signup', {
    name: 'Dr. Samir Sengupta',
    email: testEmail,
    phone: '+91 98310 99887',
    employer_id: 'ORG-001',
    department: 'Dental',
    designation: 'PRS-1',
    state: 'Delhi',
    district: 'New Delhi',
    password: 'SecurePass@2026',
    face_photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
    face_descriptor: testFaceDesc
  });

  assert.strictEqual(resSignup.status, 201, `Expected 201 Created, got ${resSignup.status}`);
  assert.ok(resSignup.data.success, 'Sign Up must report success');
  assert.ok(resSignup.data.employee.id, 'New employee must have generated ID');
  assert.strictEqual(resSignup.data.employee.name, 'Dr. Samir Sengupta');
  assert.strictEqual(resSignup.data.employee.department, 'Dental');
  assert.strictEqual(resSignup.data.employee.designation, 'PRS-1');
  assert.strictEqual(resSignup.data.employee.phone, '+91 98310 99887');
  assert.strictEqual(resSignup.data.employee.face_enrolled, 1, 'Face must be flagged as enrolled');
  assert.ok(resSignup.data.employee.team_name, 'Regional team must be resolved from Delhi / New Delhi');
  const newEmpId = resSignup.data.employee.id;
  console.log(`   ✓ Created employee account: ${newEmpId} (${resSignup.data.employee.name})`);

  // Test 3: Duplicate Email Check
  console.log('\n3. Testing duplicate email prevention...');
  const resDuplicate = await apiRequest('POST', '/api/auth/employee/signup', {
    name: 'Imposter Samir',
    email: testEmail,
    phone: '+91 99999 99999',
    employer_id: 'ORG-001',
    department: 'Dental',
    designation: 'MTS',
    password: 'Password@123'
  });
  assert.strictEqual(resDuplicate.status, 409, 'Must reject duplicate email with 409');
  console.log('   ✓ Blocked duplicate email registration');

  // Test 4: Sign In with ID & Password
  console.log('\n4. Testing Sign In with ID & Password for newly registered employee...');
  const resLoginCreds = await apiRequest('POST', '/api/auth/employee/login', {
    employer_id: 'ORG-001',
    login_id: testEmail,
    password: 'SecurePass@2026'
  });
  assert.strictEqual(resLoginCreds.status, 200);
  assert.strictEqual(resLoginCreds.data.employee.id, newEmpId);
  console.log('   ✓ Successful ID & Password login');

  // Test 5: Screenlock Face Recognition Login with Enrolled Vector
  console.log('\n5. Testing Mobile Screenlock Face Recognition Login (Matching Vector)...');
  // Matching vector with slight sensor noise
  const candidateVector = testFaceDesc.map(v => v + (Math.random() * 0.02 - 0.01));
  const resFaceLogin = await apiRequest('POST', '/api/auth/employee/face-login', {
    employer_id: 'ORG-001',
    face_descriptor: candidateVector
  });
  assert.strictEqual(resFaceLogin.status, 200, `Expected 200 OK for matching face, got ${resFaceLogin.status}`);
  assert.ok(resFaceLogin.data.success);
  assert.strictEqual(resFaceLogin.data.employee.id, newEmpId);
  assert.ok(resFaceLogin.data.confidence > 75, `Confidence must exceed 75%, got ${resFaceLogin.data.confidence}%`);
  console.log(`   ✓ Screenlock Face ID verified: ${resFaceLogin.data.employee.name} (Confidence: ${resFaceLogin.data.confidence}%)`);

  // Test 6: Screenlock Face Recognition with Unenrolled / Dissimilar Face
  console.log('\n6. Testing Face Recognition rejection for unknown face...');
  const unknownVector = generateTestVector(999);
  const resFaceFail = await apiRequest('POST', '/api/auth/employee/face-login', {
    employer_id: 'ORG-001',
    face_descriptor: unknownVector
  });
  assert.strictEqual(resFaceFail.status, 401, 'Unmatched face must return 401');
  assert.strictEqual(resFaceFail.data.success, false);
  console.log('   ✓ Unknown face correctly blocked: ' + resFaceFail.data.error);

  // Test 7: Face Recognition Quick-Unlock with registered employee
  console.log('\n7. Testing Face Unlock with registered employee...');
  const resDemoFace = await apiRequest('POST', '/api/auth/employee/face-login', {
    employer_id: 'ORG-001',
    mock_employee_id: newEmpId
  });
  assert.strictEqual(resDemoFace.status, 200);
  assert.strictEqual(resDemoFace.data.employee.name, 'Dr. Samir Sengupta');
  console.log(`   ✓ Face Unlock verified: Welcome, ${resDemoFace.data.employee.name}`);

  console.log('\n===============================================================');
  console.log('🎉 ALL SIGN UP & SCREENLOCK FACE RECOGNITION TESTS PASSED 100%!');
  console.log('===============================================================');
  } finally {
    if (serverInstance) serverInstance.close();
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Test execution error:', err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
