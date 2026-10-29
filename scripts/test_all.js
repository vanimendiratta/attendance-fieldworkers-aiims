/**
 * Comprehensive Test Runner
 * Executes all 18 test suites against the PostgreSQL database.
 *
 * Behaviour when TEST_DATABASE_URL is not set:
 *   - Pure unit-test suites (requiresDb: false) are run and must pass.
 *   - Database-dependent suites (requiresDb: true) are SKIPPED with a clear notice.
 *   - The runner exits 0 only when all non-skipped suites pass.
 */
const { execSync } = require('child_process');

const HAS_DB = Boolean(process.env.TEST_DATABASE_URL);

const suites = [
  { name: 'Pure Unit & PostgreSQL Integration',                      cmd: 'node test/api.test.js',                          requiresDb: true  },
  { name: 'Sign Up & Screenlock Face Recognition',                   cmd: 'node test/auth_signup_face.test.js',              requiresDb: true  },
  { name: 'Biometric Security & Liveness Evaluation',                cmd: 'node test/biometric_security_evaluation.test.js', requiresDb: true  },
  { name: 'Email Backup Service',                                    cmd: 'node test/email_backup.test.js',                  requiresDb: false },
  { name: '46-Column Enterprise CSV Export',                         cmd: 'node test/export_csv.test.js',                    requiresDb: true  },
  { name: 'Final Production Security Gate (OWASP & Rate Limit)',     cmd: 'node test/final_production_gate.test.js',         requiresDb: true  },
  { name: 'Leaves & Attendance Alteration',                          cmd: 'node test/leaves_and_alteration.test.js',         requiresDb: true  },
  { name: 'Security Hardening & Multi-Tenant Isolation',             cmd: 'node test/security_hardening.test.js',            requiresDb: true  },
  { name: '16-Phase Security Remediation Regression',                cmd: 'node test/security_remediation.test.js',          requiresDb: true  },
  { name: 'Single Punch Per Day Limit Enforcement',                  cmd: 'node test/single_punch_limit.test.js',            requiresDb: true  },
  { name: 'Indian States, Districts & Teams Tracking',               cmd: 'node test/state_district_team.test.js',           requiresDb: true  },
  { name: 'Supabase Automated Keep-Alive & Security Redaction',      cmd: 'node test/supabase_keepalive.test.js',            requiresDb: true  },
  { name: 'Comprehensive Security Audit & Remediation Verification', cmd: 'node test/security_audit_remediation.test.js',    requiresDb: true  },
  { name: 'Secure Signup, DOB, cder Email, Mobile & FW- Employee ID',cmd: 'node test/secure_signup_login.test.js',           requiresDb: true  },
  { name: 'Hotel Stay GPS Verification & Geographic Matching',       cmd: 'node test/hotel_gps_verification.test.js',        requiresDb: true  },
  { name: 'Inbuilt Delete Confirmation Modal Verification',          cmd: 'node test/confirm_modal.test.js',                 requiresDb: false },
  { name: 'State & District Standardization & Independent Validation',cmd: 'node test/state_district_standardization.test.js',requiresDb: true  },
  { name: 'Shared Multi-Location Geofencing & Work Mode Compliance', cmd: 'node test/shared_geofencing.test.js',             requiresDb: true  },
  { name: 'CSV Exports, Timesheet Fix & Team-Wise Attendance',       cmd: 'node test/csv_and_timesheet_export.test.js',          requiresDb: false },
  { name: 'EMS Integration & Leave Governance Engine',              cmd: 'node test/ems_integration.test.js',                   requiresDb: false },
  { name: 'EMS Post-Integration Security Verification (26 Tests)', cmd: 'node test/ems_security_verification.test.js',          requiresDb: false },
  { name: 'Secure 30-Minute Session Inactivity Timeout (15 Tests)', cmd: 'node test/session_timeout.test.js',                  requiresDb: true },
  { name: 'Single Active Session Policy Across App & EMS (8 Tests)',cmd: 'node test/single_active_session.test.js',             requiresDb: false },
  { name: 'Single Active Session Atomic Concurrency (10 Tests)',    cmd: 'node test/single_active_session_concurrency.test.js', requiresDb: true },
  { name: 'EMS Production End-to-End Workflow & QA Gate (26 Tests)',cmd: 'node test/ems_end_to_end_workflow.test.js',         requiresDb: false },
];

console.log('===============================================================');
console.log('🧪 RUNNING ALL ' + suites.length + ' TEST SUITES ACROSS THE REPOSITORY');
console.log('===============================================================');

if (!HAS_DB) {
  console.log('\n⚠️  TEST_DATABASE_URL is not set.');
  console.log('   Database-dependent suites will be SKIPPED.');
  console.log('   To run all suites, set TEST_DATABASE_URL to a local PostgreSQL instance.\n');
} else {
  console.log('');
}

let passed  = 0;
let skipped = 0;
let failed = 0;
let idx     = 0;

for (const suite of suites) {
  idx++;
  const label = `[${idx}/${suites.length}] ${suite.name}`;

  if (suite.requiresDb && !HAS_DB) {
    console.log(`⏭️  ${label} — SKIPPED (no TEST_DATABASE_URL)`);
    skipped++;
    continue;
  }

  process.stdout.write(`⏳ ${label}... `);
  try {
    execSync(suite.cmd, { stdio: 'pipe', env: process.env });
    console.log('✅ PASSED');
    passed++;
  } catch (err) {
    console.log('❌ FAILED');
    // Suite identification and exit status
    console.error(`Suite: ${label}`);
    if (err.status !== undefined) console.error(`Exit code: ${err.status}`);
    // Print both stdout and stderr if available for better diagnostics
    if (err.stdout) console.error('STDOUT:', err.stdout.toString());
    if (err.stderr) console.error('STDERR:', err.stderr.toString());
    if (!err.stdout && !err.stderr) console.error(err.message);
    failed++;
    continue;
  }
}

console.log('\n===============================================================');
console.log(`🎉 ${passed} PASSED  |  ${skipped} SKIPPED (requires PostgreSQL)  |  ${failed} FAILED`);
if (failed > 0) {
  console.log('===============================================================\n');
  process.exit(1);
} else {
  console.log('===============================================================\n');
  process.exit(0);
}
