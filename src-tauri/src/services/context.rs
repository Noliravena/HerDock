use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};

use crate::{domain::models::ContextItem, infra::database::Database, services::workspace};

const MAX_TEXT_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENT_BYTES: u64 = 8 * 1024 * 1024;

fn text_mime_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("css") => "text/css; charset=utf-8",
        Some(extension) if extension.eq_ignore_ascii_case("svg") => "image/svg+xml; charset=utf-8",
        _ => "text/plain; charset=utf-8",
    }
}

fn image_mime_for_path(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("png") => Some("image/png"),
        Some(extension) if extension.eq_ignore_ascii_case("jpg") => Some("image/jpeg"),
        Some(extension) if extension.eq_ignore_ascii_case("jpeg") => Some("image/jpeg"),
        Some(extension) if extension.eq_ignore_ascii_case("webp") => Some("image/webp"),
        Some(extension) if extension.eq_ignore_ascii_case("gif") => Some("image/gif"),
        _ => None,
    }
}

fn is_image_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/jpg" | "image/webp" | "image/gif"
    )
}

fn max_bytes_for_mime(mime: &str) -> u64 {
    if is_image_mime(mime) {
        MAX_IMAGE_ATTACHMENT_BYTES
    } else {
        MAX_TEXT_ATTACHMENT_BYTES
    }
}

fn sanitize_file_name(name: &str) -> Result<String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim();
    if base.is_empty() || base == "." || base == ".." {
        return Err(anyhow!("attachment name is missing"));
    }
    Ok(base.to_string())
}

pub fn attach_workspace_file(
    db: &Database,
    workspace_id: &str,
    root: &Path,
    relative: &str,
) -> Result<ContextItem> {
    if let Some(item) = db.context_item_for_workspace_path(workspace_id, relative)? {
        return Ok(item);
    }
    if let Some(mime) = image_mime_for_path(Path::new(relative)) {
        let path = workspace::resolve_existing(root, relative)?;
        let bytes = fs::read(&path)?;
        if bytes.len() as u64 > MAX_IMAGE_ATTACHMENT_BYTES {
            return Err(anyhow!("image attachment exceeds the 8 MiB limit"));
        }
        let digest = hex_digest(&bytes);
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
            mime_type: mime.into(),
            size_bytes: bytes.len() as i64,
            sha256: digest,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        db.upsert_context_item(&item)?;
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
        mime_type: text_mime_for_path(Path::new(relative)).into(),
        size_bytes: file.content.len() as i64,
        sha256: digest,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    db.upsert_context_item(&item)?;
    Ok(item)
}

pub fn import_bytes(
    db: &Database,
    data_dir: &Path,
    workspace_id: &str,
    file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<ContextItem> {
    let name = sanitize_file_name(file_name)?;
    let mime = if is_image_mime(mime_type) {
        if mime_type == "image/jpg" {
            "image/jpeg"
        } else {
            mime_type
        }
    } else {
        text_mime_for_path(Path::new(&name))
    };
    if bytes.len() as u64 > max_bytes_for_mime(mime) {
        return Err(anyhow!(
            "attachment exceeds the {} MiB limit",
            max_bytes_for_mime(mime) / (1024 * 1024)
        ));
    }
    if !is_image_mime(mime) {
        let _ = std::str::from_utf8(bytes).context("only UTF-8 text attachments are supported")?;
        if bytes.iter().take(8192).any(|byte| *byte == 0) {
            return Err(anyhow!("binary attachments are not supported"));
        }
    }
    let digest = hex_digest(bytes);
    if let Some(item) = db
        .list_context_items(workspace_id)?
        .into_iter()
        .find(|item| item.source_kind == "imported" && item.sha256 == digest)
    {
        return Ok(item);
    }
    let directory = data_dir.join("attachments").join(&digest);
    fs::create_dir_all(&directory)?;
    let destination = directory.join(&name);
    fs::write(&destination, bytes)?;
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
        mime_type: mime.into(),
        size_bytes: bytes.len() as i64,
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
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("attachment name is not valid UTF-8"))?
        .to_string();
    let mime = image_mime_for_path(&source).unwrap_or_else(|| text_mime_for_path(&source));
    let bytes = fs::read(&source)?;
    import_bytes(db, data_dir, workspace_id, &name, mime, &bytes)
}

pub fn render(item: &ContextItem, root: &Path) -> Result<String> {
    if item.mime_type.starts_with("image/") {
        let location = item
            .stored_path
            .clone()
            .or_else(|| {
                item.relative_path
                    .as_deref()
                    .map(|relative| root.join(relative).to_string_lossy().replace('\\', "/"))
            })
            .ok_or_else(|| anyhow!("image attachment path is missing"))?;
        return Ok(format!(
            "\n--- context: {} (image) ---\n[image: {}] stored at {}\nRead this file path to inspect the screenshot.\n",
            item.display_name, item.display_name, location
        ));
    }
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
            auto_execute: None,
            created_at: stamp.clone(),
            updated_at: stamp,
        })
        .unwrap();
        db
    }

    #[test]
    fn css_and_svg_mime_types_are_consistent_for_workspace_and_external_text() {
        let app_data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let db = database(workspace.path());

        fs::write(
            workspace.path().join("theme.CSS"),
            ":root { --accent: #3b5ba5; }",
        )
        .unwrap();
        fs::write(
            workspace.path().join("mark.svg"),
            r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>"#,
        )
        .unwrap();
        fs::write(workspace.path().join("notes.md"), "plain text").unwrap();

        let workspace_css =
            attach_workspace_file(&db, "ws_test", workspace.path(), "theme.CSS").unwrap();
        let workspace_svg =
            attach_workspace_file(&db, "ws_test", workspace.path(), "mark.svg").unwrap();
        let workspace_text =
            attach_workspace_file(&db, "ws_test", workspace.path(), "notes.md").unwrap();
        assert_eq!(workspace_css.mime_type, "text/css; charset=utf-8");
        assert_eq!(workspace_svg.mime_type, "image/svg+xml; charset=utf-8");
        assert_eq!(workspace_text.mime_type, "text/plain; charset=utf-8");

        let css_path = source.path().join("external.css");
        let svg_path = source.path().join("external.SVG");
        fs::write(&css_path, "body { color: #1c1b18; }").unwrap();
        fs::write(
            &svg_path,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>"#,
        )
        .unwrap();
        let external_css =
            import_external_file(&db, app_data.path(), "ws_test", &css_path).unwrap();
        let external_svg =
            import_external_file(&db, app_data.path(), "ws_test", &svg_path).unwrap();
        assert_eq!(external_css.mime_type, "text/css; charset=utf-8");
        assert_eq!(external_svg.mime_type, "image/svg+xml; charset=utf-8");
    }

    #[test]
    fn external_text_is_deduplicated_and_binary_is_rejected() {
        let app_data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let db = database(workspace.path());
        let text_path = source.path().join("theme.css");
        fs::write(&text_path, "body { color: black; }").unwrap();
        let first = import_external_file(&db, app_data.path(), "ws_test", &text_path).unwrap();
        let second = import_external_file(&db, app_data.path(), "ws_test", &text_path).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.mime_type, "text/css; charset=utf-8");
        assert_eq!(second.mime_type, first.mime_type);
        assert!(Path::new(first.stored_path.as_deref().unwrap()).is_file());

        let binary_path = source.path().join("binary.dat");
        fs::write(&binary_path, [0, 1, 2, 3]).unwrap();
        assert!(import_external_file(&db, app_data.path(), "ws_test", &binary_path).is_err());

        fs::write(workspace.path().join("binary.svg"), [0, 1, 2, 3]).unwrap();
        assert!(attach_workspace_file(&db, "ws_test", workspace.path(), "binary.svg").is_err());
    }

    #[test]
    fn png_bytes_are_imported_and_rendered_as_a_path() {
        let app_data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let db = database(workspace.path());
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3];
        let item = import_bytes(
            &db,
            app_data.path(),
            "ws_test",
            "shot.png",
            "image/png",
            &png,
        )
        .unwrap();
        assert_eq!(item.mime_type, "image/png");
        assert_eq!(item.display_name, "shot.png");
        let rendered = render(&item, workspace.path()).unwrap();
        assert!(rendered.contains("[image: shot.png]"));
        assert!(rendered.contains(item.stored_path.as_deref().unwrap()));

        let source = tempfile::tempdir().unwrap();
        let png_path = source.path().join("clip.png");
        fs::write(&png_path, png).unwrap();
        let from_file = import_external_file(&db, app_data.path(), "ws_test", &png_path).unwrap();
        assert_eq!(from_file.id, item.id);

        fs::write(workspace.path().join("in-tree.png"), png).unwrap();
        let workspace_png =
            attach_workspace_file(&db, "ws_test", workspace.path(), "in-tree.png").unwrap();
        assert_eq!(workspace_png.mime_type, "image/png");
        let workspace_rendered = render(&workspace_png, workspace.path()).unwrap();
        assert!(workspace_rendered.contains("in-tree.png"));
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
