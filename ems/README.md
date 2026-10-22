# Employee Management System (EMS) — Leave Governance

A dynamic, database-driven, rule-based, and auditable Employee Leave Management System built for enterprise and government administration.

## Key Principles & Architecture

* **Database as Source of Truth**: No hardcoded entitlements, rules, or balances in application code.
* **Date of Joining (DOJ) Aware**: Automatically computes full-year vs mid-year pro-rata and completed-month entitlements upon onboarding.
* **Centralized Rule Engine (`LeaveRuleEngine`)**: Server-authoritative calculations for chargeable days, holiday/weekly-off exclusions, sandwich rule evaluation, and eligibility checks.
* **Double-Entry Leave Ledger**: Every credit, deduction, reversal, and adjustment is recorded with running balances and verified against cached totals.
* **Rule Versioning**: Historical leave requests retain their original calculation snapshot and rule version even if policies evolve in future years.
* **Automated & Idempotent Credit Schedules**: Automated cycles (Annual CL, Bi-annual EL on 1 Jan & 1 Jul) protected by unique cycle execution keys.
* **Field Worker & Comp-Off Governance**: Rule-based duty tracking and compensatory off approval workflows.
* **Immutable Audit Trail & Notifications**: Database-driven notification templates and audit logs for all administrative actions.

---

## Tech Stack

* **Backend**: Node.js, Express, `better-sqlite3` (WAL mode, relational integrity, ACID transactions)
* **Authentication**: JWT, bcryptjs, role-based access control, temporary credentials & mandatory first-login password update
* **Frontend**: Vanilla CSS Design System (Inter typography, crisp inline SVG icons, zero emojis), Single Page Application architecture with live calculation preview
* **Testing**: Node.js test runner (`node --test`) with 12 automated unit & integration tests

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migrations & Seed Initial Master Data
```bash
npm run seed
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start the Application Server
```bash
npm start
```
The application will be accessible at: `http://localhost:3000`

---

## Pre-seeded Accounts for Testing

| Role | Username / ID | Password | Notes |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@ems.gov.in` | `Admin@EMS2026!` | Full administrative console access |
| **Employee (General)** | `EMP001` | `Emp@123456` | Dr. Rajesh Kumar (Senior Medical Officer) |
| **Employee (Field Worker)** | `EMP002` | `Emp@123456` | Anita Sharma (Field Epidemiologist, Comp-Off eligible) |

---

## Initial Configurable Policies

* **Casual Leave (CL)**: Annual entitlement 8 days (alternate 10 days for staff without 17 holidays), max continuous 5 days, weekly offs/holidays excluded, configurable mid-year joining (`PRO_RATA`).
* **Earned Leave (EL)**: Annual entitlement 30 days, credited 15 days on 1 Jan and 15 days on 1 Jul, accumulation ceiling 300 days, max continuous 180 days, completed month rate: 2.5 days/month.
* **Weekly Offs**: Saturday & Sunday for General staff, Sunday only for Field workers.
* **Sandwich Policy**: Configurable rule engine for charging intervening weekly offs and holidays.
