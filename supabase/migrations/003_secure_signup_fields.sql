-- =============================================================================
-- Migration: 003_secure_signup_fields.sql
-- Project:   Attendance Fieldworkers (AIIMS)
-- Scope:     Date of Birth (DOB) and Unique Constraints on Email and Phone
-- Safety:    Purely additive and non-destructive.
-- =============================================================================

-- 1. Add Date of Birth (DOB) and updated_at column to employees table
-- Legacy records safely remain NULL without synthetic dates.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at TEXT;

-- 2. Add Unique Index on lowercase email to enforce case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email_lower ON employees (LOWER(TRIM(email)));

-- 3. Add Partial Unique Index on phone number to prevent duplicate phone numbers
-- Ignores legacy null/empty phone records to avoid breaking existing data.
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_phone_unique ON employees (phone)
  WHERE phone IS NOT NULL AND phone != '';
