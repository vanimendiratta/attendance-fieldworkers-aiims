/**
 * Test Suite: Supabase Keep-Alive Health-Check & Automation
 *
 * Verifies:
 * 1. Environment validation and mode resolution (Postgres vs REST vs None)
 * 2. URL sanitization and password redaction
 * 3. Error message masking (ensures zero secrets leak into logs)
 * 4. Safe target extraction (host, port, database)
 * 5. CLI flag handling (--help, --dry-run) and exit codes
 * 6. Missing environment variable detection (clean exit code 1)
 * 7. Mock REST API ping against local test HTTP server
 * 8. Transient retry and network error handling
 * 9. GitHub Actions workflow file syntax, triggers, permissions, and security
 */

'use strict';

const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const {
  sanitizeUrl,
  extractSafeTarget,
  sanitizeError,
  maskApiKey,
  resolveExecutionMode,
  pingSupabaseRest,
  executeWithRetry
} = require('../scripts/supabase-keepalive');

console.log('===============================================================');
console.log('Running Supabase Keep-Alive Automated Test Suite');
console.log('===============================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Test ${totalTests}: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        console.log('PASSED');
        passedTests++;
      }).catch((err) => {
        console.log('FAILED');
        console.error('   Assertion Error:', err.message);
        throw err;
      });
    }
    console.log('PASSED');
    passedTests++;
  } catch (err) {
    console.log('FAILED');
    console.error('   Assertion Error:', err.message);
    throw err;
  }
}

async function runAll() {
  // -------------------------------------------------------------------------
  // Group 1: Configuration & Mode Resolution
  // -------------------------------------------------------------------------
  console.log('--- Group 1: Environment & Mode Resolution ---');

  runTest('resolveExecutionMode returns invalid when environment is empty', () => {
    const res = resolveExecutionMode({});
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.mode, 'none');
    assert.ok(res.reason.includes('Missing database configuration'));
  });

  runTest('resolveExecutionMode detects DATABASE_URL as postgres mode', () => {
    const res = resolveExecutionMode({
      DATABASE_URL: 'postgresql://postgres:secret123@db.supabase.co:6543/postgres'
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.mode, 'postgres');
  });

  runTest('resolveExecutionMode detects TEST_DATABASE_URL as postgres mode', () => {
    const res = resolveExecutionMode({
      TEST_DATABASE_URL: 'postgresql://postgres:secret123@localhost:5432/test_db'
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.mode, 'postgres');
  });

  runTest('resolveExecutionMode detects SUPABASE_URL + SUPABASE_ANON_KEY as rest mode', () => {
    const res = resolveExecutionMode({
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_anon'
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.mode, 'rest');
  });

  runTest('resolveExecutionMode rejects SUPABASE_URL without key', () => {
    const res = resolveExecutionMode({
      SUPABASE_URL: 'https://test-project.supabase.co'
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.mode, 'none');
  });

  // -------------------------------------------------------------------------
  // Group 2: Credential Redaction & Security Masking
  // -------------------------------------------------------------------------
  console.log('\n--- Group 2: Security & Credential Redaction ---');

  runTest('sanitizeUrl replaces password with asterisks in PostgreSQL URI', () => {
    const raw = 'postgresql://postgres:super_secret_password_99@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    const sanitized = sanitizeUrl(raw);
    assert.ok(!sanitized.includes('super_secret_password_99'), 'Raw password must be stripped');
    assert.ok(sanitized.includes(':***@'), 'Password must be masked with ***');
    assert.ok(sanitized.includes('aws-0-ap-south-1.pooler.supabase.com:6543/postgres'));
  });

  runTest('sanitizeUrl handles non-URL strings without throwing', () => {
    const res = sanitizeUrl('just-a-plain-string');
    assert.strictEqual(res, 'just-a-plain-string');
    assert.strictEqual(sanitizeUrl(null), '');
    assert.strictEqual(sanitizeUrl(undefined), '');
  });

  runTest('extractSafeTarget extracts host and db name without credentials', () => {
    const raw = 'postgresql://postgres:super_secret@db.abcxyz.supabase.co:5432/my_production_db';
    const target = extractSafeTarget(raw);
    assert.strictEqual(target.host, 'db.abcxyz.supabase.co');
    assert.strictEqual(target.port, '5432');
    assert.strictEqual(target.database, 'my_production_db');
  });

  runTest('sanitizeError strips database connection strings and bearer tokens', () => {
    const err = new Error(
      'Connection failed to postgresql://admin:p@ssword123@db.supabase.co:5432/postgres using Bearer eyJhbGciOiJIUzI1Ni.secret'
    );
    const sanitized = sanitizeError(err);
    assert.ok(!sanitized.includes('p@ssword123'), 'Error message must not contain database password');
    assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1Ni.secret'), 'Error message must not contain bearer token');
    assert.ok(sanitized.includes('postgresql://admin:***@db.supabase.co:5432/postgres'));
    assert.ok(sanitized.includes('Bearer ***'));
  });

  runTest('maskApiKey obscures key body while leaving identification bounds', () => {
    const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_anon_secret_payload_tail';
    const masked = maskApiKey(key);
    assert.strictEqual(masked.startsWith('eyJh'), true);
    assert.strictEqual(masked.endsWith('tail'), true);
    assert.ok(masked.includes('...'));
    assert.ok(!masked.includes('dummy_anon_secret_payload'));
    assert.strictEqual(maskApiKey(''), 'none');
    assert.strictEqual(maskApiKey('short'), '********');
  });

  // -------------------------------------------------------------------------
  // Group 3: CLI Execution & Exit Codes
  // -------------------------------------------------------------------------
  console.log('\n--- Group 3: CLI Execution & Exit Codes ---');

  runTest('CLI exits with code 1 when no environment variables are provided', () => {
    try {
      execSync('node scripts/supabase-keepalive.js', {
        env: { PATH: process.env.PATH },
        stdio: 'pipe'
      });
      assert.fail('Should have exited with non-zero code');
    } catch (err) {
      assert.strictEqual(err.status, 1);
      const stderr = err.stderr ? err.stderr.toString() : '';
      const stdout = err.stdout ? err.stdout.toString() : '';
      const combined = stdout + stderr;
      assert.ok(combined.includes('FAILED'));
      assert.ok(combined.includes('Missing database configuration'));
    }
  });

  runTest('CLI exits with code 0 on --help flag', () => {
    const output = execSync('node scripts/supabase-keepalive.js --help', {
      stdio: 'pipe'
    }).toString();
    assert.ok(output.includes('Usage:'));
    assert.ok(output.includes('--dry-run'));
    assert.ok(output.includes('DATABASE_URL'));
  });

  runTest('CLI executes dry-run successfully with mock DATABASE_URL', () => {
    const output = execSync('node scripts/supabase-keepalive.js --dry-run', {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: 'postgresql://postgres:secret@db.project.supabase.co:6543/postgres'
      },
      stdio: 'pipe'
    }).toString();
    assert.ok(output.includes('SUCCESS'));
    assert.ok(output.includes('Mode:         POSTGRES'));
    assert.ok(output.includes('Dry-run mode enabled'));
  });

  runTest('CLI executes dry-run successfully with mock SUPABASE_URL and key', () => {
    const output = execSync('node scripts/supabase-keepalive.js --dry-run', {
      env: {
        PATH: process.env.PATH,
        SUPABASE_URL: 'https://demo-project.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo_token'
      },
      stdio: 'pipe'
    }).toString();
    assert.ok(output.includes('SUCCESS'));
    assert.ok(output.includes('Mode:         REST'));
    assert.ok(output.includes('Dry-run mode enabled'));
  });

  // -------------------------------------------------------------------------
  // Group 4: Mock HTTP REST Keep-Alive & Retry Handling
  // -------------------------------------------------------------------------
  console.log('\n--- Group 4: Network Health-Check Simulation & Retries ---');

  await runTest('pingSupabaseRest successfully queries mock server with correct headers', async () => {
    let receivedAuth = '';
    let receivedApiKey = '';
    let receivedPath = '';

    const server = http.createServer((req, res) => {
      receivedAuth = req.headers['authorization'] || '';
      receivedApiKey = req.headers['apikey'] || '';
      receivedPath = req.url;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await pingSupabaseRest({
        supabaseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'test-anon-key-12345',
        timeoutMs: 5000,
        verbose: false
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.mode, 'rest');
      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(receivedApiKey, 'test-anon-key-12345');
      assert.strictEqual(receivedAuth, 'Bearer test-anon-key-12345');
      assert.strictEqual(receivedPath, '/rest/v1/');
      assert.strictEqual(typeof result.latencyMs, 'number');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await runTest('executeWithRetry successfully retries after transient failure', async () => {
    let callCount = 0;
    const flakyFunction = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Transient network glitch');
      }
      return 'recovered';
    };

    const result = await executeWithRetry(flakyFunction, 1, 100);
    assert.strictEqual(result, 'recovered');
    assert.strictEqual(callCount, 2);
  });

  // -------------------------------------------------------------------------
  // Group 5: GitHub Actions Workflow Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Group 5: GitHub Actions Workflow Validation ---');

  runTest('Workflow file exists at .github/workflows/supabase-keepalive.yml', () => {
    const workflowPath = path.join(__dirname, '../.github/workflows/supabase-keepalive.yml');
    assert.ok(fs.existsSync(workflowPath), 'Workflow file must exist');
  });

  runTest('Workflow file defines safe 3-day schedule and workflow_dispatch', () => {
    const workflowPath = path.join(__dirname, '../.github/workflows/supabase-keepalive.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    // Schedule check (every 3 days cron: '*/3')
    assert.ok(content.includes('schedule:'), 'Must configure schedule trigger');
    assert.ok(/\*\s*\/\s*3/.test(content), 'Must use */3 recurring schedule (every 3 days)');

    // Manual execution check
    assert.ok(content.includes('workflow_dispatch:'), 'Must support workflow_dispatch for manual runs');

    // Concurrency check
    assert.ok(content.includes('concurrency:'), 'Must specify concurrency group to prevent overlapping runs');

    // Permissions check
    assert.ok(/permissions:\s*\n\s*contents:\s*read/.test(content), 'Must have minimal read permissions');

    // Timeout check
    assert.ok(/timeout-minutes:\s*10/.test(content), 'Must specify job timeout');

    // Secret security check
    assert.ok(content.includes('secrets.DATABASE_URL'), 'Must bind DATABASE_URL secret');
    assert.ok(content.includes('secrets.SUPABASE_URL'), 'Must bind SUPABASE_URL secret');
    assert.ok(!content.includes('postgres://postgres:'), 'Must not hardcode connection strings');
    assert.ok(!content.includes('eyJhbGciOi'), 'Must not hardcode JWT tokens');
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('===============================================================\n');
}

runAll().catch((err) => {
  console.error('\nTest suite execution failed:', err);
  process.exit(1);
});
