/**
 * Comprehensive Test Runner
 * Executes all 11 test suites against the PostgreSQL database
 */
const { execSync } = require('child_process');

const suites = [
  { name: 'Pure Unit & PostgreSQL Integration', cmd: 'node test/api.test.js' },
  { name: 'Sign Up & Screenlock Face Recognition', cmd: 'node test/auth_signup_face.test.js' },
  { name: 'Biometric Security & Liveness Evaluation', cmd: 'node test/biometric_security_evaluation.test.js' },
  { name: 'Email Backup Service', cmd: 'node test/email_backup.test.js' },
  { name: '46-Column Enterprise CSV Export', cmd: 'node test/export_csv.test.js' },
  { name: 'Final Production Security Gate (OWASP & Rate Limit)', cmd: 'node test/final_production_gate.test.js' },
  { name: 'Leaves & Attendance Alteration', cmd: 'node test/leaves_and_alteration.test.js' },
  { name: 'Security Hardening & Multi-Tenant Isolation', cmd: 'node test/security_hardening.test.js' },
  { name: '16-Phase Security Remediation Regression', cmd: 'node test/security_remediation.test.js' },
  { name: 'Single Punch Per Day Limit Enforcement', cmd: 'node test/single_punch_limit.test.js' },
  { name: 'Indian States, Districts & Teams Tracking', cmd: 'node test/state_district_team.test.js' }
];

console.log('===============================================================');
console.log('🧪 RUNNING ALL ' + suites.length + ' TEST SUITES ACROSS THE REPOSITORY');
console.log('===============================================================\n');

let passed = 0;
for (const suite of suites) {
  process.stdout.write(`⏳ [${passed + 1}/${suites.length}] ${suite.name}... `);
  try {
    execSync(suite.cmd, { stdio: 'pipe', env: process.env });
    console.log('✅ PASSED');
    passed++;
  } catch (err) {
    console.log('❌ FAILED');
    console.error(err.stdout ? err.stdout.toString() : err.message);
    process.exit(1);
  }
}

console.log('\n===============================================================');
console.log(`🎉 ALL ${passed}/${suites.length} TEST SUITES PASSED 100% WITH ZERO ERRORS!`);
console.log('===============================================================\n');
process.exit(0);
