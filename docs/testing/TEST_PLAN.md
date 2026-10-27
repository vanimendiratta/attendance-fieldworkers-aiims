# Test Plan: Comprehensive Verification & Audit — AIIMS CDER Attendance App & EMS

## 1. Executive Summary & Objective

This document establishes the authoritative test strategy, architectural inventory, validation scope, and acceptance criteria for the entire **AIIMS CDER Real-Time Attendance System** and its integrated **Employee Management System (EMS)**.

The objective is to guarantee end-to-end functionality, high-assurance security, relational database integrity, strict authorization boundary enforcement, and regression resilience without modifying production code merely to pass tests or weakening established security controls.

---

## 2. System Architecture & Component Mapping

| Subsystem | Components & Services | Primary Storage | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Attendance Backend** | `server.js`, `src/routes/api.js`, `src/services/*`, `src/middleware/auth_middleware.js` | PostgreSQL | Employee authentication, face liveness/matching, geofencing, punches, timesheets, exports, session store |
| **Attendance Frontend** | `public/index.html`, `public/app.js`, `public/admin.html`, `public/admin.js`, modals | Browser DOM / Canvas | Single-page UI, live camera facial unlock, geolocation capture, confirm modals, timesheet viewing |
| **EMS Backend** | `ems/server/index.js`, `ems/server/controllers/*`, `ems/server/services/*`, `ems/server/middleware/*` | SQLite (`better-sqlite3`) | Double-entry leave ledger, statutory policy rule engine, credit scheduler, sandwich rules, audit trail |
| **EMS Frontend** | `ems/public/index.html`, `ems/public/js/app.js`, `ems/public/js/api.js` | Browser DOM | Employee leave application, status tracker, admin approval/rejection console, balance audit ledger |
| **Auth Bridge** | `ems/server/middleware/authMiddleware.js`, `src/services/session_service.js` | Hybrid (PG / SQLite) | Cross-system session resolution, 30-min inactivity timeout sync, single active session per user |

---

## 3. Comprehensive Feature Inventory

### Feature 1: Authentication & Single Active Session Policy
- **Files**: `src/routes/api.js`, `src/services/session_service.js`, `ems/server/services/AuthService.js`, `ems/server/middleware/authMiddleware.js`
- **Endpoints**: `/api/auth/employee/login`, `/api/auth/employee/face-login`, `/api/auth/employer/login`, `/ems/api/auth/login`, `/api/auth/logout`
- **Key Invariants**:
  - Maximum 1 active session per user across all devices/browsers.
  - Concurrent login on a second device is rejected with HTTP 409 (`ACTIVE_SESSION_EXISTS`).
  - Rejected second login must leave the existing active session completely intact.
  - Server-side 30-minute inactivity timeout. Background polling (`X-Background-Request: true`) does not slide the inactivity window.
  - Explicit logout immediately revokes the session token server-side.

### Feature 2: Biometric Face Unlock & Anti-Spoofing Liveness
- **Files**: `src/services/attendance_service.js`, `src/routes/api.js`, `test/biometric_security_evaluation.test.js`
- **Endpoints**: `/api/auth/employee/face-login`, `/api/attendance/check-in`
- **Key Invariants**:
  - Euclidean distance threshold ($\le 0.45$) for 128-dimensional biometric descriptor matching.
  - Rejection of synthetic, null, or out-of-bounds face vectors.
  - SHA-256 integrity hashing of captured photos.

### Feature 3: Geofencing, GPS Accuracy & Multi-Location Compliance
- **Files**: `src/services/geofence_service.js`, `test/shared_geofencing.test.js`, `test/hotel_gps_verification.test.js`
- **Endpoints**: `/api/attendance/check-in`, `/api/attendance/check-out`, `/api/hotel-stays`
- **Key Invariants**:
  - Haversine distance calculations verified against configurable geofence radii.
  - GPS accuracy threshold ($< 100$ meters) enforcement.
  - Field worker hotel stays requiring verifiable geographic coordinates.

### Feature 4: Attendance State Machine & Single Punch Per Day
- **Files**: `src/services/attendance_service.js`, `test/single_punch_limit.test.js`
- **Endpoints**: `/api/attendance/check-in`, `/api/attendance/check-out`
- **Key Invariants**:
  - Exactly one check-in allowed per calendar day unless admin alteration is granted.
  - Checkout cannot precede checkin; duration computed accurately in hours and minutes.

### Feature 5: EMS Dynamic Rule Engine & Double-Entry Leave Ledger
- **Files**: `ems/server/services/LeaveRuleEngine.js`, `ems/server/services/LeaveService.js`
- **Endpoints**: `/ems/api/leaves`, `/ems/api/leaves/apply`, `/ems/api/leaves/:id/review`
- **Key Invariants**:
  - Double-entry accounting: Every grant, debit, or reversal produces a discrete transaction row.
  - Sum of ledger transactions strictly equals cached `leave_balances.current_balance`.
  - Casual Leave (CL) excludes weekly offs (Sundays) and gazetted holidays.
  - Earned Leave (EL) prorated monthly (2.5 days per month).
  - Compensatory Off restricted to active Field Workers.
  - Self-approval strictly prohibited for all administrators.

### Feature 6: Data Export, Backup & Formula Injection Defense
- **Files**: `src/services/export_service.js`, `test/csv_and_timesheet_export.test.js`, `test/email_backup.test.js`
- **Endpoints**: `/api/admin/export/attendance`, `/api/admin/export/employees`, `/api/admin/export/timesheet`
- **Key Invariants**:
  - UTF-8 BOM (`\uFEFF`) prefix for international and Excel character compatibility.
  - Prefixing formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`, `|`, `%`) with `'` to prevent CSV formula injection.
  - Strict omission of sensitive fields (passwords, PINs, biometric embeddings) from CSV exports.

---

## 4. Test Types & Execution Strategy

1. **Pure Unit Tests**: Validate algorithms, math formulas (Haversine, prorated leave, timesheet balances), and validation schemas in memory.
2. **Component Integration Tests**: Exercise Express middleware, route chains, session storage, and SQLite-backed EMS workflows.
3. **Security Invariant Tests**: Verify authentication guards, role-based access control, SQL injection resistance, and rate limiting.
4. **PostgreSQL Database Integration Tests**: Test PostgreSQL migrations, constraints, and relational queries using a dedicated, isolated test database (`TEST_DATABASE_URL`).
5. **Regression Verification**: Ensure bug fixes (single active session, 30-minute inactivity timeout, delete confirmation modals, CSV escaping) remain stable.

---

## 5. Acceptance Criteria

- Zero failures across all unit and integration test suites.
- 100% compliance with Single Active Session per user policy across both systems.
- 100% compliance with 30-minute session inactivity timeout.
- Clean production linter check (`npm run lint`).
- Documented testing inventory, matrix, execution report, and defect logs.
