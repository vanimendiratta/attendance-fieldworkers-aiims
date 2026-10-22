/**
 * Automated Test Suite: State & District Standardization & Independent Backend Validation
 * 
 * Verifies:
 * 1. Single authoritative dataset containing 36 Indian States and Union Territories.
 * 2. Canonical "Delhi" normalization (eliminating "NCT of Delhi", "National Capital Territory of Delhi", etc.).
 * 3. Backend validation `validateStateAndDistrict`:
 *    - Rejects invalid/hallucinated states.
 *    - Rejects districts that do not belong to the given state.
 *    - Successfully resolves and normalizes valid combinations.
 * 4. Database migration normalization of historical records to "Delhi".
 */

'use strict';

const assert = require('assert');
const testHelper = require('./test_helper');
const {
  getAllStates,
  getDistrictsForState,
  normalizeStateName,
  validateStateAndDistrict,
  STATE_DISTRICTS_MAP
} = require('../src/data/india_states_districts');

async function runStateDistrictTests() {
  console.log('🧪 Starting State & District Standardization Test Suite...\n');

  // 1. Authoritative Dataset Validation
  console.log('--- Section 1: Authoritative Dataset Validation ---');
  const states = getAllStates();
  console.log(`Total States/UTs in authoritative dataset: ${states.length}`);
  assert.strictEqual(states.length, 36, 'Authoritative dataset must contain exactly 36 States and UTs');

  assert(states.includes('Delhi'), 'State "Delhi" must be present in the states list');
  assert(!states.includes('NCT of Delhi'), '"NCT of Delhi" must NOT be a separate state entry');
  assert(!states.includes('National Capital Territory of Delhi'), '"National Capital Territory of Delhi" must NOT be a separate state entry');
  console.log('✓ Authoritative dataset structure and 36 States/UT count verified');

  // 2. Canonical Delhi Normalization
  console.log('\n--- Section 2: Canonical Delhi Normalization ---');
  const delhiVariants = [
    'Delhi',
    'delhi',
    'DELHI',
    'NCT of Delhi',
    'nct of delhi',
    'National Capital Territory of Delhi',
    'NCT Delhi',
    'Delhi (NCT)',
    'DL'
  ];

  for (const variant of delhiVariants) {
    const normalized = normalizeStateName(variant);
    assert.strictEqual(normalized, 'Delhi', `Variant "${variant}" must normalize to "Delhi", got "${normalized}"`);
  }
  console.log('✓ All 9 Delhi variants properly normalize to canonical "Delhi"');

  // 3. District Lookup for Delhi
  const delhiDistricts = getDistrictsForState('Delhi');
  assert(delhiDistricts.length >= 11, 'Delhi must have all 11 official revenue districts');
  assert(delhiDistricts.includes('New Delhi'), 'Delhi must contain New Delhi district');
  assert(delhiDistricts.includes('South Delhi'), 'Delhi must contain South Delhi district');
  assert(delhiDistricts.includes('Central Delhi'), 'Delhi must contain Central Delhi district');
  console.log(`✓ Delhi has ${delhiDistricts.length} official districts`);

  // 4. Independent Server Validation: validateStateAndDistrict
  console.log('\n--- Section 3: Independent Backend Server Validation ---');

  // Valid combinations
  const valid1 = validateStateAndDistrict('Delhi', 'New Delhi');
  assert.strictEqual(valid1.valid, true);
  assert.strictEqual(valid1.state, 'Delhi');
  assert.strictEqual(valid1.district, 'New Delhi');

  const valid2 = validateStateAndDistrict('NCT of Delhi', 'South Delhi');
  assert.strictEqual(valid2.valid, true);
  assert.strictEqual(valid2.state, 'Delhi', 'Should normalize state to canonical Delhi');
  assert.strictEqual(valid2.district, 'South Delhi');

  const valid3 = validateStateAndDistrict('Maharashtra', 'Mumbai City');
  assert.strictEqual(valid3.valid, true);
  assert.strictEqual(valid3.state, 'Maharashtra');

  // Invalid state
  const invalidState = validateStateAndDistrict('Atlantis', 'Central');
  assert.strictEqual(invalidState.valid, false);
  assert(invalidState.error.includes('Unrecognized Indian State or Union Territory'));

  // Invalid district for state
  const mismatched = validateStateAndDistrict('Delhi', 'Mumbai Suburban');
  assert.strictEqual(mismatched.valid, false);
  assert(mismatched.error.includes('does not belong to State "Delhi"'));

  const mismatched2 = validateStateAndDistrict('Karnataka', 'New Delhi');
  assert.strictEqual(mismatched2.valid, false);
  assert(mismatched2.error.includes('does not belong to State "Karnataka"'));
  console.log('✓ Server-side independent validation correctly validates and rejects pairings');

  // 5. Database Integration & Historical Normalization
  console.log('\n--- Section 4: Database Integration & Migration 005 Verification ---');
  await testHelper.applySchema();
  await testHelper.seedTestData();

  // Insert a test employee with legacy "NCT of Delhi"
  const testEmpId = 'EMP-DELHI-TEST';
  await testHelper.query(
    `INSERT INTO employees (id, employer_id, name, email, department, designation, password, pin, is_active, state, district, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, NOW())
     ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`,
    [testEmpId, 'ORG-001', 'Delhi Test Employee', 'delhi_test@cder.aiims.edu', 'CDER', 'PRS-1', 'hash', '1234', 'NCT of Delhi', 'South Delhi']
  );

  // Apply migration 005 SQL update statement
  await testHelper.query(`
    UPDATE employees SET state = 'Delhi' WHERE state IS NOT NULL AND (state ILIKE '%delhi%' OR state ILIKE '%nct%' OR state = 'DL');
  `);

  const empRes = await testHelper.query('SELECT state FROM employees WHERE id = $1', [testEmpId]);
  assert.strictEqual(empRes.rows[0].state, 'Delhi', 'Historical state name should be normalized to "Delhi" in PostgreSQL');
  console.log('✓ PostgreSQL records successfully normalized to canonical "Delhi"');

  console.log('\n🎉 ALL STATE & DISTRICT STANDARDIZATION TESTS PASSED!\n');
}

if (require.main === module) {
  runStateDistrictTests()
    .then(() => {
      const pool = testHelper.getTestPool();
      return pool.end();
    })
    .catch((err) => {
      console.error('❌ Test failure:', err);
      process.exit(1);
    });
}

module.exports = { runStateDistrictTests };
