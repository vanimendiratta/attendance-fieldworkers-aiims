const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../../attendance.db');
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
  `);

  // Migrate columns if upgrading existing db
  try {
    const orgColumns = db.prepare('PRAGMA table_info(organizations)').all().map(c => c.name);
    if (!orgColumns.includes('admin_username')) {
      db.exec("ALTER TABLE organizations ADD COLUMN admin_username TEXT NOT NULL DEFAULT 'admin'");
    }
    if (!orgColumns.includes('admin_password')) {
      db.exec("ALTER TABLE organizations ADD COLUMN admin_password TEXT NOT NULL DEFAULT 'admin123'");
    }

    const empColumns = db.prepare('PRAGMA table_info(employees)').all().map(c => c.name);
    if (!empColumns.includes('password')) {
      db.exec("ALTER TABLE employees ADD COLUMN password TEXT NOT NULL DEFAULT 'Password@123'");
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
      admin_password=excluded.admin_password,
      updated_at=excluded.updated_at
  `);

  // Employer 1: Apex Innovations Ltd. (CDER AIIMS Campus, New Delhi)
  upsertOrg.run(
    'ORG-001',
    'Apex Innovations Ltd.',
    'CDER AIIMS Campus, New Delhi',
    28.5662,
    77.2136,
    1000,
    'ALLOW_WITH_FLAG',
    500,
    8.0,
    'Asia/Kolkata',
    'apex_admin',
    'ApexSecure@123',
    new Date().toISOString()
  );

  // Employer 2: Cyberdyne Systems Corp (CDER AIIMS Campus, New Delhi)
  upsertOrg.run(
    'ORG-002',
    'Cyberdyne Systems Corp',
    'CDER AIIMS Campus, New Delhi',
    28.5662,
    77.2136,
    1000,
    'ALLOW_WITH_FLAG',
    500,
    8.5,
    'Asia/Kolkata',
    'cyberdyne_admin',
    'Cyberdyne@456',
    new Date().toISOString()
  );

  // Seed / Upsert Regional Teams by State and District
  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, employer_id, name, state, district, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      state=excluded.state,
      district=excluded.district,
      description=excluded.description
  `);

  // ORG-001 Regional Teams
  upsertTeam.run('TEAM-101', 'ORG-001', 'Delhi Regional Headquarters', 'Delhi', 'New Delhi', 'Primary operations & engineering at AIIMS campus', new Date().toISOString());
  upsertTeam.run('TEAM-102', 'ORG-001', 'Central Delhi Field Unit', 'Delhi', 'Central Delhi', 'Active field deployment & healthcare audit', new Date().toISOString());
  upsertTeam.run('TEAM-103', 'ORG-001', 'Maharashtra West Operations', 'Maharashtra', 'Mumbai Suburban', 'Western territory inspection & client liaison', new Date().toISOString());
  upsertTeam.run('TEAM-104', 'ORG-001', 'Karnataka Tech Hub', 'Karnataka', 'Bengaluru Urban', 'Southern technology outreach and on-site support', new Date().toISOString());

  // ORG-002 Regional Teams
  upsertTeam.run('TEAM-201', 'ORG-002', 'NCR Cyber Security Unit', 'Haryana', 'Gurugram', 'Cyber defense operations & cloud monitoring', new Date().toISOString());
  upsertTeam.run('TEAM-202', 'ORG-002', 'Delhi Autonomous Systems', 'Delhi', 'North Delhi', 'Robotics and field sensor deployment', new Date().toISOString());

  // Seed / Upsert employees for Employer 1 & 2
  const upsertEmp = db.prepare(`
    INSERT INTO employees (id, employer_id, name, email, department, designation, pin, password, is_active, is_admin, team_id, state, district, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      employer_id=excluded.employer_id,
      name=excluded.name,
      password=excluded.password,
      team_id=excluded.team_id,
      state=excluded.state,
      district=excluded.district
  `);

  // ORG-001 employees
  upsertEmp.run('EMP-1001', 'ORG-001', 'Alex Johnson', 'alex.johnson@apexcorp.internal', 'Engineering', 'Senior Systems Architect', '1234', 'Password@1001', 1, 0, 'TEAM-101', 'Delhi', 'New Delhi', new Date().toISOString());
  upsertEmp.run('EMP-1002', 'ORG-001', 'Priya Sharma', 'priya.sharma@apexcorp.internal', 'Product Design', 'Lead Experience Designer', '1234', 'Password@1002', 1, 0, 'TEAM-102', 'Delhi', 'Central Delhi', new Date().toISOString());
  upsertEmp.run('EMP-1003', 'ORG-001', 'Rohan Verma', 'rohan.verma@apexcorp.internal', 'Field Operations', 'Regional Field Auditor', '1234', 'Password@1003', 1, 0, 'TEAM-103', 'Maharashtra', 'Mumbai Suburban', new Date().toISOString());

  // ORG-002 employees
  upsertEmp.run('EMP-2001', 'ORG-002', 'Marcus Wright', 'marcus.wright@cyberdyne.io', 'Cyber Security', 'Principal Security Architect', '5678', 'Password@2001', 1, 0, 'TEAM-201', 'Haryana', 'Gurugram', new Date().toISOString());
  upsertEmp.run('EMP-2002', 'ORG-002', 'Sarah Reese', 'sarah.reese@cyberdyne.io', 'Robotics & AI', 'Lead Autonomous Robotics Engineer', '5678', 'Password@2002', 1, 0, 'TEAM-202', 'Delhi', 'North Delhi', new Date().toISOString());
}

initSchema();

module.exports = db;
