-- 003_cder_policy_and_schema.sql
-- Support CDER Staff Data Import, Configurable Rules, and Schema Data Gap Management

PRAGMA foreign_keys = OFF;

-- 1. Recreate employees table to allow NULL/PENDING_CONFIGURATION for gender, date_of_birth, and metadata
CREATE TABLE IF NOT EXISTS employees_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT UNIQUE NOT NULL,
    official_employee_id TEXT, -- Future official Employee ID (pending configuration)
    name TEXT NOT NULL,
    gender TEXT CHECK(gender IN ('MALE', 'FEMALE', 'OTHER', 'PENDING_CONFIGURATION') OR gender IS NULL),
    mobile TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    date_of_joining DATE NOT NULL,
    date_of_birth DATE, -- Nullable / PENDING_CONFIGURATION
    department TEXT NOT NULL DEFAULT 'General',
    designation TEXT NOT NULL,
    employee_category TEXT NOT NULL DEFAULT 'PENDING_CONFIGURATION',
    is_field_worker INTEGER NOT NULL DEFAULT 0,
    field_worker_status TEXT DEFAULT 'PENDING_CONFIGURATION',
    field_worker_effective_date DATE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED')),
    import_source TEXT,
    import_key TEXT UNIQUE,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO employees_new (
    id, employee_id, official_employee_id, name, gender, mobile, email,
    date_of_joining, date_of_birth, department, designation, employee_category,
    is_field_worker, field_worker_status, field_worker_effective_date, status, is_demo, created_at, updated_at
)
SELECT 
    id, employee_id, NULL, name, gender, mobile, email,
    date_of_joining, date_of_birth, department, designation, employee_category,
    is_field_worker, 
    CASE WHEN is_field_worker = 1 THEN 'FIELD_WORKER' ELSE 'HOSPITAL_DUTY' END,
    field_worker_effective_date, status,
    CASE WHEN employee_id IN ('EMP001', 'EMP002') THEN 1 ELSE 0 END,
    created_at, updated_at
FROM employees;

DROP TABLE employees;
ALTER TABLE employees_new RENAME TO employees;

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_category ON employees(employee_category);
CREATE INDEX IF NOT EXISTS idx_employees_field_worker ON employees(is_field_worker);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_import_key ON employees(import_key);

-- 2. Add applicable_department column to leave_rules for department/policy-scoped rule matching
ALTER TABLE leave_rules ADD COLUMN applicable_department TEXT DEFAULT 'ALL';

PRAGMA foreign_keys = ON;
