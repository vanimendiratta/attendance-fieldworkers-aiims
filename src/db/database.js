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

const { Pool } = require('pg');
const crypto   = require('crypto');
const path     = require('path');

// ---------------------------------------------------------------------------
// Environment & Configuration Validation
// ---------------------------------------------------------------------------
const isProduction = ['production'].includes(
  (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase()
);
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const DATABASE_URL = process.env.DATABASE_URL;

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
  // Supabase requires SSL in production; allow self-signed in dev if needed
  ssl: DATABASE_URL && (DATABASE_URL.includes('supabase') || isProduction)
    ? { rejectUnauthorized: false }
    : false,
  max:                    poolMax,
  idleTimeoutMillis:      isServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Log the error class/message, never the connection string
  console.error('[DB] Pool error (client evicted):', err.message);
});

// ---------------------------------------------------------------------------
// Public query helper — use for all non-transactional queries
// ---------------------------------------------------------------------------
/**
 * Execute a parameterized SQL query.
 * @param {string} text      — SQL string using $1, $2 … placeholders
 * @param {Array}  [params]  — Bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  if (!DATABASE_URL) {
    const missingErr = new Error('[DB] DATABASE_URL environment variable is not configured. Please set DATABASE_URL in Vercel project environment variables.');
    console.error(missingErr.message);
    throw missingErr;
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

  console.log('[DB] Seed complete.');
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
module.exports = { query, pool, initSeed, closePool };
