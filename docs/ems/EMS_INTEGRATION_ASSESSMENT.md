# EMS Integration Assessment & Architectural Plan
**AIIMS CDER Fieldworker Attendance & Employee Management System (EMS)**
*Assessment Date: 2026-10-21*

---

## 1. Executive Summary

This assessment audits the newly added `ems/` module within the **AIIMS CDER Fieldworker Attendance App** repository (`vanimendiratta/attendance-fieldworkers-aiims`). The goal is to seamlessly integrate the EMS (Employee Management & Leave Governance System) into the existing attendance application under a unified, prominent **Employee Management** tab.

The integration enables:
1. **Employees** to access their personal EMS dashboard, check real-time leave balances (CL, EL, RH, Comp-Off), preview chargeable days, apply for leave, track request statuses, and view double-entry ledger history.
2. **Administrators** to review pending leave applications, approve/reject/request corrections with remarks, monitor team leave registers, manage leave policies and credit schedules, and review audit logs.
3. **Unified Identity**: Single sign-on and consistent employee mapping linking attendance records, field location/GPS records, hotel stays, and EMS leave records without duplicate accounts.

---

## 2. EMS Folder Inventory

The `ems/` folder contains a complete, production-grade leave governance application:

```
ems/
├── CDER Staff Details and Leave Rules & Record.docx   # Official AIIMS CDER Staff & Leave Rules document
├── package.json                                       # Standalone package manifest (Express 4, better-sqlite3, bcryptjs, jwt)
├── package-lock.json
├── README.md                                          # Architectural & policy specification
├── data/
│   ├── cder_extracted_data.json                       # 33 CDER staff records extracted from docx
│   ├── ems.sqlite                                     # SQLite production database with seeded master rules & CDER data
│   ├── ems_test.sqlite                                # Test database fixture
│   ├── ems.sqlite-shm & ems.sqlite-wal                # SQLite WAL journal files
├── server/
│   ├── index.js                                       # Standalone Express server on port 3000
│   ├── database/
│   │   ├── db.js                                      # better-sqlite3 instance configured with WAL mode & foreign keys
│   │   ├── migrate.js                                 # Migration runner
│   │   ├── seed.js                                    # Master rules, holidays, sandwich policies, and CDER seed
│   │   ├── extract_cder_docx.py                       # Python docx extraction script
│   │   ├── importCderData.js                          # Node import pipeline for CDER data
│   │   └── migrations/
│   │       ├── 001_initial_schema.sql                 # Base tables (users, employees, leave_types, rules, ledger, requests, comp-off)
│   │       ├── 002_field_worker_history.sql           # Field worker duty history tracking
│   │       ├── 003_cder_policy_and_schema.sql         # CDER policy extensions & metadata
│   │       └── 004_field_location.sql                 # Field location tracking
│   ├── middleware/
│   │   ├── authMiddleware.js                          # JWT-based requireAuth, requireAdmin, enforceEmployeeScope
│   │   └── rateLimiter.js                             # In-memory sliding window rate limiter
│   ├── routes/
│   │   └── api.js                                     # Express router with 30+ endpoints
│   ├── services/
│   │   ├── LeaveRuleEngine.js                         # Server-authoritative calculation engine (31KB, pro-rata, sandwich, weekly offs)
│   │   ├── LeaveLedgerService.js                      # Double-entry ledger (credits, debits, reversals, balances)
│   │   ├── LeaveCreditScheduler.js                    # Automated bi-annual EL and annual CL scheduler
│   │   ├── CderImportService.js                       # CDER docx parsing & reconciliation service
│   │   ├── AuthService.js                             # User authentication, password hashing, and token issuance
│   │   ├── AuditService.js                            # Immutable audit log recording
│   │   ├── NotificationService.js                     # In-app notifications
│   │   └── EmailService.js                            # SMTP email transport service
│   └── controllers/
│       ├── authController.js, employeeController.js, leaveRequestController.js,
│       ├── leaveLedgerController.js, leaveRuleController.js, leaveTypeController.js,
│       ├── compOffController.js, holidayController.js, weeklyOffController.js,
│       ├── sandwichRuleController.js, reportController.js, auditController.js, notificationController.js
├── public/
│   ├── index.html                                     # SPA shell with Inter typography & SVG icon containers
│   ├── css/
│   │   └── style.css                                  # Pure Vanilla CSS design system (tokens, tables, cards, modals, toasts)
│   └── js/
│       ├── api.js                                     # API client with token storage and Toast alerts
│       ├── app.js                                     # Full SPA client (190KB) with live calculation preview & administrative panels
│       └── icons.js                                   # Inline SVG icons (zero emojis)
└── tests/
    ├── leaveRuleEngine.test.js                        # 8 tests: CL, EL, RH, Comp-off, sandwich, pro-rata
    ├── leaveWorkflowAndScheduler.test.js              # 4 tests: validation, overlap, credit cycles, sandwich
    ├── auditAndDynamicRuleVerification.test.js        # 5 tests: rule resolution, ledger balance integrity, comp-off toggle
    └── cderPolicyAndImport.test.js                    # 5 tests: CDER joining cutoffs, idempotency, balance reconciliation
```

---

## 3. Technology Stack & Comparison

| Aspect | Parent Attendance App | Standalone EMS | Integration Strategy |
|---|---|---|---|
| **Backend Framework** | Node.js, Express 5.2.1 | Node.js, Express 4.21.2 | Mount EMS API router directly inside the parent Express 5 app at `/api/ems`. Both run on the same server process. |
| **Database** | SQLite `better-sqlite3` locally (`attendance.db`), PostgreSQL (`pg`) in production | SQLite `better-sqlite3` (`ems/data/ems.sqlite`) | Use unified data access layer: shared database with unified schema; seamlessly bridge employee identities across attendance and leave tables. |
| **Authentication** | Session-token backed by DB / JWT (`requireAuthenticatedEmployee`, `requireAuthenticatedAdmin`) | JWT (`requireAuth`, `requireAdmin`, `enforceEmployeeScope`) | Unified auth middleware adapter: allow parent auth tokens (session/JWT) to authenticate EMS requests seamlessly. |
| **Frontend UI** | Vanilla CSS, Leaflet Maps, Inline SVG Icons | Vanilla CSS, Inline SVG Icons | Embed EMS components into dedicated **Employee Management** tabs in both `index.html` (Employee Portal) and `admin.html` (Admin Portal). |
| **Employee ID Scheme** | `EMP-...` / `FW-...` (e.g. `FW-BGLWPZ`, `EMP-1001`) | `SYS-CDER-xxx` / `EMPxxx` | Dual ID reconciliation: Map internal `employee_id` and canonical email (`*cder*@gmail.com`). |

---

## 4. Database Schemas & Relationships

EMS introduces a relational leave governance schema:
- **`leave_types`**: Codes (`CL`, `EL`, `RH`, `COMP_OFF`), entitlement limits, half-day allowances.
- **`leave_rules` & `leave_rule_versions`**: Dynamic policies versioned by effective date ranges (`effective_from` / `effective_to`).
- **`leave_transactions`**: Double-entry ledger recording all credits, deductions, reversals, and adjustments with running balances.
- **`leave_balances`**: Cached year-wise balances (`opening_balance`, `credited_amount`, `used_amount`, `pending_amount`, `current_balance`).
- **`leave_requests`**: From/To dates, requested calendar days, weekly offs, holidays, sandwich days, chargeable days, status (`PENDING`, `APPROVED`, `REJECTED`, `HOLD`, `CANCELLED`), snapshot JSON.
- **`leave_request_status_history`**: Audit trail of all state transitions and reviewer remarks.
- **`holidays`**: Public and Restricted Holidays (RH) by date, location, and department.
- **`weekly_off_rules`**: 5-day vs 6-day work weeks (Sunday-only for field workers; Saturday & Sunday for general staff).
- **`sandwich_rules`**: Configurable rules charging intervening weekends/holidays when leave precedes and succeeds them.
- **`comp_off_records`**: Earned Sunday/Holiday duties for field workers with 1-month validity.
- **`employee_field_status_history`**: History of field worker status for date-accurate comp-off eligibility.
- **`cder_leave_records`**: Official CDER baseline records extracted from the master document.

---

## 5. Duplicate Functionality & Conflicting Implementations

1. **Leave Management in Admin Portal**:
   - The parent app currently has a basic `#viewLeave` panel in `admin.html` used for **Attendance Regularization** (marking unmarked field staff on leave for a specific day).
   - EMS provides a **Full Enterprise Leave Governance System** (multi-day requests, live calculation preview, balance checking, sandwich rules, double-entry ledger, approval workflows).
   - **Resolution**: Keep `#viewLeave` for attendance day-roster regularization, and create a prominent, dedicated **Employee Management** tab (`#viewEmsAdmin` in `admin.html` and `#tabNavEms` / `#panelEms` in `index.html`).
2. **Authentication Systems**:
   - Both systems implement JWT / bearer auth. The parent app uses `attendance_session` / Bearer token.
   - **Resolution**: Create an Auth Bridge in `server/middleware/authMiddleware.js` so that requests bearing the parent app's token are verified against both parent sessions/tokens and EMS user records.

---

## 6. Recommended Integration Architecture

```
                          AIIMS CDER Web Application
                  ┌────────────────────────────────────────┐
                  │          Express 5 Server (server.js)  │
                  └───────────────────┬────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
      /api/ (Attendance & Auth)                     /api/ems/ (Leave Governance)
  ┌───────────────────────┐                       ┌───────────────────────┐
  │ - /api/auth/*         │                       │ - /api/ems/leave/*    │
  │ - /api/attendance/*   │                       │ - /api/ems/ledger/*   │
  │ - /api/hotel-stays/*  │                       │ - /api/ems/comp-off/* │
  │ - /api/teams/*        │                       │ - /api/ems/rules/*    │
  │ - /api/geofences/*    │                       │ - /api/ems/holidays/* │
  └───────────┬───────────┘                       └───────────┬───────────┘
              │                                               │
              └───────────────────────┬───────────────────────┘
                                      │
                         Unified Application Data
             ┌─────────────────────────────────────────────────┐
             │ - Shared Employee Identity (Email / ID)         │
             │ - Attendance & Field Duty Tracking              │
             │ - Leave Rules & Double-Entry Ledger             │
             └─────────────────────────────────────────────────┘
```

---

## 7. Implementation Tasks & Dependencies

1. **Phase 2 & 3: Mount EMS Backend & Navigation Tab**
   - Mount EMS API router at `/api/ems` in `server.js` with session-compatible auth bridge.
   - Add **Employee Management** navigation tab to `public/index.html` (Employee Portal) and `public/admin.html` (Admin Portal).
2. **Phase 4 & 5: Employee EMS View**
   - Render Leave Balances (CL, EL, RH, Comp-Off), Leave History, and Live Leave Application Form with calculation preview.
3. **Phase 6: Administrator EMS View**
   - Render Pending Leave Requests, Filterable Leave Register, Approval/Rejection Modal with remarks, and Policy Settings.
4. **Phase 7 & 8: Database & Identity Reconciliation**
   - Ensure tables are created, seeded, and accessible. Reconcile employees between attendance and EMS records.
5. **Phase 9, 10, 11: Security, UI Consistency & Comprehensive Tests**
   - Validate RBAC, scope enforcement, zero-emoji compliance, and run complete test suite.
