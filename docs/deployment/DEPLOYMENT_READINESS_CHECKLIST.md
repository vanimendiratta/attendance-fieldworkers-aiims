# Deployment Readiness Checklist & Pre-Flight Verification
## AIIMS CDER Real-Time Attendance + EMS System

**Review Date:** 2026-10-29 | **Target Server:** Ubuntu 26.04 LTS (Private IP: `192.168.14.224`, 4 GB RAM, 100 GB HDD)

---

## 1. Automated Quality & Security Gate Summary

| Gate Area | Threshold Requirement | Local Verification Status | Evidence / Artifact |
|---|---|---|---|
| **Master Test Suite** | 100% Pass across all 25 suites | ✅ **PASS** (25/25 Suites) | Verified via `scripts/test_all.js` (Exit code: 0) |
| **EMS End-to-End Workflow** | Full Apply → Approve → Ledger cycle | ✅ **PASS** (26/26 Tests) | Verified via `test/ems_end_to_end_workflow.test.js` |
| **Lint & Syntax Quality** | Zero syntax errors, zero informal symbols | ✅ **PASS** (53 files) | Verified via `npm run lint` |
| **Production Build Assets** | Essential web assets present & non-empty | ✅ **PASS** (7 assets) | Verified via `npm run build` |
| **Dependency Security** | Zero high / critical vulnerabilities | ✅ **PASS** (0 vulnerabilities) | Verified via `npm audit` |
| **Shell Script Syntax** | Valid bash syntax on all deployment scripts | ✅ **PASS** | Verified via `bash -n deployment/*.sh` |

---

## 2. Server Specifications & Architecture Alignment (Ubuntu 26.04 LTS)

| Specification | AIIMS Target Specification | Implementation & Hardening Measures | Status |
|---|---|---|---|
| **Operating System** | Ubuntu 26.04 LTS | Instructions updated for Ubuntu 26.04 LTS package ecosystem. | ✅ Ready |
| **Memory** | 4 GB RAM | Configured 4 GB swapfile (`vm.swappiness=10`), capped Node heap (`--max-old-space-size=1536`), tuned PostgreSQL (`shared_buffers=256MB`). | ✅ Optimized |
| **Storage** | 100 GB Rotational HDD | Configured SQLite WAL (`synchronous=NORMAL`), 14-day rolling backup retention, 180-day photo archiving policy, and free space pre-check. | ✅ Optimized |
| **Network Address** | Private IP: `192.168.14.224` | Nginx configured for intranet IP access. Documented institutional LAN / VPN requirements and private IP SSL/TLS options. | ✅ Documented |
| **Attendance Database** | PostgreSQL 16/17 | Synchronous schema migrations, parameterized queries, connection pooling (`pg.Pool`). | ✅ Ready |
| **EMS Database** | SQLite 3 (WAL Mode) | Retained synchronous better-sqlite3 engine, persistent volume at `/var/www/attendance/ems/data/ems.sqlite`. | ✅ Ready |

---

## 3. Pre-Flight Actions Requiring System Administrator Authorization

Before routing live fieldworker attendance traffic to `192.168.14.224`, the following administrative actions must be completed by the authorized deployment owner:

- [ ] **Physical / Virtual Server Provisioning:** Verify Ubuntu 26.04 LTS server is booted and accessible at `192.168.14.224` on the hospital network.
- [ ] **Intranet Routing & VPN Access:** Confirm that fieldworkers on hospital Wi-Fi or AIIMS VPN can reach `192.168.14.224`.
- [ ] **Host-Level Swap Activation:** Execute `sudo fallocate -l 4G /swapfile` and activate swap to protect 4 GB RAM.
- [ ] **Host Secret Injection:** Generate cryptographically secure keys (`openssl rand -hex 32`) on the server and populate `/etc/attendance/attendance.env` (permissions `0640`, owner `root:www-data`).
- [ ] **Institutional SMTP Access:** Obtain authorized credentials for `smtp.aiims.edu` for daily automated backup emails.
- [ ] **Holiday Master Seeding:** Populate `organization_holidays` with gazetted CDER holiday dates for the operational calendar year.
- [ ] **Internal TLS / HTTPS Decision:** Determine whether to use HTTP port 80 within the secure hospital subnet, or install an institutional CA / self-signed certificate for internal HTTPS.
