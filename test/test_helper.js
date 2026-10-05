/**
 * PostgreSQL Test Helper & Database Fixture Manager
 *
 * Dedicated test harness for running tests against a real PostgreSQL test database.
 *
 * Safety Rules:
 *   - NEVER uses DATABASE_URL (production connection).
 *   - Only uses TEST_DATABASE_URL.
 *   - Strictly blocks execution if TEST_DATABASE_URL points to a live Supabase production host.
 *   - Applies supabase/migrations/001_initial_schema.sql on test setup.
 *   - Provides safe setup and teardown helpers.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let testPool = null;

function hashPassword(password) {
  const salt       = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Validate that TEST_DATABASE_URL is safe to use.
 */
function assertSafeTestEnvironment() {
  if (!TEST_DATABASE_URL) {
    const msg = [
      '--------------------------------------------------------------------------------',
      '❌ TEST EXECUTION BLOCKED: TEST_DATABASE_URL is not configured.',
      '',
      'Integration tests require a dedicated PostgreSQL test database.',
      'To run integration tests, set TEST_DATABASE_URL in your environment:',
      '',
      '  export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/attendance_test"',
      '  npm test',
      '',
      'CRITICAL SAFETY RULE: Production DATABASE_URL cannot and will not be used for tests.',
      '--------------------------------------------------------------------------------'
    ].join('\n');
    throw new Error(msg);
  }

  // Safety check: Prevent pointing tests at live Supabase or production databases
  if (TEST_DATABASE_URL.includes('supabase.co') || TEST_DATABASE_URL.includes('pooler.supabase.com')) {
    throw new Error(
      'CRITICAL SAFETY VIOLATION: TEST_DATABASE_URL cannot point to a remote Supabase instance. ' +
      'Use a local PostgreSQL instance (e.g. localhost:5432) or a dedicated local container.'
    );
  }
}

/**
 * Get or initialize the test connection pool.
 */
function getTestPool() {
  assertSafeTestEnvironment();

  if (!testPool) {
    testPool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max:              5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 3_000
    });

    testPool.on('error', (err) => {
      console.error('[TEST-DB] Test pool error:', err.message);
    });
  }

  return testPool;
}

/**
 * Execute parameterized query on the test database.
 */
async function query(text, params) {
  const pool = getTestPool();
  return await pool.query(text, params);
}

/**
 * Apply 001_initial_schema.sql to initialize all tables in the test database.
 */
async function applySchema() {
  assertSafeTestEnvironment();
  const pool = getTestPool();

  const migrationPath = path.join(__dirname, '../supabase/migrations/001_initial_schema.sql');
  const migrationSql  = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(migrationSql);

  const migration2Path = path.join(__dirname, '../supabase/migrations/002_leaves_and_regularization.sql');
  if (fs.existsSync(migration2Path)) {
    const migration2Sql = fs.readFileSync(migration2Path, 'utf8');
    await pool.query(migration2Sql);
  }
  console.log('✓ Applied schema migrations (001, 002) to test database');
}

/**
 * Seed baseline organization and test employee for integration testing.
 */
async function seedTestData() {
  const orgId = 'ORG-001';
  const hashedAdmin = hashPassword('TestAdmin@12345');

  await query(
    `INSERT INTO organizations (
       id, name, office_name, office_lat, office_lng,
       geofence_radius_m, geofence_policy, max_gps_accuracy_m,
       shift_hours, timezone, admin_username, admin_password, is_active, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       admin_password = EXCLUDED.admin_password,
       office_lat = EXCLUDED.office_lat,
       office_lng = EXCLUDED.office_lng`,
    [
      orgId, 'AIIMS Test Org', 'AIIMS New Delhi', 28.5672, 77.2100,
      100.0, 'ALLOW_WITH_FLAG', 100.0,
      8.0, 'Asia/Kolkata', 'aiims_admin', hashedAdmin, 1,
      new Date().toISOString()
    ]
  );

  const hashedEmp = hashPassword('TestEmp@12345');
  await query(
    `INSERT INTO employees (
       id, employer_id, name, email, department, designation, pin,
       is_active, is_admin, created_at, password
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = EXCLUDED.is_active,
       password = EXCLUDED.password`,
    [
      'EMP-1001', orgId, 'Test Employee', 'test.runner@aiims.test',
      'Dental Research & Healthcare', 'Senior Field Officer (PRS-1)', '1234',
      1, 0, new Date().toISOString(), hashedEmp
    ]
  );

  await query(
    `INSERT INTO employee_sequences (employer_id, last_seq)
     VALUES ($1, 1001)
     ON CONFLICT (employer_id) DO NOTHING`,
    [orgId]
  );
}

/**
 * Clean up ephemeral test records safely between test suites.
 */
async function cleanTestData() {
  if (!TEST_DATABASE_URL) return;

  await query("DELETE FROM audit_logs WHERE action LIKE 'TEST_%' OR event_type LIKE 'TEST_%'");
  await query("DELETE FROM attendance WHERE employee_id LIKE 'TEST_%' OR employee_id = 'EMP-1001'");
  await query("DELETE FROM auth_rate_limits");
}

/**
 * Gracefully close test connection pool.
 */
async function closeTestPool() {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

module.exports = {
  TEST_DATABASE_URL,
  assertSafeTestEnvironment,
  getTestPool,
  query,
  applySchema,
  seedTestData,
  cleanTestData,
  closeTestPool,
  hashPassword
};
