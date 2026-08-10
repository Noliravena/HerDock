use tauri::{ipc::Channel, State};

use crate::{
    commands::error::{err, CommandResult},
    commands::{app::default_shell, workspace::root_for},
    services::{
        state::AppState,
        terminal::{self, TerminalEvent},
    },
};

#[tauri::command]
pub async fn terminal_open(
    workspace_id: String,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    let cwd = root_for(&state, &workspace_id).await?;
    let configured = state
        .db
        .lock()
        .await
        .settings()
        .map_err(err)?
        .terminal_shell;
    let shell = shell
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!configured.trim().is_empty()).then_some(configured))
        .unwrap_or_else(default_shell);
    let (id, handle) =
        terminal::open(&shell, &cwd, cols.max(20), rows.max(5), on_event).map_err(err)?;
    state.terminals.lock().await.insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
pub async fn terminal_write(
    terminal_id: String,
    data: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let mut terminals = state.terminals.lock().await;
    terminals
        .get_mut(&terminal_id)
        .ok_or_else(|| "terminal not found".to_string())?
        .write(&data)
        .map_err(err)
}

#[tauri::command]
pub async fn terminal_resize(
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let terminals = state.terminals.lock().await;
    terminals
        .get(&terminal_id)
        .ok_or_else(|| "terminal not found".to_string())?
        .resize(cols.max(20), rows.max(5))
        .map_err(err)
}

#[tauri::command]
pub async fn terminal_close(terminal_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    if let Some(mut terminal) = state.terminals.lock().await.remove(&terminal_id) {
        terminal.close().map_err(err)?;
    }
    Ok(())
}
