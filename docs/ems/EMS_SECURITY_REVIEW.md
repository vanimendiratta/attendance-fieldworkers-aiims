# EMS Security Review & Hardening Assessment

## 1. Security Architecture Summary

The integrated Employee Management System enforces enterprise-grade security controls aligned with OWASP Top 10 web application security standards. Every data path connecting the frontend user interface to the backend SQLite data store is guarded by authentication, strict role checks, and parameterized SQL operations.

---

## 2. Threat Analysis & Mitigations

### 2.1 Broken Object Level Authorization (BOLA / IDOR)
- **Threat**: An employee changes `employee_id` or `request_id` in API requests to view, submit, or cancel another worker's leave.
- **Mitigation**:
  - In `leaveController.js`, `req.user.id` is extracted strictly from the verified session or JWT token.
  - Queries for personal balances and requests bind directly to `req.user.id`.
  - In cancellation routines, the database verifies that `leave_requests.employee_id = req.user.id`. If a mismatch occurs, the request aborts with `403 Forbidden`.

### 2.2 Privilege Escalation & Unauthorized Approvals
- **Threat**: A fieldworker issues a forged `POST /api/ems/admin/leave/review` payload to approve their own or a peer's leave request.
- **Mitigation**:
  - All admin routes are guarded by `requireAdmin` middleware.
  - Tokens belonging to `role: 'employee'` are rejected with `403 Forbidden: Insufficient administrative privileges`.
  - Anti-self-approval validation prevents administrators from approving requests where `request.employee_id === reviewer.id`.

### 2.3 SQL Injection
- **Threat**: Malicious input in search filters, leave reasons, or dates injected into SQL queries.
- **Mitigation**:
  - All database interactions use `better-sqlite3` prepared statements with named or positional parameters (`db.prepare('...').run(?)`).
  - No string concatenation is used in query composition.

### 2.4 Mass Assignment & Parameter Tampering
- **Threat**: Attackers supply extra payload parameters (e.g., `status: 'APPROVED'`, `days_requested: 0`) during leave application submission.
- **Mitigation**:
  - Controllers explicitly destructure and whitelist input fields (`{ leave_type, start_date, end_date, is_half_day, reason }`).
  - Request status is unconditionally set to `'PENDING'` by the server.
  - Deductible days are computed authoritatively by `LeaveRuleEngine` on the backend, ignoring any client-provided day counts.

### 2.5 State and District Data Isolation
- **Threat**: A state-level administrator attempts to view or approve leave applications for staff in another state.
- **Mitigation**:
  - The administrator's authorized `state` and `district` are verified against the employee's assigned territory.
  - Out-of-jurisdiction requests return `403 Forbidden`.

---

## 3. Audit Logging & Immutable Ledger

- Every balance debit or credit is logged in `leave_transactions` with timestamps, transaction type, reason, and initiating user.
- Administrative reviews are permanently logged with reviewer ID, timestamp, and review remarks.
- The double-entry ledger ensures that historical balance integrity can be independently audited and proven mathematically at any time.

---

## 4. UI Quality & Asset Sanitization

- The production linter (`scripts/lint.js`) enforces strict coding and asset standards across all 47 repository JavaScript files and 13 UI assets.
- 0 emojis or informal Unicode symbols are permitted in public UI assets, guaranteeing a dignified, professional appearance for AIIMS CDER.
