# Phase 3: Backend & API Security Audit

## 1. Backend Architecture & Middleware Pipeline

The backend server is structured with a modular layer pattern separating route definitions, authentication middleware, business logic services, and database persistence:

```
[HTTP Request]
       │
       ▼
[server.js Middleware Pipeline]
  ├── Security Headers (nosniff, DENY, HSTS in prod, Strict CSP with frame-ancestors 'none')
  ├── CORS Origin Validator (Allowed origins allowlist, rejects unauthorized external origins)
  ├── express.json({ limit: '20mb' }) & express.urlencoded({ limit: '20mb' })
  └── express.static ('/uploads', 'public')
       │
       ▼
[src/routes/api.js]
  ├── Public Endpoints (Health, Organization details, Geo dictionaries)
  ├── Rate-Limited Auth Endpoints (Employee login/signup, Face unlock, Employer login)
  └── Protected Routes with Middleware:
       ├── requireAuthenticatedEmployee (Enforces employee identity from DB session)
       ├── requireAuthenticatedAdmin    (Enforces admin role and tenant isolation)
       └── requireAuthenticatedUser     (Allows valid employee OR admin)
       │
       ▼
[src/services/]
  ├── attendance_service.js (Single punch per day, geofencing, photo integrity, audit log)
  ├── auth_service.js       (scrypt password verification, rate limiting, password complexity)
  ├── biometric_service.js  (Cosine similarity matching, descriptor isolation)
  ├── geo_service.js        (Haversine math, GPS accuracy validation, velocity anomalies)
  ├── photo_service.js      (Magic byte inspection, SHA-256 hash, size validation)
  ├── session_service.js    (PostgreSQL session management, TTL expiry, revocation)
  ├── email_service.js      (SMTP daily backup dispatcher)
  └── storage_service.js    (Supabase private bucket signed URLs)
       │
       ▼
[src/db/database.js]
  └── PostgreSQL Connection Pool (pg) with parameterized queries ($1, $2, ...)
```

---

## 2. Complete API Endpoint Inventory & Security Matrix

All 56 registered endpoints evaluated across authentication requirements, authorized roles, input validation rules, and verified test status:

| # | Method | Endpoint | Authentication | Authorized Role | Validation Rules | Security Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `GET` | `/api/health` | Public | Any | None | **PASS** (Masked 500 error in prod) |
| 2 | `GET` | `/api/organization` | Public | Any | Resolves active employer profile | **PASS** (`admin_password` stripped) |
| 3 | `GET` | `/api/organizations` | Public | Any | Only active public organization list | **PASS** (Only safe columns returned) |
| 4 | `GET` | `/api/employees` | Authenticated | Admin | Filtered strictly by `req.employerId` | **PASS** (Multi-tenant isolated) |
| 5 | `DELETE`| `/api/employees/:id` | Authenticated | Admin | Cascade deletion of child records | **PASS** (Multi-tenant isolated) |
| 6 | `PUT` | `/api/employees/:id` | Authenticated | Admin | Sanitized name, dept, desig, active flag | **PASS** (Multi-tenant isolated) |
| 7 | `POST` | `/api/auth/employee/login` | Rate Limited | Public | Validates ID/email + password policy | **PASS** (Brute-force protected) |
| 8 | `GET` | `/api/auth/employee/check-id` | Public | Any | Checks ID format and uniqueness | **PASS** (Read-only existence check) |
| 9 | `POST` | `/api/auth/employee/signup` | Rate Limited | Public | Mandatory password policy (8+ chars) | **PASS** (scrypt hash, state/dist check) |
| 10 | `POST` | `/api/auth/employee/face-login` | Rate Limited | Public | Min 32-dim vector, similarity >= 0.75 | **PASS** (Demo bypass blocked in prod) |
| 11 | `POST` | `/api/auth/employee/enroll-face` | Authenticated | User / Admin | Cannot enroll other employees unless admin | **PASS** (Cross-employee blocked) |
| 12 | `GET` | `/api/auth/demo-face-credentials` | Public / Non-prod | Dev / Test | Strictly blocked in production mode | **PASS** (Returns HTTP 403 in prod) |
| 13 | `POST` | `/api/auth/employer/login` | Rate Limited | Public | Matches admin_username + scrypt hash | **PASS** (Brute-force protected) |
| 14 | `POST` | `/api/auth/logout` | Authenticated | Any Active | Revokes DB session token, clears cookie | **PASS** (Session invalidated) |
| 15 | `GET` | `/api/attendance/current` | Authenticated | Employee | Evaluates active or completed session | **PASS** (Strict employee isolation) |
| 16 | `POST` | `/api/attendance/check-in` | Authenticated | Employee | Real-time photo + GPS + single punch | **PASS** (Anti-replay SHA verified) |
| 17 | `GET` | `/api/location/preview` | Public (Rate-Ltd) | Any | Coordinates validated (-90..90, -180..180)| **PASS** (Masked error, bounds check) |
| 18 | `GET` | `/api/employee/hotel-stay/active`| Authenticated | Employee | Retrieves employee's active outstation stay | **PASS** (Strict employee isolation) |
| 19 | `POST` | `/api/employee/hotel-stay` | Authenticated | Employee | Required hotel name, address, check-in | **PASS** (Linked to employee record) |
| 20 | `POST` | `/api/employee/hotel-stay/checkout`| Authenticated | Employee | Closes active stay status to CHECKED_OUT | **PASS** (Ownership verified) |
| 21 | `GET` | `/api/admin/hotel-stays` | Authenticated | Admin | Scoped by `req.employerId` | **PASS** (Multi-tenant isolated) |
| 22 | `GET` | `/api/admin/employees/:id/hotel-stays`| Authenticated | Admin | Scoped by employee ID & employer ID | **PASS** (Tenant validated) |
| 23 | `POST` | `/api/attendance/break/start`| Authenticated | Employee | Requires active checked-in attendance | **PASS** (State machine validated) |
| 24 | `POST` | `/api/attendance/break/end` | Authenticated | Employee | Accumulates break duration | **PASS** (State machine validated) |
| 25 | `POST` | `/api/attendance/check-out` | Authenticated | Employee | Requires active checkin, fresh photo/GPS | **PASS** (Single checkout enforced) |
| 26 | `GET` | `/api/admin/attendance` | Authenticated | Admin | Filter by date, status, search, mode | **PASS** (Tenant isolated) |
| 27 | `GET` | `/api/admin/attendance/export.csv`| Authenticated | Admin | 46 enterprise columns, formula escape | **PASS** (Excel formula injection safe) |
| 28 | `POST` | `/api/admin/attendance/send-backup-email`| Authenticated | Admin | Triggers SMTP backup with CSV attachment| **PASS** (Admin only) |
| 29 | `GET` | `/api/cron/daily-attendance-backup`| Authenticated | Cron / Admin | Requires `CRON_SECRET` Bearer header | **PASS** (Unauthenticated blocked 401)|
| 30 | `GET` | `/api/admin/employees/:id/timesheet`| Authenticated | Admin | Scoped by employee and employer | **PASS** (Tenant isolated) |
| 31 | `GET` | `/api/admin/employees/:id/timesheet/export.csv`| Authenticated| Admin | Monthly cumulative timesheet export | **PASS** (Formula injection safe) |
| 32 | `GET` | `/api/admin/holidays` | Authenticated | Admin | Official organization holiday calendar | **PASS** (Tenant isolated) |
| 33 | `POST` | `/api/admin/holidays` | Authenticated | Admin | Adds gazetted/national holiday | **PASS** (Tenant isolated) |
| 34 | `DELETE`| `/api/admin/holidays/:id` | Authenticated | Admin | Deletes organization holiday | **PASS** (Tenant isolated) |
| 35 | `GET` | `/api/admin/leaves` | Authenticated | Admin | Retrieves leave applications / absences | **PASS** (Tenant isolated) |
| 36 | `POST` | `/api/admin/leaves/sync-unmarked`| Authenticated | Admin | Syncs unmarked absent days | **PASS** (Tenant isolated) |
| 37 | `POST` | `/api/admin/leaves` | Authenticated | Admin | Creates explicit employee leave record | **PASS** (Tenant isolated) |
| 38 | `PUT` | `/api/admin/leaves/:id` | Authenticated | Admin | Approves or rejects leave with remarks | **PASS** (Tenant isolated) |
| 39 | `DELETE`| `/api/admin/leaves/:id` | Authenticated | Admin | Deletes pending leave request | **PASS** (Tenant isolated) |
| 40 | `POST` | `/api/admin/attendance/alter` | Authenticated | Admin | Alters hours; mandatory audit reason | **PASS** (Audit logged) |
| 41 | `GET` | `/api/admin/attendance/matrix` | Authenticated | Admin | Calculates active attendance across states | **PASS** (Tenant isolated) |
| 42 | `GET` | `/api/admin/attendance/:id` | Authenticated | Admin | Detail with breaks and audit events | **PASS** (Tenant isolated) |
| 43 | `DELETE`| `/api/admin/attendance/:id` | Authenticated | Admin | Cascades break deletion and storage cleanup| **PASS** (Tenant isolated) |
| 44 | `GET` | `/api/attendance/photo-signed-url`| Authenticated | User / Admin | Generates signed URL (TTL: 3600s) | **PASS** (Path restricted) |
| 45 | `GET` | `/api/geo/states` | Public | Any | 36 Indian States and UTs | **PASS** (Read-only static dictionary) |
| 46 | `GET` | `/api/geo/districts` | Public | Any | Districts for specified state | **PASS** (Dictionary lookup) |
| 47 | `GET` | `/api/geo/states-districts` | Public | Any | Full hierarchy mapping | **PASS** (Dictionary lookup) |
| 48 | `GET` | `/api/teams` | Authenticated | Admin | Lists teams for employer | **PASS** (Tenant isolated) |
| 49 | `POST` | `/api/teams` | Authenticated | Admin | Creates territorial team with valid dist | **PASS** (Hierarchy validated) |
| 50 | `POST` | `/api/teams/assign` | Authenticated | Admin | Assigns employee to regional team | **PASS** (Tenant isolated) |
| 51 | `GET` | `/api/admin/audit-logs` | Authenticated | Admin | Chronological security audit logs | **PASS** (Tenant isolated) |
| 52 | `GET` | `/api/admin/settings` | Authenticated | Admin | Organization settings (office, geofence)| **PASS** (admin_password excluded) |
| 53 | `POST` | `/api/admin/settings` | Authenticated | Admin | Updates office, geofence, shift hours | **PASS** (Tenant isolated) |
| 54 | `POST` | `/api/settings/set-current-office`| Authenticated| Admin | Syncs office coordinates to device GPS | **PASS** (`admin_password` stripped) |
| 55 | `GET` | `/api/admin/redcap/records` | Authenticated | Admin | Lists external SQL sync records | **PASS** (Tenant isolated) |
| 56 | `GET` | `/api/admin/redcap/data-dictionary.csv`| Authenticated| Admin | REDCap metadata dictionary CSV | **PASS** (RFC 4180 compliant) |

---

## 3. Vulnerability Remediations Applied

### 3.1 VULN-BE-01: Excessive Data Exposure in `/settings/set-current-office`
- **Severity:** High (OWASP API3:2023 / CWE-200)
- **Root Cause:** Line 2595 executed `SELECT * FROM organizations WHERE id = $1` and returned `settings: updatedRes.rows[0]` directly to the client without stripping `admin_password`.
- **Remediation:** Destructured `admin_password` out of the organization object:
  ```javascript
  const updatedRes = await query('SELECT * FROM organizations WHERE id = $1', [req.employerId]);
  const { admin_password: _, ...safeSettings } = updatedRes.rows[0] || {};
  res.json({ success: true, message: 'Office location synchronized to your current GPS coordinates.', settings: safeSettings });
  ```
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 2 passed).

### 3.2 VULN-BE-02: Password Cross-Matching / Institutional Bypass
- **Severity:** High (OWASP A07:2021 / CWE-287)
- **Root Cause:** In `src/services/auth_service.js`, an `institutionalDefaults` array allowed any entered password in the list to match *any different* stored password in the list.
- **Remediation:** Removed the cross-matching array. Passwords must match the stored password using constant-time comparison or salted scrypt verification.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 1 passed).

### 3.3 VULN-BE-03: Unauthenticated Automated Cron Access
- **Severity:** Medium (OWASP API2:2023 / CWE-306, CWE-598)
- **Root Cause:** In `GET /cron/daily-attendance-backup`, if `CRON_SECRET` was not set, the authorization check was bypassed entirely, allowing unauthenticated triggers.
- **Remediation:** Enforced strict authorization: if `CRON_SECRET` is set, require `Authorization: Bearer <secret>`. If `CRON_SECRET` is not set, reject in production with HTTP 401. In non-production environments, require an active administrator session token.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 3 passed).

### 3.4 VULN-BE-04: Location Preview Missing Bounds & Error Disclosure
- **Severity:** Medium (OWASP API4:2023 / CWE-770, CWE-209)
- **Root Cause:** `GET /location/preview` did not validate coordinate bounds and exposed raw `err.message` in 500 error responses.
- **Remediation:** Added strict boundary checks (-90 <= lat <= 90, -180 <= lng <= 180, isFinite) and centralized error handling with `handleApiError`.
- **Verification:** Verified in `test/security_audit_remediation.test.js` (Test 4 passed).

### 3.5 VULN-BE-05: Health Check Error Information Disclosure
- **Severity:** Low (OWASP A05:2021 / CWE-209)
- **Root Cause:** `GET /health` catch block returned raw `err.message`, potentially disclosing internal database hostnames.
- **Remediation:** Masked error messages in production mode (`isProductionEnvironment() ? 'Database service temporarily unavailable.' : err.message`).
