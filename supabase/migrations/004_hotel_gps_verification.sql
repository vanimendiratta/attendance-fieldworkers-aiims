-- =============================================================================
-- Migration: 004_hotel_gps_verification.sql
-- Project:   Attendance Fieldworkers (AIIMS)
-- Scope:     Hotel Stay GPS Verification, Accuracy, Matching & Audit Columns
-- Safety:    Purely additive and non-destructive.
-- =============================================================================

-- 1. Add verification and GPS accuracy columns to employee_hotel_stays table
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS hotel_accuracy NUMERIC(10, 2);
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS gps_capture_timestamp TIMESTAMPTZ;
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'PENDING';
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMPTZ;
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verified_place_name TEXT;
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verified_address TEXT;
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS distance_meters NUMERIC(10, 2);
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS place_id TEXT;
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS verification_notes TEXT;
ALTER TABLE employee_hotel_stays ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT FALSE;

-- 2. Index on verification status and employee ID for rapid admin audits
CREATE INDEX IF NOT EXISTS idx_hotel_stays_emp_status ON employee_hotel_stays (employee_id, stay_status, verification_status);
