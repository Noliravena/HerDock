ALTER TABLE artifacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE artifacts ADD COLUMN renderer TEXT;
ALTER TABLE artifacts ADD COLUMN entry_path TEXT;
ALTER TABLE artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE artifacts ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_kind_created
  ON artifacts(workspace_id, kind, created_at DESC);
