# Deployment Readiness Checklist & Pre-Flight Verification
## AIIMS CDER Real-Time Attendance + EMS System

**Review Date:** 2026-10-29 | **Target Server:** Ubuntu 26.04 LTS (Private IP: `192.168.14.224`, 4 GB RAM, 100 GB HDD)

---

## 1. Automated Quality & Security Gate Summary

| Gate Area | Threshold Requirement | Local Verification Status | Evidence / Artifact |
|---|---|---|---|
| **Node.js LTS Runtime** | Active/Maintenance LTS (Node 22 LTS) | ✅ **PASS** (Node v22.23.4) | Rebuilt and verified `better-sqlite3` and all tests on Node 22 |
| **Master Test Suite** | 100% Pass across all 25 suites | ✅ **PASS** (25/25 Suites) | Verified via `scripts/test_all.js` on Node 22 (Exit code: 0) |
| **EMS End-to-End Workflow** | Full Apply → Approve → Ledger cycle | ✅ **PASS** (26/26 Tests) | Verified via `test/ems_end_to_end_workflow.test.js` |
| **Lint & Syntax Quality** | Zero syntax errors, zero informal symbols | ✅ **PASS** (53 files) | Verified via `npm run lint` on Node 22 |
| **Production Build Assets** | Essential web assets present & non-empty | ✅ **PASS** (7 assets) | Verified via `npm run build` on Node 22 |
| **Dependency Security** | Zero high / critical vulnerabilities | ✅ **PASS** (0 vulnerabilities) | `npm audit` clean (body-parser@2.4.0, nodemailer@10.2.1) |
| **Shell Script Syntax** | Valid bash syntax on all deployment scripts | ✅ **PASS** | Verified via `bash -n deployment/*.sh` |
| **Backup & Restoration Test**| Verified restore on disposable databases | ✅ **PASS** | Verified PostgreSQL restore and SQLite WAL `.backup` integrity |

---

## 2. Server Specifications & Architecture Alignment (Ubuntu 26.04 LTS)

| Specification | AIIMS Target Specification | Implementation & Hardening Measures | Operational Status |
|---|---|---|---|
| **Operating System** | Ubuntu 26.04 LTS | Deployment scripts and Node 22 LTS toolchain configured. | ✅ Ready |
| **Runtime Version** | Node.js 22 LTS | Replaced EOL Node 20 with Node 22 LTS across all units and docs. | ✅ Ready |
| **Memory** | 4 GB Physical RAM | Configured 4 GB swapfile (`vm.swappiness=10`), capped V8 heap (`--max-old-space-size=1536`), tuned PostgreSQL (`shared_buffers=256MB`). | ⚠️ Capacity unverified until load-tested |
| **Storage** | 100 GB Rotational HDD | SQLite WAL (`synchronous=NORMAL`), 14-day rolling backup retention, 180-day photo archiving policy, and free space pre-check. | ✅ Optimized |
| **Network Address** | Private IP: `192.168.14.224` | Nginx configured for intranet IP access. Documented institutional LAN / VPN requirements and private IP SSL/TLS options. | ✅ Documented |
| **Attendance Database** | PostgreSQL 16/17 | Synchronous schema migrations, parameterized queries, connection pooling (`pg.Pool`). | ✅ Ready |
| **EMS Database** | SQLite 3 (WAL Mode) | Retained synchronous better-sqlite3 engine, persistent volume at `/var/www/attendance/ems/data/ems.sqlite`. | ✅ Ready |

---

## 3. Mandatory Pre-Flight Sign-Off & Approvals Required Before Live Go-Live

Live cut-over must not proceed until each of the following administrative items is formally verified and signed off:

### 3.1 Network & Infrastructure Approvals
- [ ] **AIIMS IT Network Approval:** Confirmation that `192.168.14.224` is provisioned on the hospital network and reachable by authorized fieldworker subnets and hospital VPNs.
- [ ] **Internal DNS & TLS Certificate (Tier 1 Preferred):** AIIMS IT network administration assigns an internal domain name (`attendance.cder.aiims.internal`) and provides an institutional CA-signed certificate and private key.
- [ ] **Host-Level Swap Activation:** System administrator creates and activates the 4 GB swapfile (`sudo fallocate -l 4G /swapfile && sudo swapon /swapfile`) with `vm.swappiness=10`.
- [ ] **Off-Host Backup Replication:** Automated daily transfer (via `rsync` over SSH) configured to replicate `/var/backups/attendance/daily/` to an external AIIMS NAS or secondary server.

### 3.2 Security & Credential Configuration
- [ ] **Cryptographic Secrets Generated on Server:** Production secrets for `JWT_SECRET`, `SESSION_SECRET`, and `HOTEL_VERIFY_SECRET` generated via `openssl rand -hex 32` directly on the server.
- [ ] **Environment File Protected:** `/etc/attendance/attendance.env` created with permissions `0640` and ownership `root:www-data`.
- [ ] **Institutional SMTP Credentials:** Valid credentials for `smtp.aiims.edu` configured and tested for daily backup CSV email dispatch.

### 3.3 Database & Operational Verification
- [ ] **PostgreSQL Production Database Initialized:** User `attendance_user` and database `attendance_prod` created with tuned settings in `/etc/postgresql/*/main/conf.d/tuning.conf`.
- [ ] **EMS SQLite Seeded:** Foundational leave types, sandwich rules, and CDER holiday calendar verified.
- [ ] **Upload Volume Storage Mount:** Uploads directory `/var/www/attendance/uploads` verified with permissions `0770` and ownership `www-data:www-data`.
- [ ] **Restoration Dry-Run Completed on Host:** Verified that `attendance-backup.sh` executes cleanly and produces restorable dumps.
- [ ] **Staged Load Testing Performed:** Internal load testing from a hospital LAN workstation completed, confirming acceptable response times and memory stability under concurrent morning check-in loads.
- [ ] **Documented Rollback Procedure:** IT team briefed on service restart and database restoration rollback steps.
