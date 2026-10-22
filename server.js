require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const apiRouter = require('./src/routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const isProd = (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase().trim() === 'production';
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none';"
  );
  next();
});

// Configure CORS — allow Netlify frontend + localhost dev
const DEFAULT_ALLOWED_ORIGINS = [
  'https://checkin-checkout-aiims.netlify.app',
  'https://attendance-fieldworkers-aiims.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : DEFAULT_ALLOWED_ORIGINS;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Ensure upload folders exist — use UPLOADS_PATH env var or project root (skip on read-only serverless runtimes)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const uploadsDir   = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads');
if (!isServerless) {
  try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(path.join(uploadsDir, 'checkins')))  fs.mkdirSync(path.join(uploadsDir, 'checkins'),  { recursive: true });
    if (!fs.existsSync(path.join(uploadsDir, 'checkouts'))) fs.mkdirSync(path.join(uploadsDir, 'checkouts'), { recursive: true });
  } catch (err) {
    console.warn('[SERVER] Warning: Local upload directory creation skipped or failed:', err.message);
  }
}

// Static assets
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/ems', express.static(path.join(__dirname, 'ems/public')));

// Ensure EMS database is migrated and master policies are seeded
try {
  const { runMigrations } = require('./ems/server/database/migrate');
  const { seedMasterPolicies } = require('./ems/server/database/seed');
  runMigrations();
  seedMasterPolicies();
} catch (emsDbErr) {
  console.warn('[SERVER] EMS Database startup warning:', emsDbErr.message);
}

// API routes
const emsApiRouter = require('./ems/server/routes/api');
app.use('/api/ems', emsApiRouter);
app.use('/api', apiRouter);

// Fallback to employee portal
app.use((req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.sendFile(path.join(__dirname, 'public/admin.html'));
  }
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Error handling middleware (masks internal details in production)
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  const isProd = (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase().trim() === 'production';
  res.status(500).json({
    success: false,
    error: isProd ? 'An internal server error occurred.' : (err.message || 'Internal Server Error')
  });
});

// ---------------------------------------------------------------------------
// Local development startup (npm run dev / node server.js)
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Real-Time Photo & Live Geolocation Attendance System`);
    console.log(`📡 Server listening on http://localhost:${PORT}`);
    console.log(`📱 Employee Live Portal: http://localhost:${PORT}`);
    console.log(`🛡️ Admin Operations:    http://localhost:${PORT}/admin.html`);
    console.log(`=======================================================`);
  });

  // Background check for daily attendance backup email in standalone mode
  let lastBackupDate = '';
  setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      // Run once per day at 23:55 (11:55 PM local time)
      if (now.getHours() === 23 && now.getMinutes() >= 55 && lastBackupDate !== todayStr) {
        lastBackupDate = todayStr;
        const emailService = require('./src/services/email_service');
        if (emailService.isEmailConfigured()) {
          console.log(`[BackupScheduler] Dispatching daily attendance backup email for ${todayStr}...`);
          await emailService.sendDailyAttendanceBackup({ employerId: 'ORG-001', dateStr: todayStr });
          console.log(`[BackupScheduler] Daily attendance backup email sent successfully.`);
        }
      }
    } catch (err) {
      console.error('[BackupScheduler] Error running scheduled daily backup:', err.message);
    }
  }, 60 * 1000); // Check once per minute

}

module.exports = app;
