use std::{collections::HashMap, path::Path};

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
        apply_migration(
            &mut conn,
            "0009_model_first_cli",
            include_str!("../../migrations/0009_model_first_cli.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0010_session_archive",
            include_str!("../../migrations/0010_session_archive.sql"),
        )?;
        apply_migration(
            &mut conn,
            "0011_workspace_auto_execute",
            include_str!("../../migrations/0011_workspace_auto_execute.sql"),
        )?;
        conn.execute(
            "UPDATE runs SET status='interrupted', updated_at=?1, finished_at=?1 WHERE status IN ('queued','starting','running','waiting_approval','paused')",
            [now()],
        )?;
        Ok(Self { conn })
    }

    pub fn upsert_workspace(&self, workspace: &Workspace) -> Result<()> {
        self.conn.execute(
            "INSERT INTO workspaces(id,name,root_path,branch,dirty_summary,created_at,updated_at,auto_execute)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(root_path) DO UPDATE SET name=excluded.name, branch=excluded.branch,
             dirty_summary=excluded.dirty_summary, updated_at=excluded.updated_at",
            params![
                workspace.id,
                workspace.name,
                workspace.root_path,
                workspace.branch,
                workspace.dirty_summary,
                workspace.created_at,
                workspace.updated_at,
                workspace.auto_execute,
            ],
        )?;
        Ok(())
    }

    pub fn workspace_by_path(&self, path: &str) -> Result<Option<Workspace>> {
        self.conn.query_row(
            "SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at,auto_execute FROM workspaces WHERE root_path=?1",
            [path], row_workspace,
        ).optional().map_err(Into::into)
    }

    pub fn workspace(&self, id: &str) -> Result<Option<Workspace>> {
        self.conn.query_row(
            "SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at,auto_execute FROM workspaces WHERE id=?1",
            [id], row_workspace,
        ).optional().map_err(Into::into)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        query_all(&self.conn, "SELECT id,name,root_path,branch,dirty_summary,created_at,updated_at,auto_execute FROM workspaces ORDER BY updated_at DESC", [], row_workspace)
    }

    pub fn set_workspace_auto_execute(
        &self,
        id: &str,
        auto_execute: Option<&str>,
    ) -> Result<Option<Workspace>> {
        let value = auto_execute.map(str::trim).filter(|item| !item.is_empty());
        self.conn.execute(
            "UPDATE workspaces SET auto_execute=?1, updated_at=?2 WHERE id=?3",
            params![value, now(), id],
        )?;
        self.workspace(id)
    }

    pub fn insert_session(&self, session: &Session) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sessions(id,workspace_id,title,kind,provider_id,created_at,updated_at,archived_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![session.id, session.workspace_id, session.title, session.kind, session.provider_id, session.created_at, session.updated_at, session.archived_at],
        )?;
        Ok(())
    }

    pub fn list_sessions(&self, workspace_id: &str) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare("SELECT id,workspace_id,title,kind,provider_id,created_at,updated_at,archived_at FROM sessions WHERE workspace_id=?1 ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([workspace_id], row_session)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn session(&self, id: &str) -> Result<Option<Session>> {
        self.conn.query_row(
            "SELECT id,workspace_id,title,kind,provider_id,created_at,updated_at,archived_at FROM sessions WHERE id=?1",
            [id], row_session,
        ).optional().map_err(Into::into)
    }

    pub fn update_session_title(&self, id: &str, title: &str) -> Result<Option<Session>> {
        let title = title.trim();
        if title.is_empty() {
            return Ok(None);
        }
        let changed = self.conn.execute(
            "UPDATE sessions SET title=?1, updated_at=?2 WHERE id=?3",
            params![title, now(), id],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        self.session(id)
    }

    pub fn delete_session(&self, id: &str) -> Result<bool> {
        let changed = self
            .conn
            .execute("DELETE FROM sessions WHERE id=?1", [id])?;
        Ok(changed > 0)
    }

    pub fn delete_workspace(&self, id: &str) -> Result<bool> {
        // Drop sessions (and their runs) first so run_context_items are gone
        // before context_items, which are RESTRICT-bound to those rows.
        self.conn
            .execute("DELETE FROM sessions WHERE workspace_id=?1", [id])?;
        self.conn
            .execute("DELETE FROM context_items WHERE workspace_id=?1", [id])?;
        let changed = self
            .conn
            .execute("DELETE FROM workspaces WHERE id=?1", [id])?;
        Ok(changed > 0)
    }

    pub fn set_session_archived(&self, id: &str, archived: bool) -> Result<Option<Session>> {
        let stamp = now();
        let changed = if archived {
            self.conn.execute(
                "UPDATE sessions SET archived_at=?1, updated_at=?1 WHERE id=?2 AND archived_at IS NULL",
                params![stamp, id],
            )?
        } else {
            self.conn.execute(
                "UPDATE sessions SET archived_at=NULL, updated_at=?1 WHERE id=?2 AND archived_at IS NOT NULL",
                params![stamp, id],
            )?
        };
        if changed == 0 {
            return self.session(id);
        }
        self.session(id)
    }

    pub fn insert_message(&self, session_id: &str, role: &str, content: &str) -> Result<()> {
        self.insert_message_at(session_id, role, content, &now())
    }

    pub fn insert_message_at(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        created_at: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO messages(id,session_id,role,content,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                format!("msg_{}", uuid::Uuid::new_v4().simple()),
                session_id,
                role,
                content,
                created_at
            ],
        )?;
        self.conn.execute(
            "UPDATE sessions SET updated_at=?1 WHERE id=?2",
            params![now(), session_id],
        )?;
        Ok(())
    }

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<(String, String, String)>> {
        query_all(
            &self.conn,
            "SELECT role,content,created_at FROM messages WHERE session_id=?1 ORDER BY created_at ASC, rowid ASC",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
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

    pub fn fork_session(&mut self, source_id: &str, before_seq: Option<i64>) -> Result<Session> {
        let source = self
            .session(source_id)?
            .ok_or_else(|| anyhow::anyhow!("session not found"))?;
        let messages = self.list_messages(source_id)?;
        let mut runs = self.list_runs(source_id)?;
        runs.reverse();
        let stamp = now();
        let session = Session {
            id: format!("sess_{}", uuid::Uuid::new_v4().simple()),
            workspace_id: source.workspace_id.clone(),
            title: format!("{} · 分叉", source.title),
            kind: source.kind.clone(),
            provider_id: source.provider_id.clone(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
            archived_at: None,
        };
        self.insert_session(&session)?;
        for (role, content, created_at) in messages {
            self.insert_message_at(&session.id, &role, &content, &created_at)?;
        }
        let last_index = runs.len().saturating_sub(1);
        for (index, run) in runs.iter().enumerate() {
            let mut events = self.list_events(&run.id)?;
            if index == last_index {
                if let Some(seq) = before_seq {
                    events.retain(|event| event.seq <= seq);
                }
            }
            let context_ids = self.run_context_ids(&run.id)?;
            let skills = self.run_skills(&run.id)?;
            let mcp_ids = self.run_mcp_ids(&run.id)?;
            let mut cloned = run.clone();
            cloned.id = format!(
                "RUN-{}",
                &uuid::Uuid::new_v4().simple().to_string()[..8].to_uppercase()
            );
            cloned.session_id = session.id.clone();
            if matches!(
                cloned.status.as_str(),
                "queued" | "starting" | "running" | "waiting_approval" | "waiting_human" | "paused"
            ) {
                cloned.status = "interrupted".into();
                cloned.finished_at = Some(stamp.clone());
                cloned.updated_at = stamp.clone();
            }
            self.insert_run(&cloned)?;
            self.bind_run_inputs(&cloned.id, &context_ids, &skills, &mcp_ids)?;
            for mut event in events {
                event.id = format!("evt_{}", uuid::Uuid::new_v4().simple());
                event.run_id = cloned.id.clone();
                self.insert_event(&event)?;
            }
        }
        Ok(session)
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

    pub fn last_event_ts(&self, run_id: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT ts FROM run_events WHERE run_id=?1 ORDER BY seq DESC LIMIT 1",
                [run_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
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
            "SELECT id,run_id,title,detail,risk,kind,scope_key,created_at FROM approvals WHERE status='pending' ORDER BY created_at DESC",
            [], |row| Ok(Approval { approval_id: row.get(0)?, run_id: row.get(1)?, title: row.get(2)?, detail: row.get(3)?, risk: row.get(4)?, kind: row.get(5)?, scope_key: row.get(6)?, created_at: row.get(7)? }))
    }

    /// The run and scope an approval belongs to, needed to record run-scoped
    /// allowances before the decision is forwarded to the waiting agent.
    pub fn approval_target(&self, id: &str) -> Result<Option<(String, Option<String>)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT run_id,scope_key FROM approvals WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
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
        let transaction = self.conn.unchecked_transaction()?;
        let existing = {
            let mut stmt = transaction
                .prepare("SELECT id,run_id,created_at FROM artifacts WHERE workspace_id=?1")?;
            let rows = stmt.query_map([workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    (row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?),
                ))
            })?;
            rows.collect::<rusqlite::Result<HashMap<_, _>>>()?
        };
        transaction.execute(
            "DELETE FROM artifacts WHERE workspace_id=?1",
            [workspace_id],
        )?;
        for artifact in artifacts {
            let (run_id, created_at) = existing
                .get(&artifact.id)
                .cloned()
                .unwrap_or_else(|| (artifact.run_id.clone(), artifact.created_at.clone()));
            transaction.execute(
                "INSERT INTO artifacts(id,run_id,workspace_id,path,name,ext,size_bytes,kind,renderer,entry_path,status,manifest_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![artifact.id, run_id, artifact.workspace_id, artifact.path, artifact.name, artifact.ext, artifact.size_bytes, artifact.kind, artifact.renderer, artifact.entry_path, artifact.status, artifact.manifest.to_string(), created_at],
            )?;
        }
        transaction.commit()?;
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
        // CLI providers still carry model defaults: the chat surface addresses
        // models, while the executable/login behind them is a Settings concern.
        let defaults = [
            (
                "codex",
                "cli",
                "Codex CLI",
                Some("gpt-5.4-codex"),
                None,
                Some(r#"["gpt-5.4-codex","gpt-5.4","gpt-5.4-mini"]"#),
            ),
            (
                "claude",
                "cli",
                "Claude CLI",
                Some("claude-sonnet-4-6"),
                None,
                Some(r#"["claude-sonnet-4-6","claude-opus-4-6","claude-haiku-4-6"]"#),
            ),
            (
                "grok",
                "cli",
                "Grok Build CLI",
                Some("grok-4"),
                None,
                Some(r#"["grok-4","grok-4-fast","grok-code-fast-1"]"#),
            ),
            (
                "openai",
                "openai",
                "OpenAI",
                Some("gpt-5.4"),
                Some("https://api.openai.com"),
                Some(r#"["gpt-5.4","gpt-5.4-mini"]"#),
            ),
            (
                "anthropic",
                "anthropic",
                "Anthropic",
                Some("claude-sonnet-4-6"),
                Some("https://api.anthropic.com"),
                Some(r#"["claude-sonnet-4-6","claude-opus-4-6","claude-haiku-4-6"]"#),
            ),
            (
                "xai",
                "openai_compatible",
                "xAI",
                Some("grok-4"),
                Some("https://api.x.ai"),
                Some(r#"["grok-4","grok-4-fast"]"#),
            ),
            (
                "compatible",
                "openai_compatible",
                "自定义兼容端点",
                None,
                None,
                None,
            ),
        ];
        for (id, kind, name, model, url, candidates) in defaults {
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
                config: match candidates {
                    Some(list) => serde_json::from_str(list).unwrap_or_else(|_| json!({})),
                    None => json!({}),
                },
            };
            self.conn.execute(
                "INSERT OR IGNORE INTO provider_profiles(id,provider_type,display_name,model,base_url,executable,credential_ref,enabled,config_json,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?9,?9)",
                params![profile.id, profile.provider_type, profile.display_name, profile.model, profile.base_url, profile.executable, profile.credential_ref, profile.config.to_string(), now()],
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

    /// Usage history for the trailing `days` window, plus the equivalent window
    /// before it so the surface can show a real period-over-period delta.
    pub fn usage_series(&self, days: i64) -> Result<UsageSeries> {
        let days = days.clamp(1, 180);
        let start = (Utc::now() - chrono::Duration::days(days - 1))
            .format("%Y-%m-%d")
            .to_string();
        let previous_start = (Utc::now() - chrono::Duration::days(days * 2 - 1))
            .format("%Y-%m-%d")
            .to_string();
        let rows = query_all(
            &self.conn,
            "SELECT day,provider_id,input_tokens,output_tokens,calls FROM usage_daily
             WHERE day >= ?1 ORDER BY day ASC",
            [&start],
            |row| {
                Ok(UsageDayEntry {
                    day: row.get(0)?,
                    provider_id: row.get(1)?,
                    input_tokens: row.get(2)?,
                    output_tokens: row.get(3)?,
                    calls: row.get(4)?,
                })
            },
        )?;
        let previous_tokens = self.conn.query_row(
            "SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM usage_daily WHERE day >= ?1 AND day < ?2",
            [&previous_start, &start],
            |row| row.get::<_, i64>(0),
        )?;
        let previous_runs = self.conn.query_row(
            "SELECT COUNT(1) FROM runs WHERE substr(created_at,1,10) >= ?1 AND substr(created_at,1,10) < ?2",
            [&previous_start, &start],
            |row| row.get::<_, i64>(0),
        )?;
        let top_runs = query_all(
            &self.conn,
            "SELECT id,prompt,provider_id,
                    CAST(COALESCE(json_extract(token_usage,'$.total'),0) AS INTEGER) AS total,
                    created_at
             FROM runs
             WHERE substr(created_at,1,10) >= ?1
               AND CAST(COALESCE(json_extract(token_usage,'$.total'),0) AS INTEGER) > 0
             ORDER BY total DESC LIMIT 8",
            [&start],
            |row| {
                let prompt: String = row.get(1)?;
                Ok(UsageRunEntry {
                    id: row.get(0)?,
                    title: prompt.chars().take(48).collect(),
                    provider_id: row.get(2)?,
                    tokens: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )?;
        Ok(UsageSeries {
            days: rows,
            previous_tokens,
            previous_runs,
            top_runs,
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
        auto_execute: row.get(7)?,
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
        archived_at: row.get(7)?,
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

    fn seed_artifact_runs(db: &Database, root: &Path) {
        let stamp = "2026-08-12T00:00:00Z".to_string();
        db.upsert_workspace(&Workspace {
            id: "workspace_artifacts".into(),
            name: "Artifacts".into(),
            root_path: root.to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.insert_session(&Session {
            id: "session_artifacts".into(),
            workspace_id: "workspace_artifacts".into(),
            title: "Artifact session".into(),
            kind: "mixed".into(),
            provider_id: "codex".into(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
            archived_at: None,
        })
        .unwrap();
        for run_id in ["run_original", "run_later"] {
            db.insert_run(&Run {
                id: run_id.into(),
                session_id: "session_artifacts".into(),
                workspace_id: "workspace_artifacts".into(),
                provider_id: "codex".into(),
                model: None,
                status: "completed".into(),
                prompt: "test artifacts".into(),
                plan_progress: None,
                error_message: None,
                token_usage: json!({}),
                created_at: stamp.clone(),
                updated_at: stamp.clone(),
                started_at: None,
                finished_at: None,
            })
            .unwrap();
        }
    }

    fn artifact(id: &str, run_id: &str, name: &str, created_at: &str) -> Artifact {
        Artifact {
            id: id.into(),
            run_id: Some(run_id.into()),
            workspace_id: "workspace_artifacts".into(),
            path: format!("out/design/{id}/index.html"),
            name: name.into(),
            ext: "html".into(),
            size_bytes: Some(42),
            kind: "html".into(),
            renderer: Some("html".into()),
            entry_path: Some(format!("out/design/{id}/index.html")),
            status: "complete".into(),
            manifest: json!({"id": id}),
            created_at: created_at.into(),
        }
    }

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
            auto_execute: None,
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
            archived_at: None,
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

    #[test]
    fn artifact_refresh_preserves_provenance_and_creation_time() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("artifacts.db")).unwrap();
        seed_artifact_runs(&db, dir.path());

        db.replace_artifacts(
            "workspace_artifacts",
            &[artifact(
                "artifact_existing",
                "run_original",
                "Original",
                "2026-08-10T10:00:00Z",
            )],
        )
        .unwrap();
        db.replace_artifacts(
            "workspace_artifacts",
            &[
                artifact(
                    "artifact_existing",
                    "run_later",
                    "Updated metadata",
                    "2026-08-12T10:00:00Z",
                ),
                artifact("artifact_new", "run_later", "New", "2026-08-12T11:00:00Z"),
            ],
        )
        .unwrap();

        let artifacts = db.list_artifacts("workspace_artifacts").unwrap();
        let existing = artifacts
            .iter()
            .find(|item| item.id == "artifact_existing")
            .unwrap();
        assert_eq!(existing.name, "Updated metadata");
        assert_eq!(existing.run_id.as_deref(), Some("run_original"));
        assert_eq!(existing.created_at, "2026-08-10T10:00:00Z");
        let new = artifacts
            .iter()
            .find(|item| item.id == "artifact_new")
            .unwrap();
        assert_eq!(new.run_id.as_deref(), Some("run_later"));
        assert_eq!(new.created_at, "2026-08-12T11:00:00Z");
    }

    #[test]
    fn artifact_replace_rolls_back_as_one_transaction() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("artifact-rollback.db")).unwrap();
        seed_artifact_runs(&db, dir.path());
        let original = artifact(
            "artifact_original",
            "run_original",
            "Keep me",
            "2026-08-10T10:00:00Z",
        );
        db.replace_artifacts("workspace_artifacts", std::slice::from_ref(&original))
            .unwrap();

        let duplicate = artifact(
            "artifact_duplicate",
            "run_later",
            "Duplicate",
            "2026-08-12T10:00:00Z",
        );
        assert!(db
            .replace_artifacts("workspace_artifacts", &[duplicate.clone(), duplicate],)
            .is_err());

        let artifacts = db.list_artifacts("workspace_artifacts").unwrap();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].id, original.id);
        assert_eq!(artifacts[0].name, "Keep me");
    }

    #[test]
    fn session_rename_and_delete_cascade_runs() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("sessions.db")).unwrap();
        let stamp = "2026-08-13T00:00:00Z".to_string();
        db.upsert_workspace(&Workspace {
            id: "ws_sess".into(),
            name: "Sess".into(),
            root_path: dir.path().to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.insert_session(&Session {
            id: "sess_one".into(),
            workspace_id: "ws_sess".into(),
            title: "新会话".into(),
            kind: "mixed".into(),
            provider_id: "codex".into(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
            archived_at: None,
        })
        .unwrap();
        db.insert_run(&Run {
            id: "run_one".into(),
            session_id: "sess_one".into(),
            workspace_id: "ws_sess".into(),
            provider_id: "codex".into(),
            model: None,
            status: "completed".into(),
            prompt: "hello".into(),
            plan_progress: None,
            error_message: None,
            token_usage: json!({}),
            created_at: stamp.clone(),
            updated_at: stamp,
            started_at: None,
            finished_at: None,
        })
        .unwrap();

        let renamed = db
            .update_session_title("sess_one", "门店复盘")
            .unwrap()
            .unwrap();
        assert_eq!(renamed.title, "门店复盘");
        assert!(db
            .update_session_title("sess_one", "   ")
            .unwrap()
            .is_none());
        assert!(db.update_session_title("missing", "x").unwrap().is_none());

        let archived = db.set_session_archived("sess_one", true).unwrap().unwrap();
        assert!(archived.archived_at.is_some());
        assert!(db.list_sessions("ws_sess").unwrap()[0]
            .archived_at
            .is_some());
        let restored = db.set_session_archived("sess_one", false).unwrap().unwrap();
        assert!(restored.archived_at.is_none());
        assert!(db.set_session_archived("missing", true).unwrap().is_none());

        assert!(db.delete_session("sess_one").unwrap());
        assert!(db.session("sess_one").unwrap().is_none());
        assert!(db.list_runs("sess_one").unwrap().is_empty());
        assert!(!db.delete_session("sess_one").unwrap());
    }

    #[test]
    fn delete_workspace_drops_sessions_and_bound_context() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(&dir.path().join("ws_del.db")).unwrap();
        let stamp = "2026-08-18T00:00:00Z".to_string();
        db.upsert_workspace(&Workspace {
            id: "ws_keep".into(),
            name: "Keep".into(),
            root_path: dir.path().join("keep").to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.upsert_workspace(&Workspace {
            id: "ws_del".into(),
            name: "Remove".into(),
            root_path: dir.path().join("remove").to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.insert_session(&Session {
            id: "sess_del".into(),
            workspace_id: "ws_del".into(),
            title: "要删的会话".into(),
            kind: "mixed".into(),
            provider_id: "codex".into(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
            archived_at: None,
        })
        .unwrap();
        db.insert_run(&Run {
            id: "run_del".into(),
            session_id: "sess_del".into(),
            workspace_id: "ws_del".into(),
            provider_id: "codex".into(),
            model: None,
            status: "completed".into(),
            prompt: "hello".into(),
            plan_progress: None,
            error_message: None,
            token_usage: json!({}),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
            started_at: None,
            finished_at: None,
        })
        .unwrap();
        db.upsert_context_item(&ContextItem {
            id: "ctx_del".into(),
            workspace_id: Some("ws_del".into()),
            source_kind: "workspace".into(),
            display_name: "README.md".into(),
            relative_path: Some("README.md".into()),
            stored_path: None,
            mime_type: "text/plain".into(),
            size_bytes: 12,
            sha256: "abc".into(),
            created_at: stamp.clone(),
        })
        .unwrap();
        db.bind_run_inputs("run_del", &["ctx_del".into()], &[], &[])
            .unwrap();

        assert!(db.delete_workspace("ws_del").unwrap());
        assert!(db.workspace("ws_del").unwrap().is_none());
        assert!(db.session("sess_del").unwrap().is_none());
        assert!(db.list_runs("sess_del").unwrap().is_empty());
        assert!(db.list_context_items("ws_del").unwrap().is_empty());
        assert!(db.workspace("ws_keep").unwrap().is_some());
        assert!(!db.delete_workspace("ws_del").unwrap());
    }

    #[test]
    fn workspace_auto_execute_survives_reopen_upsert() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("ws.db")).unwrap();
        let stamp = now();
        db.upsert_workspace(&Workspace {
            id: "ws_perm".into(),
            name: "Perm".into(),
            root_path: dir.path().to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.set_workspace_auto_execute("ws_perm", Some("ask_always"))
            .unwrap();
        db.upsert_workspace(&Workspace {
            id: "ws_perm".into(),
            name: "Perm".into(),
            root_path: dir.path().to_string_lossy().into_owned(),
            branch: Some("main".into()),
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp,
        })
        .unwrap();
        let stored = db.workspace("ws_perm").unwrap().unwrap();
        assert_eq!(stored.auto_execute.as_deref(), Some("ask_always"));
        assert_eq!(stored.branch.as_deref(), Some("main"));
    }

    #[test]
    fn fork_session_copies_messages_and_truncates_latest_run() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(&dir.path().join("fork.db")).unwrap();
        let stamp = now();
        db.upsert_workspace(&Workspace {
            id: "ws_fork".into(),
            name: "Fork".into(),
            root_path: dir.path().to_string_lossy().into_owned(),
            branch: None,
            dirty_summary: None,
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
        })
        .unwrap();
        db.insert_session(&Session {
            id: "sess_fork".into(),
            workspace_id: "ws_fork".into(),
            title: "原会话".into(),
            kind: "mixed".into(),
            provider_id: "codex".into(),
            created_at: stamp.clone(),
            updated_at: stamp.clone(),
            archived_at: None,
        })
        .unwrap();
        db.insert_message("sess_fork", "user", "hello").unwrap();
        db.insert_run(&Run {
            id: "run_fork".into(),
            session_id: "sess_fork".into(),
            workspace_id: "ws_fork".into(),
            provider_id: "codex".into(),
            model: None,
            status: "running".into(),
            prompt: "hello".into(),
            plan_progress: None,
            error_message: None,
            token_usage: json!({}),
            created_at: stamp.clone(),
            updated_at: stamp,
            started_at: None,
            finished_at: None,
        })
        .unwrap();
        for seq in 1..=3 {
            db.insert_event(&RunEvent::new(
                "run_fork",
                seq,
                "assistant_delta",
                json!({"text": format!("t{seq}")}),
            ))
            .unwrap();
        }
        let forked = db.fork_session("sess_fork", Some(2)).unwrap();
        assert!(forked.title.contains("分叉"));
        assert_eq!(db.list_messages(&forked.id).unwrap().len(), 1);
        let runs = db.list_runs(&forked.id).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "interrupted");
        assert_eq!(db.list_events(&runs[0].id).unwrap().len(), 2);
        assert_eq!(db.list_events("run_fork").unwrap().len(), 3);
    }
}
