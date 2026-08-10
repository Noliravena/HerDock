use std::{
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use crate::domain::models::Skill;

pub fn discover(data_dir: &Path, workspace_root: Option<&Path>) -> Result<Vec<Skill>> {
    let mut roots = vec![(data_dir.join("skills"), "global")];
    if let Some(root) = workspace_root {
        roots.push((root.join(".agents").join("skills"), "workspace"));
    }
    let mut skills = Vec::new();
    for (root, scope) in roots {
        if !root.is_dir() {
            continue;
        }
        for entry in fs::read_dir(root)?.filter_map(Result::ok) {
            let path = if entry.path().is_dir() {
                entry.path().join("SKILL.md")
            } else {
                entry.path()
            };
            if path.file_name().and_then(|value| value.to_str()) != Some("SKILL.md")
                || !path.is_file()
            {
                continue;
            }
            let content = fs::read_to_string(&path).unwrap_or_default();
            let (name, description) =
                skill_meta(&content, entry.file_name().to_string_lossy().as_ref());
            skills.push(Skill {
                id: format!("skill_{}", short_hash(&path)),
                glyph: "S".into(),
                name,
                status: "enabled".into(),
                detail: description,
                path: path.to_string_lossy().to_string(),
                scope: scope.into(),
            });
        }
    }
    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

pub fn selected_content(
    skills: &[Skill],
    selected_ids: &[String],
) -> Result<(String, Vec<(String, String)>)> {
    let mut content = String::new();
    let mut bindings = Vec::new();
    for skill in skills
        .iter()
        .filter(|skill| selected_ids.contains(&skill.id))
    {
        let text = fs::read_to_string(&skill.path)
            .with_context(|| format!("read skill {}", skill.path))?;
        content.push_str(&format!("\n--- skill: {} ---\n{}\n", skill.name, text));
        bindings.push((skill.id.clone(), skill.path.clone()));
    }
    Ok((content, bindings))
}

fn skill_meta(content: &str, fallback: &str) -> (String, String) {
    let mut name = fallback.to_string();
    let mut description = String::new();
    for line in content.lines().take(40) {
        if let Some(value) = line.strip_prefix("name:") {
            name = value.trim().trim_matches('"').to_string();
        }
        if let Some(value) = line.strip_prefix("description:") {
            description = value.trim().trim_matches('"').to_string();
        }
    }
    if description.is_empty() {
        description = content
            .lines()
            .find(|line| !line.trim().is_empty() && !line.starts_with(['#', '-']))
            .unwrap_or("本地技能说明")
            .trim()
            .to_string();
    }
    (name, description)
}

fn short_hash(path: &PathBuf) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
