const crypto = require('crypto');

/**
 * Authentication and Security Service
 * 
 * Provides:
 * 1. Cryptographically secure password hashing (scrypt + random salt)
 * 2. Constant-time password verification (timingSafeEqual)
 * 3. Backward-compatible upgrade for existing legacy passwords
 * 4. Production password complexity enforcement
 * 5. In-memory sliding-window rate limiting for auth endpoints
 */

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

/**
 * Validate password against enterprise security policy
 * @param {string} password
 * @returns {{ valid: boolean, error?: string }}
 */
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

/**
 * Hash password using scrypt with cryptographically random salt
 * Format: scrypt$<saltHex>$<derivedKeyHex>
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Verify password against stored hash using constant-time comparison
 * @param {string} password - Candidate plain password
 * @param {string} storedHash - Stored hash or legacy password
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const key = parts[2];
    const keyBuf = Buffer.from(key, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, keyBuf.length);
    if (keyBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, derivedBuf);
  }

  // Fallback for legacy seeded passwords (constant-time comparison)
  const plainBuf = Buffer.from(password);
  const storedBuf = Buffer.from(storedHash);
  if (plainBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(plainBuf, storedBuf);
}

/**
 * In-memory sliding window rate limiter
 */
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map(); // key -> [timestamps]

    // Periodic cleanup every 2 minutes
    setInterval(() => this.cleanup(), 120000).unref();
  }

  isAllowed(key) {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      this.hits.set(key, validTimestamps);
      return false;
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);
    return true;
  }

  reset(key) {
    this.hits.delete(key);
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

// Global limiters for sensitive endpoints
const loginRateLimiter = new RateLimiter(60000, 10); // 10 attempts per minute
const signupRateLimiter = new RateLimiter(60000, 5);  // 5 signups per minute
const faceRateLimiter = new RateLimiter(60000, 12);  // 12 face attempts per minute

function rateLimitMiddleware(limiter, actionName = 'Authentication') {
  return (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${clientIp}:${req.body?.login_id || req.body?.employee_id || 'anonymous'}`;

    if (!limiter.isAllowed(key)) {
      return res.status(429).json({
        success: false,
        error: `Too many ${actionName} attempts. Please wait 60 seconds before retrying.`
      });
    }
    next();
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
