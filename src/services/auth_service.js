'use strict';

const crypto         = require('crypto');
const { query, pool } = require('../db/database');

/**
 * Authentication and Security Service (PostgreSQL async version)
 *
 * Provides:
 *  1. Cryptographically secure password hashing (scrypt + random salt)
 *  2. Constant-time password verification (timingSafeEqual)
 *  3. Backward-compatible upgrade for existing legacy passwords
 *  4. Production password complexity enforcement
 *  5. Sliding-window rate limiting backed by PostgreSQL transactions
 */

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------
function validatePasswordPolicy(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.` };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter.' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: 'Password must contain at least one numeric digit.' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character (!@#$%^&* etc.).' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Password hashing / verification
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt       = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  // Institutional default password support (backward compat)
  if (
    (password === 'Aiims@123' || password === 'Password@123' || password === 'AiimsAdmin@123') &&
    (storedHash === 'Password@123' || storedHash === 'Aiims@123' || storedHash === 'AiimsAdmin@123')
  ) {
    return true;
  }

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt    = parts[1];
    const key     = parts[2];
    const keyBuf  = Buffer.from(key, 'hex');
    const derived = crypto.scryptSync(password, salt, keyBuf.length);
    if (keyBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(keyBuf, derived);
  }

  // Fallback constant-time comparison for legacy seeds
  const plainBuf  = Buffer.from(password);
  const storedBuf = Buffer.from(storedHash);
  if (plainBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(plainBuf, storedBuf);
}

// ---------------------------------------------------------------------------
// Multi-process Sliding-Window Rate Limiter (PostgreSQL-backed)
//
// Uses a PostgreSQL transaction to atomically:
//   1. Prune expired entries
//   2. Count recent hits
//   3. Insert a new hit (if allowed)
//
// Falls back to an in-memory Map on any DB error (fail-secure).
// ---------------------------------------------------------------------------
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 10, options = {}) {
    this.windowMs    = windowMs;
    this.maxRequests = maxRequests;
    this.name        = options.name || 'auth_limiter';
    this.hits        = new Map(); // local fallback cache

    // Periodic local-memory cleanup
    setInterval(() => this.cleanup(), 120_000).unref();
  }

  /**
   * Check if a key is allowed.  Returns a Promise<boolean>.
   */
  async isAllowed(key) {
    const now    = Date.now();
    const cutoff = now - this.windowMs;

    // 1. PostgreSQL-backed sliding window (atomic transaction)
    try {
      const client = await pool.connect();
      let allowed  = false;
      try {
        await client.query('BEGIN');

        // Prune entries older than 2× window
        await client.query(
          'DELETE FROM auth_rate_limits WHERE timestamp < $1',
          [now - this.windowMs * 2]
        );

        // Count valid entries within current sliding window
        const rateKey  = `${this.name}:${key}`;
        const countRes = await client.query(
          'SELECT COUNT(*) AS cnt FROM auth_rate_limits WHERE rate_key = $1 AND timestamp >= $2',
          [rateKey, cutoff]
        );
        const cnt = parseInt(countRes.rows[0].cnt, 10);

        if (cnt >= this.maxRequests) {
          allowed = false;
        } else {
          await client.query(
            'INSERT INTO auth_rate_limits (rate_key, timestamp) VALUES ($1, $2)',
            [rateKey, now]
          );
          allowed = true;
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      if (!allowed) return false;
    } catch (dbErr) {
      console.error(`[RateLimiter:${this.name}] DB check error (falling back to memory):`, dbErr.message);
      // FAIL-SECURE: fall through to in-memory cache
    }

    // 2. In-memory fallback
    const timestamps      = this.hits.get(key) || [];
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      this.hits.set(key, validTimestamps);
      return false;
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);
    return true;
  }

  async reset(key) {
    this.hits.delete(key);
    try {
      await query(
        'DELETE FROM auth_rate_limits WHERE rate_key = $1',
        [`${this.name}:${key}`]
      );
    } catch (_) {}
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(ts => now - ts < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Global rate limiters
// ---------------------------------------------------------------------------
const loginRateLimiter  = new RateLimiter(60000, 10, { name: 'login' });
const signupRateLimiter = new RateLimiter(60000,  5, { name: 'signup' });
const faceRateLimiter   = new RateLimiter(60000, 12, { name: 'face_unlock' });

// ---------------------------------------------------------------------------
// Rate-limit middleware factory — async-aware
// ---------------------------------------------------------------------------
function rateLimitMiddleware(limiter, actionName = 'Authentication') {
  return async (req, res, next) => {
    try {
      const clientIp   = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const identifier = req.body?.login_id || req.body?.employee_id || 'anonymous';
      const ipKey      = `ip:${clientIp}`;
      const accountKey = `account:${identifier}`;

      const ipAllowed      = await limiter.isAllowed(ipKey);
      const accountAllowed = identifier === 'anonymous' ? true : await limiter.isAllowed(accountKey);

      if (!ipAllowed || !accountAllowed) {
        const retryAfterSeconds = Math.ceil(limiter.windowMs / 1000);
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          error: `Too many ${actionName} attempts. Please wait ${retryAfterSeconds} seconds before retrying.`
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  RateLimiter,
  loginRateLimiter,
  signupRateLimiter,
  faceRateLimiter,
  rateLimitMiddleware
};
