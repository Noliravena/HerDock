use std::path::{Path, PathBuf};

use chrono::Utc;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::{
    commands::error::{err, CommandResult},
    domain::models::{
        Artifact, ContextImportRequest, ContextItem, FileRead, FsNode, SearchResult, Workspace,
        WorkspaceContext,
    },
    services::{checkpoints, context, state::AppState, workspace},
};

#[tauri::command]
pub async fn workspace_list(state: State<'_, AppState>) -> CommandResult<Vec<Workspace>> {
    state.db.lock().await.list_workspaces().map_err(err)
}

#[tauri::command]
pub async fn workspace_open(path: String, state: State<'_, AppState>) -> CommandResult<Workspace> {
    let root = workspace::canonical_workspace(&path).map_err(err)?;
    let root_string = root.to_string_lossy().to_string();
    let db = state.db.lock().await;
    let existing = db.workspace_by_path(&root_string).map_err(err)?;
    let stamp = Utc::now().to_rfc3339();
    let workspace = Workspace {
        id: existing
            .as_ref()
            .map(|value| value.id.clone())
            .unwrap_or_else(|| format!("ws_{}", Uuid::new_v4().simple())),
        name: root
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "workspace".into()),
        root_path: root_string,
        branch: workspace::git_branch(&root),
        dirty_summary: workspace::git_dirty_summary(&root),
        created_at: existing
            .as_ref()
            .map(|value| value.created_at.clone())
            .unwrap_or_else(|| stamp.clone()),
        updated_at: stamp,
    };
    db.upsert_workspace(&workspace).map_err(err)?;
    Ok(workspace)
}

#[tauri::command]
pub async fn workspace_tree(
    workspace_id: String,
    depth: Option<usize>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<FsNode>> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::tree(Path::new(&root), depth.unwrap_or(4).clamp(1, 8)).map_err(err)
}

#[tauri::command]
pub async fn file_read(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> CommandResult<FileRead> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::read_file(Path::new(&root), &path).map_err(err)
}

#[tauri::command]
pub async fn file_write(
    workspace_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::write_file(Path::new(&root), &path, &content).map_err(err)
}

#[tauri::command]
pub async fn file_create(
    workspace_id: String,
    path: String,
    kind: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::create_entry(Path::new(&root), &path, &kind).map_err(err)
}

#[tauri::command]
pub async fn file_rename(
    workspace_id: String,
    from: String,
    to: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::rename_entry(Path::new(&root), &from, &to).map_err(err)
}

#[tauri::command]
pub async fn file_delete(
    workspace_id: String,
    path: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::delete_entry(Path::new(&root), &path).map_err(err)
}

#[tauri::command]
pub async fn file_search(
    workspace_id: String,
    query: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<SearchResult>> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::search(Path::new(&root), &query, 100).map_err(err)
}

#[tauri::command]
pub async fn git_diff(
    workspace_id: String,
    path: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::git_diff(Path::new(&root), path.as_deref()).map_err(err)
}

#[tauri::command]
pub async fn workspace_context(
    workspace_id: String,
    state: State<'_, AppState>,
) -> CommandResult<WorkspaceContext> {
    let root = root_for(&state, &workspace_id).await?;
    workspace::context(Path::new(&root)).map_err(err)
}

#[tauri::command]
pub async fn context_list(
    workspace_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ContextItem>> {
    state
        .db
        .lock()
        .await
        .list_context_items(&workspace_id)
        .map_err(err)
}

#[tauri::command]
pub async fn context_import(
    request: ContextImportRequest,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ContextItem>> {
    let root = PathBuf::from(root_for(&state, &request.workspace_id).await?);
    let canonical_root = root.canonicalize().map_err(err)?;
    let mut out = Vec::new();
    let db = state.db.lock().await;
    for raw in request.paths {
        let source = PathBuf::from(&raw);
        let item = if source.is_absolute() {
            let canonical = source.canonicalize().map_err(err)?;
            if canonical.starts_with(&canonical_root) {
                let relative = canonical
                    .strip_prefix(&canonical_root)
                    .map_err(err)?
                    .to_string_lossy()
                    .replace('\\', "/");
                context::attach_workspace_file(
                    &db,
                    &request.workspace_id,
                    &canonical_root,
                    &relative,
                )
                .map_err(err)?
            } else {
                context::import_external_file(
                    &db,
                    &state.data_dir,
                    &request.workspace_id,
                    &canonical,
                )
                .map_err(err)?
            }
        } else {
            context::attach_workspace_file(&db, &request.workspace_id, &canonical_root, &raw)
                .map_err(err)?
        };
        if !out
            .iter()
            .any(|existing: &ContextItem| existing.id == item.id)
        {
            out.push(item);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn context_remove(context_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let item = state
        .db
        .lock()
        .await
        .context_items(std::slice::from_ref(&context_id))
        .map_err(err)?
        .into_iter()
        .next()
        .ok_or_else(|| "context item not found".to_string())?;
    state
        .db
        .lock()
        .await
        .delete_context_item(&context_id)
        .map_err(err)?;
    context::remove_storage(&item, &state.data_dir).map_err(err)
}

#[tauri::command]
pub async fn artifact_list(
    workspace_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<Artifact>> {
    let root = root_for(&state, &workspace_id).await?;
    let mut artifacts =
        workspace::scan_artifacts(Path::new(&root), &workspace_id, None).map_err(err)?;
    let db = state.db.lock().await;
    let existing = db.list_artifacts(&workspace_id).map_err(err)?;
    for artifact in &mut artifacts {
        if let Some(previous) = existing.iter().find(|item| item.id == artifact.id) {
            artifact.run_id.clone_from(&previous.run_id);
        }
    }
    db.replace_artifacts(&workspace_id, &artifacts)
        .map_err(err)?;
    db.list_artifacts(&workspace_id).map_err(err)
}

#[tauri::command]
pub async fn artifact_reveal(
    workspace_id: String,
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let root = root_for(&state, &workspace_id).await?;
    let target = workspace::resolve_existing(Path::new(&root), &path).map_err(err)?;
    app.opener().reveal_item_in_dir(target).map_err(err)
}

#[tauri::command]
pub async fn artifact_export(
    workspace_id: String,
    path: String,
    destination: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let root = root_for(&state, &workspace_id).await?;
    let source = workspace::resolve_existing(Path::new(&root), &path).map_err(err)?;
    if !source.is_file() {
        return Err("artifact is not a file".into());
    }
    let destination = PathBuf::from(destination);
    if !destination.is_absolute() {
        return Err("export destination must be absolute".into());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "export destination has no parent".to_string())?;
    if !parent.is_dir() {
        return Err("export destination parent does not exist".into());
    }
    std::fs::copy(source, destination).map(|_| ()).map_err(err)
}

#[tauri::command]
pub async fn checkpoint_restore(
    checkpoint_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<String>> {
    let (run_id, snapshot, manifest) = {
        let db = state.db.lock().await;
        db.checkpoint_manifest(&checkpoint_id)
            .map_err(err)?
            .ok_or_else(|| "checkpoint not found".to_string())?
    };
    let workspace_id = state
        .db
        .lock()
        .await
        .run(&run_id)
        .map_err(err)?
        .map(|run| run.workspace_id)
        .ok_or_else(|| "checkpoint run not found".to_string())?;
    let root = root_for(&state, &workspace_id).await?;
    checkpoints::restore_checkpoint(&state.data_dir, Path::new(&root), &snapshot, &manifest)
        .map_err(err)
}

#[tauri::command]
pub async fn checkpoint_preview(
    checkpoint_id: String,
    state: State<'_, AppState>,
) -> CommandResult<serde_json::Value> {
    let (run_id, snapshot, manifest) = state
        .db
        .lock()
        .await
        .checkpoint_manifest(&checkpoint_id)
        .map_err(err)?
        .ok_or_else(|| "checkpoint not found".to_string())?;
    let workspace_id = state
        .db
        .lock()
        .await
        .run(&run_id)
        .map_err(err)?
        .map(|run| run.workspace_id)
        .ok_or_else(|| "checkpoint run not found".to_string())?;
    let root = root_for(&state, &workspace_id).await?;
    let mut preview =
        checkpoints::preview_checkpoint(&state.data_dir, Path::new(&root), &snapshot, &manifest)
            .map_err(err)?;
    preview["checkpointId"] = serde_json::Value::String(checkpoint_id);
    Ok(preview)
}

pub async fn root_for(state: &AppState, workspace_id: &str) -> CommandResult<String> {
    state
        .db
        .lock()
        .await
        .workspace(workspace_id)
        .map_err(err)?
        .map(|workspace| workspace.root_path)
        .ok_or_else(|| "workspace not found".into())
}
