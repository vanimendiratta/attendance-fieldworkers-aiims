// server/index.js
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { runMigrations } = require('./database/migrate');
const { seedDatabase } = require('./database/seed');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure database is migrated and seeded on startup
try {
  runMigrations();
  seedDatabase();
} catch (err) {
  console.error('[DATABASE_STARTUP_ERROR]', err);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static Files with no-cache headers for instant frontend updates
app.use(express.static(path.resolve(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// API Routes
app.use('/api', apiRouter);

// SPA fallback for HTML5 routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[UNHANDLED_ERROR]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` EMS (Employee Leave Management System) Server Active! `);
    console.log(` Port: http://localhost:${PORT}                         `);
    console.log(` Default Admin: admin@ems.gov.in / Admin@EMS2026!      `);
    console.log(`=======================================================`);
  });
}

module.exports = app;
