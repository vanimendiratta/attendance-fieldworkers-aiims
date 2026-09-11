const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Use DB_PATH env var (Render persistent disk) or fall back to local path
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../attendance.db');

// Ensure the directory exists (important for Render's /data mount)
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      office_name TEXT NOT NULL,
      office_lat REAL NOT NULL,
      office_lng REAL NOT NULL,
      geofence_radius_m REAL NOT NULL DEFAULT 100,
      geofence_policy TEXT NOT NULL DEFAULT 'ALLOW_WITH_FLAG', -- 'STRICT_BLOCK' or 'ALLOW_WITH_FLAG'
      max_gps_accuracy_m REAL NOT NULL DEFAULT 100,
      shift_hours REAL NOT NULL DEFAULT 8.0,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      admin_username TEXT NOT NULL DEFAULT 'admin',
      admin_password TEXT NOT NULL DEFAULT 'admin123',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      employer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      department TEXT NOT NULL,
      designation TEXT NOT NULL,
      pin TEXT NOT NULL DEFAULT '1234',
      password TEXT NOT NULL DEFAULT 'Password@123',
      face_photo TEXT,
      face_descriptor TEXT,
      face_enrolled INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0,
      team_id TEXT,
      state TEXT,
      district TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (employer_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      employer_id TEXT NOT NULL,
      attendance_status TEXT NOT NULL, -- 'CHECKED_IN', 'ON_BREAK', 'COMPLETED', 'ANOMALY_FLAGGED'
      
      -- Check-in details
      checkin_photo TEXT NOT NULL,
      checkin_photo_hash TEXT,
      checkin_lat REAL NOT NULL,
      checkin_lng REAL NOT NULL,
      checkin_accuracy REAL NOT NULL,
      checkin_location_timestamp TEXT,
      checkin_server_timestamp TEXT NOT NULL,
      checkin_address TEXT,
      checkin_geofence_distance REAL,
      checkin_geofence_status TEXT,

      -- Check-out details
      checkout_photo TEXT,
      checkout_photo_hash TEXT,
      checkout_lat REAL,
      checkout_lng REAL,
      checkout_accuracy REAL,
      checkout_location_timestamp TEXT,
      checkout_server_timestamp TEXT,
      checkout_address TEXT,
      checkout_geofence_distance REAL,
      checkout_geofence_status TEXT,

      -- Working Hours
      gross_working_seconds INTEGER DEFAULT 0,
      break_seconds INTEGER DEFAULT 0,
      net_working_seconds INTEGER DEFAULT 0,
      overtime_seconds INTEGER DEFAULT 0,

      -- Field Work & Duty Mode
      work_mode TEXT DEFAULT 'OFFICE', -- 'OFFICE' or 'FIELD_WORK'
      field_site_notes TEXT,

      -- Reliability & Sync
      idempotency_key TEXT UNIQUE,
      redcap_sync_status TEXT DEFAULT 'PENDING',
      redcap_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (employer_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS breaks (
      id TEXT PRIMARY KEY,
      attendance_id TEXT NOT NULL,
      start_server_timestamp TEXT NOT NULL,
      end_server_timestamp TEXT,
      duration_seconds INTEGER DEFAULT 0,
      FOREIGN KEY (attendance_id) REFERENCES attendance(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      employee_id TEXT,
      employer_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL, -- 'SUCCESS', 'BLOCKED', 'WARNING', 'ANOMALY'
      details_json TEXT,
      client_ip TEXT,
      user_agent TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      employer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      district TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (employer_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS employee_sequences (
      employer_id TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      rate_key TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON auth_rate_limits (rate_key, timestamp);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      employer_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      is_revoked INTEGER NOT NULL DEFAULT 0,
      client_ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token_active ON sessions (id, is_revoked, expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, is_revoked);
  `);

  // Migrate columns if upgrading existing db
  try {
    const orgColumns = db.prepare('PRAGMA table_info(organizations)').all().map(c => c.name);
    if (!orgColumns.includes('admin_username')) {
      db.exec("ALTER TABLE organizations ADD COLUMN admin_username TEXT");
    }
    if (!orgColumns.includes('admin_password')) {
      db.exec("ALTER TABLE organizations ADD COLUMN admin_password TEXT");
    }

    const empColumns = db.prepare('PRAGMA table_info(employees)').all().map(c => c.name);
    if (!empColumns.includes('password')) {
      db.exec("ALTER TABLE employees ADD COLUMN password TEXT");
    }
    if (!empColumns.includes('team_id')) {
      db.exec("ALTER TABLE employees ADD COLUMN team_id TEXT");
    }
    if (!empColumns.includes('state')) {
      db.exec("ALTER TABLE employees ADD COLUMN state TEXT");
    }
    if (!empColumns.includes('district')) {
      db.exec("ALTER TABLE employees ADD COLUMN district TEXT");
    }
    if (!empColumns.includes('phone')) {
      db.exec("ALTER TABLE employees ADD COLUMN phone TEXT");
    }
    if (!empColumns.includes('face_photo')) {
      db.exec("ALTER TABLE employees ADD COLUMN face_photo TEXT");
    }
    if (!empColumns.includes('face_descriptor')) {
      db.exec("ALTER TABLE employees ADD COLUMN face_descriptor TEXT");
    }
    if (!empColumns.includes('face_enrolled')) {
      db.exec("ALTER TABLE employees ADD COLUMN face_enrolled INTEGER DEFAULT 0");
    }

    const attColumns = db.prepare('PRAGMA table_info(attendance)').all().map(c => c.name);
    if (!attColumns.includes('work_mode')) {
      db.exec("ALTER TABLE attendance ADD COLUMN work_mode TEXT DEFAULT 'OFFICE'");
    }
    if (!attColumns.includes('field_site_notes')) {
      db.exec("ALTER TABLE attendance ADD COLUMN field_site_notes TEXT");
    }
    if (!attColumns.includes('team_id')) {
      db.exec("ALTER TABLE attendance ADD COLUMN team_id TEXT");
    }
    if (!attColumns.includes('state')) {
      db.exec("ALTER TABLE attendance ADD COLUMN state TEXT");
    }
    if (!attColumns.includes('district')) {
      db.exec("ALTER TABLE attendance ADD COLUMN district TEXT");
    }
  } catch (migErr) {
    console.warn('Migration note:', migErr.message);
  }

  // Seed / Upsert distinct employers (organizations)
  const upsertOrg = db.prepare(`
    INSERT INTO organizations (id, name, office_name, office_lat, office_lng, geofence_radius_m, geofence_policy, max_gps_accuracy_m, shift_hours, timezone, admin_username, admin_password, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      office_name=excluded.office_name,
      office_lat=excluded.office_lat,
      office_lng=excluded.office_lng,
      geofence_radius_m=excluded.geofence_radius_m,
      geofence_policy=excluded.geofence_policy,
      max_gps_accuracy_m=excluded.max_gps_accuracy_m,
      admin_username=excluded.admin_username,
      admin_password=CASE WHEN organizations.admin_password LIKE 'scrypt$%' THEN organizations.admin_password ELSE excluded.admin_password END,
      updated_at=excluded.updated_at
  `);

  // Resolve initial admin password securely
  const existingOrg = db.prepare('SELECT admin_password FROM organizations WHERE id = ?').get('ORG-001');
  let adminPasswordHash = existingOrg?.admin_password;

  if (!adminPasswordHash || !adminPasswordHash.startsWith('scrypt$')) {
    const isProd = (process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase().trim() === 'production';
    if (process.env.ADMIN_INITIAL_PASSWORD) {
      const salt = crypto.randomBytes(16).toString('hex');
      const derivedKey = crypto.scryptSync(process.env.ADMIN_INITIAL_PASSWORD, salt, 64);
      adminPasswordHash = `scrypt$${salt}$${derivedKey.toString('hex')}`;
    } else if (existingOrg?.admin_password) {
      const salt = crypto.randomBytes(16).toString('hex');
      const derivedKey = crypto.scryptSync(existingOrg.admin_password, salt, 64);
      adminPasswordHash = `scrypt$${salt}$${derivedKey.toString('hex')}`;
    } else if (isProd) {
      const generatedSecret = crypto.randomBytes(24).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const derivedKey = crypto.scryptSync(generatedSecret, salt, 64);
      adminPasswordHash = `scrypt$${salt}$${derivedKey.toString('hex')}`;
      console.warn('[SECURITY NOTICE] Initial production admin password was generated. Set ADMIN_INITIAL_PASSWORD in environment.');
    } else {
      // Development mode default password (scrypt hashed)
      const salt = crypto.randomBytes(16).toString('hex');
      const derivedKey = crypto.scryptSync('Aiims@123', salt, 64);
      adminPasswordHash = `scrypt$${salt}$${derivedKey.toString('hex')}`;
    }
  }

  // Employer: AIIMS (AIIMS Campus, New Delhi)
  upsertOrg.run(
    'ORG-001',
    'AIIMS',
    'AIIMS, New Delhi',
    28.5662,
    77.2136,
    1000,
    'ALLOW_WITH_FLAG',
    500,
    8.0,
    'Asia/Kolkata',
    'aiims_admin',
    adminPasswordHash,
    new Date().toISOString()
  );

  // Clean up any legacy dummy organizations, teams, and employees (Alex, Priya, Marcus, etc.)
  try {
    const dummyEmpIds = db.prepare(`SELECT id FROM employees WHERE name LIKE '%Alex%' OR name LIKE '%Marcus%' OR name LIKE '%Priya%' OR name LIKE '%Rohan%' OR name LIKE '%Sarah%' OR name LIKE '%Elena%' OR email LIKE '%apexcorp.internal%' OR email LIKE '%cyberdyne.io%'`).all().map(r => r.id);
    if (dummyEmpIds.length > 0) {
      const placeholders = dummyEmpIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE employee_id IN (${placeholders}))`).run(...dummyEmpIds);
      db.prepare(`DELETE FROM attendance WHERE employee_id IN (${placeholders})`).run(...dummyEmpIds);
      db.prepare(`DELETE FROM audit_logs WHERE employee_id IN (${placeholders})`).run(...dummyEmpIds);
      db.prepare(`DELETE FROM employees WHERE id IN (${placeholders})`).run(...dummyEmpIds);
    }
    db.prepare(`DELETE FROM teams WHERE employer_id = 'ORG-002'`).run();
    db.prepare(`DELETE FROM organizations WHERE id = 'ORG-002'`).run();
  } catch (cleanErr) {
    // ignore
  }

  // Seed / Upsert Regional Teams by State and District for AIIMS
  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, employer_id, name, state, district, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      state=excluded.state,
      district=excluded.district,
      description=excluded.description
  `);

  // AIIMS Regional Teams
  upsertTeam.run('TEAM-101', 'ORG-001', 'Delhi Regional Headquarters', 'Delhi', 'New Delhi', 'Primary dental healthcare and research operations at AIIMS campus', new Date().toISOString());
  upsertTeam.run('TEAM-102', 'ORG-001', 'Central Delhi Field Unit', 'Delhi', 'Central Delhi', 'Active field deployment & dental healthcare audit', new Date().toISOString());
  upsertTeam.run('TEAM-103', 'ORG-001', 'Maharashtra West Operations', 'Maharashtra', 'Mumbai Suburban', 'Western territory inspection & dental clinical audit', new Date().toISOString());

  // Seed / Upsert Core AIIMS Healthcare & Research Personnel
  const upsertEmp = db.prepare(`
    INSERT INTO employees (id, employer_id, name, email, department, designation, team_id, state, district, phone, password, is_active, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      email=excluded.email,
      department=excluded.department,
      designation=excluded.designation,
      team_id=excluded.team_id,
      state=excluded.state,
      district=excluded.district,
      phone=excluded.phone
  `);

  const defaultEmpPwd = 'Aiims@123';
  const nowIso = new Date().toISOString();

  upsertEmp.run('EMP-1001', 'ORG-001', 'Dr. Rajesh Kumar', 'rajesh.kumar@aiims.edu', 'Dental Research & Healthcare', 'Senior Field Officer (PRS-1)', 'TEAM-101', 'Delhi', 'New Delhi', '+91 98765 43210', defaultEmpPwd, nowIso);
  upsertEmp.run('EMP-1002', 'ORG-001', 'Dr. Ananya Sharma', 'ananya.sharma@aiims.edu', 'Oral Health Sciences', 'Research Specialist (PRS-2)', 'TEAM-102', 'Delhi', 'Central Delhi', '+91 98765 43211', defaultEmpPwd, nowIso);
  upsertEmp.run('EMP-1003', 'ORG-001', 'Dr. Vikram Malhotra', 'vikram.malhotra@aiims.edu', 'Community Dentistry', 'Field Epidemiologist (PRS-2)', 'TEAM-103', 'Maharashtra', 'Mumbai Suburban', '+91 98765 43212', defaultEmpPwd, nowIso);
  upsertEmp.run('EMP-1004', 'ORG-001', 'Sunita Verma', 'sunita.verma@aiims.edu', 'Dental Health Audit', 'Field Operations Lead (PRS-3)', 'TEAM-101', 'Delhi', 'New Delhi', '+91 98765 43213', defaultEmpPwd, nowIso);

  // Clean legacy test accounts
  try {
    db.prepare("DELETE FROM employees WHERE id LIKE '%MANUAL%' OR name LIKE '%Tester%'").run();
  } catch (_) {}
  // Initialize sequence counters for atomic, race-condition-safe ID generation
  try {
    const existingEmployees = db.prepare(`SELECT id FROM employees WHERE id LIKE 'EMP-%'`).all();
    let maxNum = 1000;
    for (const emp of existingEmployees) {
      const m = emp.id.match(/\d+/);
      if (m) {
        const n = parseInt(m[0], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    db.prepare(`
      INSERT INTO employee_sequences (employer_id, last_seq)
      VALUES ('ORG-001', ?)
      ON CONFLICT(employer_id) DO UPDATE SET last_seq = MAX(last_seq, excluded.last_seq)
    `).run(maxNum);
  } catch (seqErr) {
    console.warn('Sequence initialization note:', seqErr.message);
  }
}

initSchema();

module.exports = db;
