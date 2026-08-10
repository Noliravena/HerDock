use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::domain::models::{ArtifactPreview, DesignSystem, DesignSystemContent};

use super::workspace;

const DEFAULT_DESIGN_MARKDOWN: &str = r#"# Neutral Modern

> Category: Starter

Create calm, legible product interfaces with strong information hierarchy, generous spacing,
restrained color, accessible contrast, and purposeful interaction states. Prefer semantic HTML,
responsive layout, and a small set of reusable visual primitives.
"#;

const DEFAULT_TOKENS_CSS: &str = r#":root {
  --color-bg: #f6f4ef;
  --color-surface: #ffffff;
  --color-ink: #24231f;
  --color-muted: #6f6b61;
  --color-accent: #3b5ba5;
  --radius-sm: 8px;
  --radius-md: 14px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
}
"#;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    id: Option<String>,
    name: Option<String>,
    category: Option<String>,
    description: Option<String>,
    files: Option<PackageFiles>,
}

#[derive(Debug, Default, Deserialize)]
struct PackageFiles {
    design: Option<String>,
    tokens: Option<String>,
}

#[derive(Debug, Clone)]
struct PackageLocation {
    system: DesignSystem,
    root: PathBuf,
    design_file: String,
    tokens_file: String,
}

pub fn list(data_dir: &Path, workspace_root: Option<&Path>) -> Result<Vec<DesignSystem>> {
    let mut packages = BTreeMap::new();
    packages.insert("default".to_string(), builtin_default().system);

    for location in scan_root(&data_dir.join("design-systems"), "global")? {
        packages.insert(location.system.id.clone(), location.system);
    }
    if let Some(root) = workspace_root {
        for location in scan_root(&root.join(".herdock").join("design-systems"), "workspace")? {
            packages.insert(location.system.id.clone(), location.system);
        }
    }

    Ok(packages.into_values().collect())
}

pub fn read(
    data_dir: &Path,
    workspace_root: Option<&Path>,
    id: &str,
) -> Result<DesignSystemContent> {
    validate_id(id)?;
    if let Some(root) = workspace_root {
        if let Some(location) = find_in_root(
            &root.join(".herdock").join("design-systems"),
            "workspace",
            id,
        )? {
            return read_location(location);
        }
    }
    if let Some(location) = find_in_root(&data_dir.join("design-systems"), "global", id)? {
        return read_location(location);
    }
    if id == "default" {
        return Ok(builtin_default());
    }
    Err(anyhow!("design system not found: {id}"))
}

pub fn preview_html(root: &Path, relative: &str) -> Result<ArtifactPreview> {
    let normalized = relative.replace('\\', "/");
    if !normalized.starts_with("out/design/") {
        return Err(anyhow!("design preview must be inside out/design"));
    }
    if !matches!(
        Path::new(&normalized)
            .extension()
            .and_then(|value| value.to_str()),
        Some("html" | "htm")
    ) {
        return Err(anyhow!("design preview only supports HTML entries"));
    }
    let path = workspace::resolve_existing(root, &normalized)?;
    let metadata = fs::metadata(&path)?;
    if metadata.len() > 5 * 1024 * 1024 {
        return Err(anyhow!("design preview exceeds 5 MB"));
    }
    let html = fs::read_to_string(&path).context("design preview is not valid UTF-8")?;
    Ok(ArtifactPreview {
        path: normalized,
        html,
    })
}

fn builtin_default() -> DesignSystemContent {
    DesignSystemContent {
        system: DesignSystem {
            id: "default".into(),
            name: "Neutral Modern".into(),
            category: "Starter".into(),
            description: "HerDock 内置的中性、清晰、产品化设计基线。".into(),
            scope: "builtin".into(),
            has_tokens: true,
        },
        design_markdown: DEFAULT_DESIGN_MARKDOWN.into(),
        tokens_css: DEFAULT_TOKENS_CSS.into(),
    }
}

fn scan_root(root: &Path, scope: &str) -> Result<Vec<PackageLocation>> {
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let canonical_root = root.canonicalize()?;
    let mut entries = fs::read_dir(root)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    let mut out = Vec::new();
    for entry in entries {
        if !entry.path().is_dir() {
            continue;
        }
        let package_root = match entry.path().canonicalize() {
            Ok(path) if path.starts_with(&canonical_root) => path,
            _ => continue,
        };
        if let Some(location) = package_at(&package_root, scope)? {
            out.push(location);
        }
    }
    Ok(out)
}

fn find_in_root(root: &Path, scope: &str, id: &str) -> Result<Option<PackageLocation>> {
    if !root.is_dir() {
        return Ok(None);
    }
    for location in scan_root(root, scope)? {
        if location.system.id == id {
            return Ok(Some(location));
        }
    }
    Ok(None)
}

fn package_at(root: &Path, scope: &str) -> Result<Option<PackageLocation>> {
    let fallback_id = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    if validate_id(&fallback_id).is_err() {
        return Ok(None);
    }
    let manifest = read_manifest(&root.join("manifest.json"));
    let id = manifest
        .id
        .as_deref()
        .filter(|value| validate_id(value).is_ok())
        .unwrap_or(&fallback_id)
        .to_string();
    let design_file = manifest
        .files
        .as_ref()
        .and_then(|files| files.design.clone())
        .unwrap_or_else(|| "DESIGN.md".into());
    let tokens_file = manifest
        .files
        .as_ref()
        .and_then(|files| files.tokens.clone())
        .unwrap_or_else(|| "tokens.css".into());
    let design_path = declared_file(root, &design_file)?;
    if !design_path.is_file() {
        return Ok(None);
    }
    let tokens_path = declared_file(root, &tokens_file)?;
    let design_markdown = read_text(&design_path, 512 * 1024).unwrap_or_default();
    let (fallback_name, fallback_category, fallback_description) = markdown_meta(&design_markdown);

    Ok(Some(PackageLocation {
        system: DesignSystem {
            id,
            name: manifest
                .name
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(fallback_name),
            category: manifest
                .category
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(fallback_category),
            description: manifest
                .description
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(fallback_description),
            scope: scope.into(),
            has_tokens: tokens_path.is_file(),
        },
        root: root.to_path_buf(),
        design_file,
        tokens_file,
    }))
}

fn read_location(location: PackageLocation) -> Result<DesignSystemContent> {
    let design_path = declared_file(&location.root, &location.design_file)?;
    let tokens_path = declared_file(&location.root, &location.tokens_file)?;
    Ok(DesignSystemContent {
        system: location.system,
        design_markdown: read_text(&design_path, 512 * 1024)?,
        tokens_css: if tokens_path.is_file() {
            read_text(&tokens_path, 512 * 1024)?
        } else {
            String::new()
        },
    })
}

fn read_manifest(path: &Path) -> PackageManifest {
    fs::read(path)
        .ok()
        .filter(|bytes| bytes.len() <= 64 * 1024)
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn declared_file(root: &Path, relative: &str) -> Result<PathBuf> {
    let relative = workspace::safe_relative(relative)?;
    let target = root.join(relative);
    let canonical_root = root.canonicalize()?;
    if target.exists() {
        let canonical_target = target.canonicalize()?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(anyhow!("design-system path escapes package"));
        }
        return Ok(canonical_target);
    }
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("invalid design-system path"))?;
    let canonical_parent = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    if !canonical_parent.starts_with(canonical_root) {
        return Err(anyhow!("design-system path escapes package"));
    }
    Ok(target)
}

fn read_text(path: &Path, max_bytes: u64) -> Result<String> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > max_bytes {
        return Err(anyhow!("design-system file exceeds size limit"));
    }
    fs::read_to_string(path).context("design-system file is not valid UTF-8")
}

fn markdown_meta(markdown: &str) -> (String, String, String) {
    let mut name = "Untitled design system".to_string();
    let mut category = "Custom".to_string();
    let mut description = String::new();
    for line in markdown.lines().take(24) {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("# ") {
            name = value.trim().to_string();
        } else if let Some(value) = trimmed.strip_prefix("> Category:") {
            category = value.trim().to_string();
        } else if let Some(value) = trimmed.strip_prefix('>') {
            if description.is_empty() {
                description = value.trim().to_string();
            }
        }
    }
    (name, category, description)
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(anyhow!("invalid design-system id"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_package_overrides_global_package() {
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let global = data.path().join("design-systems/acme");
        let local = workspace.path().join(".herdock/design-systems/acme");
        fs::create_dir_all(&global).unwrap();
        fs::create_dir_all(&local).unwrap();
        fs::write(global.join("DESIGN.md"), "# Global\n> Category: Test").unwrap();
        fs::write(local.join("DESIGN.md"), "# Workspace\n> Category: Test").unwrap();

        let systems = list(data.path(), Some(workspace.path())).unwrap();
        let acme = systems.iter().find(|item| item.id == "acme").unwrap();
        assert_eq!(acme.name, "Workspace");
        assert_eq!(acme.scope, "workspace");
    }

    #[test]
    fn preview_is_limited_to_design_html() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("out/design/demo")).unwrap();
        fs::write(
            root.path().join("out/design/demo/index.html"),
            "<h1>ok</h1>",
        )
        .unwrap();
        assert!(preview_html(root.path(), "out/design/demo/index.html").is_ok());
        assert!(preview_html(root.path(), "README.md").is_err());
    }
}
