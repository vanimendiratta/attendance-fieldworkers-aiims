// server/database/db.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const defaultDbDir = path.resolve(__dirname, '../../data');

const dbPath = process.env.EMS_DB_PATH || (
  process.env.NODE_ENV === 'test' 
    ? path.resolve(defaultDbDir, 'ems_test.sqlite')
    : path.resolve(defaultDbDir, 'ems.sqlite')
);

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

if (process.env.NODE_ENV === 'production' && process.env.EMS_REQUIRE_EXISTING_DB === 'true' && !fs.existsSync(dbPath)) {
  console.error(`[EMS_DB_FATAL] Expected existing production database at ${dbPath} but file was not found.`);
  process.exit(1);
}

const db = new Database(dbPath, {
  // verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// Configure SQLite for high performance and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

module.exports = db;
