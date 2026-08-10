use std::path::{Path, PathBuf};

use tauri::State;

use crate::{
    commands::{
        error::{err, CommandResult},
        workspace::root_for,
    },
    domain::models::{ArtifactPreview, DesignSystem, DesignSystemContent},
    services::{design, state::AppState},
};

#[tauri::command]
pub async fn design_system_list(
    workspace_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<DesignSystem>> {
    let root = workspace_root(&state, workspace_id.as_deref()).await?;
    design::list(&state.data_dir, root.as_deref()).map_err(err)
}

#[tauri::command]
pub async fn design_system_read(
    workspace_id: Option<String>,
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<DesignSystemContent> {
    let root = workspace_root(&state, workspace_id.as_deref()).await?;
    design::read(&state.data_dir, root.as_deref(), &id).map_err(err)
}

#[tauri::command]
pub async fn artifact_preview(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> CommandResult<ArtifactPreview> {
    let root = root_for(&state, &workspace_id).await?;
    design::preview_html(Path::new(&root), &path).map_err(err)
}

async fn workspace_root(
    state: &AppState,
    workspace_id: Option<&str>,
) -> CommandResult<Option<PathBuf>> {
    match workspace_id {
        Some(id) => Ok(Some(PathBuf::from(root_for(state, id).await?))),
        None => Ok(None),
    }
}
