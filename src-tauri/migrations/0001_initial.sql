PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  branch TEXT,
  dirty_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  plan_progress TEXT,
  error_message TEXT,
  token_usage TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  ts TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(run_id, seq)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  risk TEXT NOT NULL,
  scope_key TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL,
  scope_key TEXT NOT NULL UNIQUE,
  effect TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  manifest TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  model TEXT,
  base_url TEXT,
  executable TEXT,
  credential_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, provider_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);

