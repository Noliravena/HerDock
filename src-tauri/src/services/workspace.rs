use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Context, Result};
use ignore::WalkBuilder;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::domain::models::{
    Artifact, ContextFile, FileRead, FsNode, SearchResult, WorkspaceContext,
};

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".idea",
    ".vscode",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesignArtifactManifest {
    schema_version: String,
    id: String,
    title: String,
    kind: String,
    renderer: String,
    entry: String,
    exports: Vec<String>,
    status: Option<String>,
    created_at: Option<String>,
}

pub fn canonical_workspace(path: &str) -> Result<PathBuf> {
    let root = PathBuf::from(path)
        .canonicalize()
        .with_context(|| format!("workspace does not exist: {path}"))?;
    if !root.is_dir() {
        return Err(anyhow!("workspace path is not a directory"));
    }
    Ok(root)
}

pub fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf> {
    let root = root.canonicalize()?;
    let rel = safe_relative(relative)?;
    let target = root
        .join(rel)
        .canonicalize()
        .with_context(|| format!("path does not exist: {relative}"))?;
    if !target.starts_with(&root) {
        return Err(anyhow!("path escapes workspace"));
    }
    Ok(target)
}

pub fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf> {
    let root = root.canonicalize()?;
    let rel = safe_relative(relative)?;
    let target = root.join(rel);
    let mut ancestor = target
        .parent()
        .ok_or_else(|| anyhow!("invalid target path"))?;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| anyhow!("target has no existing parent"))?;
    }
    let ancestor = ancestor.canonicalize()?;
    if !ancestor.starts_with(&root) {
        return Err(anyhow!("path escapes workspace through a symbolic link"));
    }
    Ok(target)
}

pub fn safe_relative(path: &str) -> Result<PathBuf> {
    let path = Path::new(path);
    if path.is_absolute() || path.as_os_str().is_empty() {
        return Err(anyhow!("a non-empty workspace-relative path is required"));
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err(anyhow!("path traversal is not allowed")),
        }
    }
    if out.as_os_str().is_empty() {
        return Err(anyhow!("empty path"));
    }
    Ok(out)
}

pub fn read_file(root: &Path, relative: &str) -> Result<FileRead> {
    let path = resolve_existing(root, relative)?;
    if !path.is_file() {
        return Err(anyhow!("path is not a file"));
    }
    let bytes = fs::read(&path)?;
    let binary = bytes.iter().take(8192).any(|byte| *byte == 0);
    let content = if binary {
        String::new()
    } else {
        String::from_utf8(bytes).context("file is not valid UTF-8")?
    };
    Ok(FileRead {
        path: slash(relative),
        content,
        binary,
        language: language_for(&path).map(str::to_string),
    })
}

pub fn write_file(root: &Path, relative: &str, content: &str) -> Result<()> {
    let path = resolve_for_write(root, relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!(
        "{}.herdock-tmp",
        path.extension().and_then(OsStr::to_str).unwrap_or("file")
    ));
    fs::write(&temp, content.as_bytes())?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temp, path)?;
    Ok(())
}

pub fn create_entry(root: &Path, relative: &str, kind: &str) -> Result<()> {
    let path = resolve_for_write(root, relative)?;
    if path.exists() {
        return Err(anyhow!("path already exists"));
    }
    if kind == "dir" {
        fs::create_dir_all(path)?;
    } else {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, [])?;
    }
    Ok(())
}

pub fn rename_entry(root: &Path, from: &str, to: &str) -> Result<()> {
    let source = resolve_existing(root, from)?;
    let target = resolve_for_write(root, to)?;
    if target.exists() {
        return Err(anyhow!("target already exists"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, target)?;
    Ok(())
}

pub fn delete_entry(root: &Path, relative: &str) -> Result<()> {
    let target = resolve_existing(root, relative)?;
    if target.is_dir() {
        fs::remove_dir_all(target)?;
    } else {
        fs::remove_file(target)?;
    }
    Ok(())
}

pub fn tree(root: &Path, depth: usize) -> Result<Vec<FsNode>> {
    let statuses = git_status_map(root);
    tree_level(root, root, 0, depth, &statuses)
}

fn tree_level(
    root: &Path,
    dir: &Path,
    level: usize,
    depth: usize,
    statuses: &HashMap<String, String>,
) -> Result<Vec<FsNode>> {
    if level > depth {
        return Ok(vec![]);
    }
    let mut entries = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        (
            !entry.path().is_dir(),
            entry.file_name().to_string_lossy().to_lowercase(),
        )
    });
    let mut nodes = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let relative = slash(path.strip_prefix(root)?.to_string_lossy());
        let is_dir = path.is_dir();
        let children = if is_dir && level < depth {
            Some(tree_level(root, &path, level + 1, depth, statuses)?)
        } else {
            None
        };
        nodes.push(FsNode {
            name,
            path: relative.clone(),
            kind: if is_dir { "dir" } else { "file" }.into(),
            git_status: statuses.get(&relative).cloned(),
            children,
        });
    }
    Ok(nodes)
}

pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .filter_entry(|entry| {
            !IGNORED_DIRS
                .iter()
                .any(|part| entry.path().file_name() == Some(OsStr::new(part)))
        })
        .build()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let relative = slash(entry.path().strip_prefix(root)?.to_string_lossy());
        if relative.to_lowercase().contains(&query) {
            out.push(SearchResult {
                path: relative.clone(),
                line: 0,
                preview: relative.clone(),
            });
        }
        if out.len() >= limit {
            break;
        }
        let bytes = match fs::read(entry.path()) {
            Ok(bytes) if bytes.len() <= 2_000_000 && !bytes.iter().take(4096).any(|b| *b == 0) => {
                bytes
            }
            _ => continue,
        };
        let text = String::from_utf8_lossy(&bytes);
        for (index, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&query) {
                out.push(SearchResult {
                    path: relative.clone(),
                    line: index + 1,
                    preview: line.trim().chars().take(180).collect(),
                });
                if out.len() >= limit {
                    break;
                }
            }
        }
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

pub fn git_branch(root: &Path) -> Option<String> {
    command_output(root, "git", &["branch", "--show-current"])
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn git_diff(root: &Path, path: Option<&str>) -> Result<String> {
    let mut args = vec!["diff", "--no-ext-diff", "--"];
    let normalized;
    if let Some(path) = path {
        normalized = slash(safe_relative(path)?.to_string_lossy());
        args.push(&normalized);
    }
    command_output(root, "git", &args).ok_or_else(|| anyhow!("git diff is unavailable"))
}

pub fn git_dirty_summary(root: &Path) -> Option<String> {
    let output = command_output(root, "git", &["diff", "--numstat"])?;
    let mut adds = 0i64;
    let mut deletes = 0i64;
    for line in output.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() >= 2 {
            adds += fields[0].parse::<i64>().unwrap_or_default();
            deletes += fields[1].parse::<i64>().unwrap_or_default();
        }
    }
    if adds == 0 && deletes == 0 {
        None
    } else {
        Some(format!("+{adds} -{deletes}"))
    }
}

pub fn context(root: &Path) -> Result<WorkspaceContext> {
    let mut files = Vec::new();
    let mut rules = Vec::new();
    for name in ["AGENTS.md", "CLAUDE.md", "README.md", "herdock.yml"] {
        let path = root.join(name);
        if path.is_file() {
            let size = fs::metadata(&path)?.len();
            files.push(ContextFile {
                path: name.into(),
                kind: if name.ends_with(".md") {
                    "rule"
                } else {
                    "config"
                }
                .into(),
                size: format_size(size),
            });
            if matches!(name, "AGENTS.md" | "CLAUDE.md") {
                rules.extend(
                    fs::read_to_string(&path)
                        .unwrap_or_default()
                        .lines()
                        .filter(|line| !line.trim().is_empty())
                        .take(5)
                        .map(|line| line.trim_start_matches('#').trim().to_string()),
                );
            }
        }
    }
    Ok(WorkspaceContext {
        files,
        rules,
        output_dir: "out".into(),
        test_command: None,
        auto_execute: "ask_risky".into(),
    })
}

pub fn scan_artifacts(
    root: &Path,
    workspace_id: &str,
    run_id: Option<&str>,
) -> Result<Vec<Artifact>> {
    let out_dir = root.join("out");
    if !out_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut artifacts = Vec::new();
    let mut package_dirs = Vec::new();

    for entry in WalkBuilder::new(&out_dir)
        .max_depth(Some(8))
        .build()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_some_and(|kind| kind.is_file())
            || entry.file_name() != OsStr::new("artifact.json")
        {
            continue;
        }
        if let Some(artifact) = design_artifact(root, workspace_id, run_id, entry.path())? {
            if let Some(parent) = entry.path().parent() {
                package_dirs.push(parent.to_path_buf());
            }
            artifacts.push(artifact);
        }
    }

    for entry in WalkBuilder::new(&out_dir)
        .max_depth(Some(4))
        .build()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if package_dirs.iter().any(|dir| entry.path().starts_with(dir)) {
            continue;
        }
        let relative = slash(entry.path().strip_prefix(root)?.to_string_lossy());
        let name = entry.file_name().to_string_lossy().to_string();
        artifacts.push(Artifact {
            id: stable_artifact_id(workspace_id, &relative),
            run_id: run_id.map(str::to_string),
            workspace_id: workspace_id.into(),
            path: relative.clone(),
            ext: entry
                .path()
                .extension()
                .and_then(OsStr::to_str)
                .unwrap_or("")
                .to_lowercase(),
            size_bytes: fs::metadata(entry.path())
                .ok()
                .map(|meta| meta.len() as i64),
            name,
            kind: "file".into(),
            renderer: None,
            entry_path: Some(relative),
            status: "complete".into(),
            manifest: json!({}),
            created_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    Ok(artifacts)
}

fn design_artifact(
    root: &Path,
    workspace_id: &str,
    run_id: Option<&str>,
    manifest_path: &Path,
) -> Result<Option<Artifact>> {
    let bytes = match fs::read(manifest_path) {
        Ok(bytes) if bytes.len() <= 64 * 1024 => bytes,
        _ => return Ok(None),
    };
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let manifest: DesignArtifactManifest = match serde_json::from_value(value.clone()) {
        Ok(manifest) => manifest,
        Err(_) => return Ok(None),
    };
    if manifest.schema_version != "herdock.design-artifact/v1"
        || !valid_artifact_id(&manifest.id)
        || manifest.title.trim().is_empty()
        || manifest.title.len() > 200
        || !matches!(
            manifest.kind.as_str(),
            "html"
                | "deck"
                | "react-component"
                | "markdown-document"
                | "svg"
                | "diagram"
                | "mini-app"
                | "design-system"
        )
        || !matches!(
            manifest.renderer.as_str(),
            "html"
                | "deck-html"
                | "react-component"
                | "markdown"
                | "svg"
                | "diagram"
                | "mini-app"
                | "design-system"
        )
        || manifest.exports.is_empty()
        || manifest.exports.iter().any(|value| {
            !matches!(
                value.as_str(),
                "html" | "pdf" | "zip" | "jsx" | "md" | "svg" | "txt"
            )
        })
    {
        return Ok(None);
    }
    let package_dir = manifest_path
        .parent()
        .ok_or_else(|| anyhow!("artifact manifest has no parent"))?;
    let entry_rel = safe_relative(&manifest.entry)?;
    let entry = package_dir.join(entry_rel);
    let entry = match entry.canonicalize() {
        Ok(path) if path.is_file() => path,
        _ => return Ok(None),
    };
    let package_dir = package_dir.canonicalize()?;
    let root = root.canonicalize()?;
    if !entry.starts_with(&package_dir) || !package_dir.starts_with(root.join("out")) {
        return Ok(None);
    }
    let relative = slash(entry.strip_prefix(&root)?.to_string_lossy());
    let ext = entry
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_lowercase();
    let status = manifest.status.unwrap_or_else(|| "complete".into());
    if !matches!(status.as_str(), "streaming" | "complete" | "error") {
        return Ok(None);
    }
    Ok(Some(Artifact {
        id: stable_artifact_id(workspace_id, &manifest.id),
        run_id: run_id.map(str::to_string),
        workspace_id: workspace_id.into(),
        path: relative.clone(),
        name: manifest.title,
        ext,
        size_bytes: fs::metadata(&entry).ok().map(|meta| meta.len() as i64),
        kind: manifest.kind,
        renderer: Some(manifest.renderer),
        entry_path: Some(relative),
        status,
        manifest: value,
        created_at: manifest
            .created_at
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    }))
}

fn stable_artifact_id(workspace_id: &str, seed: &str) -> String {
    let digest = Sha256::digest(format!("{workspace_id}:{seed}").as_bytes());
    format!("artifact_{:x}", digest)[..25].to_string()
}

fn valid_artifact_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn command_output(root: &Path, program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_status_map(root: &Path) -> HashMap<String, String> {
    let Some(output) = command_output(root, "git", &["status", "--porcelain"]) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for line in output.lines() {
        if line.len() < 4 {
            continue;
        }
        let status = line[..2].trim().to_string();
        let path = line[3..].split(" -> ").last().unwrap_or("");
        map.insert(slash(path), status);
    }
    map
}

pub fn changed_paths(root: &Path) -> HashSet<String> {
    git_status_map(root).into_keys().collect()
}

fn slash(value: impl AsRef<str>) -> String {
    value.as_ref().replace('\\', "/")
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    }
}

fn language_for(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_lowercase().as_str() {
        "rs" => Some("rust"),
        "ts" | "tsx" => Some("typescript"),
        "js" | "jsx" => Some("javascript"),
        "py" => Some("python"),
        "go" => Some("go"),
        "md" => Some("markdown"),
        "json" => Some("json"),
        "yml" | "yaml" => Some("yaml"),
        "toml" => Some("toml"),
        "css" => Some("css"),
        "html" => Some("html"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_and_absolute_paths() {
        assert!(safe_relative("../secret").is_err());
        assert!(safe_relative("C:\\secret").is_err());
        assert_eq!(
            safe_relative("src/main.rs").unwrap(),
            PathBuf::from("src/main.rs")
        );
    }

    #[test]
    fn writes_atomically_inside_workspace() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "src/test.txt", "ok").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("src/test.txt")).unwrap(),
            "ok"
        );
    }

    #[test]
    fn groups_manifest_design_as_one_stable_artifact() {
        let dir = tempfile::tempdir().unwrap();
        let package = dir.path().join("out/design/demo");
        fs::create_dir_all(package.join("assets")).unwrap();
        fs::write(package.join("index.html"), "<h1>demo</h1>").unwrap();
        fs::write(package.join("assets/app.css"), "body {}").unwrap();
        fs::write(
            package.join("artifact.json"),
            r#"{"schemaVersion":"herdock.design-artifact/v1","id":"demo","title":"Demo","kind":"html","renderer":"html","entry":"index.html","exports":["html","zip"],"status":"complete"}"#,
        )
        .unwrap();

        let first = scan_artifacts(dir.path(), "workspace", Some("run_1")).unwrap();
        let second = scan_artifacts(dir.path(), "workspace", None).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].name, "Demo");
        assert_eq!(first[0].kind, "html");
        assert_eq!(first[0].id, second[0].id);
    }
}
