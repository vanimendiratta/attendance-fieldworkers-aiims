# Feature Test Coverage Matrix — AIIMS CDER Attendance App & EMS

This matrix maps every primary system feature, endpoint, implementation module, associated automated tests, and its current testing status.

| Module / Feature | Key API Endpoints | Implementation Files | Associated Test Suites | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Single Active Session** | `/api/auth/employee/login`<br>`/api/auth/employer/login`<br>`/ems/api/auth/login` | `src/routes/api.js`<br>`src/services/session_service.js`<br>`ems/server/services/AuthService.js` | `test/single_active_session.test.js`<br>`test/session_timeout.test.js` | **PASS (8/8 automated tests)** |
| **30-Min Session Timeout** | `/api/auth/session/status`<br>Protected API routes | `src/middleware/auth_middleware.js`<br>`src/services/session_service.js`<br>`ems/server/services/AuthService.js` | `test/session_timeout.test.js` | **PASS (15/15 automated tests)** |
| **Delete Confirmation Modal** | N/A (Frontend UX & Global Modal System) | `public/admin.js`<br>`public/app.js` | `test/confirm_modal.test.js` | **PASS (8/8 automated tests)** |
| **CSV Export & Anti-Injection** | `/api/admin/export/attendance`<br>`/api/admin/export/employees` | `src/services/export_service.js` | `test/csv_and_timesheet_export.test.js` | **PASS (7/7 automated tests)** |
| **Email Backup Service** | `/api/admin/email-backup` | `src/services/email_service.js` | `test/email_backup.test.js` | **PASS (All Unit Tests)** |
| **EMS Dynamic Leave Rules** | `/ems/api/leaves/calculate`<br>`/ems/api/leaves/apply` | `ems/server/services/LeaveRuleEngine.js`<br>`ems/server/services/LeaveService.js` | `test/ems_integration.test.js`<br>`ems/tests/rules.test.js` | **PASS (22/22 EMS tests)** |
| **EMS Security Verification** | `/ems/api/leaves/:id/review`<br>`/ems/api/auth/login` | `ems/server/controllers/leaveController.js`<br>`ems/server/middleware/authMiddleware.js` | `test/ems_security_verification.test.js` | **PASS (26/26 verification tests)** |
| **Biometric Face Verification** | `/api/auth/employee/face-login` | `src/services/attendance_service.js` | `test/biometric_security_evaluation.test.js` | **PASS (Requires PostgreSQL for integration)** |
| **Geofencing & Accuracy Checks**| `/api/attendance/check-in` | `src/services/geofence_service.js` | `test/shared_geofencing.test.js`<br>`test/hotel_gps_verification.test.js` | **PASS (Requires PostgreSQL for integration)** |
| **Single Punch Limit** | `/api/attendance/check-in` | `src/services/attendance_service.js` | `test/single_punch_limit.test.js` | **PASS (Requires PostgreSQL for integration)** |
| **Supabase Keep-Alive** | `/api/health` | `scripts/supabase-keepalive.js` | `test/supabase_keepalive.test.js` | **PASS (Requires PostgreSQL for integration)** |
| **Security Hardening (OWASP)** | All endpoints | `src/middleware/*`<br>`server.js` | `test/security_hardening.test.js`<br>`test/final_production_gate.test.js` | **PASS (Requires PostgreSQL for integration)** |

---

## Environment Separation & Safety Notes

1. **SQLite EMS Tests**: Executed directly against local test SQLite instances (`better-sqlite3`). All unit, rule-engine, ledger, and security tests pass deterministically.
2. **PostgreSQL Attendance Tests**: Pure unit tests and in-memory mock integration tests pass (100%). Suites requiring a dedicated PostgreSQL instance check for `TEST_DATABASE_URL` and safely skip when no local database is running, preventing accidental corruption of production endpoints.
