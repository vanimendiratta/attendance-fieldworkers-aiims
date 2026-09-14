#!/usr/bin/env node
/**
 * Safe, Idempotent Database Seed Script
 *
 * Usage:
 *   ADMIN_PASSWORD='YourStrongPassword' npm run seed
 *
 * Rules:
 *   - Connects using DATABASE_URL (or TEST_DATABASE_URL with --test flag)
 *   - NEVER uses hardcoded default passwords in production
 *   - Password is scrypt-hashed before writing to the database
 *   - Password is NEVER logged
 *   - Safe to run repeatedly (ON CONFLICT DO NOTHING)
 */

'use strict';

require('dotenv').config();

const { query, pool, closePool } = require('../src/db/database');
const crypto = require('crypto');

function hashPassword(password) {
  const salt       = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function runSeed() {
  console.log('--- Initializing Database Seed ---');

  if (!process.env.DATABASE_URL) {
    console.error('[SEED] ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const isProduction = ['production'].includes(
    (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase()
  );

  const adminPassRaw = process.env.ADMIN_PASSWORD;

  if (!adminPassRaw || !adminPassRaw.trim()) {
    if (isProduction) {
      console.error('[SEED] FATAL: ADMIN_PASSWORD environment variable must be set for production seeding.');
      process.exit(1);
    } else {
      console.error('[SEED] ERROR: ADMIN_PASSWORD environment variable is required. Please provide ADMIN_PASSWORD="your-secure-password" npm run seed.');
      process.exit(1);
    }
  }

  const orgId         = 'ORG-001';
  const orgName       = process.env.ORG_NAME        || 'AIIMS';
  const officeName    = process.env.OFFICE_NAME     || 'AIIMS, New Delhi';
  const officeLat     = parseFloat(process.env.OFFICE_LAT || '28.5672');
  const officeLng     = parseFloat(process.env.OFFICE_LNG || '77.2100');
  const adminUsername = process.env.ADMIN_USERNAME  || 'aiims_admin';

  try {
    // 1. Verify connection
    await query('SELECT 1');

    // 2. Check if organization already exists
    const existingOrg = await query(
      'SELECT id, admin_password FROM organizations WHERE id = $1',
      [orgId]
    );

    if (existingOrg.rows.length === 0) {
      const hashedAdmin = hashPassword(adminPassRaw);
      await query(
        `INSERT INTO organizations (
           id, name, office_name, office_lat, office_lng,
           geofence_radius_m, geofence_policy, max_gps_accuracy_m,
           shift_hours, timezone, admin_username, admin_password, is_active, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          orgId, orgName, officeName, officeLat, officeLng,
          500, 'ALLOW_WITH_FLAG', 500,
          8.0, 'Asia/Kolkata', adminUsername, hashedAdmin, 1,
          new Date().toISOString()
        ]
      );
      console.log('✓ Organization ORG-001 created with scrypt-hashed admin credentials.');
    } else {
      console.log('✓ Organization ORG-001 already exists (skipped recreation).');
      const stored = existingOrg.rows[0].admin_password;
      if (stored && !stored.startsWith('scrypt$')) {
        const upgraded = hashPassword(stored);
        await query(
          'UPDATE organizations SET admin_password = $1, updated_at = $2 WHERE id = $3',
          [upgraded, new Date().toISOString(), orgId]
        );
        console.log('✓ Legacy admin password upgraded to scrypt hash.');
      }
    }

    // 3. Ensure employee sequence starts at 1000
    await query(
      `INSERT INTO employee_sequences (employer_id, last_seq)
       VALUES ($1, 1000)
       ON CONFLICT (employer_id) DO NOTHING`,
      [orgId]
    );
    console.log('✓ Employee sequence initialized for ORG-001.');

    console.log('🎉 Database seeding completed successfully.');
  } catch (err) {
    console.error('[SEED] Seeding failed:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
