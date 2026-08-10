use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Result};
use chrono::Utc;
use ignore::WalkBuilder;
use serde_json::{json, Map, Value};
use similar::TextDiff;
use uuid::Uuid;

use crate::{domain::models::Checkpoint, services::workspace};

pub fn create_checkpoint(
    data_dir: &Path,
    root: &Path,
    run_id: &str,
    paths: &[String],
    label: &str,
) -> Result<(Checkpoint, Value)> {
    let id = format!("checkpoint_{}", Uuid::new_v4().simple());
    let snapshot_dir = data_dir.join("checkpoints").join(run_id).join(&id);
    fs::create_dir_all(&snapshot_dir)?;
    let mut manifest = Map::new();
    for relative in paths {
        let target = workspace::resolve_for_write(root, relative)?;
        let existed = target.is_file();
        if existed {
            let destination = snapshot_dir.join(workspace::safe_relative(relative)?);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&target, destination)?;
        }
        manifest.insert(relative.replace('\\', "/"), json!({"existed": existed}));
    }
    let checkpoint = Checkpoint {
        id,
        run_id: run_id.into(),
        label: label.into(),
        snapshot_ref: snapshot_dir.to_string_lossy().to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    Ok((
        checkpoint,
        json!({"version":2,"scope":"paths","files":manifest}),
    ))
}

pub fn create_workspace_checkpoint(
    data_dir: &Path,
    root: &Path,
    run_id: &str,
    label: &str,
) -> Result<(Checkpoint, Value)> {
    const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
    let root = root.canonicalize()?;
    let id = format!("checkpoint_{}", Uuid::new_v4().simple());
    let snapshot_dir = data_dir.join("checkpoints").join(run_id).join(&id);
    fs::create_dir_all(&snapshot_dir)?;
    let mut manifest = Map::new();
    let mut total = 0u64;
    for entry in workspace_files(&root) {
        let path = entry?;
        let relative = path
            .strip_prefix(&root)?
            .to_string_lossy()
            .replace('\\', "/");
        let size = path.metadata()?.len();
        total = total.saturating_add(size);
        if total > MAX_SNAPSHOT_BYTES {
            let _ = fs::remove_dir_all(&snapshot_dir);
            return Err(anyhow!("workspace checkpoint exceeds the 256 MiB limit"));
        }
        let destination = snapshot_dir.join(workspace::safe_relative(&relative)?);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&path, destination)?;
        manifest.insert(relative, json!({"existed":true,"sizeBytes":size}));
    }
    let git = capture_git_state(&root, &snapshot_dir)?;
    let checkpoint = Checkpoint {
        id,
        run_id: run_id.into(),
        label: label.into(),
        snapshot_ref: snapshot_dir.to_string_lossy().to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    Ok((
        checkpoint,
        json!({"version":2,"scope":"workspace","files":manifest,"sizeBytes":total,"git":git}),
    ))
}

pub fn restore_checkpoint(
    data_dir: &Path,
    root: &Path,
    snapshot_ref: &str,
    manifest: &Value,
) -> Result<Vec<String>> {
    let checkpoint_root = data_dir.join("checkpoints").canonicalize()?;
    let snapshot_dir = PathBuf::from(snapshot_ref).canonicalize()?;
    if !snapshot_dir.starts_with(&checkpoint_root) {
        return Err(anyhow!(
            "checkpoint snapshot is outside the HerDock data directory"
        ));
    }
    let entries = manifest
        .get("files")
        .unwrap_or(manifest)
        .as_object()
        .ok_or_else(|| anyhow!("invalid checkpoint manifest"))?;
    if manifest.get("scope").and_then(Value::as_str) == Some("workspace") {
        for current in workspace_files(&root.canonicalize()?) {
            let current = current?;
            let relative = current
                .strip_prefix(root.canonicalize()?)?
                .to_string_lossy()
                .replace('\\', "/");
            if !entries.contains_key(&relative) {
                fs::remove_file(current)?;
            }
        }
    }
    let mut restored = Vec::new();
    for (relative, metadata) in entries {
        let target = workspace::resolve_for_write(root, relative)?;
        let source = snapshot_dir.join(workspace::safe_relative(relative)?);
        let existed = metadata
            .get("existed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if existed {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(source, &target)?;
        } else if target.is_file() {
            fs::remove_file(&target)?;
        }
        restored.push(relative.clone());
    }
    if let Some(git) = manifest.get("git") {
        restore_git_state(root, &snapshot_dir, git)?;
    }
    Ok(restored)
}

fn capture_git_state(root: &Path, snapshot_dir: &Path) -> Result<Value> {
    let Some(head) = git_output(root, &["rev-parse", "--verify", "HEAD"]) else {
        return Ok(Value::Null);
    };
    let head_ref = git_output(root, &["symbolic-ref", "-q", "HEAD"]);
    let index_path = git_output(root, &["rev-parse", "--git-path", "index"])
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        });
    let index_existed = index_path.as_ref().is_some_and(|path| path.is_file());
    if let Some(index_path) = index_path.as_ref().filter(|path| path.is_file()) {
        let destination = snapshot_dir.join(".herdock").join("git-index");
        fs::create_dir_all(destination.parent().expect("snapshot index parent"))?;
        fs::copy(index_path, destination)?;
    }
    Ok(json!({"head":head,"headRef":head_ref,"indexExisted":index_existed}))
}

fn restore_git_state(root: &Path, snapshot_dir: &Path, state: &Value) -> Result<()> {
    let Some(head) = state.get("head").and_then(Value::as_str) else {
        return Ok(());
    };
    if let Some(reference) = state.get("headRef").and_then(Value::as_str) {
        git_status(root, &["symbolic-ref", "HEAD", reference])?;
        git_status(root, &["update-ref", reference, head])?;
    } else {
        git_status(root, &["update-ref", "--no-deref", "HEAD", head])?;
    }
    if let Some(index_path) = git_output(root, &["rev-parse", "--git-path", "index"])
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        })
    {
        let snapshot = snapshot_dir.join(".herdock").join("git-index");
        if state.get("indexExisted").and_then(Value::as_bool) == Some(true) {
            if let Some(parent) = index_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(snapshot, index_path)?;
        } else if index_path.is_file() {
            fs::remove_file(index_path)?;
        }
    }
    Ok(())
}

fn git_output(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn git_status(root: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("git").args(args).current_dir(root).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("git {} failed with {status}", args.join(" ")))
    }
}

pub fn preview_checkpoint(
    data_dir: &Path,
    root: &Path,
    snapshot_ref: &str,
    manifest: &Value,
) -> Result<Value> {
    let checkpoint_root = data_dir.join("checkpoints").canonicalize()?;
    let snapshot_dir = PathBuf::from(snapshot_ref).canonicalize()?;
    if !snapshot_dir.starts_with(&checkpoint_root) {
        return Err(anyhow!(
            "checkpoint snapshot is outside the HerDock data directory"
        ));
    }
    let entries = manifest
        .get("files")
        .unwrap_or(manifest)
        .as_object()
        .ok_or_else(|| anyhow!("invalid checkpoint manifest"))?;
    let mut files = Vec::new();
    let mut diff_budget = 200_000usize;
    for relative in entries.keys() {
        let target = workspace::resolve_for_write(root, relative)?;
        let source = snapshot_dir.join(workspace::safe_relative(relative)?);
        let before = fs::read(&source).unwrap_or_default();
        let after = fs::read(&target).unwrap_or_default();
        if before == after {
            continue;
        }
        let diff = match (std::str::from_utf8(&before), std::str::from_utf8(&after)) {
            (Ok(before), Ok(after)) if diff_budget > 0 => {
                let value = TextDiff::from_lines(before, after)
                    .unified_diff()
                    .header(&format!("checkpoint/{relative}"), relative)
                    .to_string();
                let value: String = value.chars().take(diff_budget).collect();
                diff_budget = diff_budget.saturating_sub(value.len());
                Some(value)
            }
            _ => None,
        };
        files.push(json!({"path":relative,"kind":if target.exists(){"modified"}else{"deleted"},"diff":diff}));
    }
    Ok(json!({
        "scope":manifest.get("scope").and_then(Value::as_str).unwrap_or("paths"),
        "files":files,
        "sizeBytes":manifest.get("sizeBytes").and_then(Value::as_u64).unwrap_or(0)
    }))
}

fn workspace_files(root: &Path) -> impl Iterator<Item = Result<PathBuf>> + '_ {
    WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".git" | "node_modules" | "target" | "dist" | ".next")
            )
        })
        .build()
        .filter_map(|entry| match entry {
            Ok(entry) if entry.file_type().is_some_and(|kind| kind.is_file()) => {
                Some(Ok(entry.into_path()))
            }
            Ok(_) => None,
            Err(error) => Some(Err(error.into())),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_snapshot_outside_data_directory() {
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        fs::create_dir_all(data.path().join("checkpoints")).unwrap();
        let result = restore_checkpoint(
            data.path(),
            workspace.path(),
            external.path().to_str().unwrap(),
            &json!({"file.txt":{"existed":true}}),
        );
        assert!(result.is_err());
    }

    #[test]
    fn workspace_restore_preserves_pre_run_dirty_state_and_index() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        fs::write(workspace.path().join("tracked.txt"), "committed\n").unwrap();
        git_status(workspace.path(), &["init"]).unwrap();
        git_status(workspace.path(), &["add", "tracked.txt"]).unwrap();
        git_status(
            workspace.path(),
            &[
                "-c",
                "user.name=HerDock Test",
                "-c",
                "user.email=test@herdock.local",
                "commit",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        fs::write(workspace.path().join("tracked.txt"), "dirty before run\n").unwrap();
        fs::write(workspace.path().join("existing-untracked.txt"), "keep\n").unwrap();

        let (checkpoint, manifest) =
            create_workspace_checkpoint(data.path(), workspace.path(), "run_test", "before run")
                .unwrap();
        fs::write(workspace.path().join("tracked.txt"), "agent changed\n").unwrap();
        fs::write(workspace.path().join("agent-new.txt"), "remove\n").unwrap();
        git_status(workspace.path(), &["add", "tracked.txt", "agent-new.txt"]).unwrap();

        restore_checkpoint(
            data.path(),
            workspace.path(),
            &checkpoint.snapshot_ref,
            &manifest,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(workspace.path().join("tracked.txt")).unwrap(),
            "dirty before run\n"
        );
        assert!(workspace.path().join("existing-untracked.txt").is_file());
        assert!(!workspace.path().join("agent-new.txt").exists());
        let cached = git_output(workspace.path(), &["diff", "--cached", "--name-only"]);
        assert!(cached.is_none());
    }
}
