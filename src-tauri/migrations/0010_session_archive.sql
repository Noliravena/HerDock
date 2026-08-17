ALTER TABLE sessions ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_archived
  ON sessions(workspace_id, archived_at, updated_at DESC);
