use std::path::PathBuf;

use chrono::Utc;
use tauri::{ipc::Channel, AppHandle, State};
use uuid::Uuid;

use crate::{
    commands::error::{err, CommandResult},
    domain::models::{
        GrokAuthStatus, GrokLoginEvent, GrokLoginResult, McpServer, ProviderHealth,
        ProviderProfile, SaveMcpRequest, SaveProviderRequest, SaveScheduleRequest, Schedule, Skill,
    },
    infra::secrets,
    services::{
        grok, mcp,
        providers::{self, ProviderAdapter},
        scheduler, skills,
        state::AppState,
    },
};

#[tauri::command]
pub async fn provider_list(state: State<'_, AppState>) -> CommandResult<Vec<ProviderHealth>> {
    let profiles = state.db.lock().await.list_providers().map_err(err)?;
    let mut out = Vec::with_capacity(profiles.len());
    for profile in profiles {
        let has_secret = profile
            .credential_ref
            .as_deref()
            .and_then(|reference| secrets::get_secret(reference).ok().flatten())
            .is_some();
        out.push(
            providers::adapter_with_secret(&profile, has_secret)
                .detect()
                .await,
        );
    }
    Ok(out)
}

#[tauri::command]
pub async fn provider_profiles(state: State<'_, AppState>) -> CommandResult<Vec<ProviderProfile>> {
    state.db.lock().await.list_providers().map_err(err)
}

#[tauri::command]
pub async fn provider_save(
    request: SaveProviderRequest,
    state: State<'_, AppState>,
) -> CommandResult<ProviderProfile> {
    if request.id.trim().is_empty() {
        return Err("provider id is required".into());
    }
    let existing = state.db.lock().await.provider(&request.id).map_err(err)?;
    let credential_ref = if request.provider_type == "cli" {
        None
    } else {
        Some(
            existing
                .as_ref()
                .and_then(|profile| profile.credential_ref.clone())
                .unwrap_or_else(|| format!("provider:{}", request.id)),
        )
    };
    if let (Some(reference), Some(api_key)) = (
        &credential_ref,
        request
            .api_key
            .as_deref()
            .filter(|value| !value.trim().is_empty()),
    ) {
        secrets::set_secret(reference, api_key).map_err(err)?;
    }
    let profile = ProviderProfile {
        id: request.id,
        provider_type: request.provider_type,
        display_name: request.display_name,
        model: request.model,
        base_url: request.base_url,
        executable: request.executable,
        credential_ref,
        enabled: request.enabled,
        config: serde_json::json!({ "candidateModels": request.candidate_models }),
    };
    state
        .db
        .lock()
        .await
        .upsert_provider(&profile)
        .map_err(err)?;
    Ok(profile)
}

#[tauri::command]
pub async fn provider_validate(
    provider_id: String,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    let profile = state
        .db
        .lock()
        .await
        .provider(&provider_id)
        .map_err(err)?
        .ok_or_else(|| "provider not found".to_string())?;
    let secret = profile
        .credential_ref
        .as_deref()
        .and_then(|reference| secrets::get_secret(reference).ok().flatten());
    providers::adapter(&profile)
        .validate(secret.as_deref())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn grok_auth_status(state: State<'_, AppState>) -> CommandResult<GrokAuthStatus> {
    let profile = grok_profile(&state).await?;
    Ok(grok::status(&profile, &state.grok_auth).await)
}

#[tauri::command]
pub async fn grok_login(
    method: String,
    on_event: Channel<GrokLoginEvent>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<GrokLoginResult> {
    let profile = grok_profile(&state).await?;
    grok::login(&app, &profile, &state.grok_auth, &method, Some(on_event))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn grok_login_submit_code(code: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.grok_auth.submit_code(&code).await.map_err(err)
}

#[tauri::command]
pub async fn grok_login_cancel(state: State<'_, AppState>) -> CommandResult<()> {
    state.grok_auth.cancel().await;
    Ok(())
}

#[tauri::command]
pub async fn grok_logout(state: State<'_, AppState>) -> CommandResult<GrokAuthStatus> {
    let profile = grok_profile(&state).await?;
    grok::logout(&profile, &state.grok_auth).await.map_err(err)
}

async fn grok_profile(state: &AppState) -> CommandResult<ProviderProfile> {
    state
        .db
        .lock()
        .await
        .provider("grok")
        .map_err(err)?
        .ok_or_else(|| "Grok Build Provider 不存在".into())
}

#[tauri::command]
pub async fn mcp_list(state: State<'_, AppState>) -> CommandResult<Vec<McpServer>> {
    state
        .db
        .lock()
        .await
        .list_mcp()
        .map(|servers| servers.into_iter().map(mcp::public_server).collect())
        .map_err(err)
}

#[tauri::command]
pub async fn mcp_save(
    request: SaveMcpRequest,
    state: State<'_, AppState>,
) -> CommandResult<McpServer> {
    if request.command.trim().is_empty() {
        return Err("MCP command is required".into());
    }
    let existing = match request.id.as_deref() {
        Some(id) => state.db.lock().await.mcp(id).map_err(err)?,
        None => None,
    };
    let id = request
        .id
        .unwrap_or_else(|| format!("mcp_{}", Uuid::new_v4().simple()));
    let env = mcp::secure_env(
        &id,
        &request.env,
        existing.as_ref().map(|server| &server.env),
    )
    .map_err(err)?;
    let server = McpServer {
        id,
        name: request.name,
        command: request.command,
        args: request.args,
        env,
        enabled: request.enabled,
        workspace_id: request.workspace_id,
        status: existing.as_ref().and_then(|server| server.status.clone()),
        tools: existing.map(|server| server.tools).unwrap_or_default(),
    };
    state.db.lock().await.upsert_mcp(&server).map_err(err)?;
    Ok(mcp::public_server(server))
}

#[tauri::command]
pub async fn mcp_delete(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.mcp.stop(&id).await.map_err(err)?;
    if let Some(server) = state.db.lock().await.mcp(&id).map_err(err)? {
        for reference in server
            .env
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(_, value)| value.as_str())
            .filter_map(|value| value.strip_prefix("keyring:"))
        {
            let _ = secrets::delete_secret(reference);
        }
    }
    state.db.lock().await.delete_mcp(&id).map_err(err)
}

#[tauri::command]
pub async fn mcp_test(id: String, state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    let mut server = state
        .db
        .lock()
        .await
        .mcp(&id)
        .map_err(err)?
        .ok_or_else(|| "MCP server not found".to_string())?;
    match state.mcp.start(&server).await {
        Ok(specs) => {
            let tools = specs.into_iter().map(|tool| tool.name).collect::<Vec<_>>();
            server.status = Some("ready".into());
            server.tools = tools.clone();
            state.db.lock().await.upsert_mcp(&server).map_err(err)?;
            Ok(tools)
        }
        Err(error) => {
            server.status = Some("error".into());
            server.tools.clear();
            state.db.lock().await.upsert_mcp(&server).map_err(err)?;
            Err(error.to_string().into())
        }
    }
}

#[tauri::command]
pub async fn mcp_start(id: String, state: State<'_, AppState>) -> CommandResult<McpServer> {
    let mut server = state
        .db
        .lock()
        .await
        .mcp(&id)
        .map_err(err)?
        .ok_or_else(|| "MCP server not found".to_string())?;
    let specs = state.mcp.start(&server).await.map_err(err)?;
    server.enabled = true;
    server.status = Some("ready".into());
    server.tools = specs.into_iter().map(|tool| tool.name).collect();
    state.db.lock().await.upsert_mcp(&server).map_err(err)?;
    Ok(mcp::public_server(server))
}

#[tauri::command]
pub async fn mcp_stop(id: String, state: State<'_, AppState>) -> CommandResult<McpServer> {
    state.mcp.stop(&id).await.map_err(err)?;
    let mut server = state
        .db
        .lock()
        .await
        .mcp(&id)
        .map_err(err)?
        .ok_or_else(|| "MCP server not found".to_string())?;
    server.enabled = false;
    server.status = Some("stopped".into());
    state.db.lock().await.upsert_mcp(&server).map_err(err)?;
    Ok(mcp::public_server(server))
}

#[tauri::command]
pub async fn skill_list(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<Skill>> {
    let root = if let Some(workspace_id) = workspace_id {
        state
            .db
            .lock()
            .await
            .workspace(&workspace_id)
            .map_err(err)?
            .map(|workspace| PathBuf::from(workspace.root_path))
    } else {
        None
    };
    skills::discover(&state.data_dir, root.as_deref()).map_err(err)
}

#[tauri::command]
pub async fn schedule_list(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<Schedule>> {
    state
        .db
        .lock()
        .await
        .list_schedules(workspace_id.as_deref())
        .map_err(err)
}

#[tauri::command]
pub async fn schedule_save(
    request: SaveScheduleRequest,
    state: State<'_, AppState>,
) -> CommandResult<Schedule> {
    let existing = if let Some(id) = &request.id {
        state
            .db
            .lock()
            .await
            .list_schedules(Some(&request.workspace_id))
            .map_err(err)?
            .into_iter()
            .find(|schedule| &schedule.id == id)
    } else {
        None
    };
    let stamp = Utc::now().to_rfc3339();
    let next_run_at =
        scheduler::next_run(&request.cron, Utc::now()).map(|value| value.to_rfc3339());
    let schedule = Schedule {
        id: request
            .id
            .unwrap_or_else(|| format!("schedule_{}", Uuid::new_v4().simple())),
        workspace_id: request.workspace_id,
        name: request.name,
        cron: request.cron,
        prompt: request.prompt,
        provider_id: request.provider_id,
        enabled: request.enabled,
        next_run_at,
        last_run_at: existing
            .as_ref()
            .and_then(|schedule| schedule.last_run_at.clone()),
        created_at: existing
            .map(|schedule| schedule.created_at)
            .unwrap_or_else(|| stamp.clone()),
        updated_at: stamp,
    };
    state
        .db
        .lock()
        .await
        .upsert_schedule(&schedule)
        .map_err(err)?;
    Ok(schedule)
}

#[tauri::command]
pub async fn schedule_toggle(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> CommandResult<Schedule> {
    let mut schedule = state
        .db
        .lock()
        .await
        .list_schedules(None)
        .map_err(err)?
        .into_iter()
        .find(|schedule| schedule.id == id)
        .ok_or_else(|| "schedule not found".to_string())?;
    schedule.enabled = enabled;
    schedule.updated_at = Utc::now().to_rfc3339();
    schedule.next_run_at = enabled
        .then(|| scheduler::next_run(&schedule.cron, Utc::now()).map(|value| value.to_rfc3339()))
        .flatten();
    state
        .db
        .lock()
        .await
        .upsert_schedule(&schedule)
        .map_err(err)?;
    Ok(schedule)
}

#[tauri::command]
pub async fn schedule_delete(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.db.lock().await.delete_schedule(&id).map_err(err)
}
