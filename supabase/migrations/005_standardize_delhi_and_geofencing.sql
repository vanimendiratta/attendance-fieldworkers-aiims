-- =============================================================================
-- Migration: 005_standardize_delhi_and_geofencing.sql
-- Project:   Attendance Fieldworkers (AIIMS)
-- Scope:     Standardize Delhi State Naming & Shared Multi-Location Geofences
-- =============================================================================

-- 1. Standardize historical state names to canonical "Delhi"
UPDATE employees
SET state = 'Delhi'
WHERE state IS NOT NULL AND (
  state ILIKE '%delhi%' OR
  state ILIKE '%nct%' OR
  state = 'DL'
);

UPDATE attendance
SET state = 'Delhi'
WHERE state IS NOT NULL AND (
  state ILIKE '%delhi%' OR
  state ILIKE '%nct%' OR
  state = 'DL'
);

UPDATE teams
SET state = 'Delhi'
WHERE state IS NOT NULL AND (
  state ILIKE '%delhi%' OR
  state ILIKE '%nct%' OR
  state = 'DL'
);

UPDATE external_sync_records
SET state = 'Delhi'
WHERE state IS NOT NULL AND (
  state ILIKE '%delhi%' OR
  state ILIKE '%nct%' OR
  state = 'DL'
);

-- 2. Create shared geofences table for workplace and hotel geofences
CREATE TABLE IF NOT EXISTS geofences (
  id TEXT PRIMARY KEY,
  employer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  geofence_type TEXT NOT NULL DEFAULT 'WORKPLACE',
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  radius_meters NUMERIC(10, 2) NOT NULL DEFAULT 150.00,
  policy TEXT NOT NULL DEFAULT 'ALLOW_WITH_FLAG',
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofences_employer ON geofences (employer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_geofences_type ON geofences (employer_id, geofence_type, is_active);
