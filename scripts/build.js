/**
 * Production Build Verification Script
 * 
 * Verifies:
 * 1. Required runtime upload directories
 * 2. Static web asset bundle completeness
 * 3. Database initialization & schema integrity
 */

const fs = require('fs');
const path = require('path');

console.log('--- Running Production Build & Asset Verification ---');

// 1. Ensure required runtime storage directories exist
const requiredDirs = [
  'uploads',
  'uploads/checkins',
  'uploads/checkouts',
  'public',
  'src/db',
  'src/routes',
  'src/services'
];

for (const dir of requiredDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`+ Created runtime directory: ${dir}`);
  }
}
console.log('✓ Runtime upload and storage directories verified.');

// 2. Validate essential public web assets
const requiredAssets = [
  'public/index.html',
  'public/admin.html',
  'public/tokens.css',
  'public/icons.js',
  'public/app.js',
  'public/admin.js',
  'public/face_biometric_client.js'
];

for (const asset of requiredAssets) {
  if (!fs.existsSync(asset)) {
    console.error(`❌ Missing critical production asset: ${asset}`);
    process.exit(1);
  }
  const stats = fs.statSync(asset);
  if (stats.size === 0) {
    console.error(`❌ Production asset is empty: ${asset}`);
    process.exit(1);
  }
}
console.log(`✓ All ${requiredAssets.length} production frontend assets present and non-empty.`);

// 3. Validate database schema integrity
try {
  const db = require('../src/db/database');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  const expectedTables = ['organizations', 'employees', 'teams', 'attendance', 'breaks', 'audit_logs', 'auth_rate_limits'];
  
  for (const exp of expectedTables) {
    if (!tables.includes(exp)) {
      console.error(`❌ Expected database table missing: ${exp}`);
      process.exit(1);
    }
  }
  console.log(`✓ Database schema validated with all ${expectedTables.length} enterprise tables active.`);
} catch (dbErr) {
  console.error('❌ Database initialization error:', dbErr.message);
  process.exit(1);
}

console.log('🎉 BUILD SUCCESSFUL: Production bundle and environment verified.');
