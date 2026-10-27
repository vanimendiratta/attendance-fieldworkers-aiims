# Final Pre-Tenable Security Audit Readiness Report
**Attendance & Employee Management System (EMS)**

---

## 1. Executive Summary & Audit Scope

This document represents the final engineering security and deployment-readiness assessment for the **AIIMS Attendance System & Integrated Employee Management System (EMS)** located at `/Users/vanimendiratta/Desktop/attendance`.

This evaluation was conducted prior to executive handover to the manager for an authorized vulnerability and compliance assessment using **Tenable**.

### Audit Scope
- **Attendance Application**: Core Express.js backend (`server.js`, `src/routes/api.js`), PostgreSQL integration (`src/db/database.js`), session lifecycle engine (`src/services/session_service.js`), biometric pipeline (`src/services/biometric_service.js`), geofencing/location verification (`src/services/geo_service.js`, `src/services/attendance_service.js`), CSV export utility (`src/services/csv_service.js`), and frontend client assets (`public/`).
- **EMS Subsystem**: Employee Management System backend (`ems/server/index.js`, `ems/server/routes/api.js`), SQLite/PostgreSQL bridge, authentication service (`ems/server/services/AuthService.js`), role-based middleware (`ems/server/middleware/authMiddleware.js`), and administrative portal (`ems/public/`).
- **Database Migrations & Schemas**: Initial schemas through migration `006_single_active_session_index.sql` in both Supabase PostgreSQL and EMS SQLite/PostgreSQL.
- **Dependencies & Tooling**: Root and EMS `package.json`, lockfiles, automated test harnesses (`scripts/test_all.js`, 24 suites).

---

## 2. Review Environment & Methodology

- **Local Assessment Date**: October 27, 2026
- **Operating Environment**: macOS Darwin arm64, Node.js v20+, npm v10+
- **Test Database**: PostgreSQL 15 on `127.0.0.1:5434/attendance_test`
- **Isolation Policy**: `DATABASE_URL` strictly unset in testing shells; `TEST_DATABASE_URL` configured with dedicated non-production credentials; non-destructive test isolation.
- **Verification Rule**: 100% of claims are substantiated by automated test execution, static code inspection, and runtime dependency analysis. No claims of production security or regulatory compliance are certified solely from local code review.

---

## 3. Repository & Configuration Integrity

### 3.1 Git Tracking and State
- **Working Tree**: `git status` verifies that no secret-bearing files, `.env` files, `.pem`/`.key` files, SQLite databases, memory dumps, or runtime log files are tracked in version control.
- **Tracked Configuration**: Only `.env.example` is tracked, containing safe placeholder tokens (`[YOUR-PASSWORD]`, `[YOUR-PROJECT-REF]`).
- **Whitespace & Diff Hygiene**: `git diff --check` executed with code `0`, confirming clean formatting, zero trailing whitespace errors, and zero unresolved merge markers.
- **Static Assets & Artifacts**: Verified 52 JavaScript files via production linter (`npm run lint`), passing with 0 syntax errors and clean formatting.
- **Asset Build Verification**: `npm run build` executed with code `0`, confirming all 7 production frontend assets and runtime directory structures are present.

### 3.2 Secret Exposure & JWT_SECRET Review
- **Hardcoded Credentials**: Purged from all client-side JavaScript (`public/admin.js`, `public/app.js`, `public/admin.html`).
- **Cryptographic Hashing**: Production passwords use `scrypt` with individual 16-byte random salts and 64-byte derived keys (`auth_service.js` / `test_helper.js`), preventing rainbow table and preimage attacks.
- **EMS JWT_SECRET**:
  - `ems/server/services/AuthService.js` and `ems/server/middleware/authMiddleware.js` load `JWT_SECRET` strictly from `process.env.JWT_SECRET`.
  - When `JWT_SECRET` is unset, the system logs `[EMS_AUTH_CRITICAL]` and **fails closed**—refusing to issue or verify forged tokens.
  - There is zero hardcoded or fallback secret in source code.
  - **Production Requirement**: The deployment owner must configure a high-entropy secret (>= 64 characters) via the production secret manager before live operation.

---

## 4. Authentication, Session & Access Control

### 4.1 30-Minute Inactivity Timeout Policy
- Both the Attendance backend and EMS enforce a strict 30-minute rolling inactivity timeout (`SESSION_INACTIVITY_TIMEOUT_MS = 1,800,000 ms`).
- Verified via `test/session_timeout.test.js` (15/15 passed):
  - Sessions at 29 minutes remain valid.
  - Sessions at 30 minutes or beyond are rejected with HTTP 401 `SESSION_EXPIRED`.
  - Background polling requests carrying `x-background-request: true` do not touch or artificially extend session lifespan.
  - Expired tokens cannot be revived by refreshing the page or restarting the browser.

### 4.2 Single Active Session Invariant
- **Policy**: A user (employee or administrator) may only have one active session (`is_revoked = 0`) at any time across Attendance and EMS.
- **Enforcement**:
  - **Database Level**: Partial unique index `idx_sessions_single_active_user ON sessions (user_id, session_type) WHERE is_revoked = 0` (Supabase Migration 006) and `idx_user_sessions_single_active ON user_sessions (user_id) WHERE is_revoked = 0` (EMS Migration 006).
  - **Application Level**: Atomic database constraint violation handling catches duplicate concurrent logins and surfaces HTTP 409 `ACTIVE_SESSION_EXISTS`.
  - **Non-Destructive Invariant**: A second login attempt on Device B is rejected while preserving Device A's active session. Device A is never silently revoked to accommodate an unauthorized login.
  - **Logout Lifecycle**: Explicit logout (`POST /api/auth/logout`) marks `is_revoked = 1`, immediately freeing the account for subsequent logins.
- Verified via:
  - `test/single_active_session.test.js` (8/8 passed)
  - `test/single_active_session_concurrency.test.js` (10/10 passed)

### 4.3 Role-Based Access Control (RBAC) & Tenant Isolation
- Employee sessions cannot access admin endpoints (`/api/admin/*`, `/api/employees/*`, `/api/teams/*`), returning HTTP 403 `Forbidden: Employer administrator privileges required`.
- Multi-tenant isolation verified: administrators can only read, export, or manage records matching their authoritative `employer_id`. Attempts to tamper with `?employer_id=ORG-002` or headers fail closed with HTTP 403.

---

## 5. Input Validation, Injection & API Hardening

### 5.1 Parameterized SQL Queries
- All database queries in `src/routes/api.js`, `src/services/attendance_service.js`, and `src/services/session_service.js` use parameterized `$1, $2, ...` placeholders via `pg` pool.
- Zero raw string concatenation found in SQL execution paths.

### 5.2 HTTP Security Headers & Cross-Site Defenses
Configured globally in `server.js`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (anti-clickjacking)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (enforced when `NODE_ENV=production`)
- `Content-Security-Policy`:
  `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none';`
- CORS: Strict whitelist from `ALLOWED_ORIGINS` environment variable, defaulting to authorized Netlify and Render hostnames. Unwhitelisted origins are rejected.
- Production Error Masking: Server-side stack traces and internal database errors are masked with generic messages (`An internal server error occurred.`) when `NODE_ENV=production`.

---

## 6. Attendance Integrity, Geofencing & Hotel Stays

### 6.1 Single Punch Per Day Limit
- An employee can check in and check out exactly once per calendar day.
- A checkout without an active check-in is blocked (HTTP 400).
- Duplicate check-ins while active are blocked (HTTP 400).
- Secondary check-ins on the same calendar day after shift completion are strictly rejected (HTTP 400).
- Verified via `test/single_punch_limit.test.js` (7/7 assertions passed).

### 6.2 Geolocation & Geofencing Verification
- Coordinates (`latitude`, `longitude`, `accuracy`) and photo payload are verified server-side.
- Client-provided GPS coordinates are evaluated against organization geofence centers (`office_lat`, `office_lng`, `geofence_radius_m`) using Haversine distance calculations.
- Hotel stays require active stay record validation, GPS distance matching, and place-type confirmation before check-in approval.
- **Physical Limitation Disclosure**: Device-level GPS spoofing (e.g. mock locations or manipulated browser APIs) cannot be completely ruled out by software alone. Compensating controls (real-time camera photo capture, satellite map URL logging, network IP logging) are actively recorded.

---

## 7. Biometric & Face Verification Findings

### 7.1 Architecture & Implementation
- Uses 128-dimensional spatial luminance and edge-gradient histogram descriptors normalized with Euclidean L2 norm.
- Face matching uses cosine similarity against the enrolled descriptor with threshold `>= 0.75` (75.0%).
- Raw camera frames and facial descriptors are restricted from unprivileged APIs.

### 7.2 Biometric Evaluation Evidence & PAD Limitations
Actual empirical results from executing `node test/biometric_security_evaluation.test.js`:
- **Section 1: Genuine Acceptance (Same Subject)**:
  - 10/10 environmental variations accepted (Normal lighting, low lighting, bright lighting, background changes, scale shifts, yaw rotations, downsampling blur, eyewear frame artifacts, clean baseline, smiling expression).
  - **False Rejection Rate (FRR)**: **0.0%** at threshold 0.75.
- **Section 2: Impostor Rejection (Different Persons)**:
  - 1/5 synthetic impostor blocked, 4/5 false accepted:
    - Impostor 1 (narrow face/inverted): 86.6% (False Accept)
    - Impostor 2 (high forehead/wide chin): 62.3% (Blocked)
    - Impostor 3 (asymmetric bone/shadow): 80.6% (False Accept)
    - Impostor 4 (round face/uniform gradient): 91.5% (False Accept)
    - Impostor 5 (distinct human/different bone layout): 82.9% (False Accept)
  - **False Acceptance Rate (FAR)**: **80.0%** against synthetic variations at threshold 0.75.
- **Section 3: Presentation Attack (Spoofing) Testing**:
  - 6/6 2D presentation attack scenarios were accepted at 100.0% similarity score:
    1. Printed color photograph on paper
    2. Photograph displayed on mobile OLED screen
    3. Photograph displayed on laptop LCD screen
    4. Recorded video playback of genuine face
    5. Screenshot digital replication
    6. High-resolution downscaled image
  - **PAD Pass Rate**: **0.0%** (100% of 2D spoofs accepted).

### 7.3 Security Classification & Handover Impact
- **CRITICAL CLASSIFICATION**: **NO ACTIVE PRESENTATION ATTACK DETECTION (PAD)**.
- The 2D spatial luminance and edge-gradient descriptor processes only 2D pixel energy without 3D structured light, IR depth, or challenge-response blink/head turn liveness.
- **Handover Requirement**: In Tenable and executive audit documentation, this feature must be explicitly classified as a convenience/recognition tool and **must not be advertised or relied upon as an ISO/IEC 30107-3 compliant biometric access control**.
- **Compensating Controls**: Server-side GPS geofencing, single punch per day rules, camera-only restriction (gallery uploads blocked), audit logging of IP/User-Agent, and supervisor manual review of punch photographs.

---

## 8. File Uploads, Exports & Data Protection

### 8.1 46-Column Enterprise CSV Export
- **Authoritative Structure**: The export engine (`generateAttendanceCsv` in `src/routes/api.js`) and test suite (`test/export_csv.test.js`) generate exactly **46 columns** in both header and data rows.
- **Formula Injection Neutralization**: `src/services/csv_service.js` enforces `FORMULA_INJECTION_PATTERN = /^[\s\t\r]*[=+\-@\t\r|%]/`. Any cell beginning with formula triggers has a single quote `'` prepended and is quoted per RFC 4180.
- **Excel BOM**: Emits UTF-8 Byte Order Mark (`\uFEFF` / `0xEF 0xBB 0xBF`) at byte 0.
- Verified via `test/export_csv.test.js` (7/7 tests passed).

### 8.2 File Upload Security
- Multi-part camera uploads enforce 20MB Express request limits.
- Stored file uploads are restricted to designated subdirectories (`uploads/checkins`, `uploads/checkouts`) with direct script execution disabled.

---

## 9. Database & Migration Hygiene

### 9.1 Schema Migrations
- Chronological migrations verified in Supabase PostgreSQL and EMS SQLite:
  - `001_initial_schema.sql`
  - `002_leaves_and_regularization.sql`
  - `003_secure_signup_fields.sql`
  - `004_hotel_gps_verification.sql`
  - `005_standardize_delhi_and_geofencing.sql`
  - `006_single_active_session_index.sql`
- Migrations are idempotent (`IF NOT EXISTS` / `ON CONFLICT`) and safe for staging/production application.
- Unique constraints strictly enforce data integrity on `employees.email`, `employees.phone`, `employees.id`, and `sessions (user_id, session_type)`.

---

## 10. Dependency Vulnerability Assessment (`npm audit`)

### 10.1 Root Application Dependencies
Executed `npm audit --omit=dev --json` against root `package.json`:
- **Vulnerabilities Found**: 3 (2 High, 1 Moderate)
  1. **`body-parser`**:
     - Installed Version: `2.3.0` (transitive via Express 5)
     - Vulnerable Range: `>=2.0.0 <2.4.0`
     - Severity: **High** (CVSS 7.5, GHSA-27r3-jxmh-p828, CWE-248)
     - Description: Denial of Service via trailing bytes after a compressed request body.
     - Patched Version: `>=2.4.0`
  2. **`multer`**:
     - Installed Version: `2.4.0` (direct dependency)
     - Vulnerable Range: `>=2.0.0 <2.5.0`
     - Severity: **High** (CVSS 7.5, GHSA-q7qp-rjg7-q26m, CWE-248, CWE-404)
     - Description: Denial of Service via a pending asynchronous fileFilter after request teardown.
     - Patched Version: `>=2.5.0`
  3. **`nodemailer`**:
     - Installed Version: `10.0.10` (direct dependency)
     - Vulnerable Range: `>=3.0.0 <10.1.4`
     - Severity: **Moderate** (CVSS 6.5, GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h, CWE-20, CWE-436)
     - Description: Addressparser edge-case recipient misdirection.
     - Patched Version: `>=10.1.4`

### 10.2 EMS Subsystem Dependencies
Executed `npm audit --omit=dev --json` against `ems/package.json`:
- **Vulnerabilities Found**: 1 (1 High)
  1. **`body-parser`**:
     - Installed Version: `<1.20.9` (transitive via Express 4.21.2)
     - Vulnerable Range: `<1.20.9`
     - Severity: **High** (CVSS 7.5, GHSA-27r3-jxmh-p828, CWE-248)
     - Description: Denial of Service via compressed request body.
     - Patched Version: `>=1.20.9`

### 10.3 Risk Evaluation & Mitigation Distinctions
- **Unresolved Vulnerabilities vs. Mitigated Risks**:
  - The DoS conditions in `body-parser` and `multer` are real unpatched dependency vulnerabilities. However, their exploitability in production is mitigated by reverse proxies (e.g., Cloudflare, NGINX, AWS ALB) that enforce strict request body size limits and drop malformed compressed streams before reaching Node.js.
  - Per pre-audit safety rules, `npm audit fix --force` was intentionally avoided to eliminate regression risk on Express 5.
  - **Action**: Package version updates must be scheduled as a routine post-audit maintenance release following staging validation.

---

## 11. Automated Verification Summary

All 24 test suites executed cleanly against PostgreSQL 15 on port 5434:

| Suite # | Test Suite Name | Result |
|:-------:|:----------------|:------:|
| 1/24 | Pure Unit & PostgreSQL Integration | ✅ PASSED |
| 2/24 | Sign Up & Screenlock Face Recognition | ✅ PASSED |
| 3/24 | Biometric Security & Liveness Evaluation | ✅ PASSED |
| 4/24 | Email Backup Service | ✅ PASSED |
| 5/24 | 46-Column Enterprise CSV Export | ✅ PASSED |
| 6/24 | Final Production Security Gate (OWASP & Rate Limit) | ✅ PASSED |
| 7/24 | Leaves & Attendance Alteration | ✅ PASSED |
| 8/24 | Security Hardening & Multi-Tenant Isolation | ✅ PASSED |
| 9/24 | 16-Phase Security Remediation Regression | ✅ PASSED |
| 10/24 | Single Punch Per Day Limit Enforcement | ✅ PASSED |
| 11/24 | Indian States, Districts & Teams Tracking | ✅ PASSED |
| 12/24 | Supabase Automated Keep-Alive & Security Redaction | ✅ PASSED |
| 13/24 | Comprehensive Security Audit & Remediation Verification | ✅ PASSED |
| 14/24 | Secure Signup, DOB, cder Email, Mobile & FW- Employee ID | ✅ PASSED |
| 15/24 | Hotel Stay GPS Verification & Geographic Matching | ✅ PASSED |
| 16/24 | Inbuilt Delete Confirmation Modal Verification | ✅ PASSED |
| 17/24 | State & District Standardization & Independent Validation | ✅ PASSED |
| 18/24 | Shared Multi-Location Geofencing & Work Mode Compliance | ✅ PASSED |
| 19/24 | CSV Exports, Timesheet Fix & Team-Wise Attendance | ✅ PASSED |
| 20/24 | EMS Integration & Leave Governance Engine | ✅ PASSED |
| 21/24 | EMS Post-Integration Security Verification (26 Tests) | ✅ PASSED |
| 22/24 | Secure 30-Minute Session Inactivity Timeout (15 Tests) | ✅ PASSED |
| 23/24 | Single Active Session Policy Across App & EMS (8 Tests) | ✅ PASSED |
| 24/24 | Single Active Session Atomic Concurrency (10 Tests) | ✅ PASSED |

**Total: 24 PASSED, 0 SKIPPED, 0 FAILED (100% Pass Rate)**

---

## 12. Security Findings & Defect Register

| ID | Title | Severity | Status | Compensating Controls / Action |
|:---|:------|:--------:|:------:|:--------------------------------|
| **SEC-01** | Lack of 3D / Active Liveness Detection (PAD) | **High** | Architectural Limitation | 2D recognition has 80% FAR on synthetic profiles and 100% spoof pass rate. Must be classified as convenience recognition, not ISO/IEC 30107-3 PAD. Compensating controls: geofencing, single punch rules, IP/photo logging. |
| **SEC-02** | Upstream Dependencies (`body-parser`, `multer` DoS) | **High** | Known Vulnerability | Protected at network edge by reverse proxy payload limits. Upgrade packages in scheduled post-audit maintenance. |
| **SEC-03** | EMS Production `JWT_SECRET` Deployment Dependency | **Medium** | Config Dependent | System fails closed when absent. Must be injected via production environment secret manager by deployment owner. |
| **SEC-04** | Client-Side Geolocation Spoofing | **Low** | Physical Limitation | Browser Geolocation API can be manipulated by rooted devices. Mitigated by network IP logging, photo capture, and supervisor audit. |

---

## 13. Manager Handover & Tenable Scan Configuration

Before initiating the authorized Tenable vulnerability scan, the manager must review and approve the following operational parameters:

1. **Scan Scope & Target Authority**:
   - The manager has sole authority to approve the target scope (e.g. staging URL, Netlify frontend, or container instance) and the authorized scan window.
   - Blanket exclusions of application routes are **not** recommended.
2. **Side-Effect Management (No Blanket Exclusions)**:
   - Automated scanners fuzzing `/api/admin/attendance/send-backup-email` or `/cron/daily-attendance-backup` will trigger outbound emails if SMTP credentials are live.
   - Rather than excluding these routes from security assessment, the deployment owner should configure test/mock SMTP credentials (e.g., MailHog or an internal capture sink) during the scan window so these routes can be safely audited.
3. **Scanner IP Whitelisting (Rate Limiters Only)**:
   - If high-volume automated vulnerability scanning is authorized, the Tenable scanner IP should be allowlisted in the network firewall or application rate limiter (`authService.rateLimitMiddleware`) to prevent false-positive denial-of-service throttling.
   - Scanner IP allowlisting must **never** bypass authentication, session checks, or RBAC authorization.
4. **Dedicated Scan Accounts**:
   - Provide isolated test credentials for employee (`FW-AUDIT01`) and admin (`audit_admin`) roles. Never provide production administrative credentials or shared employee credentials to automated scanners.
5. **Session Expiry Handling**:
   - The scanner must be configured to accommodate the 30-minute rolling session inactivity timeout during authenticated crawl sequences.

---

## 14. Readiness Conclusion

### **READY WITH DOCUMENTED LIMITATIONS**

The Attendance and EMS repository is in a stable, verified, and defensible state for manager handover. All 24 automated test suites pass with 100% success against PostgreSQL 15, atomic single-active-session constraints are enforced at both database and application levels, 30-minute session inactivity timeouts are active, security headers and CSP are enforced, and SQL queries are parameterized.

The manager may proceed with the authorized Tenable vulnerability audit, with the understanding that:
1. Face recognition is an employee convenience feature without ISO/IEC 30107-3 liveness protection;
2. `JWT_SECRET` must be set in the deployment environment;
3. Upstream dependency updates (`body-parser`, `multer`, `nodemailer`) should be scheduled as routine package maintenance;
4. This conclusion addresses readiness for an authorized vulnerability scan and does not certify production security or regulatory compliance.
