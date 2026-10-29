# Deployment Readiness Checklist
## AIIMS CDER Real-Time Attendance + EMS System

**Review Date:** 2026-10-29 | **Target Release:** Production Release 1.0.0

---

## 1. Automated Quality & Security Gate Summary

| Gate Area | Required Threshold | Actual Status | Evidence / Artifact |
|---|---|---|---|
| **Master Test Suite** | 100% Pass across all 25 suites | ✅ **PASS** (25/25 Suites) | Verified via `scripts/test_all.js` (Exit code: 0) |
| **EMS End-to-End Workflow** | Complete Apply → Approve → Ledger flow | ✅ **PASS** (26/26 Tests) | Verified via `test/ems_end_to_end_workflow.test.js` |
| **Lint & UI Quality** | Zero syntax errors, zero informal symbols | ✅ **PASS** (53 files) | Verified via `npm run lint` |
| **Production Build Assets** | Critical static assets present & non-empty | ✅ **PASS** (7 assets) | Verified via `npm run build` |
| **Dependency Security** | Zero high / critical vulnerabilities | ✅ **PASS** (0 vuln) | `npm audit` clean (body-parser & nodemailer patched) |
| **Database Schema** | All PostgreSQL & SQLite tables validated | ✅ **PASS** | Auto-synchronized and verified against test instances |

---

## 2. Detailed Technical Readiness Criteria

### Section 1: Code Integrity & Test Verification
- [x] **Suite 1 to 25 Execution:** All 25 suites execute cleanly without skipped tests when a valid PostgreSQL test database is provided.
- [x] **Test Idempotency:** Master test suite can be run repeatedly without database corruption or synthetic fixture leakage.
- [x] **Test Isolation:** Dedicated test database (`attendance_test`) isolated from production connection strings.
- [x] **EMS SQLite Test Harness:** In-process API verification via `supertest` with automated synthetic fixture teardown.

### Section 2: Security Architecture & Access Control
- [x] **Authentication Controls:** Strong bcrypt / scrypt hashing, JWT validation with mandatory high-entropy secret, fail-closed when secret is missing.
- [x] **Single-Active-Session Policy:** Verified across Attendance and EMS; concurrent logins rejected with `409 ACTIVE_SESSION_EXISTS`.
- [x] **Session Inactivity Timeout:** 30-minute inactivity threshold strictly enforced; expired sessions rejected with `401 SESSION_EXPIRED`.
- [x] **Role-Based Access Control (RBAC):** Employees blocked from admin operations (`403 Forbidden`).
- [x] **Insecure Direct Object Reference (IDOR) Mitigation:** Employees cannot query other fieldworkers' private leave requests or attendance logs.
- [x] **Anti-Self-Approval Rule:** Administrators cannot approve, reject, or modify their own leave requests.
- [x] **HTTP Security Headers:** HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive Content Security Policy (CSP).
- [x] **Production Error Masking:** Stack traces and internal database errors masked as `An internal server error occurred.` in production mode.

### Section 3: Dependency Supply Chain
- [x] **`body-parser`:** Patched to `^2.3.2` (resolved to `2.4.0`), mitigating GHSA-27r3-jxmh-p828 (DoS via compressed request bodies).
- [x] **`nodemailer`:** Patched to `^10.2.1` (resolved to `10.2.1`), mitigating GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h, GHSA-4ffr-jq9g-5ffx, and GHSA-g73g-hqqh-jr95.
- [x] **Audit Outcome:** `npm audit` reports `found 0 vulnerabilities`.

### Section 4: Database & Storage Provisioning
- [x] **Dual-Database Strategy Documented:** PostgreSQL for Attendance, WAL-mode SQLite for EMS.
- [x] **Schema Definitions Complete:** SQL migrations for PostgreSQL (`001` through `006`) and EMS migration scripts verified.
- [x] **Double-Entry Ledger Invariant:** Total transaction entries match cached leave balance precisely (`GET /api/ems/ledger/verify-integrity`).
- [x] **Persistent Upload Storage:** Storage directory structure (`uploads/checkins`, `uploads/checkouts`, `uploads/leave_documents`) defined and configurable via `UPLOADS_PATH`.

### Section 5: Deployment & Operational Artifacts
- [x] **Ubuntu 24.04 Deployment Guide:** `docs/deployment/UBUNTU_SERVER_DEPLOYMENT_GUIDE.md` complete with reproducible step-by-step commands.
- [x] **Environment Variable Inventory:** `docs/deployment/PRODUCTION_ENVIRONMENT_VARIABLES.md` complete with secret generation instructions.
- [x] **Database Strategy Guide:** `docs/deployment/DATABASE_DEPLOYMENT_AND_MIGRATION.md` detailing PostgreSQL setup, SQLite WAL pragmas, and backup procedures.
- [x] **Operations Runbook:** `docs/deployment/PRODUCTION_OPERATIONS_RUNBOOK.md` detailing systemd commands, logging, and incident response playbooks.
- [x] **Production Systemd Service Template:** `deployment/attendance.service` with security sandboxing (`ProtectSystem=full`, `PrivateTmp=true`).
- [x] **Production Nginx Proxy Template:** `deployment/nginx-attendance.conf` with TLS 1.2/1.3, HSTS, gzip, and 20MB body size.
- [x] **Automated Backup Script:** `deployment/backup.sh` supporting PostgreSQL `pg_dump`, SQLite `.backup`, and 14-day retention.
- [x] **Operational Health Check:** `deployment/healthcheck.sh` testing Attendance and EMS health endpoints.

---

## 3. Pre-Flight Sign-Off & Human Actions Required Before Go-Live

The application code, dependencies, tests, and deployment scripts are fully prepared. Before routing live production traffic, the following administrative actions must be completed by the authorized deployment team:

1. **Host Server Provisioning:** Provision Ubuntu Server 24.04 LTS instance with 4 vCPUs, 8 GB RAM, and 80 GB SSD.
2. **Domain & DNS Configuration:** Point official domain (e.g., `attendance.cder.aiims.edu`) to the server's public IP address.
3. **Environment Secrets Generation:** Generate cryptographically secure values for `DATABASE_URL`, `JWT_SECRET`, and `SESSION_SECRET` on the host and write them to `/etc/attendance/attendance.env`.
4. **Institutional SMTP Relay Access:** Obtain official AIIMS CDER SMTP relay credentials for automated daily attendance backup email dispatch.
5. **Holiday Master Data Seeding:** Populate `organization_holidays` with gazetted CDER holiday dates for the operational calendar year.
6. **TLS Certificate Issuance:** Run Certbot on the server to bind official Let's Encrypt SSL/TLS certificates.

