use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Result};

use crate::domain::models::{GitWorktree, WorktreeList};

pub fn list(root: &Path) -> Result<WorktreeList> {
    let Ok(output) = git(root, &["worktree", "list", "--porcelain"]) else {
        return Ok(WorktreeList {
            available: false,
            items: Vec::new(),
        });
    };
    let current = root.canonicalize().ok();
    let items = parse_porcelain(&output, current.as_deref());
    Ok(WorktreeList {
        available: true,
        items,
    })
}

pub fn add(root: &Path, name: &str, start_point: Option<&str>) -> Result<GitWorktree> {
    let name = sanitize_name(name)?;
    let start = start_point
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_ref)
        .transpose()?;
    let path = sibling_path(root, &name)?;
    if path.exists() {
        return Err(anyhow!("worktree 路径已存在：{}", path.display()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let path_text = path.to_string_lossy().into_owned();
    let mut args = vec!["worktree", "add", "-b", name.as_str(), path_text.as_str()];
    if let Some(start) = start.as_deref() {
        args.push(start);
    }
    git(root, &args)?;
    drop(args);
    Ok(list(root)?
        .items
        .into_iter()
        .find(|item| {
            Path::new(&item.path).canonicalize().ok().as_deref()
                == path.canonicalize().ok().as_deref()
        })
        .unwrap_or_else(|| GitWorktree {
            path: path_text,
            branch: Some(name.clone()),
            head: None,
            bare: false,
            detached: false,
            locked: false,
            prunable: false,
            is_main: false,
            is_current: false,
        }))
}

pub fn remove(root: &Path, target: &str, force: bool) -> Result<()> {
    let list = list(root)?;
    let target_canon = PathBuf::from(target)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(target));
    let item = list
        .items
        .iter()
        .find(|item| {
            Path::new(&item.path).canonicalize().ok().as_deref() == Some(target_canon.as_path())
        })
        .ok_or_else(|| anyhow!("不是当前仓库的 worktree"))?;
    if item.is_main {
        return Err(anyhow!("不能删除主工作树"));
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(item.path.as_str());
    git(root, &args)?;
    Ok(())
}

pub fn prune(root: &Path) -> Result<String> {
    git(root, &["worktree", "prune", "-v"])
}

pub fn sanitize_name(raw: &str) -> Result<String> {
    let name = raw.trim();
    if name.is_empty() || name.len() > 64 || name.starts_with('-') {
        return Err(anyhow!("worktree 名称只能用字母、数字、. _ -，最长 64"));
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(anyhow!("worktree 名称只能用字母、数字、. _ -，最长 64"));
    }
    Ok(name.to_string())
}

pub fn sanitize_ref(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.is_empty()
        || value.len() > 256
        || value.starts_with('-')
        || value.contains('\0')
        || value.contains('\n')
    {
        return Err(anyhow!("起点不是合法的 branch / tag / commit"));
    }
    Ok(value.to_string())
}

pub fn sibling_path(root: &Path, name: &str) -> Result<PathBuf> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let parent = root
        .parent()
        .ok_or_else(|| anyhow!("无法在仓库旁创建 worktree"))?;
    let base = root
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "repo".into());
    Ok(parent.join(format!("{base}-{name}")))
}

pub fn parse_porcelain(output: &str, current: Option<&Path>) -> Vec<GitWorktree> {
    let mut items = Vec::new();
    let mut current_item: Option<GitWorktree> = None;
    let flush = |item: Option<GitWorktree>, items: &mut Vec<GitWorktree>| {
        if let Some(mut item) = item {
            item.is_main = items.is_empty();
            item.is_current = current
                .and_then(|path| path.canonicalize().ok())
                .zip(Path::new(&item.path).canonicalize().ok())
                .is_some_and(|(left, right)| left == right);
            items.push(item);
        }
    };
    for line in output.lines() {
        if line.is_empty() {
            flush(current_item.take(), &mut items);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            flush(current_item.take(), &mut items);
            current_item = Some(GitWorktree {
                path: path.to_string(),
                branch: None,
                head: None,
                bare: false,
                detached: false,
                locked: false,
                prunable: false,
                is_main: false,
                is_current: false,
            });
            continue;
        }
        let Some(item) = current_item.as_mut() else {
            continue;
        };
        if let Some(head) = line.strip_prefix("HEAD ") {
            item.head = Some(head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            item.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
        } else if line == "bare" {
            item.bare = true;
        } else if line == "detached" {
            item.detached = true;
        } else if line.starts_with("locked") {
            item.locked = true;
        } else if line.starts_with("prunable") {
            item.prunable = true;
        }
    }
    flush(current_item.take(), &mut items);
    items
}

fn git(root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|_| anyhow!("未找到 git，无法管理 worktree"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = [stderr.trim(), stdout.trim()]
            .into_iter()
            .find(|value| !value.is_empty())
            .unwrap_or("git worktree 失败");
        Err(anyhow!("{detail}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_main_and_linked_worktrees() {
        let porcelain = "\
worktree /repo
HEAD abc
branch refs/heads/main

worktree /repo-feat
HEAD def
branch refs/heads/feat
";
        let items = parse_porcelain(porcelain, None);
        assert!(items[0].is_main);
        assert_eq!(items[0].branch.as_deref(), Some("main"));
        assert!(!items[1].is_main);
        assert_eq!(items[1].branch.as_deref(), Some("feat"));
        assert_eq!(items[1].path, "/repo-feat");
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(sanitize_name("-feat").is_err());
        assert!(sanitize_name("feat/name").is_err());
        assert!(sanitize_name("ok_feat-1").is_ok());
        assert!(sanitize_ref("-main").is_err());
        assert!(sanitize_ref("origin/main").is_ok());
    }

    #[test]
    fn builds_sibling_layout() {
        let root = Path::new("/Users/me/code/her-dock");
        let path = sibling_path(root, "feat").unwrap();
        assert!(path.ends_with("her-dock-feat"));
    }
}
