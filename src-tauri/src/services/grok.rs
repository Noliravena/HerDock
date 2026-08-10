use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use reqwest::Url;
use serde_json::Value;
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::models::{GrokAuthStatus, GrokLoginEvent, GrokLoginResult, ProviderProfile},
    services::{process, providers},
};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Default)]
pub struct SafeAuthProfile {
    pub signed_in: bool,
    pub expired: bool,
    pub has_refresh: bool,
    pub auth_mode: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Default)]
struct LoginState {
    running: bool,
    cancel: Option<CancellationToken>,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct GrokAuthManager {
    state: Mutex<LoginState>,
}

impl GrokAuthManager {
    async fn begin(&self) -> Result<CancellationToken> {
        let mut state = self.state.lock().await;
        if state.running {
            return Err(anyhow!("Grok Build 登录已在进行中"));
        }
        let cancel = CancellationToken::new();
        state.running = true;
        state.cancel = Some(cancel.clone());
        state.stdin = None;
        Ok(cancel)
    }

    async fn set_stdin(&self, stdin: Option<ChildStdin>) {
        self.state.lock().await.stdin = stdin;
    }

    async fn finish(&self) {
        let mut state = self.state.lock().await;
        state.running = false;
        state.cancel = None;
        state.stdin = None;
    }

    pub async fn is_running(&self) -> bool {
        self.state.lock().await.running
    }

    pub async fn cancel(&self) {
        if let Some(cancel) = self.state.lock().await.cancel.clone() {
            cancel.cancel();
        }
    }

    pub async fn cancel_and_wait(&self) {
        self.cancel().await;
        for _ in 0..30 {
            if !self.is_running().await {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub async fn submit_code(&self, code: &str) -> Result<()> {
        let code = validate_verification_code(code)?;
        let mut state = self.state.lock().await;
        let stdin = state
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("当前没有等待验证码的 Grok Build 登录"))?;
        stdin
            .write_all(format!("{code}\n").as_bytes())
            .await
            .context("向 Grok Build CLI 提交验证码失败")?;
        stdin
            .flush()
            .await
            .context("刷新 Grok Build CLI 输入失败")?;
        Ok(())
    }
}

pub fn auth_json_path() -> PathBuf {
    if let Ok(home) = std::env::var("GROK_HOME") {
        let candidate = PathBuf::from(home).join("auth.json");
        if candidate.is_file() {
            return candidate;
        }
    }
    user_home().join(".grok").join("auth.json")
}

pub fn cli_candidates() -> Vec<PathBuf> {
    let home = user_home();
    let executable = if cfg!(target_os = "windows") {
        "grok.exe"
    } else {
        "grok"
    };
    let mut candidates = vec![home.join(".grok").join("bin").join(executable)];
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/grok"));
        candidates.push(PathBuf::from("/usr/local/bin/grok"));
    } else if cfg!(target_os = "linux") {
        candidates.push(home.join(".local").join("bin").join("grok"));
        candidates.push(PathBuf::from("/usr/local/bin/grok"));
    }
    candidates
}

pub fn apply_environment(command: &mut Command) {
    if std::env::var_os("HOME").is_none() {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            command.env("HOME", home);
        }
    }
}

pub fn read_auth_profile() -> SafeAuthProfile {
    read_auth_profile_at(&auth_json_path()).unwrap_or_default()
}

pub fn read_auth_profile_at(path: &Path) -> Option<SafeAuthProfile> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    parse_auth_profile(&value)
}

pub async fn status(profile: &ProviderProfile, manager: &GrokAuthManager) -> GrokAuthStatus {
    let path = providers::resolve_cli(profile);
    let version = match path.as_ref() {
        Some(path) => cli_version(path).await,
        None => None,
    };
    let auth = read_auth_profile();
    let usable = auth.signed_in && (!auth.expired || auth.has_refresh);
    let detail = if path.is_none() {
        "未找到 Grok Build CLI，请安装后配置可执行文件路径".into()
    } else if usable {
        auth.email
            .as_ref()
            .map(|email| format!("已通过官方 CLI 登录：{email}"))
            .unwrap_or_else(|| "已通过官方 Grok Build CLI 登录".into())
    } else if auth.expired {
        "Grok Build 登录已过期，请重新登录".into()
    } else {
        "尚未登录 Grok Build".into()
    };
    GrokAuthStatus {
        cli_found: path.is_some(),
        cli_path: path.map(|value| value.to_string_lossy().to_string()),
        version,
        signed_in: usable,
        expired: auth.expired,
        auth_mode: auth.auth_mode,
        email: auth.email,
        display_name: auth.display_name,
        expires_at: auth.expires_at,
        login_running: manager.is_running().await,
        detail,
    }
}

pub async fn login(
    app: &AppHandle,
    profile: &ProviderProfile,
    manager: &GrokAuthManager,
    method: &str,
    channel: Option<Channel<GrokLoginEvent>>,
) -> Result<GrokLoginResult> {
    let method = normalize_method(method);
    let cancel = manager.begin().await?;
    let result = run_login(app, profile, manager, method, cancel, channel).await;
    manager.finish().await;
    match result {
        Ok(mut result) => {
            result.status = status(profile, manager).await;
            Ok(result)
        }
        Err(error) => Err(error),
    }
}

async fn run_login(
    app: &AppHandle,
    profile: &ProviderProfile,
    manager: &GrokAuthManager,
    method: &str,
    cancel: CancellationToken,
    channel: Option<Channel<GrokLoginEvent>>,
) -> Result<GrokLoginResult> {
    let executable = providers::resolve_cli(profile)
        .ok_or_else(|| anyhow!("未找到 Grok Build CLI，请先安装或配置可执行文件路径"))?;
    send_event(&channel, "started", "正在启动 Grok Build 登录", None, None);

    let mut command = Command::new(&executable);
    command
        .args(login_args(method))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_environment(&mut command);
    process::configure_child(&mut command);
    let mut child = command
        .spawn()
        .with_context(|| format!("无法启动 {}", executable.display()))?;
    manager.set_stdin(child.stdin.take()).await;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Grok 登录 stdout 不可用"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Grok 登录 stderr 不可用"))?;
    let (tx, mut rx) = mpsc::unbounded_channel::<(&'static str, String)>();
    for (stream, pipe) in [
        (
            "stdout",
            Box::new(stdout) as Box<dyn tokio::io::AsyncRead + Unpin + Send>,
        ),
        (
            "stderr",
            Box::new(stderr) as Box<dyn tokio::io::AsyncRead + Unpin + Send>,
        ),
    ] {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(pipe).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send((stream, line));
            }
        });
    }
    drop(tx);

    let timeout = tokio::time::sleep(LOGIN_TIMEOUT);
    tokio::pin!(timeout);
    let mut exit_status = None;
    let mut last_detail = None;
    let mut device_url = None;
    let mut device_code = None;
    let mut cancelled = false;
    let mut timed_out = false;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                cancelled = true;
                process::terminate_process_tree(&mut child).await;
                break;
            }
            _ = &mut timeout => {
                timed_out = true;
                process::terminate_process_tree(&mut child).await;
                break;
            }
            line = rx.recv() => {
                match line {
                    Some((_stream, line)) => {
                        let login_url = extract_safe_login_url(&line);
                        let login_code = extract_device_code(&line);
                        if let Some(url) = login_url.as_ref() {
                            if device_url.is_none() {
                                let _ = app.opener().open_url(url.clone(), None::<String>);
                                send_event(&channel, "url", "登录页面已在浏览器中打开", Some(url.clone()), None);
                                device_url = Some(url.clone());
                            }
                        }
                        if let Some(code) = login_code.as_ref() {
                            if device_code.is_none() {
                                send_event(&channel, "code", "已获取设备验证码", None, Some(code.clone()));
                                device_code = Some(code.clone());
                            }
                        }
                        if login_url.is_none() && login_code.is_none() {
                            if let Some(detail) = safe_diagnostic(&line) {
                            last_detail = Some(detail);
                            }
                        }
                    }
                    None if exit_status.is_some() => break,
                    None => {}
                }
            }
            result = child.wait(), if exit_status.is_none() => {
                exit_status = Some(result.context("等待 Grok Build 登录进程失败")?);
                if rx.is_closed() { break; }
            }
        }
    }

    if cancelled {
        send_event(&channel, "cancelled", "Grok Build 登录已取消", None, None);
        return Ok(login_result(
            false,
            method,
            "Grok Build 登录已取消",
            false,
            device_url,
            device_code,
            status(profile, manager).await,
        ));
    }
    if timed_out {
        send_event(
            &channel,
            "failed",
            "登录等待超时，请检查网络后重试",
            None,
            None,
        );
        return Ok(login_result(
            false,
            method,
            "Grok Build 登录在 120 秒后超时，请检查网络或改用设备码登录",
            true,
            device_url,
            device_code,
            status(profile, manager).await,
        ));
    }

    if exit_status.as_ref().is_some_and(|value| value.success()) {
        for _ in 0..20 {
            if read_auth_profile().signed_in {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
    let auth_status = status(profile, manager).await;
    let ok = auth_status.signed_in;
    let message = if ok {
        auth_status
            .email
            .as_ref()
            .map(|email| format!("已登录 Grok Build：{email}"))
            .unwrap_or_else(|| "已登录 Grok Build".into())
    } else {
        last_detail
            .map(|detail| format!("Grok Build 登录未完成：{detail}"))
            .unwrap_or_else(|| "登录进程已结束，但没有发现有效凭据".into())
    };
    send_event(
        &channel,
        if ok { "completed" } else { "failed" },
        &message,
        None,
        None,
    );
    Ok(login_result(
        ok,
        method,
        &message,
        false,
        device_url,
        device_code,
        auth_status,
    ))
}

pub async fn logout(
    profile: &ProviderProfile,
    manager: &GrokAuthManager,
) -> Result<GrokAuthStatus> {
    manager.cancel_and_wait().await;
    let executable = providers::resolve_cli(profile)
        .ok_or_else(|| anyhow!("未找到 Grok Build CLI，无法执行官方退出命令"))?;
    let mut command = Command::new(executable);
    command
        .arg("logout")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    apply_environment(&mut command);
    process::configure_child(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| anyhow!("Grok Build 退出超时"))??;
    if !output.status.success() {
        return Err(anyhow!(
            "Grok Build CLI 退出失败：{}",
            safe_diagnostic(&String::from_utf8_lossy(&output.stderr))
                .unwrap_or_else(|| output.status.to_string())
        ));
    }
    Ok(status(profile, manager).await)
}

pub async fn cli_version(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command.arg("--version").stdin(Stdio::null());
    apply_environment(&mut command);
    process::configure_child(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    let text = if output.stdout.is_empty() {
        output.stderr
    } else {
        output.stdout
    };
    let value = String::from_utf8_lossy(&text).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn login_result(
    ok: bool,
    method: &str,
    message: &str,
    timed_out: bool,
    device_url: Option<String>,
    device_code: Option<String>,
    status: GrokAuthStatus,
) -> GrokLoginResult {
    GrokLoginResult {
        ok,
        method: method.into(),
        message: message.into(),
        timed_out,
        device_url,
        device_code,
        status,
    }
}

fn send_event(
    channel: &Option<Channel<GrokLoginEvent>>,
    event_type: &str,
    message: &str,
    url: Option<String>,
    code: Option<String>,
) {
    if let Some(channel) = channel {
        let _ = channel.send(GrokLoginEvent {
            event_type: event_type.into(),
            message: message.into(),
            url,
            code,
        });
    }
}

fn normalize_method(method: &str) -> &'static str {
    match method.trim().to_ascii_lowercase().as_str() {
        "device" | "device-auth" | "device-code" => "device",
        _ => "oauth",
    }
}

fn login_args(method: &str) -> [&'static str; 2] {
    [
        "login",
        if method == "device" {
            "--device-auth"
        } else {
            "--oauth"
        },
    ]
}

fn validate_verification_code(code: &str) -> Result<String> {
    let code = code.trim().trim_matches(['\'', '"']).trim();
    if code.is_empty() || code.len() > 256 || code.chars().any(char::is_control) {
        return Err(anyhow!("验证码格式无效"));
    }
    Ok(code.to_string())
}

fn parse_auth_profile(value: &Value) -> Option<SafeAuthProfile> {
    let entries = value.as_object()?;
    let entry = entries
        .values()
        .find(|entry| has_non_empty(entry, &["key", "access_token", "refresh_token"]))
        .or_else(|| entries.values().next())?;
    let expires_at = string_field(entry, &["expires_at"]);
    let expired = expires_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|value| value.with_timezone(&Utc) < Utc::now());
    let has_access = has_non_empty(entry, &["key", "access_token"]);
    let has_refresh = has_non_empty(entry, &["refresh_token"]);
    let first = string_field(entry, &["first_name"]).unwrap_or_default();
    let last = string_field(entry, &["last_name"]).unwrap_or_default();
    let joined = format!("{first} {last}").trim().to_string();
    let email = string_field(entry, &["email"]);
    Some(SafeAuthProfile {
        signed_in: has_access || has_refresh,
        expired,
        has_refresh,
        auth_mode: string_field(entry, &["auth_mode"]),
        email: email.clone(),
        display_name: if joined.is_empty() {
            email
        } else {
            Some(joined)
        },
        expires_at,
    })
}

fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        value
            .get(*name)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn has_non_empty(value: &Value, names: &[&str]) -> bool {
    string_field(value, names).is_some()
}

fn extract_safe_login_url(line: &str) -> Option<String> {
    strip_ansi(line).split_whitespace().find_map(|part| {
        let candidate = part.trim_matches(|value: char| {
            matches!(
                value,
                '\'' | '"' | '(' | ')' | '[' | ']' | '<' | '>' | ',' | ';'
            )
        });
        let url = Url::parse(candidate).ok()?;
        let host = url.host_str()?.to_ascii_lowercase();
        let allowed = url.scheme() == "https"
            && (host == "x.ai"
                || host.ends_with(".x.ai")
                || host == "grok.com"
                || host.ends_with(".grok.com"));
        allowed.then(|| url.to_string())
    })
}

fn extract_device_code(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    if !lower.contains("code") && !lower.contains("验证码") {
        return None;
    }
    line.split(|value: char| value.is_whitespace() || matches!(value, ':' | '='))
        .map(|value| {
            value.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        })
        .filter(|value| (4..=64).contains(&value.len()))
        .find(|value| {
            value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                && value.chars().any(|c| c.is_ascii_digit())
                && !value.eq_ignore_ascii_case("code")
        })
        .map(str::to_string)
}

fn safe_diagnostic(line: &str) -> Option<String> {
    let line = strip_ansi(line).trim().to_string();
    if line.is_empty() {
        return None;
    }
    let lower = line.to_ascii_lowercase();
    if lower.contains("token")
        || lower.contains("secret")
        || lower.contains("authorization")
        || lower.contains("http://")
        || lower.contains("https://")
    {
        return Some("CLI 返回了已隐藏的认证信息".into());
    }
    Some(line.chars().take(240).collect())
}

fn strip_ansi(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn user_home() -> PathBuf {
    std::env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .map(PathBuf::from)
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_profile_exposes_metadata_without_tokens() {
        let value = serde_json::json!({
            "https://auth.x.ai::client": {
                "key": "top-secret-access-token",
                "refresh_token": "top-secret-refresh-token",
                "auth_mode": "oauth",
                "email": "dev@example.com",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "expires_at": "2099-08-10T00:00:00Z"
            }
        });
        let profile = parse_auth_profile(&value).unwrap();
        assert!(profile.signed_in);
        assert_eq!(profile.email.as_deref(), Some("dev@example.com"));
        assert_eq!(profile.display_name.as_deref(), Some("Ada Lovelace"));
        let serialized = serde_json::to_string(&GrokAuthStatus {
            cli_found: true,
            cli_path: None,
            version: None,
            signed_in: profile.signed_in,
            expired: profile.expired,
            auth_mode: profile.auth_mode,
            email: profile.email,
            display_name: profile.display_name,
            expires_at: profile.expires_at,
            login_running: false,
            detail: String::new(),
        })
        .unwrap();
        assert!(!serialized.contains("top-secret"));
    }

    #[test]
    fn login_url_is_restricted_to_official_hosts() {
        assert!(extract_safe_login_url("Open https://auth.x.ai/device?code=1234").is_some());
        assert!(extract_safe_login_url("Open https://example.com/steal").is_none());
        assert!(extract_safe_login_url("Open http://auth.x.ai/device").is_none());
    }

    #[test]
    fn device_code_and_login_args_are_normalized() {
        assert_eq!(
            extract_device_code("Code: ABCD-1234").as_deref(),
            Some("ABCD-1234")
        );
        assert_eq!(login_args("device"), ["login", "--device-auth"]);
        assert_eq!(login_args("oauth"), ["login", "--oauth"]);
        assert!(validate_verification_code("ABC\n123").is_err());
    }

    #[tokio::test]
    async fn login_manager_allows_one_run_and_cancels_it() {
        let manager = GrokAuthManager::default();
        let cancel = manager.begin().await.unwrap();
        assert!(manager.begin().await.is_err());
        manager.cancel().await;
        assert!(cancel.is_cancelled());
        manager.finish().await;
        assert!(!manager.is_running().await);
    }
}
