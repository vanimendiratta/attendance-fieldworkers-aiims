#!/usr/bin/env node
/**
 * Automated Supabase Database Keep-Alive Script
 *
 * Purpose:
 *   Performs a lightweight, read-only database query or API health-check against
 *   the Supabase project to generate active database usage and prevent Supabase
 *   free-tier projects from automatically pausing due to 7-day inactivity policies.
 *
 * Scheduling:
 *   Intended to run automatically every 3 days via GitHub Actions (.github/workflows/supabase-keepalive.yml)
 *   or manually on demand via CLI / workflow_dispatch.
 *
 * Security:
 *   - NEVER logs passwords, secrets, or full connection strings.
 *   - Uses read-only queries (SELECT NOW() AT TIME ZONE 'UTC').
 *   - Never inserts or modifies database rows.
 *   - Exits with code 0 on success, code 1 on failure.
 */

'use strict';

require('dotenv').config({ quiet: true });

const { Client } = require('pg');

const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds
const DEFAULT_RETRIES    = 1;     // 1 retry on transient failure
const RETRY_BACKOFF_MS   = 2000;  // 2 seconds delay between retries

/**
 * Redact passwords and credentials from connection strings or URLs.
 * @param {string} raw
 * @returns {string} Sanitized string
 */
function sanitizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const parsed = new URL(raw);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // Regex fallback for malformed URLs
    return raw.replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:***@');
  }
}

/**
 * Extract safe host and database name for logging without credentials.
 * @param {string} rawUrl
 * @returns {{ host: string, port: string, database: string }}
 */
function extractSafeTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return { host: 'unknown', port: '', database: '' };
  try {
    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || 'unknown',
      port: parsed.port || '5432',
      database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : ''
    };
  } catch {
    const hostMatch = rawUrl.match(/@([^:/]+)(?::(\d+))?(?:\/(.*))?$/);
    if (hostMatch) {
      return {
        host: hostMatch[1] || 'unknown',
        port: hostMatch[2] || '5432',
        database: (hostMatch[3] || '').split('?')[0]
      };
    }
    return { host: 'unknown', port: '', database: '' };
  }
}

/**
 * Redact sensitive substrings (passwords, tokens) from error messages.
 * @param {Error|string} err
 * @returns {string}
 */
function sanitizeError(err) {
  const msg = (err && err.message) ? err.message : String(err || 'Unknown error');
  return msg
    .replace(/postgresql:\/\/[^\s]*/gi, (match) => sanitizeUrl(match))
    .replace(/postgres:\/\/[^\s]*/gi, (match) => sanitizeUrl(match))
    .replace(/key=[^\s&]+/gi, 'key=***')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***');
}

/**
 * Mask an API key showing only first 4 and last 4 chars.
 * @param {string} key
 * @returns {string}
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return 'none';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Validate configuration and determine execution mode.
 * @param {object} env
 * @returns {{ valid: boolean, mode: 'postgres'|'rest'|'none', reason?: string }}
 */
function resolveExecutionMode(env = process.env) {
  const dbUrl = env.DATABASE_URL || env.TEST_DATABASE_URL;
  if (dbUrl && dbUrl.trim()) {
    return { valid: true, mode: 'postgres' };
  }

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseUrl.trim() && supabaseKey && supabaseKey.trim()) {
    return { valid: true, mode: 'rest' };
  }

  return {
    valid: false,
    mode: 'none',
    reason: 'Missing database configuration. Either DATABASE_URL (recommended) or SUPABASE_URL + SUPABASE_ANON_KEY must be provided.'
  };
}

/**
 * Execute keep-alive query via direct PostgreSQL connection.
 * @param {object} opts
 * @param {string} opts.connectionString
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.verbose]
 * @returns {Promise<object>}
 */
async function pingPostgres({ connectionString, timeoutMs = DEFAULT_TIMEOUT_MS, verbose = false }) {
  const target = extractSafeTarget(connectionString);
  const startTime = Date.now();

  const isSupabase = connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com');
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const requiresSsl = isSupabase || isProd;

  if (verbose) {
    console.log(`[KeepAlive] Connecting to PostgreSQL host: ${target.host}:${target.port} (DB: ${target.database || 'default'})...`);
  }

  const client = new Client({
    connectionString,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs
  });

  try {
    await client.connect();

    // Lightweight, read-only query to update the last-activity timestamp in PostgreSQL engine
    const queryText = "SELECT NOW() AT TIME ZONE 'UTC' AS server_time_utc, current_database() AS db_name, version() AS pg_version, 1 AS keep_alive_status";
    const res = await client.query(queryText);

    const latencyMs = Date.now() - startTime;
    const row = res.rows && res.rows[0] ? res.rows[0] : {};

    return {
      success: true,
      mode: 'postgres',
      targetHost: target.host,
      database: row.db_name || target.database,
      serverTimeUtc: row.server_time_utc ? new Date(row.server_time_utc).toISOString() : new Date().toISOString(),
      latencyMs,
      pgVersion: (row.pg_version || '').split(' ')[0] || 'PostgreSQL'
    };
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore client shutdown errors
    }
  }
}

/**
 * Execute keep-alive ping via Supabase REST API (PostgREST / Auth health).
 * @param {object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.apiKey
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.verbose]
 * @returns {Promise<object>}
 */
async function pingSupabaseRest({ supabaseUrl, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, verbose = false }) {
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const targetHost = extractSafeTarget(baseUrl).host;
  const startTime = Date.now();

  // Primary endpoint: PostgREST root OpenAPI endpoint
  const endpoint = `${baseUrl}/rest/v1/`;

  if (verbose) {
    console.log(`[KeepAlive] Pinging Supabase REST endpoint: ${baseUrl}/rest/v1/ (Key: ${maskApiKey(apiKey)})...`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      throw new Error(`Supabase REST endpoint returned HTTP status ${res.status} (${res.statusText})`);
    }

    return {
      success: true,
      mode: 'rest',
      targetHost,
      statusCode: res.status,
      serverTimeUtc: new Date().toISOString(),
      latencyMs
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry helper for transient failures.
 * @param {Function} fn
 * @param {number} maxRetries
 * @param {number} backoffMs
 * @returns {Promise<any>}
 */
async function executeWithRetry(fn, maxRetries = DEFAULT_RETRIES, backoffMs = RETRY_BACKOFF_MS) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt > maxRetries;
      if (isLastAttempt) {
        throw err;
      }
      console.warn(`[KeepAlive] Warning: Attempt ${attempt} failed (${sanitizeError(err)}). Retrying in ${backoffMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

/**
 * Main coordinator function.
 * @param {object} [options]
 * @param {object} [options.env]
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.verbose]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @returns {Promise<object>}
 */
async function runKeepAlive(options = {}) {
  const env = options.env || process.env;
  const dryRun = Boolean(options.dryRun);
  const verbose = Boolean(options.verbose || env.VERBOSE === 'true');
  const timeoutMs = Number(options.timeoutMs || env.KEEPALIVE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const retries = Number(options.retries !== undefined ? options.retries : (env.KEEPALIVE_RETRIES || DEFAULT_RETRIES));

  const resolved = resolveExecutionMode(env);
  if (!resolved.valid) {
    throw new Error(resolved.reason);
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      mode: resolved.mode,
      message: `Configuration is valid. Mode: ${resolved.mode}. Dry-run mode enabled, skipping network query.`
    };
  }

  if (resolved.mode === 'postgres') {
    const connectionString = env.DATABASE_URL || env.TEST_DATABASE_URL;
    return await executeWithRetry(
      () => pingPostgres({ connectionString, timeoutMs, verbose }),
      retries,
      RETRY_BACKOFF_MS
    );
  }

  if (resolved.mode === 'rest') {
    const supabaseUrl = env.SUPABASE_URL;
    const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    return await executeWithRetry(
      () => pingSupabaseRest({ supabaseUrl, apiKey, timeoutMs, verbose }),
      retries,
      RETRY_BACKOFF_MS
    );
  }

  throw new Error('Unsupported execution mode');
}

/**
 * Print formatted banner.
 */
function printBanner() {
  console.log('===============================================================');
  console.log('SUPABASE DATABASE AUTOMATED KEEP-ALIVE');
  console.log('===============================================================');
}

/**
 * CLI execution entry point.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printBanner();
    console.log(`
Usage:
  node scripts/supabase-keepalive.js [options]

Options:
  --help, -h       Display this help message
  --dry-run        Validate configuration without making network requests
  --verbose, -v    Enable detailed output

Environment Variables:
  DATABASE_URL             PostgreSQL connection string (Recommended)
  SUPABASE_URL             Supabase project URL (e.g. https://xyz.supabase.co)
  SUPABASE_ANON_KEY        Supabase anon/public key (for REST health-check)
  KEEPALIVE_TIMEOUT_MS     Request timeout in milliseconds (default: 10000)
  KEEPALIVE_RETRIES        Transient failure retries (default: 1)
  VERBOSE                  Enable verbose logs ('true'/'false')

Exit Codes:
  0: Success (database reachable, query executed)
  1: Failure (unreachable database, missing config, timeout)
`);
    process.exit(0);
  }

  const dryRun  = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');

  printBanner();
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    const result = await runKeepAlive({ dryRun, verbose });

    console.log('---------------------------------------------------------------');
    console.log('Status:       SUCCESS (Database Active)');
    console.log(`Mode:         ${result.mode.toUpperCase()}`);
    if (result.targetHost) {
      console.log(`Target Host:  ${result.targetHost}`);
    }
    if (result.database) {
      console.log(`Database:     ${result.database}`);
    }
    if (result.serverTimeUtc) {
      console.log(`Server Time:  ${result.serverTimeUtc}`);
    }
    if (result.latencyMs !== undefined) {
      console.log(`Latency:      ${result.latencyMs} ms`);
    }
    if (result.dryRun) {
      console.log(`Note:         ${result.message}`);
    }
    console.log('---------------------------------------------------------------');
    console.log('Supabase keep-alive operation completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('---------------------------------------------------------------');
    console.error('Status:       FAILED');
    console.error(`Error:        ${sanitizeError(err)}`);
    console.error('---------------------------------------------------------------');
    console.error('Action Required:');
    console.error('  1. Verify DATABASE_URL or SUPABASE_URL + SUPABASE_ANON_KEY in your secrets.');
    console.error('  2. Confirm network connectivity to the Supabase database instance.');
    console.error('  3. Check if the project is currently paused in the Supabase Dashboard.');
    console.error('---------------------------------------------------------------');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  sanitizeUrl,
  extractSafeTarget,
  sanitizeError,
  maskApiKey,
  resolveExecutionMode,
  pingPostgres,
  pingSupabaseRest,
  executeWithRetry,
  runKeepAlive
};
