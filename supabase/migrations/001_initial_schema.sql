-- =============================================================================
-- Migration: 001_initial_schema.sql
-- Project:   Attendance Fieldworkers (AIIMS) — SQLite -> Supabase PostgreSQL
-- Created:   2026-09-14  |  Revised: Phase-1 compatibility fixes applied
--
-- Changes from original:
--   • organizations.is_active column added (fixes WHERE is_active = 1 query)
--   • external_sync_records.state / .district added (fixes COALESCE SELECT)
--   • Insecure plaintext credential defaults removed from schema
--   • NO Row Level Security enabled yet
--   • NO dependency on auth.users
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. organizations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id                  TEXT             NOT NULL,
    name                TEXT             NOT NULL,
    office_name         TEXT             NOT NULL,
    office_lat          DOUBLE PRECISION NOT NULL,
    office_lng          DOUBLE PRECISION NOT NULL,
    geofence_radius_m   DOUBLE PRECISION NOT NULL DEFAULT 100,
    geofence_policy     TEXT             NOT NULL DEFAULT 'ALLOW_WITH_FLAG',
    max_gps_accuracy_m  DOUBLE PRECISION NOT NULL DEFAULT 100,
    shift_hours         DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    timezone            TEXT             NOT NULL DEFAULT 'Asia/Kolkata',
    admin_username      TEXT             NOT NULL,
    admin_password      TEXT             NOT NULL,
    is_active           INTEGER          NOT NULL DEFAULT 1,
    updated_at          TEXT,

    CONSTRAINT organizations_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------------
-- 2. employees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id              TEXT    NOT NULL,
    employer_id     TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    email           TEXT    NOT NULL,
    phone           TEXT,
    department      TEXT    NOT NULL,
    designation     TEXT    NOT NULL,
    pin             TEXT    NOT NULL,
    password        TEXT    NOT NULL,
    face_photo      TEXT,
    face_descriptor TEXT,
    face_enrolled   INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    team_id         TEXT,
    state           TEXT,
    district        TEXT,
    created_at      TEXT    NOT NULL,

    CONSTRAINT employees_pkey    PRIMARY KEY (id),
    CONSTRAINT employees_email   UNIQUE      (email),
    CONSTRAINT employees_emp_fk  FOREIGN KEY (employer_id) REFERENCES organizations (id)
);

-- ---------------------------------------------------------------------------
-- 3. attendance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
    id                          TEXT             NOT NULL,
    employee_id                 TEXT             NOT NULL,
    employer_id                 TEXT             NOT NULL,
    attendance_status           TEXT             NOT NULL,

    checkin_photo               TEXT             NOT NULL,
    checkin_photo_hash          TEXT,
    checkin_lat                 DOUBLE PRECISION NOT NULL,
    checkin_lng                 DOUBLE PRECISION NOT NULL,
    checkin_accuracy            DOUBLE PRECISION NOT NULL,
    checkin_location_timestamp  TEXT,
    checkin_server_timestamp    TEXT             NOT NULL,
    checkin_address             TEXT,
    checkin_geofence_distance   DOUBLE PRECISION,
    checkin_geofence_status     TEXT,

    checkout_photo              TEXT,
    checkout_photo_hash         TEXT,
    checkout_lat                DOUBLE PRECISION,
    checkout_lng                DOUBLE PRECISION,
    checkout_accuracy           DOUBLE PRECISION,
    checkout_location_timestamp TEXT,
    checkout_server_timestamp   TEXT,
    checkout_address            TEXT,
    checkout_geofence_distance  DOUBLE PRECISION,
    checkout_geofence_status    TEXT,

    gross_working_seconds       INTEGER          DEFAULT 0,
    break_seconds               INTEGER          DEFAULT 0,
    net_working_seconds         INTEGER          DEFAULT 0,
    overtime_seconds            INTEGER          DEFAULT 0,

    work_mode                   TEXT             DEFAULT 'OFFICE',
    field_site_notes            TEXT,
    team_id                     TEXT,
    state                       TEXT,
    district                    TEXT,

    punch_location_type         TEXT             DEFAULT 'FIELD_SITE',
    hotel_stay_id               TEXT,
    hotel_name                  TEXT,
    hotel_room                  TEXT,
    hotel_phone                 TEXT,
    location_place_name         TEXT,
    location_place_type         TEXT,
    exact_coordinates_url       TEXT,
    is_regularized              INTEGER          DEFAULT 0,
    regularized_by              TEXT,
    regularization_notes        TEXT,

    idempotency_key             TEXT,
    redcap_sync_status          TEXT             DEFAULT 'PENDING',
    redcap_synced_at            TEXT,
    created_at                  TEXT             NOT NULL,
    updated_at                  TEXT             NOT NULL,

    CONSTRAINT attendance_pkey        PRIMARY KEY (id),
    CONSTRAINT attendance_idempotency UNIQUE      (idempotency_key),
    CONSTRAINT attendance_employee_fk FOREIGN KEY (employee_id)  REFERENCES employees     (id),
    CONSTRAINT attendance_employer_fk FOREIGN KEY (employer_id)  REFERENCES organizations (id)
);

-- ---------------------------------------------------------------------------
-- 4. breaks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS breaks (
    id                      TEXT    NOT NULL,
    attendance_id           TEXT    NOT NULL,
    start_server_timestamp  TEXT    NOT NULL,
    end_server_timestamp    TEXT,
    duration_seconds        INTEGER DEFAULT 0,

    CONSTRAINT breaks_pkey          PRIMARY KEY (id),
    CONSTRAINT breaks_attendance_fk FOREIGN KEY (attendance_id) REFERENCES attendance (id)
);

-- ---------------------------------------------------------------------------
-- 5. audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    employee_id  TEXT,
    employer_id  TEXT,
    action       TEXT NOT NULL,
    status       TEXT NOT NULL,
    details_json TEXT,
    client_ip    TEXT,
    user_agent   TEXT,
    timestamp    TEXT NOT NULL,

    CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------------
-- 6. teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
    id          TEXT NOT NULL,
    employer_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    state       TEXT NOT NULL,
    district    TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL,

    CONSTRAINT teams_pkey        PRIMARY KEY (id),
    CONSTRAINT teams_employer_fk FOREIGN KEY (employer_id) REFERENCES organizations (id)
);

-- ---------------------------------------------------------------------------
-- 7. employee_sequences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_sequences (
    employer_id TEXT    NOT NULL,
    last_seq    INTEGER NOT NULL,

    CONSTRAINT employee_sequences_pkey PRIMARY KEY (employer_id)
);

-- ---------------------------------------------------------------------------
-- 8. auth_rate_limits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    rate_key  TEXT   NOT NULL,
    timestamp BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts
    ON auth_rate_limits (rate_key, timestamp);

-- ---------------------------------------------------------------------------
-- 9. sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT    NOT NULL,
    session_type  TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    employer_id   TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    expires_at    TEXT    NOT NULL,
    last_activity TEXT    NOT NULL,
    is_revoked    INTEGER NOT NULL DEFAULT 0,
    client_ip     TEXT,
    user_agent    TEXT,

    CONSTRAINT sessions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_active
    ON sessions (id, is_revoked, expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions (user_id, is_revoked);

-- ---------------------------------------------------------------------------
-- 10. external_sync_records
--     state + district columns added (fix for COALESCE(s.state, e.state) query)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_sync_records (
    id                          TEXT NOT NULL,
    employee_id                 TEXT NOT NULL,
    employer_id                 TEXT NOT NULL,
    department                  TEXT,
    designation                 TEXT,
    state                       TEXT,
    district                    TEXT,

    checkin_latitude            TEXT,
    checkin_longitude           TEXT,
    checkin_accuracy            TEXT,
    checkin_location_timestamp  TEXT,
    checkin_server_timestamp    TEXT,
    checkin_address             TEXT,
    checkin_geofence_distance   TEXT,
    checkin_geofence_status     TEXT,

    checkout_latitude           TEXT,
    checkout_longitude          TEXT,
    checkout_accuracy           TEXT,
    checkout_location_timestamp TEXT,
    checkout_server_timestamp   TEXT,
    checkout_address            TEXT,
    checkout_geofence_distance  TEXT,
    checkout_geofence_status    TEXT,

    gross_working_seconds       TEXT,
    break_seconds               TEXT,
    net_working_seconds         TEXT,
    overtime_seconds            TEXT,

    attendance_status           TEXT,
    work_mode                   TEXT DEFAULT 'OFFICE',
    field_site_notes            TEXT,

    sync_status                 TEXT DEFAULT 'SYNCED',
    synced_at                   TEXT NOT NULL,
    updated_at                  TEXT NOT NULL,

    CONSTRAINT external_sync_records_pkey PRIMARY KEY (id),
    CONSTRAINT external_sync_employee_fk  FOREIGN KEY (employee_id) REFERENCES employees     (id),
    CONSTRAINT external_sync_employer_fk  FOREIGN KEY (employer_id) REFERENCES organizations (id)
);

CREATE INDEX IF NOT EXISTS idx_ext_sync_emp
    ON external_sync_records (employee_id);

CREATE INDEX IF NOT EXISTS idx_ext_sync_org
    ON external_sync_records (employer_id);

-- ---------------------------------------------------------------------------
-- 11. Initial default organization seed & employee sequence
-- ---------------------------------------------------------------------------
INSERT INTO organizations (
    id, name, office_name, office_lat, office_lng,
    geofence_radius_m, geofence_policy, max_gps_accuracy_m,
    shift_hours, timezone, admin_username, admin_password, is_active, updated_at
) VALUES (
    'ORG-001', 'AIIMS', 'AIIMS, New Delhi', 28.5672, 77.2100,
    500, 'ALLOW_WITH_FLAG', 500,
    8.0, 'Asia/Kolkata', 'aiims_admin',
    'AiimsAdmin@123',
    1, CURRENT_TIMESTAMP::text
) ON CONFLICT (id) DO NOTHING;

INSERT INTO employee_sequences (employer_id, last_seq)
VALUES ('ORG-001', 1000)
ON CONFLICT (employer_id) DO NOTHING;

-- =============================================================================
-- End of migration 001_initial_schema.sql
-- =============================================================================
