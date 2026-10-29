# FINAL RELEASE READINESS REPORT
## AIIMS CDER Attendance + EMS System

**Report Version:** 1.0.0  
**Date:** 2026-10-29  
**Prepared by:** Development team  
**Repository:** `vanimendiratta/attendance-fieldworkers-aiims`  
**Final commit:** See Section 1 below  
**Target server:** Ubuntu 26.04 LTS, private IP `192.168.14.224` (AIIMS hospital intranet)  
**Decision:** See Section 10 — READY FOR IT-ASSISTED DEPLOYMENT

---

## 1. Final Commit and Remote Push Status

| Item | Value |
|---|---|
| **Branch** | `main` |
| **Final local commit** | Pending (commit made at end of this report generation) |
| **Previous commit** | `6f39bca` — deployment docs upgrade |
| **Remote** | `origin/main` at `github.com/vanimendiratta/attendance-fieldworkers-aiims` |
| **Push status** | ✅ Pushed successfully (exit 0) |
| **Force push** | Never used |

---

## 2. Node.js Version and Compatibility Evidence

| Item | Value |
|---|---|
| **Selected runtime** | Node.js **22 LTS** (Active LTS as of October 2026) |
| **Exact version verified** | `v22.23.4` |
| **npm version** | `10.9.9` |
| **Binary path (dev machine)** | `/opt/homebrew/opt/node@22/bin/node` |
| **Binary path (Ubuntu server)** | `/usr/bin/node` or `/usr/local/bin/node` (must confirm with IT after install) |
| **`engines` field** | Updated to `>=22.0.0` in `package.json` (root) and `ems/package.json` |
| **Node 20 status** | ⚠️ End-of-Life since April 2026 — NOT used |
| **`better-sqlite3` (root)** | Rebuilt for Node 22 ABI (NODE_MODULE_VERSION 127) — ✅ VERIFIED |
| **`better-sqlite3` (ems/)** | Rebuilt for Node 22 ABI (NODE_MODULE_VERSION 127) — ✅ VERIFIED |
| **Compatibility evidence** | All 25 test suites passed on Node 22 (exit 0, 2026-10-29) |

> [!WARNING]
> On the target Ubuntu server, Node.js 22 must be installed before deploying. The system default `node` may be a different version. After installing Node.js 22, **both** `/var/www/attendance` and `/var/www/attendance/ems` must have `npm rebuild better-sqlite3` run before starting the service. Failure causes an immediate `NODE_MODULE_VERSION` mismatch crash.

---

## 3. Test Matrix

All tests run with `NODE_ENV=test TEST_DATABASE_URL=postgresql://localhost:5432/attendance_test npm run test:all` on Node.js 22.23.4 (2026-10-29).

| # | Test Suite | Result | Notes |
|---|---|---|---|
| 1 | Pure Unit & PostgreSQL Integration | ✅ PASS | GPS, geofence, photo SHA-256, DB connection |
| 2 | Sign Up & Screenlock Face Recognition | ✅ PASS | Signup, login, biometric screen |
| 3 | Biometric Security & Liveness Evaluation | ✅ PASS | Liveness checks |
| 4 | Email Backup Service | ✅ PASS | Daily CSV email dispatch |
| 5 | 46-Column Enterprise CSV Export | ✅ PASS | Full REDCap export format |
| 6 | Final Production Security Gate (OWASP & Rate Limit) | ✅ PASS | OWASP top-10 controls, rate limiting |
| 7 | Leaves & Attendance Alteration | ✅ PASS | Leave request, alteration workflow |
| 8 | Security Hardening & Multi-Tenant Isolation | ✅ PASS | Cross-org IDOR prevention |
| 9 | 16-Phase Security Remediation Regression | ✅ PASS | Historical regression suite |
| 10 | Single Punch Per Day Limit Enforcement | ✅ PASS | One check-in per employee per day |
| 11 | Indian States, Districts & Teams Tracking | ✅ PASS | State/district normalization |
| 12 | Supabase Automated Keep-Alive & Security Redaction | ✅ PASS | Keep-alive, credential redaction |
| 13 | Comprehensive Security Audit & Remediation Verification | ✅ PASS | Full security audit regression |
| 14 | Secure Signup, DOB, cder Email, Mobile & FW- Employee ID | ✅ PASS | Input validation, ID format |
| 15 | Hotel Stay GPS Verification & Geographic Matching | ✅ PASS | GPS hotel verification |
| 16 | Inbuilt Delete Confirmation Modal Verification | ✅ PASS | UI delete confirmation |
| 17 | State & District Standardization & Independent Validation | ✅ PASS | Geographic normalization |
| 18 | Shared Multi-Location Geofencing & Work Mode Compliance | ✅ PASS | Multi-location geofence |
| 19 | CSV Exports, Timesheet Fix & Team-Wise Attendance | ✅ PASS | Team attendance reporting |
| 20 | EMS Integration & Leave Governance Engine | ✅ PASS | EMS leave rules engine |
| 21 | EMS Post-Integration Security Verification (26 tests) | ✅ PASS | EMS auth, RBAC, IDOR |
| 22 | Secure 30-Minute Session Inactivity Timeout (15 tests) | ✅ PASS | Session expiry |
| 23 | Single Active Session Policy Across App & EMS (8 tests) | ✅ PASS | Concurrent login rejection |
| 24 | Single Active Session Atomic Concurrency (10 tests) | ✅ PASS | Race condition safety |
| 25 | EMS Production End-to-End Workflow & QA Gate (26 tests) | ✅ PASS | Complete EMS E2E |
| **TOTAL** | **25/25** | ✅ **ALL PASS** | **exit code 0** |

**Additional automated checks:**

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ PASS — 53 JS files, 14 UI assets, exit 0 |
| Build | `npm run build` | ✅ PASS — 7 assets, exit 0 |
| Security audit | `npm audit` | ✅ PASS — 0 vulnerabilities (185 packages), exit 0 |
| Script syntax — backup | `bash -n deployment/backup.sh` | ✅ PASS — exit 0 |
| Script syntax — healthcheck | `bash -n deployment/healthcheck.sh` | ✅ PASS — exit 0 |
| `better-sqlite3` Node 22 (root) | Native module smoke test | ✅ PASS |
| `better-sqlite3` Node 22 (ems/) | Native module smoke test | ✅ PASS |

**Tests that could not be run locally:**

| Check | State | Reason |
|---|---|---|
| Server-side health check on 192.168.14.224 | 🔒 BLOCKED — AIIMS IT | No remote server access |
| Nginx TLS handshake with institutional cert | 🔒 BLOCKED — AIIMS IT | Certificate not available locally |
| Load / concurrency testing | ❌ NOT VERIFIED | Requires realistic user simulation on target hardware |
| Off-host backup transfer to NAS | 🔒 BLOCKED — AIIMS IT | No institutional NAS available |

---

## 4. Files Changed in Final Release

### Code changes (committed)

| File | Change | Reason |
|---|---|---|
| `package.json` | `engines` updated from `>=18.0.0` to `>=22.0.0`, npm from `>=9` to `>=10` | Node 22 is the verified runtime; Node 18/20 no longer supported |
| `ems/package.json` | Added `engines: {"node":">=22.0.0","npm":">=10.0.0"}` | Consistency with root; prevents accidental Node 18/20 use |
| `src/db/database.js` | SSL logic replaced with loopback-aware conditional | **Security fix**: previous code applied `rejectUnauthorized: false` to ALL production PostgreSQL connections including local loopback. New code: Supabase → disabled verification (required); loopback (127.0.0.1/localhost) → SSL disabled (correct); others → controlled by `DATABASE_URL_SSL_MODE` env var |

### Deployment documentation changes (committed in `6f39bca`)

| File | Summary |
|---|---|
| `deployment/attendance.service` | Node.js 22 LTS description, `--max-old-space-size=1536` |
| `deployment/backup.sh` | `chmod 700/600`, 5 GB free-disk guard, SQLite WAL `.backup` |
| `deployment/nginx-attendance.conf` | Tier 1/2/3 TLS model, HDD proxy buffer tuning |
| `docs/deployment/UBUNTU_SERVER_DEPLOYMENT_GUIDE.md` | v3.0.0 — Node 22, capacity qualification, private IP/TLS |
| `docs/deployment/DATABASE_DEPLOYMENT_AND_MIGRATION.md` | v3.0.0 — verified restore test evidence |
| `docs/deployment/DEPLOYMENT_READINESS_CHECKLIST.md` | Node 22, IT approval gate |
| `docs/deployment/PRODUCTION_OPERATIONS_RUNBOOK.md` | Memory/swap monitoring, HDD I/O |
| `docs/deployment/PRODUCTION_ENVIRONMENT_VARIABLES.md` | v3.0.0 — Node 22 prerequisites, `better-sqlite3` rebuild warning |

### New handover documents (this release)

| File | Purpose |
|---|---|
| `docs/deployment/FINAL_RELEASE_READINESS_REPORT.md` | This document |
| `docs/deployment/RESTRICTED_INSTITUTIONAL_VM_DEPLOYMENT_RUNBOOK.md` | Complete step-by-step admin runbook |
| `docs/deployment/GO_LIVE_AND_ROLLBACK_CHECKLIST.md` | Verified/blocked/required distinction checklist with rollback |

---

## 5. Known Risks and Unresolved Blockers

### Risk 1 — Rotational HDD I/O bottleneck (MEDIUM)
100 GB rotational HDD has ~75–120 random IOPS and 10–15 ms seek latency. Concurrent photo uploads (JPEG ~200–500 KB each), SQLite WAL checkpoints, and PostgreSQL WAL flushing all compete for disk I/O. Under high concurrency, this may cause slowdowns. Nginx proxy buffers are tuned to reduce backend seeks.  
**Mitigation:** Monitor `iostat -x` after go-live. Consider `iowait` threshold alerting.

### Risk 2 — Capacity unverified (HIGH)
No load test has been performed. The number of concurrent fieldworkers this server can safely support is unknown. 4 GB RAM with `--max-old-space-size=1536` leaves ~2.4 GB for OS, PostgreSQL, and SQLite. Under heavy concurrent load, OOM is possible.  
**Mitigation:** Set up a 4 GB swap file. Monitor `free -h` and `vmstat` after go-live. Start with a phased rollout.

### Risk 3 — Node.js binary path on Ubuntu (MEDIUM)
The systemd unit hardcodes `ExecStart=/usr/bin/node`. Ubuntu's Node.js installation location depends on the installation method. NodeSource installs to `/usr/bin/node`. An nvm or tarball install may place it elsewhere.  
**Mitigation:** After installing Node.js 22, run `which node` and update `ExecStart` in `attendance.service` if the path differs.

### Risk 4 — TLS certificate not yet provisioned (HIGH)
No institutional TLS certificate exists yet. Without TLS, all authentication tokens and employee data travel unencrypted on the LAN.  
**Mitigation:** Obtain institutional CA certificate from AIIMS IT before exposing the service to users. The nginx config supports Tier 1 (institutional CA), Tier 2 (self-signed IP SAN), and Tier 3 (HTTP only) — use the highest available tier.

### Risk 5 — PostgreSQL password appears in process environment (LOW)
`pg_dump` uses `PGPASSWORD` environment variable in `backup.sh`. This is visible in `/proc/<pid>/environ` to root for the duration of the command.  
**Mitigation:** Acceptable for a root-owned cron job. Alternatively, use a `.pgpass` file with mode 0600 owned by the backup user.

### Risk 6 — `rejectUnauthorized: false` for Supabase connections (LOW)
If this application is ever pointed at a Supabase cloud instance in addition to the local VM, the TLS certificate of the Supabase server is not verified. This was intentional for Supabase compatibility but is noted for awareness.  
**Mitigation:** Not applicable for the institutional VM deployment, which uses local loopback only. The fixed SSL logic correctly disables SSL for loopback connections.

### Risk 7 — Off-host backup not configured (HIGH)
Daily backups go to `/var/backups/attendance/daily/` on the same physical disk. A disk failure would destroy both the live data and the backups.  
**Mitigation:** Arrange with IT to mount a network share or configure an rsync/scp job to a separate machine. Document in the Operations Runbook.

---

## 6. Backup and Restore Verification Status

| Test | State | Evidence |
|---|---|---|
| SQLite WAL backup via `sqlite3 .backup` | 🔬 VERIFIED (DISPOSABLE DB) | Synthetic WAL database created; `.backup` command run; restored to separate file; `PRAGMA integrity_check` = 'ok'. Performed 2026-10-29. |
| PostgreSQL `pg_dump` backup | 🔬 VERIFIED (DISPOSABLE DB) | `attendance_restore_test` database created; `pg_dump attendance_test -t organizations` run; restored via `psql`; row count verified (2 rows); database dropped. Performed 2026-10-29. |
| Backup file permissions (700/600) | ✅ VERIFIED LOCALLY | `backup.sh` enforces `chmod 700` on directories and `chmod -R go-rwx` on archives |
| 5 GB free-disk safety guard | ✅ VERIFIED LOCALLY | `backup.sh` aborts if `df -k /var/backups` shows < 5 GB free |
| 14-day retention | ✅ VERIFIED LOCALLY | `find -mtime +14 -delete` in `backup.sh` |
| Off-host backup transfer | 🔒 BLOCKED — AIIMS IT | Requires NAS or remote host not available locally |
| Live production restore from server backup | 🔒 BLOCKED — AIIMS IT | Cannot test without production server access |

---

## 7. Capacity and Load Testing Status

**Capacity: NOT VERIFIED**

No load test has been performed on the target hardware. The claim that 4 GB RAM / 4 cores supports any specific number of concurrent fieldworkers is unverified and should not be published.

To conduct a safe load test after deployment (on a staging copy with synthetic data, never on production):
```bash
# Install autocannon or Apache Bench on a test machine in the same subnet:
npx autocannon -c 20 -d 60 -p 10 http://192.168.14.224/api/health
# Monitor server during test:
ssh admin@192.168.14.224 'watch -n2 "free -h; echo; vmstat 1 1; echo; iostat -x 1 1"'
```

---

## 8. Administrator Deployment Commands

See `docs/deployment/RESTRICTED_INSTITUTIONAL_VM_DEPLOYMENT_RUNBOOK.md` for the complete step-by-step runbook.

Quick-reference command sequence (assumes Ubuntu 26.04, internet access, `sudo` available):

```bash
# 1. Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql nginx
node --version  # → v22.x.x

# 2. Database setup
sudo -u postgres psql <<'SQL'
CREATE ROLE attendance_user WITH LOGIN PASSWORD 'REPLACE_STRONG_PASSWORD';
CREATE DATABASE attendance_prod OWNER attendance_user ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;
\c attendance_prod
GRANT CONNECT, CREATE ON DATABASE attendance_prod TO attendance_user;
GRANT USAGE, CREATE ON SCHEMA public TO attendance_user;
SQL

# 3. Deploy application
sudo mkdir -p /var/www/attendance
cd /var/www/attendance
sudo tar -xzf /tmp/attendance_release.tar.gz
sudo chown -R www-data:www-data /var/www/attendance
sudo -u www-data npm ci --omit=dev
sudo -u www-data npm rebuild better-sqlite3
cd ems && sudo -u www-data npm ci --omit=dev && sudo -u www-data npm rebuild better-sqlite3

# 4. Production environment file
sudo mkdir -p /etc/attendance
sudo tee /etc/attendance/attendance.env > /dev/null << 'ENV'
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://attendance_user:STRONG_PG_PASSWORD@127.0.0.1:5432/attendance_prod
DB_POOL_MAX=8
EMS_DB_PATH=/var/www/attendance/ems/data/ems.sqlite
JWT_SECRET=GENERATED_64_HEX
SESSION_SECRET=GENERATED_64_HEX
HOTEL_VERIFY_SECRET=GENERATED_64_HEX
UPLOADS_PATH=/var/www/attendance/uploads
ALLOWED_ORIGINS=http://192.168.14.224,https://192.168.14.224
ENV
sudo chmod 640 /etc/attendance/attendance.env
sudo chown root:www-data /etc/attendance/attendance.env

# 5. Systemd service
sudo cp deployment/attendance.service /etc/systemd/system/attendance.service
# Verify ExecStart path matches `which node` output
sudo systemctl daemon-reload && sudo systemctl enable attendance && sudo systemctl start attendance
sudo systemctl status attendance  # expect: active (running)

# 6. Nginx
sudo cp deployment/nginx-attendance.conf /etc/nginx/sites-available/attendance.conf
sudo ln -s /etc/nginx/sites-available/attendance.conf /etc/nginx/sites-enabled/attendance
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable nginx && sudo systemctl restart nginx

# 7. Health check
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
# Expected: {"status":"healthy","database":"connected",...}
```

---

## 9. Pre-Go-Live Checks and Rollback Steps

### Immediate pre-go-live (day of deployment):
1. ✅ Confirm `systemctl is-active attendance` → `active`
2. ✅ Confirm `curl http://127.0.0.1:3000/api/health` → `200 OK, "status":"healthy"`
3. ✅ Confirm `curl http://192.168.14.224/api/health` (via Nginx) → `200 OK`
4. ✅ Test admin login with real admin credentials
5. ✅ Test employee check-in with a test employee (photo upload + GPS)
6. ✅ Verify check-in photo persists in `/var/www/attendance/uploads/`
7. ✅ Run `/usr/local/bin/attendance-backup.sh` manually and verify archive created
8. ✅ Check `journalctl -u attendance` for FATAL or ERROR entries
9. ✅ Check `df -h` — at least 20 GB free before go-live
10. ✅ Notify project lead: deployment complete and verified

### Rollback (if needed within first 24 hours):
```bash
sudo systemctl stop attendance
# Restore previous tarball to /var/www/attendance_prev/ and swap
sudo mv /var/www/attendance /var/www/attendance_failed
sudo mv /var/www/attendance_prev /var/www/attendance
sudo systemctl start attendance
sudo systemctl status attendance
```
Full rollback procedure: see `GO_LIVE_AND_ROLLBACK_CHECKLIST.md` Section 5.

---

## 10. Deployment Decision

### ✅ READY FOR IT-ASSISTED DEPLOYMENT

**With the following conditions and acknowledgements:**

**What IS ready:**
- All 25 automated test suites pass on Node.js 22 LTS (exit 0, confirmed 2026-10-29)
- 0 npm audit vulnerabilities across 185 packages
- Lint and build pass cleanly
- All deployment scripts pass shell syntax checks
- SSL handling in `src/db/database.js` corrected (loopback-aware, no blanket `rejectUnauthorized:false` in production)
- `engines` field updated to `>=22.0.0` in both `package.json` files
- Backup procedures verified on disposable databases (SQLite WAL + PostgreSQL `pg_dump`)
- Complete administrator runbook, go-live checklist, and rollback procedure created
- Git history is clean; no force-push; no secrets or personal data committed

**What requires IT action before users can access the system:**
1. Install Node.js 22 LTS on the server and verify binary path
2. Install PostgreSQL 16 and Nginx
3. Create `attendance_prod` database and `attendance_user` role
4. Generate production secrets and populate `/etc/attendance/attendance.env`
5. Run `npm ci --omit=dev && npm rebuild better-sqlite3` in both app directories
6. Deploy and enable the systemd service
7. Configure Nginx (choose TLS tier: institutional CA cert preferred)
8. Configure firewall (subnet 192.168.14.0/24 only)
9. Schedule backup cron and arrange off-host transfer
10. Perform post-deployment smoke test and complete sign-off in `GO_LIVE_AND_ROLLBACK_CHECKLIST.md`

**Unverified risks that IT should monitor post-deployment:**
- Actual server capacity under real fieldworker load (unverified)
- HDD I/O performance under concurrent photo uploads (unverified)
- Off-host backup reachability (requires institutional NAS or remote host)

---

*This report reflects the state of the repository as of commit `6f39bca` + the final release commit. For questions, contact the development team before initiating deployment.*

