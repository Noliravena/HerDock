use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    commands::error::{err, CommandResult},
    services::{
        browser::{BrowserBounds, BrowserStatus},
        state::AppState,
    },
};

#[tauri::command]
pub async fn browser_create(
    id: String,
    url: String,
    bounds: BrowserBounds,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<BrowserStatus> {
    state
        .browser
        .create(&app, &id, &url, bounds)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn browser_show(
    id: String,
    bounds: BrowserBounds,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.browser.show(&id, bounds).await.map_err(err)
}

#[tauri::command]
pub async fn browser_set_bounds(
    id: String,
    bounds: BrowserBounds,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.browser.set_bounds(&id, bounds).await.map_err(err)
}

#[tauri::command]
pub async fn browser_hide(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.browser.hide(&id).await.map_err(err)
}

#[tauri::command]
pub async fn browser_close(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.browser.close(&id).await.map_err(err)
}

#[tauri::command]
pub async fn browser_navigate(
    id: String,
    target: String,
    state: State<'_, AppState>,
) -> CommandResult<BrowserStatus> {
    state
        .browser
        .navigate(Some(&id), &target)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn browser_search(
    id: String,
    query: String,
    engine: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<BrowserStatus> {
    state
        .browser
        .search(Some(&id), &query, engine.as_deref())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn browser_back(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.browser.back(&id).await.map_err(err)
}

#[tauri::command]
pub async fn browser_forward(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.browser.forward(&id).await.map_err(err)
}

#[tauri::command]
pub async fn browser_reload(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    state.browser.reload(&id).await.map_err(err)
}

#[tauri::command]
pub async fn browser_status(
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<BrowserStatus> {
    state.browser.status(&id).await.map_err(err)
}

#[tauri::command]
pub async fn browser_list(state: State<'_, AppState>) -> CommandResult<Vec<BrowserStatus>> {
    Ok(state.browser.list().await)
}

#[tauri::command]
pub async fn browser_snapshot(
    id: String,
    max_chars: Option<usize>,
    state: State<'_, AppState>,
) -> CommandResult<Value> {
    state
        .browser
        .snapshot(Some(&id), max_chars.unwrap_or(40_000))
        .await
        .map_err(err)
}
