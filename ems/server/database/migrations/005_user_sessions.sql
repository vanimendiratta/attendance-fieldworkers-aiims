-- 005_user_sessions.sql
-- Server-side session tracking for 30-minute inactivity timeout & JWT revocation

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  employee_id TEXT,
  token_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  client_ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_lookup ON user_sessions (id, is_revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id, is_revoked);
