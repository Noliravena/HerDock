use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};

use crate::{domain::models::ContextItem, infra::database::Database, services::workspace};

const MAX_TEXT_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024;

pub fn attach_workspace_file(
    db: &Database,
    workspace_id: &str,
    root: &Path,
    relative: &str,
) -> Result<ContextItem> {
    if let Some(item) = db.context_item_for_workspace_path(workspace_id, relative)? {
        return Ok(item);
    }
    let file = workspace::read_file(root, relative)?;
    if file.binary {
        return Err(anyhow!("binary attachments are not supported"));
    }
    if file.content.len() as u64 > MAX_TEXT_ATTACHMENT_BYTES {
        return Err(anyhow!("attachment exceeds the 2 MiB limit"));
    }
    let digest = hex_digest(file.content.as_bytes());
    let item = ContextItem {
        id: format!(
            "ctx_{}",
            &hex_digest(format!("{workspace_id}:{relative}").as_bytes())[..20]
        ),
        workspace_id: Some(workspace_id.to_string()),
        source_kind: "workspace".into(),
        display_name: Path::new(relative)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(relative)
            .to_string(),
        relative_path: Some(relative.replace('\\', "/")),
        stored_path: None,
        mime_type: "text/plain; charset=utf-8".into(),
        size_bytes: file.content.len() as i64,
        sha256: digest,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    db.upsert_context_item(&item)?;
    Ok(item)
}

pub fn import_external_file(
    db: &Database,
    data_dir: &Path,
    workspace_id: &str,
    source: &Path,
) -> Result<ContextItem> {
    let source = source
        .canonicalize()
        .with_context(|| format!("attachment does not exist: {}", source.display()))?;
    if !source.is_file() {
        return Err(anyhow!("attachment path is not a file"));
    }
    let metadata = source.metadata()?;
    if metadata.len() > MAX_TEXT_ATTACHMENT_BYTES {
        return Err(anyhow!("attachment exceeds the 2 MiB limit"));
    }
    let bytes = fs::read(&source)?;
    let _ = std::str::from_utf8(&bytes).context("only UTF-8 text attachments are supported")?;
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(anyhow!("binary attachments are not supported"));
    }
    let digest = hex_digest(&bytes);
    if let Some(item) = db
        .list_context_items(workspace_id)?
        .into_iter()
        .find(|item| item.source_kind == "imported" && item.sha256 == digest)
    {
        return Ok(item);
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("attachment name is not valid UTF-8"))?
        .to_string();
    let directory = data_dir.join("attachments").join(&digest);
    fs::create_dir_all(&directory)?;
    let destination = directory.join(&name);
    fs::write(&destination, &bytes)?;
    let item = ContextItem {
        id: format!(
            "ctx_{}",
            &hex_digest(format!("{workspace_id}:{digest}").as_bytes())[..20]
        ),
        workspace_id: Some(workspace_id.to_string()),
        source_kind: "imported".into(),
        display_name: name,
        relative_path: None,
        stored_path: Some(destination.to_string_lossy().to_string()),
        mime_type: "text/plain; charset=utf-8".into(),
        size_bytes: bytes.len() as i64,
        sha256: digest,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    db.upsert_context_item(&item)?;
    Ok(item)
}

pub fn render(item: &ContextItem, root: &Path) -> Result<String> {
    let content = match item.source_kind.as_str() {
        "workspace" => {
            workspace::read_file(
                root,
                item.relative_path
                    .as_deref()
                    .ok_or_else(|| anyhow!("workspace context path is missing"))?,
            )?
            .content
        }
        "imported" => {
            let path = item
                .stored_path
                .as_deref()
                .ok_or_else(|| anyhow!("stored attachment path is missing"))?;
            fs::read_to_string(path)?
        }
        kind => return Err(anyhow!("unsupported context kind: {kind}")),
    };
    Ok(format!(
        "\n--- context: {} ({}) ---\n{}\n",
        item.display_name, item.source_kind, content
    ))
}

pub fn remove_storage(item: &ContextItem, data_dir: &Path) -> Result<()> {
    let Some(path) = item.stored_path.as_deref() else {
        return Ok(());
    };
    let root = data_dir.join("attachments").canonicalize()?;
    let path = PathBuf::from(path).canonicalize()?;
    if !path.starts_with(&root) {
        return Err(anyhow!("attachment storage path escaped app data"));
    }
    fs::remove_file(path)?;
    Ok(())
}

fn hex_digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::Workspace;

    fn database(root: &Path) -> Database {
        let db = Database::open(&root.join("context.db")).unwrap();
        let stamp = chrono::Utc::now().to_rfc3339();
        db.upsert_workspace(&Workspace {
            id: "ws_test".into(),
            name: "test".into(),
            root_path: root.to_string_lossy().to_string(),
            branch: None,
            dirty_summary: None,
            created_at: stamp.clone(),
            updated_at: stamp,
        })
        .unwrap();
        db
    }

    #[test]
    fn external_text_is_deduplicated_and_binary_is_rejected() {
        let app_data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let db = database(workspace.path());
        let text_path = source.path().join("notes.txt");
        fs::write(&text_path, "same context").unwrap();
        let first = import_external_file(&db, app_data.path(), "ws_test", &text_path).unwrap();
        let second = import_external_file(&db, app_data.path(), "ws_test", &text_path).unwrap();
        assert_eq!(first.id, second.id);
        assert!(Path::new(first.stored_path.as_deref().unwrap()).is_file());

        let binary_path = source.path().join("binary.dat");
        fs::write(&binary_path, [0, 1, 2, 3]).unwrap();
        assert!(import_external_file(&db, app_data.path(), "ws_test", &binary_path).is_err());
    }

    #[test]
    fn rejects_attachments_larger_than_two_mib() {
        let app_data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let db = database(workspace.path());
        let path = source.path().join("large.txt");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_TEXT_ATTACHMENT_BYTES + 1).unwrap();
        assert!(import_external_file(&db, app_data.path(), "ws_test", &path).is_err());
    }
}
