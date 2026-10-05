-- =============================================================================
-- Migration 002: Employee Leaves & Attendance Alteration / Regularization
-- =============================================================================

-- 1. Employee Leaves Table
CREATE TABLE IF NOT EXISTS employee_leaves (
    id                          TEXT             NOT NULL,
    employer_id                 TEXT             NOT NULL,
    employee_id                 TEXT             NOT NULL,
    leave_date                  DATE             NOT NULL,
    leave_type                  TEXT             NOT NULL DEFAULT 'UNMARKED_ABSENCE',
    status                      TEXT             NOT NULL DEFAULT 'PENDING',
    reason                      TEXT,
    applied_by                  TEXT             DEFAULT 'SYSTEM_ABSENCE',
    admin_remarks               TEXT,
    regularized_attendance_id   TEXT,
    created_at                  TIMESTAMPTZ      DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ      DEFAULT NOW(),

    CONSTRAINT employee_leaves_pkey PRIMARY KEY (id),
    CONSTRAINT employee_leaves_employer_fk FOREIGN KEY (employer_id) REFERENCES organizations (id),
    CONSTRAINT employee_leaves_employee_fk FOREIGN KEY (employee_id) REFERENCES employees (id),
    CONSTRAINT employee_leaves_unique_per_day UNIQUE (employer_id, employee_id, leave_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_date ON employee_leaves (employer_id, leave_date);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_emp_id ON employee_leaves (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_status ON employee_leaves (status);

-- 2. Attendance Alteration & Regularization Support Columns
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_regularized INTEGER DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularized_by TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularization_notes TEXT;
