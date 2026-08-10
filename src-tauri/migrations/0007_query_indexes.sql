CREATE INDEX IF NOT EXISTS idx_runs_updated
  ON runs(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_status_created
  ON approvals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_policy_rules_scope_effect
  ON policy_rules(scope_key, effect);

CREATE INDEX IF NOT EXISTS idx_checkpoints_run_created
  ON checkpoints(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_created
  ON artifacts(workspace_id, created_at DESC);
