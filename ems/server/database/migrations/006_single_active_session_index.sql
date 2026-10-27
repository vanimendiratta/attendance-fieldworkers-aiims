-- 006_single_active_session_index.sql
-- Remediate concurrent login race condition with partial unique index
-- Enforces that a user can have at most one active (is_revoked = 0) session at a time.

-- Clean up any historical duplicate unrevoked sessions (keeping the most recently active session)
UPDATE user_sessions
SET is_revoked = 1
WHERE is_revoked = 0
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_activity_at DESC) as rn
      FROM user_sessions
      WHERE is_revoked = 0
    ) WHERE rn = 1
  );

-- Create partial unique index on active sessions
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_single_active
ON user_sessions (user_id)
WHERE is_revoked = 0;
