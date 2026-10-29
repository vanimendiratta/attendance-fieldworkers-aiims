# GO-LIVE AND ROLLBACK CHECKLIST
## AIIMS CDER Attendance + EMS System — Institutional VM Deployment

**Version:** 1.0.0 | **Date:** 2026-10-29 | **Target:** Ubuntu 26.04 LTS, 192.168.14.224  
**Prepared by:** Development team (vanimendiratta/attendance-fieldworkers-aiims)  
**Final commit:** `6f39bca` (local) → pending final release commit after this checklist is complete

---

> [!IMPORTANT]
> This checklist distinguishes five verification states. Use them precisely:
> - ✅ **VERIFIED LOCALLY** — confirmed by automated test or command on the development machine
> - 🔬 **VERIFIED (DISPOSABLE DB)** — confirmed using a synthetic, non-production database that was dropped or discarded after the test
> - ❌ **NOT VERIFIED** — could not be tested; requires human judgement or manual check
> - 🔒 **BLOCKED — AIIMS IT** — cannot be completed without institutional infrastructure, credentials, or administrator access
> - 🚨 **REQUIRED BEFORE GO-LIVE** — must be completed and signed off before the service opens to users

---

## SECTION 1 — Pre-Deployment Approvals (AIIMS IT Action Required)

| # | Item | State | Owner |
|---|---|---|---|
| 1.1 | AIIMS IT has formally approved the deployment of this application on the institutional VM | 🔒 BLOCKED — AIIMS IT | IT Manager |
| 1.2 | Server OS, version, architecture, and network configuration confirmed with IT | 🔒 BLOCKED — AIIMS IT | IT Manager |
| 1.3 | Administrator (sudo) access to 192.168.14.224 confirmed for the deployment session | 🔒 BLOCKED — AIIMS IT | IT Manager |
| 1.4 | Institutional TLS certificate or approved self-signed IP SAN certificate obtained and ready | 🔒 BLOCKED — AIIMS IT | Network Admin |
| 1.5 | Internal DNS entry (e.g. `attendance.cder.aiims.internal`) registered, or IP-only access confirmed | 🔒 BLOCKED — AIIMS IT | Network Admin |
| 1.6 | Firewall rules restricting access to subnet 192.168.14.0/24 approved | 🔒 BLOCKED — AIIMS IT | Network Admin |
| 1.7 | Off-host backup destination (NAS, network share, external drive) identified and accessible | 🔒 BLOCKED — AIIMS IT | IT Manager |
| 1.8 | Production secrets (JWT_SECRET, SESSION_SECRET, database password) generated on an approved secure machine | 🔒 BLOCKED — AIIMS IT | IT Manager |
| 1.9 | Node.js 22 LTS installation method on the restricted VM confirmed (apt mirror, tarball, or package) | 🔒 BLOCKED — AIIMS IT | IT Manager |
| 1.10 | Maintenance window scheduled; fieldworker team notified of downtime | 🔒 BLOCKED — AIIMS IT | Project Lead |

---

## SECTION 2 — Development-Side Verification (Pre-Handover)

### 2a. Code Quality and Security

| # | Item | State | Evidence |
|---|---|---|---|
| 2.1 | `npm run lint` exits 0 — 53 JS files, 14 UI assets | ✅ VERIFIED LOCALLY | exit 0, 2026-10-29 |
| 2.2 | `npm run build` exits 0 — 7 production frontend assets present | ✅ VERIFIED LOCALLY | exit 0, 2026-10-29 |
| 2.3 | `npm audit` exits 0 — 0 vulnerabilities across 185 packages | ✅ VERIFIED LOCALLY | `{"total":0}`, 2026-10-29 |
| 2.4 | `bash -n deployment/backup.sh` exits 0 — no syntax errors | ✅ VERIFIED LOCALLY | exit 0, 2026-10-29 |
| 2.5 | `bash -n deployment/healthcheck.sh` exits 0 — no syntax errors | ✅ VERIFIED LOCALLY | exit 0, 2026-10-29 |
| 2.6 | `better-sqlite3` compiled for Node 22 ABI (NODE_MODULE_VERSION 127) in both root and `ems/` | ✅ VERIFIED LOCALLY | `npm rebuild` exit 0, 2026-10-29 |
| 2.7 | `package.json` `engines` updated to `>=22.0.0` for both root and `ems/` | ✅ VERIFIED LOCALLY | Committed |
| 2.8 | SSL logic in `src/db/database.js` uses loopback detection to correctly disable SSL for local PostgreSQL | ✅ VERIFIED LOCALLY | Code reviewed, tests pass |
| 2.9 | No `.env` files, secrets, database files, or personal data committed | ✅ VERIFIED LOCALLY | `git log --diff-filter=A --name-only` checked |
| 2.10 | `.gitignore` excludes `*.env`, `*.sqlite`, `*.db`, `uploads/*`, `node_modules/` | ✅ VERIFIED LOCALLY | `.gitignore` reviewed |
| 2.11 | All SQL queries in `src/routes/api.js` use parameterized `$1, $2, …` placeholders | ✅ VERIFIED LOCALLY | Code audit |
| 2.12 | Production startup aborts if `DATABASE_URL` or `JWT_SECRET` is missing or weak | ✅ VERIFIED LOCALLY | `server.js` lines 127–142 |
| 2.13 | Error responses in production mask internal error messages from clients | ✅ VERIFIED LOCALLY | `handleApiError()` + global error handler |

### 2b. Full Automated Test Suite

| # | Suite | State | Evidence |
|---|---|---|---|
| 2.14 | [1/25] Pure Unit & PostgreSQL Integration | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.15 | [2/25] Sign Up & Screenlock Face Recognition | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.16 | [3/25] Biometric Security & Liveness Evaluation | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.17 | [4/25] Email Backup Service | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.18 | [5/25] 46-Column Enterprise CSV Export | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.19 | [6/25] Final Production Security Gate (OWASP & Rate Limit) | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.20 | [7/25] Leaves & Attendance Alteration | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.21 | [8/25] Security Hardening & Multi-Tenant Isolation | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.22 | [9/25] 16-Phase Security Remediation Regression | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.23 | [10/25] Single Punch Per Day Limit Enforcement | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.24 | [11/25] Indian States, Districts & Teams Tracking | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.25 | [12/25] Supabase Automated Keep-Alive & Security Redaction | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.26 | [13/25] Comprehensive Security Audit & Remediation Verification | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.27 | [14/25] Secure Signup, DOB, cder Email, Mobile & FW- Employee ID | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.28 | [15/25] Hotel Stay GPS Verification & Geographic Matching | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.29 | [16/25] Inbuilt Delete Confirmation Modal Verification | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.30 | [17/25] State & District Standardization & Independent Validation | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.31 | [18/25] Shared Multi-Location Geofencing & Work Mode Compliance | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.32 | [19/25] CSV Exports, Timesheet Fix & Team-Wise Attendance | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.33 | [20/25] EMS Integration & Leave Governance Engine | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.34 | [21/25] EMS Post-Integration Security Verification (26 Tests) | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.35 | [22/25] Secure 30-Minute Session Inactivity Timeout (15 Tests) | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.36 | [23/25] Single Active Session Policy Across App & EMS (8 Tests) | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.37 | [24/25] Single Active Session Atomic Concurrency (10 Tests) | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| 2.38 | [25/25] EMS Production End-to-End Workflow & QA Gate (26 Tests) | ✅ VERIFIED LOCALLY | PASSED, 2026-10-29 |
| **TOTAL** | **25/25 PASSED, 0 FAILED, 0 SKIPPED** | ✅ | **exit code 0, Node 22 LTS** |

### 2c. Database and Recovery

| # | Item | State | Evidence |
|---|---|---|---|
| 2.39 | SQLite WAL backup using `sqlite3 .backup` verified on disposable database | 🔬 VERIFIED (DISPOSABLE DB) | integrity_check='ok', 2026-10-29 |
| 2.40 | PostgreSQL `pg_dump` + restore verified on disposable `attendance_restore_test` database | 🔬 VERIFIED (DISPOSABLE DB) | Row count matched, dropped after test, 2026-10-29 |
| 2.41 | Backup archives stored outside app directory (`/var/backups/attendance`) | ✅ VERIFIED LOCALLY | `backup.sh` reviewed |
| 2.42 | Backup file permissions enforced (chmod 700 dir, chmod 600 archives) | ✅ VERIFIED LOCALLY | `backup.sh` lines 37–38, 66 |
| 2.43 | 5 GB free-disk safety guard verified in backup.sh | ✅ VERIFIED LOCALLY | `backup.sh` lines 27–32 |
| 2.44 | 14-day backup retention enforced via `find -mtime +14 -delete` | ✅ VERIFIED LOCALLY | `backup.sh` lines 68–71 |
| 2.45 | Off-host backup transfer to institutional NAS/share verified | 🔒 BLOCKED — AIIMS IT | Requires target NAS |
| 2.46 | Live production restore tested on actual production backup | 🔒 BLOCKED — AIIMS IT | Cannot do without production server |
| 2.47 | EMS SQLite data directory persists on `/var/www/attendance/ems/data/` (not tmpfs) | ❌ NOT VERIFIED | Requires IT to confirm disk mount |
| 2.48 | Upload photos persist on `/var/www/attendance/uploads/` (not tmpfs) | ❌ NOT VERIFIED | Requires IT to confirm disk mount |

---

## SECTION 3 — Server-Side Deployment Verification (IT-Assisted, Day of Go-Live)

| # | Item | State |
|---|---|---|
| 3.1 | `uname -r` and `lsb_release -a` confirm Ubuntu 26.04 LTS (or IT-approved Ubuntu version) | 🔒 BLOCKED — AIIMS IT |
| 3.2 | `node --version` → `v22.x.x` and `npm --version` → `10.x.x` | 🔒 BLOCKED — AIIMS IT |
| 3.3 | `npm rebuild better-sqlite3` exits 0 in `/var/www/attendance` | 🔒 BLOCKED — AIIMS IT |
| 3.4 | `npm rebuild better-sqlite3` exits 0 in `/var/www/attendance/ems` | 🔒 BLOCKED — AIIMS IT |
| 3.5 | `/etc/attendance/attendance.env` is `0640` owned `root:www-data` | 🔒 BLOCKED — AIIMS IT |
| 3.6 | PostgreSQL `attendance_prod` database reachable via `attendance_user` on `127.0.0.1:5432` | 🔒 BLOCKED — AIIMS IT |
| 3.7 | `systemctl status attendance` → `active (running)` | 🔒 BLOCKED — AIIMS IT |
| 3.8 | `curl http://127.0.0.1:3000/api/health` → `{"status":"healthy","database":"connected"}` | 🔒 BLOCKED — AIIMS IT |
| 3.9 | `systemctl status nginx` → `active (running)` | 🔒 BLOCKED — AIIMS IT |
| 3.10 | `nginx -t` → `syntax is ok; test is successful` | 🔒 BLOCKED — AIIMS IT |
| 3.11 | `curl http://192.168.14.224/api/health` → `200 OK` (via Nginx) | 🔒 BLOCKED — AIIMS IT |
| 3.12 | HTTPS endpoint reachable (if TLS configured): `curl -k https://192.168.14.224/api/health` | 🔒 BLOCKED — AIIMS IT |
| 3.13 | EMS `/api/ems/system/info` returns 200 | 🔒 BLOCKED — AIIMS IT |
| 3.14 | Admin login tested with production admin credentials | 🔒 BLOCKED — AIIMS IT |
| 3.15 | Employee signup tested with a real test employee record | 🔒 BLOCKED — AIIMS IT |
| 3.16 | Check-in photo upload and GPS verification tested | 🔒 BLOCKED — AIIMS IT |
| 3.17 | Leave request submission and admin approval workflow tested | 🔒 BLOCKED — AIIMS IT |
| 3.18 | Journald logs show no FATAL or ERROR entries after startup | 🔒 BLOCKED — AIIMS IT |
| 3.19 | First manual backup run succeeds: `/usr/local/bin/attendance-backup.sh` | 🔒 BLOCKED — AIIMS IT |
| 3.20 | Firewall: only ports 80 and 443 reachable from 192.168.14.0/24 subnet | 🔒 BLOCKED — AIIMS IT |
| 3.21 | Port 3000 is NOT reachable from outside the loopback interface | 🔒 BLOCKED — AIIMS IT |

---

## SECTION 4 — Load and Capacity (Not Verified)

| # | Item | State |
|---|---|---|
| 4.1 | Realistic concurrent fieldworker load test (photo uploads + GPS + check-in/out + leave) | ❌ NOT VERIFIED |
| 4.2 | Memory and swap usage confirmed stable under realistic peak load | ❌ NOT VERIFIED |
| 4.3 | CPU and HDD I/O confirmed within acceptable bounds under load | ❌ NOT VERIFIED |
| 4.4 | Maximum safe concurrent user count determined empirically | ❌ NOT VERIFIED |

> [!CAUTION]
> **Capacity is unverified.** The claim that this application can support 300–500 concurrent fieldworkers has NOT been tested. Do not publish or commit to any user-count guarantee without realistic load test results. Monitor memory and swap closely after go-live and be prepared to reduce concurrent sessions if the server becomes resource-constrained.

---

## SECTION 5 — Rollback Plan

### When to trigger rollback

Trigger rollback immediately if, within 30 minutes of go-live:
- Application returns HTTP 500 or 503 to more than 5% of requests
- `systemctl status attendance` shows `failed`
- Any fieldworker reports inability to check in or out
- Database write failures appear in `journalctl -u attendance`
- Available RAM drops below 300 MB or swap usage exceeds 2 GB

### Rollback commands (IT admin)

> [!CAUTION]
> **Never use `rm -rf /var/www/attendance`** — this destroys uploaded check-in photos and the EMS SQLite database. Preserve `uploads/` and `ems/data/` in every rollback.

```bash
# Stop the service
sudo systemctl stop attendance

# Preserve runtime data before touching application code
sudo cp -a /var/www/attendance/uploads /tmp/uploads_preserve_$(date +%Y%m%d_%H%M%S)
sudo cp -a /var/www/attendance/ems/data /tmp/emsdata_preserve_$(date +%Y%m%d_%H%M%S)

# Move failed deployment aside — do NOT delete until rollback is confirmed working
sudo mv /var/www/attendance /var/www/attendance_failed_$(date +%Y%m%d_%H%M%S)

# Extract previous release (must have been saved before the upgrade)
sudo mkdir -p /var/www/attendance
sudo tar -xzf /tmp/previous_release.tar.gz -C /var/www/attendance

# Set ownership: root owns source, www-data reads
sudo chown -R root:www-data /var/www/attendance
sudo find /var/www/attendance -type d -exec chmod 750 {} \;
sudo find /var/www/attendance -type f -exec chmod 640 {} \;

# Reinstall dependencies for the previous version
sudo chown www-data:www-data /var/www/attendance
sudo -u www-data bash -c "cd /var/www/attendance && npm ci --omit=dev && npm rebuild better-sqlite3"
sudo chown root:www-data /var/www/attendance
sudo chown www-data:www-data /var/www/attendance/ems
sudo -u www-data bash -c "cd /var/www/attendance/ems && npm ci --omit=dev && npm rebuild better-sqlite3"
sudo chown root:www-data /var/www/attendance/ems

# Restore preserved runtime data
sudo mkdir -p /var/www/attendance/uploads /var/www/attendance/ems/data
sudo cp -a /tmp/uploads_preserve_*/. /var/www/attendance/uploads/
sudo cp -a /tmp/emsdata_preserve_*/. /var/www/attendance/ems/data/
sudo chown -R www-data:www-data /var/www/attendance/uploads /var/www/attendance/ems/data

# Start the previous version
sudo systemctl start attendance
sudo systemctl status attendance

# Confirm health
curl -s http://127.0.0.1:3000/api/health
```

### Database rollback

The Attendance PostgreSQL schema uses additive `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` migrations. These cannot be automatically reversed. If a new migration causes data integrity problems:

1. Stop the application: `sudo systemctl stop attendance`
2. Restore from the most recent `pg_dump` backup (runs as the `postgres` superuser to avoid password prompt):
   ```bash
   # Identify the backup file
   ls -lt /var/backups/attendance/daily/attendance_pg_*.sql.gz | head -3
   # Terminate active connections, then drop and recreate
   sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='attendance_prod' AND pid<>pg_backend_pid();"
   sudo -u postgres psql -c "DROP DATABASE IF EXISTS attendance_prod;"
   sudo -u postgres psql -c "CREATE DATABASE attendance_prod OWNER attendance_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
   # Restore from gzip SQL dump
   gunzip -c /var/backups/attendance/daily/attendance_pg_TIMESTAMP.sql.gz | \
     sudo -u postgres psql -d attendance_prod
   ```
3. Restore EMS SQLite if affected:
   ```bash
   gunzip -c /var/backups/attendance/daily/ems_sqlite_TIMESTAMP.sqlite.gz > /tmp/ems_restored.sqlite
   sudo cp /tmp/ems_restored.sqlite /var/www/attendance/ems/data/ems.sqlite
   sudo chown www-data:www-data /var/www/attendance/ems/data/ems.sqlite
   sudo rm -f /tmp/ems_restored.sqlite
   ```
4. Restart the previous application version.

> [!CAUTION]
> Restoring a database backup overwrites all data written after the backup timestamp. Inform the project lead before restoring. Document the data window that will be lost.

---

## SECTION 6 — Sign-Off

This checklist must be reviewed and signed by both the development contact and the AIIMS IT administrator before the service is opened to fieldworkers.

| Role | Name | Signature | Date |
|---|---|---|---|
| Developer / Deployer | | | |
| AIIMS IT Administrator | | | |
| Project Lead / PI | | | |

---

*This checklist is part of the final release gate for the AIIMS CDER Attendance + EMS system. Keep a completed copy alongside the server maintenance log.*

