use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Context, Result};
use ignore::WalkBuilder;

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
    for entry in WalkBuilder::new(&out_dir)
        .max_depth(Some(4))
        .build()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let relative = slash(entry.path().strip_prefix(root)?.to_string_lossy());
        let name = entry.file_name().to_string_lossy().to_string();
        artifacts.push(Artifact {
            id: format!("artifact_{}", uuid::Uuid::new_v4().simple()),
            run_id: run_id.map(str::to_string),
            workspace_id: workspace_id.into(),
            path: relative,
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
            created_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    Ok(artifacts)
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
}
