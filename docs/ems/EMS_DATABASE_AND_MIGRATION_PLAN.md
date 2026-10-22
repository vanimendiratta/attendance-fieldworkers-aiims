# EMS Database Schema, Migration & Data Reconciliation Plan
**AIIMS CDER Fieldworker Attendance & Leave Management Integration**
*Document Version: 1.0 | Date: 2026-10-21*

---

## 1. Database Architecture & Dual Storage Overview

The application utilizes a robust database architecture:
- **Local Development / Edge Mode**: SQLite database using `better-sqlite3` in WAL mode with foreign keys enabled (`attendance.db` and `ems/data/ems.sqlite`).
- **Production Cloud Deployment (Render / Supabase)**: PostgreSQL connection pool managed via `pg` (`DATABASE_URL`).
- **Integrity Guarantee**: All leave transactions adhere to double-entry ledger bookkeeping. Every credit, debit, reversal, and adjustment is recorded with running balances verified against cached balance totals.

---

## 2. Integrated Schema & Relational Model

```
       [organizations]
             │ 1
             │
             │ N
        [employees] ◄────────────────────────────────────────┐
             │                                               │
             ├─────────────────┬──────────────┐              │
             │ 1               │ 1            │ 1            │ 1
             │                 │              │              │
             │ N               │ N            │ N            │ N
       [attendance]      [hotel_stays]  [leave_requests] [leave_balances]
                                              │              │
                                              │ N            │ 1
                                              ▼              ▼
                                     [leave_transactions] ───┘
                                              ▲
                                              │ N
                                              │ 1
                                     [leave_types]
                                              │ 1
                                              │ N
                                     [leave_rules]
                                              │ 1
                                              │ N
                                     [leave_rule_versions]
```

### Table Definitions

1. **`leave_types`**:
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `code` TEXT UNIQUE NOT NULL (`CL`, `EL`, `RH`, `COMP_OFF`, `MATERNITY`, `PATERNITY`)
   - `name` TEXT NOT NULL
   - `is_paid` INTEGER DEFAULT 1
   - `requires_approval` INTEGER DEFAULT 1
   - `allow_half_day` INTEGER DEFAULT 1
   - `min_days_per_request` REAL DEFAULT 0.5
   - `max_days_per_request` REAL
   - `is_active` INTEGER DEFAULT 1

2. **`leave_rules` & `leave_rule_versions`**:
   - Versioned policy rules capturing calculation parameters (`annual_entitlement`, `max_continuous_days`, `charge_weekly_offs`, `sandwich_rule_id`).
   - Ensures historical leave requests retain their exact snapshot calculation even if rules evolve in future years.

3. **`leave_transactions` (Double-Entry Ledger)**:
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `employee_id` TEXT NOT NULL (references `employees.employee_id`)
   - `leave_type_id` INTEGER NOT NULL
   - `transaction_type` TEXT CHECK (`INITIAL_CREDIT`, `PERIODIC_CREDIT`, `LEAVE_DEDUCTION`, `LEAVE_REVERSAL`, `ADMIN_ADJUSTMENT`, `COMP_OFF_CREDIT`, `COMP_OFF_DEDUCTION`, `EXPIRY`, `CORRECTION`)
   - `amount` REAL NOT NULL (positive for credits/reversals, negative for deductions)
   - `running_balance` REAL NOT NULL
   - `reference_id` TEXT (e.g. request_number, cycle_key)
   - `rule_version_id` INTEGER
   - `remarks` TEXT
   - `created_by` TEXT DEFAULT 'SYSTEM'
   - `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

4. **`leave_balances`**:
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `employee_id` TEXT NOT NULL
   - `leave_type_id` INTEGER NOT NULL
   - `year` INTEGER NOT NULL
   - `opening_balance` REAL DEFAULT 0
   - `credited_amount` REAL DEFAULT 0
   - `used_amount` REAL DEFAULT 0
   - `pending_amount` REAL DEFAULT 0
   - `adjusted_amount` REAL DEFAULT 0
   - `current_balance` REAL DEFAULT 0
   - `last_transaction_id` INTEGER
   - UNIQUE(`employee_id`, `leave_type_id`, `year`)

5. **`leave_requests`**:
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `request_number` TEXT UNIQUE NOT NULL (e.g. `LEV-202610-0042`)
   - `employee_id` TEXT NOT NULL
   - `leave_type_id` INTEGER NOT NULL
   - `from_date` DATE NOT NULL
   - `to_date` DATE NOT NULL
   - `is_half_day` INTEGER DEFAULT 0
   - `half_day_session` TEXT CHECK (`FIRST_HALF`, `SECOND_HALF`, NULL)
   - `requested_calendar_days` REAL NOT NULL
   - `weekly_off_days` REAL DEFAULT 0
   - `holiday_days` REAL DEFAULT 0
   - `sandwich_days` REAL DEFAULT 0
   - `chargeable_days` REAL NOT NULL
   - `reason` TEXT NOT NULL
   - `supporting_document_url` TEXT
   - `status` TEXT DEFAULT 'PENDING' CHECK (`PENDING`, `APPROVED`, `REJECTED`, `HOLD`, `CANCELLED`)
   - `rule_version_id` INTEGER
   - `calculation_snapshot_json` TEXT NOT NULL
   - `reviewed_by` TEXT
   - `reviewed_at` DATETIME
   - `review_remarks` TEXT

6. **`comp_off_records`**:
   - `id` INTEGER PRIMARY KEY AUTOINCREMENT
   - `employee_id` TEXT NOT NULL
   - `worked_date` DATE NOT NULL
   - `qualifying_day_type` TEXT CHECK (`SUNDAY`, `SATURDAY`, `HOLIDAY`, `EMERGENCY_DUTY`)
   - `credited_days` REAL DEFAULT 1.0
   - `expiry_date` DATE
   - `reason` TEXT
   - `status` TEXT DEFAULT 'PENDING' CHECK (`PENDING`, `APPROVED`, `REJECTED`, `AVAILED`, `EXPIRED`)

7. **`employee_field_status_history`**:
   - Tracks historical transitions between `FIELD_WORKER` (comp-off eligible) and `HOSPITAL_DUTY` (no comp-off) with date bounds (`effective_from`, `effective_to`).

---

## 3. Employee Identity Reconciliation

To reconcile accounts between attendance and EMS:
1. **Primary Match Key**: Verified Email address (`email`). All registered AIIMS CDER staff possess unique institutional email addresses containing `cder`.
2. **Secondary Match Key**: System Employee ID (`employee_id` / `id`).
3. **Automatic Profile Sync**: If an authenticated employee accesses the EMS tab and exists in `attendance.employees` but not yet in `ems.employees`, a synchronization hook automatically creates their profile and initializes pro-rata leave balances using their Date of Joining (`date_of_joining` or account creation date).
4. **Data Preservation**: Historical leave records, ledger balances, and check-in records are never deleted or overridden.

---

## 4. Migration Execution & Rollback Strategy

### Migration Execution
1. Migrations are executed idempotently in strict alphabetical order via `ems/server/database/migrate.js`.
2. All schema changes are wrapped in atomic transactions (`BEGIN ... COMMIT`).
3. Table `schema_migrations` tracks applied files.

### Rollback Strategy
1. **Pre-migration Backup**: Automatic SQLite snapshot (`cp ems.sqlite ems.sqlite.bak`) or pg_dump before schema execution.
2. **Schema Rollback**: If a migration fails mid-flight, SQLite/PostgreSQL aborts the transaction immediately, preventing partial schema state.
3. **Data Protection**: No `DROP TABLE` or destructive data truncation is performed in production.
