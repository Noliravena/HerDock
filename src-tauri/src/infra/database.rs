use std::path::Path;

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::domain::{
    events::{RunEvent, RunEventPage},
    models::*,
};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn =
            Connection::open(path).with_context(|| format!("open database {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);")?;
        conn.execute_batch(include_str!("../../migrations/0001_initial.sql"))?;
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES('0001_initial',?1)",
            [now()],
        )?;
        apply_migration(
            &mut conn,
            "0002_mcp_health",
            include_str!("../../migrations/0002_mcp_health.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0003_runtime_completion",
            include_str!("../../migrations/0003_runtime_completion.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0004_explicit_compatible_endpoint",
            include_str!("../../migrations/0004_explicit_compatible_endpoint.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0005_grok_build_provider",
            include_str!("../../migrations/0005_grok_build_provider.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0006_long_session_indexes",
            include_str!("../../migrations/0006_long_session_indexes.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0007_query_indexes",
            include_str!("../../migrations/0007_query_indexes.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0008_design_artifacts",
            include_str!("../../migrations/0008_design_artifacts.sql"),
        )?;
        conn.execute(
            "UPDATE runs SET status='interrupted', updated_at=?1, finished_at=?1 WHERE status IN ('queued','starting','running','waiting_approval','paused')",
            [now()],
        )?;
        Ok(Self { conn })
    }

    pub fn upsert_workspace(&self, workspace: &Workspace) -> Result<()> {
        self.conn.execute(
            "INSERT INTO workspaces(id,name,root_path,branch,dirty_summary,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(root_path) DO UPDATE SET name=excluded.name, branch=excluded.branch,
             dirty_summary=excluded.dirty_summary, updated_at=excluded.updated_at",
            params![
                workspace.id,
                workspace.name,
                workspace.root_path,
                workspace.branch,
                workspace.dirty_summary,
                workspace.created_at,
                workspace.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn workspace_by_path(&self, path: &str) -> Result<Option<Workspace>> {
        self.conn.query_row(
            "SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at FROM workspaces WHERE root_path=?1",
            [path], row_workspace,
        ).optional().map_err(Into::into)
    }

    pub fn workspace(&self, id: &str) -> Result<Option<Workspace>> {
        self.conn.query_row(
            "SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at FROM workspaces WHERE id=?1",
            [id], row_workspace,
        ).optional().map_err(Into::into)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        query_all(&self.conn, "SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at FROM workspaces ORDER BY updated_at DESC", [], row_workspace)
    }

    pub fn insert_session(&self, session: &Session) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sessions(id,workspace_id,title,kind,provider_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![session.id, session.workspace_id, session.title, session.kind, session.provider_id, session.created_at, session.updated_at],
        )?;
        Ok(())
    }

    pub fn list_sessions(&self, workspace_id: &str) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare("SELECT id,workspace_id,title,kind,provider_id,created_at,updated_at FROM sessions WHERE workspace_id=?1 ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([workspace_id], row_session)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn session(&self, id: &str) -> Result<Option<Session>> {
        self.conn.query_row(
            "SELECT id,workspace_id,title,kind,provider_id,created_at,updated_at FROM sessions WHERE id=?1",
            [id], row_session,
        ).optional().map_err(Into::into)
    }

    pub fn insert_message(&self, session_id: &str, role: &str, content: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO messages(id,session_id,role,content,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                format!("msg_{}", uuid::Uuid::new_v4().simple()),
                session_id,
                role,
                content,
                now()
            ],
        )?;
        self.conn.execute(
            "UPDATE sessions SET updated_at=?1 WHERE id=?2",
            params![now(), session_id],
        )?;
        Ok(())
    }

    pub fn list_recent_messages(&self, session_id: &str, limit: i64) -> Result<Vec<Value>> {
        let mut stmt = self.conn.prepare("SELECT role,content,created_at FROM messages WHERE session_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2")?;
        let rows = stmt.query_map(params![session_id, limit.clamp(1, 200)], |row| {
            Ok(json!({
                "role": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "createdAt": row.get::<_, String>(2)?,
            }))
        })?;
        let mut messages = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        messages.reverse();
        Ok(messages)
    }

    pub fn insert_run(&self, run: &Run) -> Result<()> {
        self.conn.execute(
            "INSERT INTO runs(id,session_id,workspace_id,provider_id,model,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![run.id, run.session_id, run.workspace_id, run.provider_id, run.model, run.status, run.prompt,
                run.plan_progress, run.error_message, run.token_usage.to_string(), run.created_at, run.updated_at,
                run.started_at, run.finished_at],
        )?;
        Ok(())
    }

    pub fn run(&self, id: &str) -> Result<Option<Run>> {
        self.conn.query_row(
            "SELECT id,session_id,workspace_id,provider_id,model,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at FROM runs WHERE id=?1",
            [id], row_run,
        ).optional().map_err(Into::into)
    }

    pub fn list_runs(&self, session_id: &str) -> Result<Vec<Run>> {
        let mut stmt = self.conn.prepare("SELECT id,session_id,workspace_id,provider_id,model,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at FROM runs WHERE session_id=?1 ORDER BY created_at DESC")?;
        let rows = stmt.query_map([session_id], row_run)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn recent_runs(&self, limit: i64) -> Result<Vec<Run>> {
        let mut stmt = self.conn.prepare("SELECT id,session_id,workspace_id,provider_id,model,status,prompt,plan_progress,error_message,token_usage,created_at,updated_at,started_at,finished_at FROM runs ORDER BY updated_at DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit], row_run)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn update_run_status(
        &self,
        id: &str,
        status: &str,
        message: Option<&str>,
        progress: Option<&str>,
    ) -> Result<()> {
        let stamp = now();
        self.conn.execute(
            "UPDATE runs SET status=?1,error_message=?2,plan_progress=COALESCE(?3,plan_progress),updated_at=?4,
             started_at=CASE WHEN ?1='running' THEN COALESCE(started_at,?4) ELSE started_at END,
             finished_at=CASE WHEN ?1 IN ('completed','failed','cancelled','interrupted') THEN ?4 ELSE finished_at END WHERE id=?5",
            params![status, message, progress, stamp, id],
        )?;
        Ok(())
    }

    pub fn update_run_usage(
        &self,
        id: &str,
        provider_id: &str,
        input: i64,
        output: i64,
    ) -> Result<()> {
        let total = input + output;
        self.conn.execute(
            "UPDATE runs SET token_usage=?1,updated_at=?2 WHERE id=?3",
            params![
                json!({"input":input,"output":output,"total":total}).to_string(),
                now(),
                id
            ],
        )?;
        let day = Utc::now().format("%Y-%m-%d").to_string();
        self.conn.execute(
            "INSERT INTO usage_daily(day,provider_id,input_tokens,output_tokens,calls) VALUES(?1,?2,?3,?4,1)
             ON CONFLICT(day,provider_id) DO UPDATE SET input_tokens=input_tokens+excluded.input_tokens,
             output_tokens=output_tokens+excluded.output_tokens,calls=calls+1",
            params![day, provider_id, input, output],
        )?;
        Ok(())
    }

    pub fn next_event_seq(&self, run_id: &str) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM run_events WHERE run_id=?1",
            [run_id],
            |row| row.get(0),
        )?)
    }

    pub fn insert_event(&self, event: &RunEvent) -> Result<()> {
        self.conn.execute(
            "INSERT INTO run_events(id,run_id,seq,event_type,ts,payload) VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                event.id,
                event.run_id,
                event.seq,
                event.event_type,
                event.ts,
                serde_json::to_string(event)?
            ],
        )?;
        Ok(())
    }

    pub fn list_events(&self, run_id: &str) -> Result<Vec<RunEvent>> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload FROM run_events WHERE run_id=?1 ORDER BY seq ASC")?;
        let rows = stmt.query_map([run_id], row_run_event)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn list_events_page(
        &self,
        run_id: &str,
        before_seq: Option<i64>,
        limit: i64,
    ) -> Result<RunEventPage> {
        let limit = limit.clamp(50, 1000);
        let mut events = if let Some(before_seq) = before_seq {
            let mut stmt = self.conn.prepare(
                "SELECT payload FROM run_events WHERE run_id=?1 AND seq<?2 ORDER BY seq DESC LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![run_id, before_seq, limit + 1], row_run_event)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT payload FROM run_events WHERE run_id=?1 ORDER BY seq DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![run_id, limit + 1], row_run_event)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let has_more = events.len() > limit as usize;
        events.truncate(limit as usize);
        events.reverse();
        Ok(RunEventPage { events, has_more })
    }

    pub fn insert_approval(&self, approval: &Approval) -> Result<()> {
        self.conn.execute(
            "INSERT INTO approvals(id,run_id,kind,title,detail,risk,scope_key,status,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'pending',?8)",
            params![approval.approval_id, approval.run_id, approval.kind, approval.title, approval.detail, approval.risk, approval.scope_key, now()],
        )?;
        Ok(())
    }

    pub fn pending_approvals(&self) -> Result<Vec<Approval>> {
        query_all(&self.conn,
            "SELECT id,run_id,title,detail,risk,kind,scope_key FROM approvals WHERE status='pending' ORDER BY created_at DESC",
            [], |row| Ok(Approval { approval_id: row.get(0)?, run_id: row.get(1)?, title: row.get(2)?, detail: row.get(3)?, risk: row.get(4)?, kind: row.get(5)?, scope_key: row.get(6)? }))
    }

    pub fn resolve_approval(&self, id: &str, decision: &str) -> Result<Option<String>> {
        let scope: Option<String> = self
            .conn
            .query_row("SELECT scope_key FROM approvals WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?
            .flatten();
        self.conn.execute(
            "UPDATE approvals SET status='resolved',decision=?1,resolved_at=?2 WHERE id=?3",
            params![decision, now(), id],
        )?;
        if decision == "always_allow" {
            if let Some(scope_key) = &scope {
                self.conn.execute(
                    "INSERT INTO policy_rules(id,rule_type,scope_key,effect,created_at) VALUES(?1,'tool',?2,'allow',?3)
                     ON CONFLICT(scope_key) DO UPDATE SET effect='allow'",
                    params![format!("rule_{}", uuid::Uuid::new_v4().simple()), scope_key, now()],
                )?;
            }
        }
        Ok(scope)
    }

    pub fn is_allowed(&self, scope_key: &str) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT COUNT(1) FROM policy_rules WHERE scope_key=?1 AND effect='allow'",
            [scope_key],
            |row| row.get::<_, i64>(0),
        )? > 0)
    }

    pub fn list_policy_rules(&self) -> Result<Vec<PolicyRule>> {
        query_all(
            &self.conn,
            "SELECT id,rule_type,scope_key,effect,created_at FROM policy_rules ORDER BY created_at DESC",
            [],
            |row| {
                Ok(PolicyRule {
                    id: row.get(0)?,
                    rule_type: row.get(1)?,
                    scope_key: row.get(2)?,
                    effect: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
    }

    pub fn delete_policy_rule(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM policy_rules WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn upsert_context_item(&self, item: &ContextItem) -> Result<()> {
        self.conn.execute(
            "INSERT INTO context_items(id,workspace_id,source_kind,display_name,relative_path,stored_path,mime_type,size_bytes,sha256,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,stored_path=excluded.stored_path,
             mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,sha256=excluded.sha256",
            params![item.id,item.workspace_id,item.source_kind,item.display_name,item.relative_path,item.stored_path,
                item.mime_type,item.size_bytes,item.sha256,item.created_at],
        )?;
        Ok(())
    }

    pub fn context_item_for_workspace_path(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<Option<ContextItem>> {
        self.conn.query_row(
            "SELECT id,workspace_id,source_kind,display_name,relative_path,stored_path,mime_type,size_bytes,sha256,created_at
             FROM context_items WHERE workspace_id=?1 AND source_kind='workspace' AND relative_path=?2",
            params![workspace_id, relative_path],
            row_context_item,
        ).optional().map_err(Into::into)
    }

    pub fn list_context_items(&self, workspace_id: &str) -> Result<Vec<ContextItem>> {
        query_all(
            &self.conn,
            "SELECT id,workspace_id,source_kind,display_name,relative_path,stored_path,mime_type,size_bytes,sha256,created_at
             FROM context_items WHERE workspace_id=?1 ORDER BY created_at DESC",
            [workspace_id],
            row_context_item,
        )
    }

    pub fn context_items(&self, ids: &[String]) -> Result<Vec<ContextItem>> {
        let mut out = Vec::new();
        for id in ids {
            if let Some(item) = self.conn.query_row(
                "SELECT id,workspace_id,source_kind,display_name,relative_path,stored_path,mime_type,size_bytes,sha256,created_at FROM context_items WHERE id=?1",
                [id], row_context_item,
            ).optional()? {
                out.push(item);
            }
        }
        Ok(out)
    }

    pub fn delete_context_item(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM context_items WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn bind_run_inputs(
        &mut self,
        run_id: &str,
        context_ids: &[String],
        skills: &[(String, String)],
        mcp_ids: &[String],
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        for id in context_ids {
            tx.execute(
                "INSERT OR IGNORE INTO run_context_items(run_id,context_item_id) VALUES(?1,?2)",
                params![run_id, id],
            )?;
        }
        for (id, path) in skills {
            tx.execute(
                "INSERT OR IGNORE INTO run_skills(run_id,skill_id,path) VALUES(?1,?2,?3)",
                params![run_id, id, path],
            )?;
        }
        for id in mcp_ids {
            tx.execute(
                "INSERT OR IGNORE INTO run_mcp_servers(run_id,mcp_server_id) VALUES(?1,?2)",
                params![run_id, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn run_context_ids(&self, run_id: &str) -> Result<Vec<String>> {
        query_all(
            &self.conn,
            "SELECT context_item_id FROM run_context_items WHERE run_id=?1 ORDER BY context_item_id",
            [run_id],
            |row| row.get(0),
        )
    }

    pub fn run_skills(&self, run_id: &str) -> Result<Vec<(String, String)>> {
        query_all(
            &self.conn,
            "SELECT skill_id,path FROM run_skills WHERE run_id=?1 ORDER BY skill_id",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    pub fn run_mcp_ids(&self, run_id: &str) -> Result<Vec<String>> {
        query_all(
            &self.conn,
            "SELECT mcp_server_id FROM run_mcp_servers WHERE run_id=?1 ORDER BY mcp_server_id",
            [run_id],
            |row| row.get(0),
        )
    }

    pub fn insert_checkpoint(&self, checkpoint: &Checkpoint, manifest: &Value) -> Result<()> {
        self.conn.execute(
            "INSERT INTO checkpoints(id,run_id,label,snapshot_ref,manifest,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![checkpoint.id, checkpoint.run_id, checkpoint.label, checkpoint.snapshot_ref, manifest.to_string(), checkpoint.created_at],
        )?;
        Ok(())
    }

    pub fn list_checkpoints(&self, run_id: &str) -> Result<Vec<Checkpoint>> {
        let mut stmt = self.conn.prepare("SELECT id,run_id,label,snapshot_ref,created_at FROM checkpoints WHERE run_id=?1 ORDER BY created_at DESC")?;
        let rows = stmt.query_map([run_id], |row| {
            Ok(Checkpoint {
                id: row.get(0)?,
                run_id: row.get(1)?,
                label: row.get(2)?,
                snapshot_ref: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn checkpoint_manifest(&self, id: &str) -> Result<Option<(String, String, Value)>> {
        self.conn
            .query_row(
                "SELECT run_id,snapshot_ref,manifest FROM checkpoints WHERE id=?1",
                [id],
                |row| {
                    let raw: String = row.get(2)?;
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        serde_json::from_str(&raw).unwrap_or(json!({})),
                    ))
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_artifacts(&self, workspace_id: &str) -> Result<Vec<Artifact>> {
        let mut stmt = self.conn.prepare("SELECT id,run_id,workspace_id,path,name,ext,size_bytes,kind,renderer,entry_path,status,manifest_json,created_at FROM artifacts WHERE workspace_id=?1 ORDER BY created_at DESC")?;
        let rows = stmt.query_map([workspace_id], |row| {
            let manifest: String = row.get(11)?;
            Ok(Artifact {
                id: row.get(0)?,
                run_id: row.get(1)?,
                workspace_id: row.get(2)?,
                path: row.get(3)?,
                name: row.get(4)?,
                ext: row.get(5)?,
                size_bytes: row.get(6)?,
                kind: row.get(7)?,
                renderer: row.get(8)?,
                entry_path: row.get(9)?,
                status: row.get(10)?,
                manifest: serde_json::from_str(&manifest).unwrap_or(json!({})),
                created_at: row.get(12)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn replace_artifacts(&self, workspace_id: &str, artifacts: &[Artifact]) -> Result<()> {
        self.conn.execute(
            "DELETE FROM artifacts WHERE workspace_id=?1",
            [workspace_id],
        )?;
        for artifact in artifacts {
            self.conn.execute(
                "INSERT INTO artifacts(id,run_id,workspace_id,path,name,ext,size_bytes,kind,renderer,entry_path,status,manifest_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![artifact.id, artifact.run_id, artifact.workspace_id, artifact.path, artifact.name, artifact.ext, artifact.size_bytes, artifact.kind, artifact.renderer, artifact.entry_path, artifact.status, artifact.manifest.to_string(), artifact.created_at],
            )?;
        }
        Ok(())
    }

    pub fn list_schedules(&self, workspace_id: Option<&str>) -> Result<Vec<Schedule>> {
        let sql = "SELECT id,workspace_id,name,cron,prompt,provider_id,enabled,next_run_at,last_run_at,created_at,updated_at FROM schedules";
        let mut out = Vec::new();
        if let Some(workspace_id) = workspace_id {
            let mut stmt = self.conn.prepare(&format!(
                "{sql} WHERE workspace_id=?1 ORDER BY created_at ASC"
            ))?;
            out.extend(
                stmt.query_map([workspace_id], row_schedule)?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        } else {
            out.extend(query_all(
                &self.conn,
                &format!("{sql} ORDER BY created_at ASC"),
                [],
                row_schedule,
            )?);
        }
        Ok(out)
    }

    pub fn upsert_schedule(&self, schedule: &Schedule) -> Result<()> {
        self.conn.execute(
            "INSERT INTO schedules(id,workspace_id,name,cron,prompt,provider_id,enabled,next_run_at,last_run_at,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,cron=excluded.cron,prompt=excluded.prompt,
             provider_id=excluded.provider_id,enabled=excluded.enabled,next_run_at=excluded.next_run_at,
             last_run_at=excluded.last_run_at,updated_at=excluded.updated_at",
            params![schedule.id, schedule.workspace_id, schedule.name, schedule.cron, schedule.prompt, schedule.provider_id,
                schedule.enabled as i64, schedule.next_run_at, schedule.last_run_at, schedule.created_at, schedule.updated_at],
        )?;
        Ok(())
    }

    pub fn delete_schedule(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM schedules WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn list_providers(&self) -> Result<Vec<ProviderProfile>> {
        query_all(&self.conn,
            "SELECT id,provider_type,display_name,model,base_url,executable,credential_ref,enabled,config_json FROM provider_profiles ORDER BY display_name",
            [], row_provider)
    }

    pub fn provider(&self, id: &str) -> Result<Option<ProviderProfile>> {
        self.conn.query_row(
            "SELECT id,provider_type,display_name,model,base_url,executable,credential_ref,enabled,config_json FROM provider_profiles WHERE id=?1",
            [id], row_provider,
        ).optional().map_err(Into::into)
    }

    pub fn upsert_provider(&self, profile: &ProviderProfile) -> Result<()> {
        self.conn.execute(
            "INSERT INTO provider_profiles(id,provider_type,display_name,model,base_url,executable,credential_ref,enabled,config_json,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
             ON CONFLICT(id) DO UPDATE SET provider_type=excluded.provider_type,display_name=excluded.display_name,
             model=excluded.model,base_url=excluded.base_url,executable=excluded.executable,credential_ref=excluded.credential_ref,
             enabled=excluded.enabled,config_json=excluded.config_json,updated_at=excluded.updated_at",
            params![profile.id, profile.provider_type, profile.display_name, profile.model, profile.base_url,
                profile.executable, profile.credential_ref, profile.enabled as i64, profile.config.to_string(), now()],
        )?;
        Ok(())
    }

    pub fn seed_providers(&self) -> Result<()> {
        let defaults = [
            ("codex", "cli", "Codex CLI", None, None),
            ("claude", "cli", "Claude CLI", None, None),
            ("grok", "cli", "Grok Build CLI", None, None),
            (
                "openai",
                "openai",
                "OpenAI",
                Some("gpt-5.4"),
                Some("https://api.openai.com"),
            ),
            (
                "anthropic",
                "anthropic",
                "Anthropic",
                Some("claude-sonnet-4-6"),
                Some("https://api.anthropic.com"),
            ),
            (
                "xai",
                "openai_compatible",
                "xAI",
                Some("grok-4"),
                Some("https://api.x.ai"),
            ),
            (
                "compatible",
                "openai_compatible",
                "自定义兼容端点",
                None,
                None,
            ),
        ];
        for (id, kind, name, model, url) in defaults {
            let profile = ProviderProfile {
                id: id.into(),
                provider_type: kind.into(),
                display_name: name.into(),
                model: model.map(Into::into),
                base_url: url.map(Into::into),
                executable: None,
                credential_ref: if kind == "cli" {
                    None
                } else {
                    Some(format!("provider:{id}"))
                },
                enabled: true,
                config: json!({}),
            };
            self.conn.execute(
                "INSERT OR IGNORE INTO provider_profiles(id,provider_type,display_name,model,base_url,executable,credential_ref,enabled,config_json,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,1,'{}',?8,?8)",
                params![profile.id, profile.provider_type, profile.display_name, profile.model, profile.base_url, profile.executable, profile.credential_ref, now()],
            )?;
        }
        Ok(())
    }

    pub fn list_mcp(&self) -> Result<Vec<McpServer>> {
        query_all(&self.conn,
            "SELECT id,name,command,args_json,env_json,enabled,workspace_id,status,tools_json FROM mcp_servers ORDER BY name",
            [], row_mcp)
    }

    pub fn mcp(&self, id: &str) -> Result<Option<McpServer>> {
        self.conn.query_row("SELECT id,name,command,args_json,env_json,enabled,workspace_id,status,tools_json FROM mcp_servers WHERE id=?1", [id], row_mcp).optional().map_err(Into::into)
    }

    pub fn upsert_mcp(&self, server: &McpServer) -> Result<()> {
        self.conn.execute(
            "INSERT INTO mcp_servers(id,name,command,args_json,env_json,enabled,workspace_id,status,tools_json,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,command=excluded.command,args_json=excluded.args_json,
             env_json=excluded.env_json,enabled=excluded.enabled,workspace_id=excluded.workspace_id,status=excluded.status,
             tools_json=excluded.tools_json,updated_at=excluded.updated_at",
            params![server.id, server.name, server.command, serde_json::to_string(&server.args)?, server.env.to_string(), server.enabled as i64, server.workspace_id, server.status, serde_json::to_string(&server.tools)?, now()],
        )?;
        Ok(())
    }

    pub fn delete_mcp(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM mcp_servers WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn settings(&self) -> Result<AppSettings> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key='settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(raw
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings(key,value,updated_at) VALUES('settings',?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            params![serde_json::to_string(settings)?, now()],
        )?;
        Ok(())
    }

    pub fn usage(&self, run_id: Option<&str>) -> Result<UsageReport> {
        let run_tokens = if let Some(run_id) = run_id {
            self.conn
                .query_row(
                    "SELECT COALESCE(json_extract(token_usage,'$.total'),0) FROM runs WHERE id=?1",
                    [run_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or_default()
        } else {
            0
        };
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let today_row = self.conn.query_row(
            "SELECT COALESCE(SUM(input_tokens+output_tokens),0),COALESCE(SUM(calls),0) FROM usage_daily WHERE day=?1",
            [today], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let month = Utc::now().format("%Y-%m").to_string();
        let month_row = self.conn.query_row(
            "SELECT COALESCE(SUM(input_tokens+output_tokens),0),COALESCE(SUM(calls),0) FROM usage_daily WHERE day LIKE ?1",
            [format!("{month}%")], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        let today_runs = self.conn.query_row(
            "SELECT COUNT(1) FROM runs WHERE substr(created_at,1,10)=?1",
            [Utc::now().format("%Y-%m-%d").to_string()],
            |row| row.get::<_, i64>(0),
        )?;
        let month_runs = self.conn.query_row(
            "SELECT COUNT(1) FROM runs WHERE substr(created_at,1,7)=?1",
            [month],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(UsageReport {
            buckets: vec![
                UsageBucket {
                    key: "run".into(),
                    label: "本次会话".into(),
                    tokens: run_tokens,
                    runs: i64::from(run_id.is_some()),
                    calls: 0,
                },
                UsageBucket {
                    key: "today".into(),
                    label: "今天".into(),
                    tokens: today_row.0,
                    runs: today_runs,
                    calls: today_row.1,
                },
                UsageBucket {
                    key: "month".into(),
                    label: "本月".into(),
                    tokens: month_row.0,
                    runs: month_runs,
                    calls: month_row.1,
                },
            ],
            context: UsageContext {
                used: run_tokens,
                limit: 200_000,
            },
        })
    }
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn query_all<T, P, F>(conn: &Connection, sql: &str, params: P, map: F) -> Result<Vec<T>>
where
    P: rusqlite::Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, map)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn row_workspace(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        branch: row.get(3)?,
        dirty_summary: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        kind: row.get(3)?,
        provider_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_run(row: &Row<'_>) -> rusqlite::Result<Run> {
    let usage: String = row.get(9)?;
    Ok(Run {
        id: row.get(0)?,
        session_id: row.get(1)?,
        workspace_id: row.get(2)?,
        provider_id: row.get(3)?,
        model: row.get(4)?,
        status: row.get(5)?,
        prompt: row.get(6)?,
        plan_progress: row.get(7)?,
        error_message: row.get(8)?,
        token_usage: serde_json::from_str(&usage).unwrap_or(json!({})),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        started_at: row.get(12)?,
        finished_at: row.get(13)?,
    })
}

fn row_run_event(row: &Row<'_>) -> rusqlite::Result<RunEvent> {
    let raw: String = row.get(0)?;
    serde_json::from_str::<RunEvent>(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            raw.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn row_context_item(row: &Row<'_>) -> rusqlite::Result<ContextItem> {
    Ok(ContextItem {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        source_kind: row.get(2)?,
        display_name: row.get(3)?,
        relative_path: row.get(4)?,
        stored_path: row.get(5)?,
        mime_type: row.get(6)?,
        size_bytes: row.get(7)?,
        sha256: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn row_schedule(row: &Row<'_>) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        cron: row.get(3)?,
        prompt: row.get(4)?,
        provider_id: row.get(5)?,
        enabled: row.get::<_, i64>(6)? != 0,
        next_run_at: row.get(7)?,
        last_run_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn row_provider(row: &Row<'_>) -> rusqlite::Result<ProviderProfile> {
    let config: String = row.get(8)?;
    Ok(ProviderProfile {
        id: row.get(0)?,
        provider_type: row.get(1)?,
        display_name: row.get(2)?,
        model: row.get(3)?,
        base_url: row.get(4)?,
        executable: row.get(5)?,
        credential_ref: row.get(6)?,
        enabled: row.get::<_, i64>(7)? != 0,
        config: serde_json::from_str(&config).unwrap_or(json!({})),
    })
}

fn row_mcp(row: &Row<'_>) -> rusqlite::Result<McpServer> {
    let args: String = row.get(3)?;
    let env: String = row.get(4)?;
    let tools: String = row.get(8)?;
    Ok(McpServer {
        id: row.get(0)?,
        name: row.get(1)?,
        command: row.get(2)?,
        args: serde_json::from_str(&args).unwrap_or_default(),
        env: serde_json::from_str(&env).unwrap_or(json!({})),
        enabled: row.get::<_, i64>(5)? != 0,
        workspace_id: row.get(6)?,
        status: row.get(7)?,
        tools: serde_json::from_str(&tools).unwrap_or_default(),
    })
}

fn apply_migration(conn: &mut Connection, version: &str, sql: &str) -> Result<()> {
    let applied = conn
        .query_row(
            "SELECT 1 FROM schema_migrations WHERE version=?1",
            [version],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if applied {
        return Ok(());
    }
    let transaction = conn.transaction()?;
    transaction.execute_batch(sql)?;
    transaction.execute(
        "INSERT INTO schema_migrations(version,applied_at) VALUES(?1,?2)",
        params![version, now()],
    )?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_schema_and_marks_runs_interrupted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("herdock.db");
        let db = Database::open(&path).unwrap();
        db.seed_providers().unwrap();
        assert!(db.list_providers().unwrap().len() >= 6);
        assert_eq!(
            db.provider("grok").unwrap().unwrap().display_name,
            "Grok Build CLI"
        );
        assert!(db.list_workspaces().unwrap().is_empty());
        let columns = db
            .conn
            .prepare("PRAGMA table_info(provider_profiles)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(!columns
            .iter()
            .any(|column| column == "api_key" || column == "secret"));

        let server = McpServer {
            id: "mcp_test".into(),
            name: "Test".into(),
            command: "test".into(),
            args: vec![],
            env: json!({}),
            enabled: true,
            workspace_id: None,
            status: Some("ready".into()),
            tools: vec!["read_file".into()],
        };
        db.upsert_mcp(&server).unwrap();
        drop(db);
        let reopened = Database::open(&path).unwrap();
        let persisted = reopened.mcp("mcp_test").unwrap().unwrap();
        assert_eq!(persisted.status.as_deref(), Some("ready"));
        assert_eq!(persisted.tools, vec!["read_file"]);
    }

    #[test]
    fn pages_large_run_history_by_sequence() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("history.db")).unwrap();
        let stamp = now();
        db.upsert_workspace(&Workspace {
            id: "workspace_history".into(),
            name: "History".into(),
            root_path: dir.path().to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.insert_session(&Session {
            id: "session_history".into(),
            workspace_id: "workspace_history".into(),
            title: "Long session".into(),
            kind: "coding".into(),
            provider_id: "codex".into(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.insert_run(&Run {
            id: "run_history".into(),
            session_id: "session_history".into(),
            workspace_id: "workspace_history".into(),
            provider_id: "codex".into(),
            model: None,
            status: "completed".into(),
            prompt: "test pagination".into(),
            plan_progress: None,
            error_message: None,
            token_usage: json!({}),
            created_at: stamp.clone(),
            updated_at: stamp,
            started_at: None,
            finished_at: None,
        })
        .unwrap();

        for index in 0..60 {
            db.insert_message("session_history", "user", &format!("message-{index}"))
                .unwrap();
        }
        let recent_messages = db.list_recent_messages("session_history", 24).unwrap();
        assert_eq!(recent_messages.len(), 24);
        assert_eq!(recent_messages.first().unwrap()["content"], "message-36");
        assert_eq!(recent_messages.last().unwrap()["content"], "message-59");

        for seq in 1..=1_200 {
            db.insert_event(&RunEvent::new(
                "run_history",
                seq,
                "assistant_delta",
                json!({ "text": "chunk" }),
            ))
            .unwrap();
        }

        let latest = db.list_events_page("run_history", None, 500).unwrap();
        assert!(latest.has_more);
        assert_eq!(latest.events.len(), 500);
        assert_eq!(latest.events.first().unwrap().seq, 701);
        assert_eq!(latest.events.last().unwrap().seq, 1_200);

        let middle = db.list_events_page("run_history", Some(701), 500).unwrap();
        assert!(middle.has_more);
        assert_eq!(middle.events.first().unwrap().seq, 201);
        assert_eq!(middle.events.last().unwrap().seq, 700);

        let oldest = db.list_events_page("run_history", Some(201), 500).unwrap();
        assert!(!oldest.has_more);
        assert_eq!(oldest.events.len(), 200);
        assert_eq!(oldest.events.first().unwrap().seq, 1);
        assert_eq!(oldest.events.last().unwrap().seq, 200);
    }
}
