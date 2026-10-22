-- 002_field_worker_history.sql
-- Tracking historical periods of Field Worker (Yes) vs Hospital/Desk Duty (No)
-- Allows accurate, date-bound Comp-Off qualification based on duty status on worked_date.

-- 1. Add field_worker_effective_date column to employees table
ALTER TABLE employees ADD COLUMN field_worker_effective_date DATE;

-- 2. Create historical periods table for employee field duty assignments
CREATE TABLE IF NOT EXISTS employee_field_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    is_field_worker INTEGER NOT NULL DEFAULT 0, -- 1 = Field Duty (Comp-Off Eligible), 0 = Hospital / Desk Duty (No Comp-Off)
    effective_from DATE NOT NULL,
    effective_to DATE, -- NULL indicates current active status until subsequent transition
    remarks TEXT,
    changed_by TEXT DEFAULT 'ADMIN',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_field_hist_emp ON employee_field_status_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_field_hist_lookup ON employee_field_status_history(employee_id, effective_from, effective_to);

-- 3. Backfill baseline history for existing employees from their joining date
INSERT INTO employee_field_status_history (employee_id, is_field_worker, effective_from, effective_to, remarks, changed_by)
SELECT 
    employee_id,
    is_field_worker,
    date_of_joining,
    NULL,
    CASE WHEN is_field_worker = 1 THEN 'Initial appointment on Field Duty' ELSE 'Initial appointment on Hospital/Desk Duty' END,
    'SYSTEM'
FROM employees
WHERE employee_id NOT IN (SELECT employee_id FROM employee_field_status_history);

UPDATE employees 
SET field_worker_effective_date = date_of_joining 
WHERE field_worker_effective_date IS NULL;
