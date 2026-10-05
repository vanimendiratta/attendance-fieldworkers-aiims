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

-- 2. Attendance Location Classification, Hotel Stays & Regularization Columns
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_location_type TEXT DEFAULT 'FIELD_SITE';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_stay_id TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_name TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_room TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS hotel_phone TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_place_name TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_place_type TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS exact_coordinates_url TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_regularized INTEGER DEFAULT 0;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularized_by TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS regularization_notes TEXT;

-- 3. Employee Hotel Stays Table
CREATE TABLE IF NOT EXISTS employee_hotel_stays (
    id TEXT PRIMARY KEY,
    employer_id TEXT NOT NULL REFERENCES organizations(id),
    employee_id TEXT NOT NULL REFERENCES employees(id),
    hotel_name TEXT NOT NULL,
    room_number TEXT,
    hotel_address TEXT NOT NULL,
    hotel_phone TEXT,
    checkin_date DATE NOT NULL,
    checkout_date DATE,
    booking_ref TEXT,
    hotel_lat NUMERIC(10, 7),
    hotel_lng NUMERIC(10, 7),
    stay_status TEXT DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Organization Holidays Table
CREATE TABLE IF NOT EXISTS organization_holidays (
    id TEXT PRIMARY KEY,
    employer_id TEXT NOT NULL REFERENCES organizations(id),
    holiday_date DATE NOT NULL,
    name TEXT NOT NULL,
    holiday_type TEXT DEFAULT 'GAZETTED',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employer_id, holiday_date)
);

-- 5. Rate Limits Timestamp Capacity Fix
ALTER TABLE auth_rate_limits ALTER COLUMN timestamp TYPE BIGINT;
