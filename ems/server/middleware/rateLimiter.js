// server/middleware/rateLimiter.js
/**
 * In-memory sliding window rate limiter for login attempts
 * Prevents brute-force credential stuffing
 */
const loginAttempts = new Map(); // key: ip, value: { count, firstAttemptTime }

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5; // max 5 failed attempts per 15 minutes

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (record) {
    if (now - record.firstAttemptTime > WINDOW_MS) {
      // Window expired, reset
      loginAttempts.set(ip, { count: 0, firstAttemptTime: now });
    } else if (record.count >= MAX_ATTEMPTS) {
      const waitMinutes = Math.ceil((WINDOW_MS - (now - record.firstAttemptTime)) / 60000);
      return res.status(429).json({
        error: `Too many login attempts. For security, your access is temporarily restricted. Please try again after ${waitMinutes} minute(s).`
      });
    }
  } else {
    loginAttempts.set(ip, { count: 0, firstAttemptTime: now });
  }

  // Hook into response to record failed attempts or clear on success
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 401) {
      const current = loginAttempts.get(ip) || { count: 0, firstAttemptTime: now };
      current.count += 1;
      loginAttempts.set(ip, current);
    } else if (res.statusCode === 200 && body.token) {
      // Successful login: reset counter
      loginAttempts.delete(ip);
    }
    return originalJson(body);
  };

  next();
}

module.exports = { loginRateLimiter };
