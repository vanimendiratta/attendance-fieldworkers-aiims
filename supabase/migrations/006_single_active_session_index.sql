-- 006_single_active_session_index.sql
-- Remediate concurrent login race condition with partial unique index
-- Enforces that a user identity can have at most one active (is_revoked = 0) session per session_type.

-- 1. Opportunistically revoke any legacy duplicate active sessions, keeping only the most recently active one
UPDATE sessions
SET is_revoked = 1
WHERE is_revoked = 0
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, session_type ORDER BY last_activity DESC) as rn
      FROM sessions
      WHERE is_revoked = 0
    ) ranked
    WHERE ranked.rn = 1
  );

-- 2. Create partial unique index guaranteeing strict atomicity on concurrent session insertion
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active_user
ON sessions (user_id, session_type)
WHERE is_revoked = 0;
