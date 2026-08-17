use chrono::Utc;
use tauri::{ipc::Channel, AppHandle, State};
use uuid::Uuid;

use crate::{
    commands::error::{err, CommandResult},
    domain::{
        events::{RunEvent, RunEventPage},
        models::{
            Approval, Checkpoint, PolicyRule, QueueItem, Run, RunInputs, Session, StartRunRequest,
            UsageReport, UsageSeries,
        },
    },
    services::{agent, state::AppState},
};

#[tauri::command]
pub async fn session_list(
    workspace_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<Session>> {
    state
        .db
        .lock()
        .await
        .list_sessions(&workspace_id)
        .map_err(err)
}

#[tauri::command]
pub async fn session_create(
    workspace_id: String,
    title: String,
    kind: String,
    provider_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Session> {
    if state
        .db
        .lock()
        .await
        .workspace(&workspace_id)
        .map_err(err)?
        .is_none()
    {
        return Err("workspace not found".into());
    }
    let stamp = Utc::now().to_rfc3339();
    let session = Session {
        id: format!("sess_{}", Uuid::new_v4().simple()),
        workspace_id,
        title: if title.trim().is_empty() {
            "新会话".into()
        } else {
            title
        },
        kind,
        provider_id,
        created_at: stamp.clone(),
        updated_at: stamp,
        archived_at: None,
    };
    state
        .db
        .lock()
        .await
        .insert_session(&session)
        .map_err(err)?;
    Ok(session)
}

#[tauri::command]
pub async fn session_fork(
    id: String,
    before_seq: Option<i64>,
    state: State<'_, AppState>,
) -> CommandResult<Session> {
    state
        .db
        .lock()
        .await
        .fork_session(id.trim(), before_seq)
        .map_err(err)
}

const LIVE_STATUSES: &[&str] = &[
    "queued",
    "starting",
    "running",
    "waiting_approval",
    "waiting_human",
];

#[tauri::command]
pub async fn session_rename(
    id: String,
    title: String,
    state: State<'_, AppState>,
) -> CommandResult<Session> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("title required".into());
    }
    state
        .db
        .lock()
        .await
        .update_session_title(&id, trimmed)
        .map_err(err)?
        .ok_or_else(|| "session not found".into())
}

#[tauri::command]
pub async fn session_delete(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let runs = state.db.lock().await.list_runs(&id).map_err(err)?;
    for run in runs {
        if LIVE_STATUSES.contains(&run.status.as_str()) {
            let _ = cancel_run_inner(&run.id, &state).await;
        }
    }
    let deleted = state.db.lock().await.delete_session(&id).map_err(err)?;
    if !deleted {
        return Err("session not found".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn session_archive(id: String, state: State<'_, AppState>) -> CommandResult<Session> {
    set_session_archived(id, true, state).await
}

#[tauri::command]
pub async fn session_unarchive(id: String, state: State<'_, AppState>) -> CommandResult<Session> {
    set_session_archived(id, false, state).await
}

async fn set_session_archived(
    id: String,
    archived: bool,
    state: State<'_, AppState>,
) -> CommandResult<Session> {
    state
        .db
        .lock()
        .await
        .set_session_archived(&id, archived)
        .map_err(err)?
        .ok_or_else(|| "session not found".into())
}

async fn cancel_run_inner(run_id: &str, state: &State<'_, AppState>) -> CommandResult<()> {
    let token = state.runs.lock().await.get(run_id).cloned();
    if let Some(token) = token.as_ref() {
        if let Some(run) = state.db.lock().await.run(run_id).map_err(err)? {
            if let Some(profile) = state
                .db
                .lock()
                .await
                .provider(&run.provider_id)
                .map_err(err)?
            {
                use crate::services::providers::ProviderAdapter;
                crate::services::providers::adapter(&profile).cancel(token);
            } else {
                token.cancel();
            }
        } else {
            token.cancel();
        }
    }
    state
        .db
        .lock()
        .await
        .update_run_status(run_id, "cancelled", None, None)
        .map_err(err)
}

#[tauri::command]
pub async fn run_list(session_id: String, state: State<'_, AppState>) -> CommandResult<Vec<Run>> {
    state.db.lock().await.list_runs(&session_id).map_err(err)
}

#[tauri::command]
pub async fn run_recent(state: State<'_, AppState>) -> CommandResult<Vec<Run>> {
    state.db.lock().await.recent_runs(100).map_err(err)
}

#[tauri::command]
pub async fn run_events(
    run_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<RunEvent>> {
    state.db.lock().await.list_events(&run_id).map_err(err)
}

#[tauri::command]
pub async fn run_events_page(
    run_id: String,
    before_seq: Option<i64>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> CommandResult<RunEventPage> {
    state
        .db
        .lock()
        .await
        .list_events_page(&run_id, before_seq, limit.unwrap_or(500))
        .map_err(err)
}

#[tauri::command]
pub async fn run_inputs(run_id: String, state: State<'_, AppState>) -> CommandResult<RunInputs> {
    let db = state.db.lock().await;
    let run = db
        .run(&run_id)
        .map_err(err)?
        .ok_or_else(|| "run not found".to_string())?;
    Ok(RunInputs {
        model: run.model,
        context_item_ids: db.run_context_ids(&run_id).map_err(err)?,
        skill_ids: db
            .run_skills(&run_id)
            .map_err(err)?
            .into_iter()
            .map(|(id, _)| id)
            .collect(),
        mcp_server_ids: db.run_mcp_ids(&run_id).map_err(err)?,
    })
}

#[tauri::command]
pub async fn run_checkpoints(
    run_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<Checkpoint>> {
    state.db.lock().await.list_checkpoints(&run_id).map_err(err)
}

#[tauri::command]
pub async fn run_start(
    app: AppHandle,
    request: StartRunRequest,
    on_event: Channel<RunEvent>,
    state: State<'_, AppState>,
) -> CommandResult<Run> {
    agent::start(app, state.inner().clone(), request, Some(on_event))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn run_continue(
    app: AppHandle,
    run_id: String,
    note: Option<String>,
    on_event: Channel<RunEvent>,
    state: State<'_, AppState>,
) -> CommandResult<Run> {
    let previous = state
        .db
        .lock()
        .await
        .run(&run_id)
        .map_err(err)?
        .ok_or_else(|| "run not found".to_string())?;
    let (context_item_ids, skill_ids, mcp_server_ids) = {
        let db = state.db.lock().await;
        (
            db.run_context_ids(&run_id).map_err(err)?,
            db.run_skills(&run_id)
                .map_err(err)?
                .into_iter()
                .map(|(id, _)| id)
                .collect(),
            db.run_mcp_ids(&run_id).map_err(err)?,
        )
    };
    let request = StartRunRequest {
        session_id: previous.session_id,
        workspace_id: previous.workspace_id,
        provider_id: previous.provider_id,
        model: previous.model,
        prompt: format!("Continue the previous task. Human changes on disk take precedence.\n\nOriginal request:\n{}\n\nUser note:\n{}", previous.prompt, note.unwrap_or_default()),
        auto_execute: None,
        context_paths: vec![],
        context_item_ids,
        skill_ids,
        mcp_server_ids,
    };
    agent::start(app, state.inner().clone(), request, Some(on_event))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn run_retry(
    app: AppHandle,
    run_id: String,
    on_event: Channel<RunEvent>,
    state: State<'_, AppState>,
) -> CommandResult<Run> {
    let previous = state
        .db
        .lock()
        .await
        .run(&run_id)
        .map_err(err)?
        .ok_or_else(|| "run not found".to_string())?;
    if !matches!(
        previous.status.as_str(),
        "failed" | "cancelled" | "interrupted"
    ) {
        return Err("only failed, cancelled, or interrupted runs can be retried".into());
    }
    let (context_item_ids, skill_ids, mcp_server_ids) = {
        let db = state.db.lock().await;
        (
            db.run_context_ids(&run_id).map_err(err)?,
            db.run_skills(&run_id)
                .map_err(err)?
                .into_iter()
                .map(|(id, _)| id)
                .collect(),
            db.run_mcp_ids(&run_id).map_err(err)?,
        )
    };
    agent::start(
        app,
        state.inner().clone(),
        StartRunRequest {
            session_id: previous.session_id,
            workspace_id: previous.workspace_id,
            provider_id: previous.provider_id,
            model: previous.model,
            prompt: previous.prompt,
            auto_execute: None,
            context_paths: vec![],
            context_item_ids,
            skill_ids,
            mcp_server_ids,
        },
        Some(on_event),
    )
    .await
    .map_err(err)
}

#[tauri::command]
pub async fn run_cancel(run_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    cancel_run_inner(&run_id, &state).await
}

#[tauri::command]
pub async fn approval_list(state: State<'_, AppState>) -> CommandResult<Vec<Approval>> {
    state.db.lock().await.pending_approvals().map_err(err)
}

#[tauri::command]
pub async fn approval_resolve(
    approval_id: String,
    decision: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    if !matches!(
        decision.as_str(),
        "approve_once" | "allow_run" | "always_allow" | "deny"
    ) {
        return Err("invalid approval decision".into());
    }
    let target = state
        .db
        .lock()
        .await
        .approval_target(&approval_id)
        .map_err(err)?;
    // A run-scoped allowance lives in memory for the rest of this run only; it is
    // deliberately never written to policy_rules.
    if decision == "allow_run" {
        if let Some((run_id, Some(scope_key))) = target {
            state
                .run_allowances
                .lock()
                .await
                .entry(run_id)
                .or_default()
                .insert(scope_key);
        }
    }
    state
        .db
        .lock()
        .await
        .resolve_approval(&approval_id, &decision)
        .map_err(err)?;
    if let Some(sender) = state.approvals.lock().await.remove(&approval_id) {
        let _ = sender.send(decision);
    }
    Ok(())
}

#[tauri::command]
pub async fn policy_rule_list(state: State<'_, AppState>) -> CommandResult<Vec<PolicyRule>> {
    state.db.lock().await.list_policy_rules().map_err(err)
}

#[tauri::command]
pub async fn policy_rule_delete(rule_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state
        .db
        .lock()
        .await
        .delete_policy_rule(&rule_id)
        .map_err(err)
}

#[tauri::command]
pub async fn run_queue(state: State<'_, AppState>) -> CommandResult<Vec<QueueItem>> {
    let runs = state.db.lock().await.recent_runs(100).map_err(err)?;
    Ok(runs
        .into_iter()
        .filter(|run| {
            matches!(
                run.status.as_str(),
                "queued" | "starting" | "running" | "waiting_approval" | "paused"
            )
        })
        .map(|run| {
            let name: String = run.prompt.chars().take(32).collect();
            QueueItem {
                run_id: run.id.clone(),
                name,
                workspace_id: run.workspace_id,
                status: run.status,
                meta: format!("{} · {}", run.id, run.plan_progress.unwrap_or_default()),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn usage_get(
    run_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<UsageReport> {
    state.db.lock().await.usage(run_id.as_deref()).map_err(err)
}

#[tauri::command]
pub async fn usage_series(
    days: Option<i64>,
    state: State<'_, AppState>,
) -> CommandResult<UsageSeries> {
    state
        .db
        .lock()
        .await
        .usage_series(days.unwrap_or(7))
        .map_err(err)
}
