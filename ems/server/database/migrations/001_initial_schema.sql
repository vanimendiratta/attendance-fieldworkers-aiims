-- 001_initial_schema.sql
-- EMS / LEAVE MANAGEMENT SYSTEM Relational Schema

PRAGMA foreign_keys = ON;

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN', 'EMPLOYEE')),
    must_change_password INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Employees Master Table
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    gender TEXT NOT NULL CHECK(gender IN ('MALE', 'FEMALE', 'OTHER')),
    mobile TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    date_of_joining DATE NOT NULL,
    date_of_birth DATE NOT NULL,
    department TEXT NOT NULL DEFAULT 'General',
    designation TEXT NOT NULL,
    employee_category TEXT NOT NULL DEFAULT 'GENERAL',
    is_field_worker INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Leave Types Master Table
CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_paid INTEGER NOT NULL DEFAULT 1,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    allow_half_day INTEGER NOT NULL DEFAULT 1,
    allow_hourly INTEGER NOT NULL DEFAULT 0,
    min_days_per_request REAL NOT NULL DEFAULT 0.5,
    max_days_per_request REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Leave Rules definition
CREATE TABLE IF NOT EXISTS leave_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_type_id INTEGER NOT NULL,
    rule_code TEXT UNIQUE NOT NULL,
    rule_name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE
);

-- Leave Rule Versions (Versioned policies for historical immutability)
CREATE TABLE IF NOT EXISTS leave_rule_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_rule_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'DRAFT', 'DEPRECATED', 'ARCHIVED')),
    config_json TEXT NOT NULL,
    created_by TEXT DEFAULT 'SYSTEM',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(leave_rule_id, version_number),
    FOREIGN KEY (leave_rule_id) REFERENCES leave_rules(id) ON DELETE CASCADE
);

-- Automated Leave Credit Schedules
CREATE TABLE IF NOT EXISTS leave_credit_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_type_id INTEGER NOT NULL,
    schedule_name TEXT NOT NULL,
    schedule_type TEXT NOT NULL CHECK(schedule_type IN ('ANNUAL', 'BI_ANNUAL', 'MONTHLY', 'JOINING', 'CUSTOM')),
    credit_month_day TEXT, -- e.g., '01-01' or '07-01'
    credit_amount REAL,
    calculation_rule_key TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE
);

-- Track executions of credit schedules for strict idempotency
CREATE TABLE IF NOT EXISTS credit_schedule_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    cycle_key TEXT UNIQUE NOT NULL, -- e.g. 'EL_BI_ANNUAL_2026_01_01'
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    employees_credited_count INTEGER NOT NULL DEFAULT 0,
    details_json TEXT,
    FOREIGN KEY (schedule_id) REFERENCES leave_credit_schedules(id) ON DELETE CASCADE
);

-- Leave Transactions (Double-entry Ledger)
CREATE TABLE IF NOT EXISTS leave_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    leave_type_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN (
        'INITIAL_CREDIT',
        'PERIODIC_CREDIT',
        'LEAVE_DEDUCTION',
        'LEAVE_REVERSAL',
        'ADMIN_ADJUSTMENT',
        'COMP_OFF_CREDIT',
        'COMP_OFF_DEDUCTION',
        'EXPIRY',
        'CORRECTION'
    )),
    amount REAL NOT NULL, -- positive for credits/reversals, negative for deductions
    running_balance REAL NOT NULL,
    reference_id TEXT, -- e.g. request_number, comp_off_id, cycle_key
    rule_version_id INTEGER,
    remarks TEXT,
    created_by TEXT NOT NULL DEFAULT 'SYSTEM',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_version_id) REFERENCES leave_rule_versions(id)
);

-- Cached Leave Balances (Aggregated from ledger, verified against ledger)
CREATE TABLE IF NOT EXISTS leave_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    leave_type_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    opening_balance REAL NOT NULL DEFAULT 0,
    credited_amount REAL NOT NULL DEFAULT 0,
    used_amount REAL NOT NULL DEFAULT 0,
    pending_amount REAL NOT NULL DEFAULT 0,
    adjusted_amount REAL NOT NULL DEFAULT 0,
    current_balance REAL NOT NULL DEFAULT 0,
    last_transaction_id INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, leave_type_id, year),
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    FOREIGN KEY (last_transaction_id) REFERENCES leave_transactions(id)
);

-- Holidays Master Table
CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date DATE NOT NULL,
    holiday_name TEXT NOT NULL,
    holiday_type TEXT NOT NULL DEFAULT 'PUBLIC' CHECK(holiday_type IN ('PUBLIC', 'RESTRICTED', 'NATIONAL', 'REGIONAL')),
    location TEXT DEFAULT 'ALL',
    department TEXT DEFAULT 'ALL',
    applicable_category TEXT DEFAULT 'ALL',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(holiday_date, location, department)
);

-- Weekly Off Rules
CREATE TABLE IF NOT EXISTS weekly_off_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name TEXT NOT NULL,
    pattern_json TEXT NOT NULL, -- e.g. '{"days": [0, 6]}' for Sun(0) & Sat(6), '{"days": [0]}' for Sun only
    department TEXT DEFAULT 'ALL',
    applicable_category TEXT DEFAULT 'ALL', -- e.g. 'FIELD_WORKER', 'GENERAL'
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sandwich Rules (Configurable rules on intervening weekly offs / holidays)
CREATE TABLE IF NOT EXISTS sandwich_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    applicable_leave_types_json TEXT NOT NULL, -- e.g. '["CL", "EL"]' or '[]'
    include_weekly_offs INTEGER NOT NULL DEFAULT 1,
    include_public_holidays INTEGER NOT NULL DEFAULT 1,
    charge_intervening_days INTEGER NOT NULL DEFAULT 1,
    condition_description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Leave Requests Table
CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_number TEXT UNIQUE NOT NULL,
    employee_id TEXT NOT NULL,
    leave_type_id INTEGER NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    is_half_day INTEGER NOT NULL DEFAULT 0,
    half_day_session TEXT CHECK(half_day_session IN ('FIRST_HALF', 'SECOND_HALF', NULL)),
    requested_calendar_days REAL NOT NULL,
    weekly_off_days REAL NOT NULL DEFAULT 0,
    holiday_days REAL NOT NULL DEFAULT 0,
    sandwich_days REAL NOT NULL DEFAULT 0,
    chargeable_days REAL NOT NULL,
    reason TEXT NOT NULL,
    supporting_document_url TEXT,
    remarks TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'HOLD', 'CANCELLED')),
    rule_version_id INTEGER,
    calculation_snapshot_json TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    review_remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_version_id) REFERENCES leave_rule_versions(id)
);

-- Status transition tracking for audit and lifecycle
CREATE TABLE IF NOT EXISTS leave_request_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_request_id INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE
);

-- Compensatory Off (Comp-Off) Records
CREATE TABLE IF NOT EXISTS comp_off_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    worked_date DATE NOT NULL,
    qualifying_day_type TEXT NOT NULL CHECK(qualifying_day_type IN ('SUNDAY', 'SATURDAY', 'HOLIDAY', 'EMERGENCY_DUTY')),
    credited_days REAL NOT NULL DEFAULT 1.0,
    reason TEXT NOT NULL,
    approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approved_by TEXT,
    credited_date DATE,
    expiry_date DATE,
    used_date DATE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'AVAILABLE', 'USED', 'EXPIRED', 'CANCELLED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'INFO' CHECK(type IN ('INFO', 'SUCCESS', 'WARNING', 'ACTION_REQUIRED')),
    is_read INTEGER NOT NULL DEFAULT 0,
    link_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Notification Templates
CREATE TABLE IF NOT EXISTS notification_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_code TEXT UNIQUE NOT NULL,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Comprehensive Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    actor_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    old_values_json TEXT,
    new_values_json TEXT,
    ip_address TEXT,
    user_agent TEXT,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System Settings (Key-Value configurable storage)
CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'GENERAL',
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_emp_id ON users(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_category ON employees(employee_category);
CREATE INDEX IF NOT EXISTS idx_employees_field_worker ON employees(is_field_worker);
CREATE INDEX IF NOT EXISTS idx_leave_transactions_emp_type ON leave_transactions(employee_id, leave_type_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_emp_type_year ON leave_balances(employee_id, leave_type_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(from_date, to_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comp_off_emp ON comp_off_records(employee_id);
