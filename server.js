require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const apiRouter = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and generous JSON limit for live camera image payloads
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Ensure upload folders exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(path.join(uploadsDir, 'checkins'))) fs.mkdirSync(path.join(uploadsDir, 'checkins'), { recursive: true });
if (!fs.existsSync(path.join(uploadsDir, 'checkouts'))) fs.mkdirSync(path.join(uploadsDir, 'checkouts'), { recursive: true });

// Static assets
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRouter);

// Fallback to employee portal
app.use((req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.sendFile(path.join(__dirname, 'public/admin.html'));
  }
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Real-Time Photo & Live Geolocation Attendance System`);
    console.log(`📡 Server listening on http://localhost:${PORT}`);
    console.log(`📱 Employee Live Portal: http://localhost:${PORT}`);
    console.log(`🛡️ Admin Operations:    http://localhost:${PORT}/admin.html`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
