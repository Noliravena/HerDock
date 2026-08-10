ALTER TABLE runs ADD COLUMN model TEXT;

CREATE TABLE IF NOT EXISTS context_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  relative_path TEXT,
  stored_path TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_context_workspace_path
  ON context_items(workspace_id, source_kind, relative_path)
  WHERE relative_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_workspace ON context_items(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_context_items (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  context_item_id TEXT NOT NULL REFERENCES context_items(id) ON DELETE RESTRICT,
  PRIMARY KEY(run_id, context_item_id)
);

CREATE TABLE IF NOT EXISTS run_skills (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY(run_id, skill_id)
);

CREATE TABLE IF NOT EXISTS run_mcp_servers (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY(run_id, mcp_server_id)
);
