# Database Deployment, Provisioning & Migration Strategy
## Attendance (PostgreSQL) + EMS (SQLite) Dual-Database Architecture

**Document Version:** 2.0.0 | **Target Server:** Ubuntu 26.04 LTS (IP: `192.168.14.224`, 4 GB RAM, 100 GB HDD)

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

### 2.4 Schema Migrations
The application automatically runs schema verification on startup. To apply or inspect initial migration scripts manually:

```bash
cd /var/www/attendance
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod -f supabase/migrations/001_initial_schema.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod -f supabase/migrations/002_add_organization_holidays.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod -f supabase/migrations/003_add_session_inactivity_timeout.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod -f supabase/migrations/004_single_active_session.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod -f supabase/migrations/005_atomic_session_concurrency.sql
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod -f supabase/migrations/006_state_district_standardization.sql
```

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

## 4. Backup & Disaster Recovery (100 GB HDD Safety)

### 4.1 Daily Automated Backup Script
The backup script `/usr/local/bin/attendance-backup.sh` runs at 02:00 AM via cron:
1. **Disk Space Safety Check:** Aborts before writing if free space is less than 5 GB to protect server operation.
2. **PostgreSQL Dump:** Creates compressed SQL dump (`pg_dump ... | gzip`).
3. **SQLite Atomic Backup:** Executes `sqlite3 .backup` ensuring a consistent snapshot without database locks.
4. **Uploads Archive:** Archives new attachments to `uploads_<timestamp>.tar.gz`.
5. **Rolling Retention:** Automatically purges backup archives older than 14 days to preserve HDD capacity.

### 4.2 PostgreSQL Restore Procedure
```bash
gunzip -c /var/backups/attendance/daily/attendance_pg_YYYYMMDD_HHMMSS.sql.gz | \
PGPASSWORD='STRONG_PG_PASSWORD_HERE' psql -h 127.0.0.1 -U attendance_user -d attendance_prod
```

### 4.3 SQLite Restore Procedure
```bash
sudo systemctl stop attendance.service
sudo cp /var/backups/attendance/daily/ems_sqlite_YYYYMMDD_HHMMSS.sqlite /var/www/attendance/ems/data/ems.sqlite
sudo chown www-data:www-data /var/www/attendance/ems/data/ems.sqlite
sudo chmod 660 /var/www/attendance/ems/data/ems.sqlite
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
