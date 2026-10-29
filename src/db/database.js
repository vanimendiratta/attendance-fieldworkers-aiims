/**
 * PostgreSQL Database Module — Supabase / pg
 *
 * Replaces better-sqlite3 with the `pg` (node-postgres) connection pool.
 *
 * Rules:
 *  - DATABASE_URL is read only from process.env — never hardcoded.
 *  - DATABASE_URL is never printed to logs.
 *  - All queries are parameterized ($1, $2, … placeholders).
 *  - Pool errors are caught and logged (without credentials).
 *  - Transactions require a manually checked-out client.
 *  - Graceful shutdown releases the pool.
 */

'use strict';

const { Pool, types } = require('pg');
// Return PostgreSQL DATE columns (OID 1082) as exact 'YYYY-MM-DD' strings to prevent timezone shifts
types.setTypeParser(1082, (val) => val);
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

// ---------------------------------------------------------------------------
// Environment & Configuration Validation
// ---------------------------------------------------------------------------
const isProduction = ['production'].includes(
  (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase()
);
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

if (!DATABASE_URL) {
  if (isProduction && !isServerless) {
    console.error('[DB] FATAL: DATABASE_URL environment variable is not set. Cannot start in production without a database connection.');
    process.exit(1);
  } else {
    console.warn('[DB] WARNING: DATABASE_URL is not set. Database queries will fail until it is configured.');
  }
}

// ---------------------------------------------------------------------------
// Connection pool — optimized for serverless (Vercel) & traditional Node
// ---------------------------------------------------------------------------
// In serverless, each concurrent invocation opens a pool; keep max small (1-2) to avoid exhausting Supabase limits
const defaultPoolMax = isServerless ? 1 : (isProduction ? 2 : 10);
const poolMax        = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : defaultPoolMax;

const pool = new Pool({
  connectionString: DATABASE_URL,
  // SSL configuration:
  //   - Local PostgreSQL (AIIMS institutional VM loopback: 127.0.0.1 / localhost):
  //     SSL is not used over the loopback interface; ssl:false is correct and safe.
  //   - Supabase cloud: requires SSL; uses rejectUnauthorized=false due to pooler CA chain.
  //   - Remote PostgreSQL (institutional database server or external host):
  //     Certificate verification is ENABLED by default (rejectUnauthorized: true) in production
  //     to prevent MITM attacks. For institutional internal CAs, specify DATABASE_SSL_CA=/path/to/ca.crt
  //     or use NODE_EXTRA_CA_CERTS. To explicitly opt out of verification, set DATABASE_URL_SSL_MODE=no-verify.
  ssl: (() => {
    if (!DATABASE_URL) return false;
    // Local loopback connections (127.0.0.1 or localhost) never use SSL
    if (/[@/](127\.0\.0\.1|localhost)(:|\/|$)/.test(DATABASE_URL)) return false;
    // Supabase cloud requires SSL; uses rejectUnauthorized=false due to pooler CA chain
    if (DATABASE_URL.includes('supabase')) return { rejectUnauthorized: false };
    // Remote database connections:
    if (process.env.DATABASE_URL_SSL_MODE === 'disable') return false;
    if (process.env.DATABASE_URL_SSL_MODE === 'no-verify') return { rejectUnauthorized: false };
    // Remote connections in production default to secure SSL with CA certificate verification enabled
    if (isProduction || process.env.DATABASE_URL_SSL_MODE === 'verify-ca' || process.env.DATABASE_URL_SSL_MODE === 'verify-full') {
      const sslConfig = { rejectUnauthorized: true };
      if (process.env.DATABASE_SSL_CA) {
        try {
          sslConfig.ca = fs.readFileSync(process.env.DATABASE_SSL_CA, 'utf8');
        } catch (e) {
          console.error('[DB] Failed to read DATABASE_SSL_CA file:', e.message);
        }
      }
      return sslConfig;
    }
    return false;
  })(),
  max:                    poolMax,
  idleTimeoutMillis:      isServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Log the error class/message, never the connection string
  console.error('[DB] Pool error (client evicted):', err.message);
});

// ---------------------------------------------------------------------------
// Schema Synchronization — ensures missing columns and tables exist
// ---------------------------------------------------------------------------
let schemaEnsured = false;
let schemaPromise = null;

async function ensureSchema() {
  if (schemaEnsured) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const statements = [
        // 1. Critical Employee Columns (ensures Signup works immediately)
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS dob DATE`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at TEXT`,

        // 2. Attendance schema extensions
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_location_type TEXT DEFAULT 'FIELD_SITE'`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_stay_id TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_name TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_room TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_phone TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_place_name TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_place_type TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS exact_coordinates_url TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_regularized INTEGER DEFAULT 0`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularized_by TEXT`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularization_notes TEXT`,

        // 3. Organization Holidays
        `CREATE TABLE IF NOT EXISTS organization_holidays (
          id TEXT PRIMARY KEY,
          employer_id TEXT NOT NULL,
          holiday_date DATE NOT NULL,
          name TEXT NOT NULL,
          holiday_type TEXT DEFAULT 'GAZETTED',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employer_id, holiday_date)
        )`,

        // 4. Employee Hotel Stays
        `CREATE TABLE IF NOT EXISTS employee_hotel_stays (
          id TEXT PRIMARY KEY,
          employer_id TEXT NOT NULL,
          employee_id TEXT NOT NULL,
          hotel_name TEXT NOT NULL,
          room_number TEXT,
          hotel_address TEXT NOT NULL,
          hotel_phone TEXT,
          checkin_date DATE NOT NULL,
          checkout_date DATE,
          booking_ref TEXT,
          hotel_lat NUMERIC(10, 7),
          hotel_lng NUMERIC(10, 7),
          hotel_accuracy NUMERIC(10, 2),
          gps_capture_timestamp TIMESTAMPTZ,
          verification_status TEXT DEFAULT 'PENDING',
          verification_timestamp TIMESTAMPTZ,
          verified_place_name TEXT,
          verified_address TEXT,
          distance_meters NUMERIC(10, 2),
          place_id TEXT,
          verification_notes TEXT,
          is_manual_override BOOLEAN DEFAULT FALSE,
          stay_status TEXT DEFAULT 'ACTIVE',
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,

        // 5. Employee Leaves
        `CREATE TABLE IF NOT EXISTS employee_leaves (
          id TEXT PRIMARY KEY,
          employer_id TEXT NOT NULL,
          employee_id TEXT NOT NULL,
          leave_date DATE NOT NULL,
          leave_type TEXT NOT NULL DEFAULT 'UNMARKED_ABSENCE',
          status TEXT NOT NULL DEFAULT 'PENDING',
          reason TEXT,
          applied_by TEXT DEFAULT 'SYSTEM_ABSENCE',
          admin_remarks TEXT,
          regularized_attendance_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employer_id, employee_id, leave_date)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_date ON employee_leaves(employer_id, leave_date)`,
        `CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_id ON employee_leaves(employee_id)`,
        `CREATE INDEX IF NOT EXISTS idx_employee_leaves_status ON employee_leaves(status)`,

        // 6. Rate Limits table & column
        `CREATE TABLE IF NOT EXISTS auth_rate_limits (
          rate_key TEXT NOT NULL,
          timestamp BIGINT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON auth_rate_limits (rate_key, timestamp)`,
        `ALTER TABLE auth_rate_limits ALTER COLUMN timestamp TYPE BIGINT`,

        // 7. Employee Unique Indexes
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email_lower ON employees (LOWER(TRIM(email)))`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_phone_unique ON employees (phone) WHERE phone IS NOT NULL AND phone != ''`,

        // 8. Geofences
        `CREATE TABLE IF NOT EXISTS geofences (
          id TEXT PRIMARY KEY,
          employer_id TEXT NOT NULL,
          name TEXT NOT NULL,
          geofence_type TEXT NOT NULL DEFAULT 'WORKPLACE',
          latitude NUMERIC(10, 7) NOT NULL,
          longitude NUMERIC(10, 7) NOT NULL,
          radius_meters NUMERIC(10, 2) NOT NULL DEFAULT 150.00,
          policy TEXT NOT NULL DEFAULT 'ALLOW_WITH_FLAG',
          address TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_geofences_employer ON geofences (employer_id, is_active)`,
        `CREATE INDEX IF NOT EXISTS idx_geofences_type ON geofences (employer_id, geofence_type, is_active)`,

        // 9. Location & State Normalization
        `UPDATE employees SET state = 'Delhi' WHERE state IS NOT NULL AND (state ILIKE '%delhi%' OR state ILIKE '%nct%' OR state = 'DL')`,
        `UPDATE attendance SET state = 'Delhi' WHERE state IS NOT NULL AND (state ILIKE '%delhi%' OR state ILIKE '%nct%' OR state = 'DL')`,
        `UPDATE teams SET state = 'Delhi' WHERE state IS NOT NULL AND (state ILIKE '%delhi%' OR state ILIKE '%nct%' OR state = 'DL')`,
        `UPDATE external_sync_records SET state = 'Delhi' WHERE state ILIKE '%delhi%' OR state ILIKE '%nct%' OR state = 'DL'`,

        // 10. Sessions Single Active User Index
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active_user
         ON sessions (user_id, session_type)
         WHERE is_revoked = 0`
      ];

      for (const stmt of statements) {
        try {
          await pool.query(stmt);
        } catch (err) {
          console.warn('[DB] Schema sync notice:', err.message, `(${stmt.slice(0, 50).replace(/\\s+/g, ' ')}...)`);
        }
      }
      schemaEnsured = true;
    })();
  }
  return schemaPromise;
}

// ---------------------------------------------------------------------------
// Public query helper — use for all non-transactional queries
// ---------------------------------------------------------------------------
let testQueryProvider = null;

function setTestQueryProvider(fn) {
  testQueryProvider = fn;
}

/**
 * Execute a parameterized SQL query.
 * @param {string} text      — SQL string using $1, $2 … placeholders
 * @param {Array}  [params]  — Bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  if (testQueryProvider) {
    return testQueryProvider(text, params);
  }

  if (!DATABASE_URL) {
    const missingErr = new Error('[DB] DATABASE_URL environment variable is not configured. Please set DATABASE_URL in Vercel project environment variables.');
    console.error(missingErr.message);
    throw missingErr;
  }
  if (!schemaEnsured) {
    await ensureSchema().catch(() => {});
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    // Redact any credential that may have leaked into error messages
    const safeMessage = err.message
      ? err.message.replace(/postgresql:\/\/[^\s]*/gi, 'postgresql://***')
      : 'Unknown database error';
    console.error(`[DB] Query error: ${safeMessage} (SQL: ${String(text).slice(0, 100).replace(/\s+/g, ' ')})`);
    const wrappedErr = new Error(`[DB] Query error: ${safeMessage}`);
    wrappedErr.code    = err.code;
    wrappedErr.detail  = err.detail;
    wrappedErr.hint    = err.hint;
    throw wrappedErr;
  }
}

// ---------------------------------------------------------------------------
// Seed helper — hashes a password with scrypt
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt       = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Application seed — upsert ORG-001 and initialize sequences
// Safe one-time setup mechanism.
// In production, ADMIN_PASSWORD must be provided via environment variable.
// ---------------------------------------------------------------------------
async function initSeed() {
  const orgId = 'ORG-001';

  // Check if org already exists
  const existingOrg = await query(
    'SELECT id, admin_password FROM organizations WHERE id = $1',
    [orgId]
  );

  const officeLatEnv  = parseFloat(process.env.OFFICE_LAT  || '28.5672');
  const officeLngEnv  = parseFloat(process.env.OFFICE_LNG  || '77.2100');
  const officeNameEnv = process.env.OFFICE_NAME  || 'AIIMS, New Delhi';
  const orgNameEnv    = process.env.ORG_NAME     || 'AIIMS';
  const adminUser     = process.env.ADMIN_USERNAME || 'aiims_admin';
  const adminPassRaw  = process.env.ADMIN_PASSWORD || 'AiimsAdmin@123';

  if (existingOrg.rows.length === 0) {
    // First boot — insert with scrypt-hashed password
    const hashedAdmin = hashPassword(adminPassRaw);
    await query(
      `INSERT INTO organizations (
         id, name, office_name, office_lat, office_lng,
         geofence_radius_m, geofence_policy, max_gps_accuracy_m,
         shift_hours, timezone, admin_username, admin_password, is_active, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        orgId, orgNameEnv, officeNameEnv, officeLatEnv, officeLngEnv,
        500, 'ALLOW_WITH_FLAG', 500,
        8.0, 'Asia/Kolkata', adminUser, hashedAdmin, 1,
        new Date().toISOString()
      ]
    );
    console.log('[DB] Organization ORG-001 seeded successfully.');
  } else {
    // Upgrade legacy plaintext admin password to scrypt hash if needed
    const stored = existingOrg.rows[0].admin_password;
    if (stored && !stored.startsWith('scrypt$')) {
      const upgraded = hashPassword(stored);
      await query(
        'UPDATE organizations SET admin_password = $1, updated_at = $2 WHERE id = $3',
        [upgraded, new Date().toISOString(), orgId]
      );
      console.log('[DB] Admin password upgraded to scrypt hash.');
    }
  }

  // Ensure sequence row exists for EMP-XXXX generation
  await query(
    `INSERT INTO employee_sequences (employer_id, last_seq)
     VALUES ($1, 1000)
     ON CONFLICT (employer_id) DO NOTHING`,
    [orgId]
  );

  // Ensure organization_holidays table exists
  await query(`
    CREATE TABLE IF NOT EXISTS organization_holidays (
      id TEXT PRIMARY KEY,
      employer_id TEXT NOT NULL,
      holiday_date DATE NOT NULL,
      name TEXT NOT NULL,
      holiday_type TEXT DEFAULT 'GAZETTED',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employer_id, holiday_date)
    )
  `);

  // Seed standard gazetted / national holidays for ORG-001
  const defaultHolidays = [
    { date: '2026-01-26', name: 'Republic Day', type: 'NATIONAL' },
    { date: '2026-03-04', name: 'Holi', type: 'GAZETTED' },
    { date: '2026-03-21', name: 'Id-ul-Fitr', type: 'GAZETTED' },
    { date: '2026-04-03', name: 'Good Friday', type: 'GAZETTED' },
    { date: '2026-04-14', name: 'Dr. B.R. Ambedkar Jayanti', type: 'GAZETTED' },
    { date: '2026-05-27', name: 'Id-ul-Zuha (Bakrid)', type: 'GAZETTED' },
    { date: '2026-08-15', name: 'Independence Day', type: 'NATIONAL' },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti', type: 'NATIONAL' },
    { date: '2026-10-20', name: 'Dussehra (Vijay Dashami)', type: 'GAZETTED' },
    { date: '2026-11-08', name: 'Diwali (Deepavali)', type: 'GAZETTED' },
    { date: '2026-12-25', name: 'Christmas Day', type: 'GAZETTED' }
  ];

  for (const h of defaultHolidays) {
    const hId = `HOL-${orgId}-${h.date}`;
    await query(
      `INSERT INTO organization_holidays (id, employer_id, holiday_date, name, holiday_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employer_id, holiday_date) DO NOTHING`,
      [hId, orgId, h.date, h.name, h.type]
    );
  }

  // Ensure employee_hotel_stays table exists
  await query(`
    CREATE TABLE IF NOT EXISTS employee_hotel_stays (
      id TEXT PRIMARY KEY,
      employer_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      hotel_name TEXT NOT NULL,
      room_number TEXT,
      hotel_address TEXT NOT NULL,
      hotel_phone TEXT,
      checkin_date DATE NOT NULL,
      checkout_date DATE,
      booking_ref TEXT,
      hotel_lat NUMERIC(10, 7),
      hotel_lng NUMERIC(10, 7),
      stay_status TEXT DEFAULT 'ACTIVE',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS hotel_accuracy NUMERIC(10, 2);
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS gps_capture_timestamp TIMESTAMPTZ;
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'PENDING';
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMPTZ;
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verified_place_name TEXT;
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verified_address TEXT;
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS distance_meters NUMERIC(10, 2);
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS place_id TEXT;
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verification_notes TEXT;
    ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT FALSE;
  `);

  // Ensure attendance table has location classification & hotel stay columns
  await query(`
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_location_type TEXT DEFAULT 'FIELD_SITE';
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_stay_id TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_name TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_room TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_phone TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_place_name TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_place_type TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS exact_coordinates_url TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_regularized INTEGER DEFAULT 0;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularized_by TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularization_notes TEXT;
  `);

  // Ensure employee_leaves table exists for tracking field absentees & leaves
  await query(`
    CREATE TABLE IF NOT EXISTS employee_leaves (
      id TEXT PRIMARY KEY,
      employer_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      leave_date DATE NOT NULL,
      leave_type TEXT NOT NULL DEFAULT 'UNMARKED_ABSENCE',
      status TEXT NOT NULL DEFAULT 'PENDING',
      reason TEXT,
      applied_by TEXT DEFAULT 'SYSTEM_ABSENCE',
      admin_remarks TEXT,
      regularized_attendance_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employer_id, employee_id, leave_date)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_date ON employee_leaves(employer_id, leave_date);
    CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_id ON employee_leaves(employee_id);
    CREATE INDEX IF NOT EXISTS idx_employee_leaves_status ON employee_leaves(status);
  `);

  console.log('[DB] Seed complete with official holidays, hotel stay tracking, and leaves roster.');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function closePool() {
  await pool.end();
  console.log('[DB] Connection pool closed.');
}

// Only register process signal listeners in long-running processes (not in serverless environments)
if (!isServerless) {
  process.on('SIGTERM', async () => {
    console.log('[DB] SIGTERM received — draining pool…');
    await closePool();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[DB] SIGINT received — draining pool…');
    await closePool();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { query, pool, initSeed, closePool, setTestQueryProvider };
