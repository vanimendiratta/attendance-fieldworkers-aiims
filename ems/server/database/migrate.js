// server/database/migrate.js
const fs = require('fs');
const path = require('path');
const db = require('./db');

function runMigrations() {
  console.log('[MIGRATION] Checking migration status...');

  // Track applied migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE filename = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');

  for (const file of files) {
    const existing = getMigration.get(file);
    if (!existing) {
      console.log(`[MIGRATION] Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      const applyTransaction = db.transaction(() => {
        db.exec(sql);
        recordMigration.run(file);
      });

      applyTransaction();
      console.log(`[MIGRATION] Successfully applied: ${file}`);
    } else {
      // console.log(`[MIGRATION] Skipping already applied: ${file}`);
    }
  }

  console.log('[MIGRATION] All migrations are up to date.');
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
