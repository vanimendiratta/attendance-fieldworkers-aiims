# Database Deployment, Provisioning & Migration Strategy
## Attendance (PostgreSQL) + EMS (SQLite) Dual-Database Architecture

**Document Version:** 3.0.0 | **Target Server:** Ubuntu 26.04 LTS (IP: `192.168.14.224`, 4 GB RAM, 100 GB HDD)

---

## 1. Architectural Strategy & Design Rationale

The AIIMS CDER system operates with a dual-database architecture:
1. **Attendance & Biometric Identity Module:** Backed by **PostgreSQL 16/17** via `src/db/database.js`.
   - Manages employee sequence IDs, check-in/checkout timestamps, GPS coordinates, geofences, break durations, and audit logs.
   - Leverages connection pooling (`pg.Pool`), parameterized queries, and transactional safety.
2. **Employee Management & Leave Governance (EMS) Module:** Backed by **SQLite 3 in WAL mode** via `ems/server/database/db.js`.
   - Manages leave types (CL, EL, RH, COMP_OFF), pro-rata accrual policies, sandwich rules, double-entry leave ledgers, and multi-tier approval workflows.
   - Configured with `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, and `busy_timeout = 5000`.

### Technical Rationale for Retaining Dual-Database Architecture
- **Preserves Critical Domain Logic:** The EMS subsystem utilizes synchronous `better-sqlite3` calls across 25+ controllers and services. An asynchronous rewrite to PostgreSQL would risk calculation and concurrency regressions in the audited leave rules.
- **Hardware Profile Adaptation (4 GB RAM, 100 GB HDD):** SQLite requires negligible memory (~32 MB page cache), leaving critical RAM available for PostgreSQL and the Node.js runtime on a 4 GB RAM server.
- **Data Persistence:** Because the application is deployed on a dedicated Ubuntu server with a local 100 GB HDD, SQLite files persist reliably at `/var/www/attendance/ems/data/ems.sqlite`.

---

## 2. PostgreSQL Provisioning & Tuning (4 GB RAM / Rotational HDD)

### 2.1 Installation (Ubuntu 26.04 LTS)
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

### 2.2 PostgreSQL Hardware Configuration
Rotational HDDs have low random IOPS (75–120 IOPS) and high seek latency. Create `/etc/postgresql/*/main/conf.d/tuning.conf` to optimize PostgreSQL for 4 GB RAM and HDD:

```ini
# Memory Configuration (Sized for 4 GB System RAM)
shared_buffers = 256MB                  # 25% of RAM reserved for PG buffer
work_mem = 4MB                          # Per-operation sort memory
maintenance_work_mem = 64MB             # Vacuum and index creation memory
effective_cache_size = 1GB              # Estimated OS page cache
max_connections = 50                    # Prevents connection exhaustion

# Rotational HDD I/O Optimizations
checkpoint_completion_target = 0.9      # Smooths checkpoint disk writes over time
wal_buffers = 16MB                      # Buffers WAL writes to rotational disk
random_page_cost = 4.0                  # Reflects HDD rotational seek penalty
effective_io_concurrency = 2            # Conservative for single spindle HDD
```

Restart PostgreSQL to apply:
```bash
sudo systemctl restart postgresql
```

### 2.3 Role & Database Provisioning
```bash
sudo -u postgres psql <<EOF
CREATE ROLE attendance_user WITH LOGIN PASSWORD 'STRONG_PG_PASSWORD_HERE';
CREATE DATABASE attendance_prod OWNER attendance_user;
GRANT ALL PRIVILEGES ON DATABASE attendance_prod TO attendance_user;
\c attendance_prod
GRANT ALL ON SCHEMA public TO attendance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO attendance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO attendance_user;
EOF
```

### 2.4 Schema Migrations & Target Verification

> [!IMPORTANT]
> The application automatically performs safe additive schema synchronization on startup (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
> 
> **Safety Check Before Manual Execution:** Confirm you are targeting the production database (`attendance_prod`), NOT any development or test database (`attendance_test`), and verify that existing data will not be overwritten.
> 
> Never pass database passwords as inline shell command arguments. Instead, execute migration scripts as the local `postgres` system user via peer authentication:

```bash
# 1. Verify target database identity and ensure it is NOT a test database
sudo -u postgres psql -d attendance_prod -c "SELECT current_database(), current_user;"
# Expected: current_database = attendance_prod

# 2. Apply migrations sequentially using local peer authentication (no passwords in shell history)
cd /var/www/attendance
sudo -u postgres psql -d attendance_prod -f supabase/migrations/001_initial_schema.sql
sudo -u postgres psql -d attendance_prod -f supabase/migrations/002_add_organization_holidays.sql
sudo -u postgres psql -d attendance_prod -f supabase/migrations/003_add_session_inactivity_timeout.sql
sudo -u postgres psql -d attendance_prod -f supabase/migrations/004_single_active_session.sql
sudo -u postgres psql -d attendance_prod -f supabase/migrations/005_atomic_session_concurrency.sql
sudo -u postgres psql -d attendance_prod -f supabase/migrations/006_state_district_standardization.sql
```

### 2.5 PostgreSQL SSL & Remote CA Verification
- **Local Loopback (`127.0.0.1` / `localhost`):** SSL is disabled (`ssl: false`) as traffic never leaves the local VM memory/bus.
- **Supabase Cloud:** Uses managed poolers requiring SSL with intermediate certificates (`rejectUnauthorized: false`).
- **Remote Institutional PostgreSQL:** Certificate verification is **enabled by default** in production (`rejectUnauthorized: true`). For private institutional CAs, configure `DATABASE_SSL_CA=/etc/ssl/certs/aiims-ca.crt` in `/etc/attendance/attendance.env` or use system trust via `NODE_EXTRA_CA_CERTS`. Explicit opt-out requires setting `DATABASE_URL_SSL_MODE=no-verify`.

---

## 3. SQLite EMS Database Provisioning (Leave Management Module)

### 3.1 Directory Setup & Security
```bash
sudo mkdir -p /var/www/attendance/ems/data
sudo chown -R www-data:www-data /var/www/attendance/ems/data
sudo chmod 770 /var/www/attendance/ems/data
```

### 3.2 Seeding & Pragma Verification
```bash
cd /var/www/attendance
sudo -u www-data node -e "
const { runMigrations } = require('./ems/server/database/migrate');
const { seedMasterPolicies } = require('./ems/server/database/seed');
runMigrations();
seedMasterPolicies();
console.log('✓ EMS SQLite migrations executed and foundational policies seeded.');
"

# Verify Pragmas
sqlite3 /var/www/attendance/ems/data/ems.sqlite "PRAGMA journal_mode;"         # wal
sqlite3 /var/www/attendance/ems/data/ems.sqlite "PRAGMA foreign_key_check;"    # (0 errors)
sqlite3 /var/www/attendance/ems/data/ems.sqlite "PRAGMA synchronous;"          # 1 (NORMAL)
```

---

## 4. Backup & Verified Restoration Procedures

### 4.1 Daily Automated Backup Workflow
The backup script `/usr/local/bin/attendance-backup.sh` runs at 02:00 AM daily:
1. **Pre-flight Disk Space Safety:** Confirms minimum 5 GB free disk space exists before initiating backups.
2. **PostgreSQL Dump:** Creates compressed SQL dump (`pg_dump ... | gzip`).
3. **SQLite Atomic Backup:** Executes `sqlite3 .backup` API, safely capturing uncheckpointed WAL frames into a standalone `.sqlite` file without table locking.
4. **Permissions Enforcement:** Restricts backup archives to mode `0600` inside `/var/backups/attendance` (mode `0700`, owner `root:root`).
5. **Rolling Retention:** Purges archives older than 14 days to preserve HDD capacity.

### 4.2 Verified Restoration Test (Evidence on Disposable Database)
The backup and restoration workflow was verified using disposable test databases with synthetic fixtures.

#### Test 1: SQLite WAL Online Backup & Restoration Verification
```bash
# 1. Created WAL-mode database with synthetic uncheckpointed records
sqlite3 test_source.sqlite "PRAGMA journal_mode=WAL; CREATE TABLE synthetic_ledger (id INT, emp_id TEXT, amount REAL);"
sqlite3 test_source.sqlite "INSERT INTO synthetic_ledger VALUES (1, 'SYN-001', 8.5), (2, 'SYN-002', 14.0);"

# 2. Executed online backup API
sqlite3 test_source.sqlite ".backup 'test_backup.sqlite'"

# 3. Restored to fresh destination and verified data
sqlite3 test_backup.sqlite "SELECT * FROM synthetic_ledger; PRAGMA integrity_check;"
# Result: Returned all 2 rows; PRAGMA integrity_check = 'ok'
```

#### Test 2: PostgreSQL Dump & Restoration into Disposable Database
```bash
# 1. Created disposable database
createdb attendance_restore_test

# 2. Streamed dump and restored
pg_dump -d attendance_test -t organizations | psql -d attendance_restore_test -q

# 3. Verified table rows and integrity
psql -d attendance_restore_test -c "SELECT count(*) FROM organizations;"
# Result: 2 rows verified matching source database

# 4. Cleaned up disposable database
dropdb attendance_restore_test
```

### 4.3 Production Restore Runbook
- **Restoring PostgreSQL in Production:**
  ```bash
  # Terminate active client connections to attendance_prod before restoring
  sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='attendance_prod' AND pid<>pg_backend_pid();"
  
  # Stream decompress directly into attendance_prod using peer auth (no passwords exposed)
  gunzip -c /var/backups/attendance/daily/attendance_pg_YYYYMMDD_HHMMSS.sql.gz | \
    sudo -u postgres psql -d attendance_prod
  ```
- **Restoring SQLite in Production:**
  ```bash
  sudo systemctl stop attendance.service
  # Copy restored sqlite file to persistent location
  sudo cp /var/backups/attendance/daily/ems_sqlite_YYYYMMDD_HHMMSS.sqlite /var/www/attendance/ems/data/ems.sqlite
  sudo chown www-data:www-data /var/www/attendance/ems/data/ems.sqlite
  sudo chmod 660 /var/www/attendance/ems/data/ems.sqlite
  # Clean up stale WAL / SHM files so SQLite starts clean
  sudo rm -f /var/www/attendance/ems/data/ems.sqlite-wal /var/www/attendance/ems/data/ems.sqlite-shm
  sudo systemctl start attendance.service
  ```

---

## 5. Future Unified PostgreSQL Migration Path

If AIIMS CDER IT schedules a future unified PostgreSQL migration:
1. **Asynchronous Adapter:** Implement async wrappers around `db.prepare().get/all/run` in `ems/server/database/db.js` using PostgreSQL transactions.
2. **Schema Translation:** Translate SQLite tables into a PostgreSQL `ems` schema.
3. **Data Export/Import:** Export SQLite rows via CSV or streaming JSON and insert into PostgreSQL with transaction rollbacks on failure.
4. **Balance Verification:** Run `GET /api/ems/ledger/verify-integrity` to confirm ledger transactions equal cached balances with 0.00 drift.
