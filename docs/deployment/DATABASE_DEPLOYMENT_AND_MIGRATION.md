# Database Deployment, Provisioning & Migration Strategy
## Attendance (PostgreSQL) + EMS (SQLite) Dual-Database Architecture

**Document Version:** 1.0.0 | **Database Engines:** PostgreSQL 16 & SQLite 3 (WAL Mode)

---

## 1. Architectural Strategy & Design Rationale

The AIIMS CDER system utilizes a dual-database architecture:
1. **Attendance & Core Identity Module:** Backed by **PostgreSQL 16** via `src/db/database.js`.
   - Handles multi-tenant employee records, geolocation check-in/out logs, break tracking, biometric facial hashes, audit trails, and organization geofencing.
   - Utilizes `pg.Pool` connection pooling and ACID-compliant transactional guarantees for high-concurrency punch submissions.
2. **Employee Management & Leave Governance (EMS) Module:** Backed by **SQLite 3** with Write-Ahead Logging (WAL) via `ems/server/database/db.js`.
   - Handles leave entitlements, pro-rata credit calculations, sandwich rule validations, comp-off ledger double-entry bookkeeping, and workflow approval state machines.
   - Operates in WAL mode (`journal_mode = WAL`) with `busy_timeout = 5000` and `foreign_keys = ON`.

### Technical Rationale for Dual-Database Architecture in this Release
- **Codebase Stability & Zero Regressions:** The EMS subsystem utilizes `better-sqlite3`'s synchronous execution API across 25+ controllers and core engines (`LeaveRuleEngine`, `LeaveLedgerService`, `AuthService`). Converting hundreds of synchronous calls to asynchronous `pg.query()` would require extensive cross-module refactoring and introduce high regression risk to leave calculation math.
- **Performance Characteristics:** SQLite WAL mode handles several hundred concurrent reads with zero lock contention and single-writer transactions that complete in sub-millisecond timeframes.
- **Data Persistence:** Because the application is deployed to an Ubuntu 24.04 server on a persistent NVMe volume, SQLite file persistence is durable and safe.

---

## 2. PostgreSQL 16 Deployment & Provisioning (Attendance Module)

### 2.1 Installation
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

### 2.2 Role & Database Creation
```bash
sudo -u postgres psql <<EOF
-- Create application user
CREATE ROLE attendance_user WITH LOGIN PASSWORD 'STRONG_PG_PASSWORD_HERE';

-- Create production database
CREATE DATABASE attendance_prod OWNER attendance_user;

-- Grant schema permissions
\c attendance_prod
GRANT ALL ON SCHEMA public TO attendance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO attendance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO attendance_user;
EOF
```

### 2.3 Schema Migration Execution
The application automatically verifies and synchronizes the PostgreSQL schema upon startup via `src/db/database.js` (`ensureSchemaSync()`). To manually run or inspect migrations:

```bash
cd /var/www/attendance
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -f supabase/migrations/001_initial_schema.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -f supabase/migrations/002_add_organization_holidays.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -f supabase/migrations/003_add_session_inactivity_timeout.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -f supabase/migrations/004_single_active_session.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -f supabase/migrations/005_atomic_session_concurrency.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -f supabase/migrations/006_state_district_standardization.sql
```

### 2.4 Schema Verification Query
Verify that all 14 required PostgreSQL relations are present:

```bash
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -c "
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
"
```

Expected tables:
- `attendance`
- `audit_logs`
- `auth_rate_limits`
- `breaks`
- `employee_hotel_stays`
- `employee_leaves`
- `employee_sequences`
- `employees`
- `external_sync_records`
- `geofences`
- `organization_holidays`
- `organizations`
- `sessions`
- `teams`

---

## 3. SQLite EMS Database Provisioning (Leave Management Module)

### 3.1 Directory & File Setup
```bash
sudo mkdir -p /var/www/attendance/ems/data
sudo chown -R www-data:www-data /var/www/attendance/ems/data
sudo chmod 770 /var/www/attendance/ems/data
```

### 3.2 Migration & Seeding Command
Initialize EMS tables and foundational policies:

```bash
cd /var/www/attendance
sudo -u www-data node -e "
const { runMigrations } = require('./ems/server/database/migrate');
const { seedMasterPolicies } = require('./ems/server/database/seed');
runMigrations();
seedMasterPolicies();
console.log('✓ EMS SQLite migrations executed and foundational policies seeded.');
"
```

### 3.3 Verify SQLite Pragmas & Tables
Verify WAL mode and integrity:

```bash
sqlite3 /var/www/attendance/ems/data/ems.sqlite "PRAGMA journal_mode;"
# Expected: wal

sqlite3 /var/www/attendance/ems/data/ems.sqlite "PRAGMA foreign_key_check;"
# Expected: (empty output, 0 errors)

sqlite3 /var/www/attendance/ems/data/ems.sqlite ".tables"
```

Expected EMS tables:
- `audit_logs`
- `comp_off_claims`
- `comp_off_credits`
- `employees`
- `holiday_calendar`
- `leave_balances`
- `leave_credit_schedules`
- `leave_requests`
- `leave_rule_versions`
- `leave_rules`
- `leave_transactions`
- `leave_types`
- `notifications`
- `sandwich_rules`
- `user_sessions`
- `users`
- `weekly_off_rules`

---

## 4. Backup & Disaster Recovery Procedures

### 4.1 Automated Daily Backups
The automated backup script `/usr/local/bin/attendance-backup.sh` runs daily at 02:00 AM via cron and executes:
1. `pg_dump -U attendance_user -d attendance_prod --clean --if-exists | gzip > /var/backups/attendance/daily/attendance_pg_<timestamp>.sql.gz`
2. `sqlite3 /var/www/attendance/ems/data/ems.sqlite ".backup '/var/backups/attendance/daily/ems_sqlite_<timestamp>.sqlite'"`
3. `tar -czf /var/backups/attendance/daily/uploads_<timestamp>.tar.gz /var/www/attendance/uploads`
4. Pruning of backups older than 14 days.

### 4.2 Manual PostgreSQL Restore Test
To restore the PostgreSQL database to a test instance:

```bash
# 1. Unzip and restore
gunzip -c /var/backups/attendance/daily/attendance_pg_YYYYMMDD_HHMMSS.sql.gz | \
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod

# 2. Verify row count
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h localhost -U attendance_user -d attendance_prod -c "SELECT count(*) FROM employees;"
```

### 4.3 Manual SQLite Restore Test
To restore the EMS SQLite database:

```bash
# 1. Stop service to avoid write contention
sudo systemctl stop attendance.service

# 2. Restore SQLite database file
sudo cp /var/backups/attendance/daily/ems_sqlite_YYYYMMDD_HHMMSS.sqlite /var/www/attendance/ems/data/ems.sqlite
sudo chown www-data:www-data /var/www/attendance/ems/data/ems.sqlite
sudo chmod 660 /var/www/attendance/ems/data/ems.sqlite

# 3. Clean up any stale WAL/SHM files
sudo rm -f /var/www/attendance/ems/data/ems.sqlite-wal /var/www/attendance/ems/data/ems.sqlite-shm

# 4. Restart service
sudo systemctl start attendance.service
```

---

## 5. Future Unified PostgreSQL Migration Path

If the engineering team decides to consolidate EMS into PostgreSQL in a future release:
1. **Schema Generation:** Map SQLite EMS tables into a dedicated PostgreSQL schema (`ems.leave_requests`, `ems.leave_balances`, etc.) or prefixed tables (`ems_leave_requests`).
2. **Asynchronous Service Adapter:** Wrap the synchronous EMS database interface in an async facade or refactor controllers to async/await.
3. **Data Export/Import Script:** Use `sqlite3 .mode csv` or a Node.js streaming migration script to transfer existing data with foreign key preservation.
4. **Validation:** Run double-entry balance integrity checks (`GET /api/ems/ledger/verify-integrity`) to ensure zero balance drift.

