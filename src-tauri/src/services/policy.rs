use std::sync::OnceLock;

use regex::Regex;

fn command_patterns() -> &'static [Regex; 3] {
    static PATTERNS: OnceLock<[Regex; 3]> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            Regex::new(r"\b(rm|del|rmdir|format|mkfs|diskpart)\b")
                .expect("destructive command pattern is valid"),
            Regex::new(r"\b(curl|wget|invoke-webrequest|publish|push)\b")
                .expect("network command pattern is valid"),
            Regex::new(r"\b(install|add)\b").expect("install command pattern is valid"),
        ]
    })
}

pub fn classify_program(program: &str, args: &[String]) -> &'static str {
    let line = format!("{} {}", program, args.join(" ")).to_lowercase();
    let [destructive, network, install] = command_patterns();
    let executable = std::path::Path::new(program)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(program)
        .to_lowercase();
    let read_only = matches!(
        executable.as_str(),
        "rg" | "grep"
            | "find"
            | "findstr"
            | "cat"
            | "type"
            | "head"
            | "tail"
            | "pwd"
            | "ls"
            | "dir"
    ) || (executable == "git"
        && args.first().is_some_and(|arg| {
            matches!(arg.as_str(), "status" | "diff" | "log" | "show" | "branch")
        }));
    if destructive.is_match(&line) {
        "destructive"
    } else if network.is_match(&line) {
        "network"
    } else if install.is_match(&line) {
        "package_install"
    } else if read_only {
        "read_only"
    } else {
        "workspace_write"
    }
}

pub fn requires_approval(kind: &str, auto_execute: &str) -> bool {
    match auto_execute {
        "ask_always" => true,
        "auto_all" => false,
        "auto_workspace" => matches!(kind, "network" | "destructive"),
        _ => matches!(
            kind,
            "workspace_write" | "package_install" | "network" | "destructive" | "unknown"
        ),
    }
}

pub fn risk_for(kind: &str) -> &'static str {
    match kind {
        "destructive" => "high",
        "network" | "package_install" => "high",
        "workspace_write" => "medium",
        _ => "low",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_without_shell_parsing() {
        assert_eq!(classify_program("git", &["status".into()]), "read_only");
        assert_eq!(
            classify_program("rm", &["-rf".into(), ".".into()]),
            "destructive"
        );
        assert!(requires_approval("network", "auto_workspace"));
    }
}
