use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    domain::models::{AppSettings, McpServer, PlatformInfo, ProviderHealth, ProviderProfile, Run},
    infra::{database::Database, secrets},
    services::{
        http,
        providers::{self, ProviderAdapter},
    },
};

pub struct DoctorSnapshot {
    pub settings: AppSettings,
    pub workspace_count: usize,
    pub profiles: Vec<ProviderProfile>,
    pub mcp_servers: Vec<McpServer>,
    pub runs: Vec<Run>,
    pub last_event_ts: HashMap<String, String>,
}

impl DoctorSnapshot {
    pub fn from_db(db: &Database) -> Result<Self> {
        let runs = db.recent_runs(40).unwrap_or_default();
        let mut last_event_ts = HashMap::new();
        for run in &runs {
            if is_live_run_status(&run.status) {
                if let Ok(Some(ts)) = db.last_event_ts(&run.id) {
                    last_event_ts.insert(run.id.clone(), ts);
                }
            }
        }
        Ok(Self {
            settings: db.settings()?,
            workspace_count: db.list_workspaces()?.len(),
            profiles: db.list_providers()?,
            mcp_servers: db.list_mcp()?,
            runs,
            last_event_ts,
        })
    }
}

const PROBE_CONNECT: Duration = Duration::from_secs(5);
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const DEFAULT_PROBE_URLS: &[&str] = &[
    "https://api.x.ai",
    "https://api.openai.com",
    "https://api.anthropic.com",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub id: String,
    pub title: String,
    pub status: DoctorStatus,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

fn check(
    id: impl Into<String>,
    title: impl Into<String>,
    status: DoctorStatus,
    detail: impl Into<String>,
) -> DoctorCheck {
    DoctorCheck {
        id: id.into(),
        title: title.into(),
        status,
        detail: detail.into(),
        run_id: None,
    }
}

const STALL_SECS: i64 = 180;

fn is_live_run_status(status: &str) -> bool {
    matches!(status, "running" | "starting")
}

fn parse_rfc3339(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn format_quiet(secs: i64) -> String {
    if secs < 60 {
        format!("{secs} 秒")
    } else if secs < 3600 {
        format!("{} 分钟", secs / 60)
    } else {
        format!("{} 小时", secs / 3600)
    }
}

/// `running` / `starting` with no events for `STALL_SECS`. Waiting on the user is not a stall.
pub fn stall_checks(
    runs: &[Run],
    last_event_ts: &HashMap<String, String>,
    now: DateTime<Utc>,
) -> Vec<DoctorCheck> {
    let live: Vec<&Run> = runs
        .iter()
        .filter(|run| is_live_run_status(&run.status))
        .collect();
    if live.is_empty() {
        return vec![check(
            "runs",
            "活动任务",
            DoctorStatus::Ok,
            "没有正在运行的任务。",
        )];
    }
    let mut stalled = Vec::new();
    for run in &live {
        let last = last_event_ts
            .get(&run.id)
            .cloned()
            .or_else(|| {
                if run.updated_at.is_empty() {
                    None
                } else {
                    Some(run.updated_at.clone())
                }
            })
            .or_else(|| run.started_at.clone())
            .unwrap_or_else(|| run.created_at.clone());
        let quiet = parse_rfc3339(&last)
            .map(|ts| (now - ts).num_seconds())
            .unwrap_or(0);
        if quiet >= STALL_SECS {
            stalled.push(DoctorCheck {
                id: format!("stall:{}", run.id),
                title: format!("卡住 · {}", run.id),
                status: DoctorStatus::Warn,
                detail: format!("已 {} 没有新事件。可以取消后重试。", format_quiet(quiet)),
                run_id: Some(run.id.clone()),
            });
        }
    }
    if stalled.is_empty() {
        vec![check(
            "runs",
            "活动任务",
            DoctorStatus::Ok,
            format!("{} 个任务在运行，事件仍在更新。", live.len()),
        )]
    } else {
        stalled
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub url: String,
    pub status: DoctorStatus,
    pub detail: String,
    pub status_code: Option<u16>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub generated_at: String,
    pub checks: Vec<DoctorCheck>,
    pub probes: Vec<ProbeResult>,
}

pub fn classify_http(status: u16) -> DoctorStatus {
    match status {
        200..=499 => DoctorStatus::Ok,
        _ => DoctorStatus::Warn,
    }
}

pub fn classify_error(error: &str) -> DoctorStatus {
    let lower = error.to_lowercase();
    if lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("unknown issuer")
        || lower.contains("cert")
    {
        DoctorStatus::Warn
    } else {
        DoctorStatus::Fail
    }
}

pub fn http_detail(status: u16) -> String {
    match status {
        401 | 403 => "可达（未授权，网络路径正常）".into(),
        404 => "可达（端点不存在，网络路径正常）".into(),
        200..=399 => "可达".into(),
        400..=499 => format!("可达（HTTP {status}）"),
        _ => format!("服务端错误 HTTP {status}，网络路径仍可达"),
    }
}

pub fn error_detail(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        "连接超时，办公网可能需要 HTTP 代理".into()
    } else if lower.contains("dns")
        || lower.contains("resolve")
        || lower.contains("name or service")
    {
        "无法解析主机，办公网可能需要 HTTP 代理".into()
    } else if lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("unknown issuer")
    {
        "TLS 校验失败，办公网可能做了 HTTPS 检查".into()
    } else if lower.contains("connect") || lower.contains("connection") {
        "无法连接，办公网可能需要 HTTP 代理".into()
    } else {
        error.chars().take(240).collect()
    }
}

pub fn origin_of(raw: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(raw.trim()).ok()?;
    let host = parsed.host_str()?;
    if is_local_host(host) {
        return None;
    }
    let port = parsed
        .port()
        .map(|value| format!(":{value}"))
        .unwrap_or_default();
    Some(format!("{}://{host}{port}", parsed.scheme()))
}

fn is_local_host(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.');
    host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host.eq_ignore_ascii_case("0.0.0.0")
}

pub fn probe_targets(provider_base_urls: &[String], requested: Option<&[String]>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut push = |raw: &str| {
        let Some(origin) = origin_of(raw).or_else(|| {
            let trimmed = raw.trim().trim_end_matches('/');
            if trimmed.is_empty() {
                None
            } else {
                origin_of(&format!("https://{trimmed}"))
            }
        }) else {
            return;
        };
        if seen.insert(origin.clone()) {
            out.push(origin);
        }
    };
    if let Some(urls) = requested.filter(|items| !items.is_empty()) {
        for url in urls {
            push(url);
        }
        return out;
    }
    for url in DEFAULT_PROBE_URLS {
        push(url);
    }
    for url in provider_base_urls {
        push(url);
    }
    out
}

pub fn redact_json(mut value: Value) -> Value {
    redact_value(&mut value);
    value
}

fn is_secret_key(key: &str) -> bool {
    let normalized = key.to_lowercase().replace(['_', '-'], "");
    matches!(
        normalized.as_str(),
        "apikey"
            | "secret"
            | "password"
            | "authorization"
            | "accesstoken"
            | "refreshtoken"
            | "credential"
            | "credentialref"
            | "token"
    ) || normalized.ends_with("secret")
        || normalized.ends_with("password")
        || normalized.ends_with("apikey")
}

fn redact_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            let env_block = map.contains_key("env");
            for (key, child) in map.iter_mut() {
                if is_secret_key(key) {
                    *child = json!("[redacted]");
                    continue;
                }
                if env_block && key == "env" {
                    if let Value::Object(env) = child {
                        for item in env.values_mut() {
                            *item = json!("[redacted]");
                        }
                    }
                    continue;
                }
                redact_value(child);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_value),
        _ => {}
    }
}

pub async fn probe_url(url: &str) -> ProbeResult {
    let started = Instant::now();
    let client = match http::build_client(PROBE_CONNECT, PROBE_TIMEOUT) {
        Ok(client) => client,
        Err(error) => {
            return ProbeResult {
                url: url.to_string(),
                status: DoctorStatus::Fail,
                detail: format!("无法使用当前代理：{error}"),
                status_code: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
            };
        }
    };
    match client.get(url).send().await {
        Ok(response) => {
            let status_code = response.status().as_u16();
            ProbeResult {
                url: url.to_string(),
                status: classify_http(status_code),
                detail: http_detail(status_code),
                status_code: Some(status_code),
                elapsed_ms: started.elapsed().as_millis() as u64,
            }
        }
        Err(error) => {
            let message = error.to_string();
            ProbeResult {
                url: url.to_string(),
                status: classify_error(&message),
                detail: error_detail(&message),
                status_code: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
            }
        }
    }
}

pub async fn probe_urls(urls: &[String]) -> Vec<ProbeResult> {
    let mut results = Vec::with_capacity(urls.len());
    for url in urls {
        results.push(probe_url(url).await);
    }
    results
}

pub async fn provider_health(profiles: &[ProviderProfile]) -> Vec<ProviderHealth> {
    let mut out = Vec::with_capacity(profiles.len());
    for profile in profiles {
        let has_secret = profile
            .credential_ref
            .as_deref()
            .and_then(|reference| secrets::get_secret(reference).ok().flatten())
            .is_some();
        out.push(
            providers::adapter_with_secret(profile, has_secret)
                .detect()
                .await,
        );
    }
    out
}

fn data_dir_check(data_dir: &Path) -> DoctorCheck {
    let probe = data_dir.join(".doctor-write-test");
    let result = std::fs::create_dir_all(data_dir)
        .and_then(|_| std::fs::write(&probe, b"ok"))
        .and_then(|_| std::fs::remove_file(&probe));
    match result {
        Ok(()) => check(
            "data_dir",
            "数据目录",
            DoctorStatus::Ok,
            data_dir.display().to_string(),
        ),
        Err(error) => check(
            "data_dir",
            "数据目录",
            DoctorStatus::Fail,
            format!("无法写入 {}：{error}", data_dir.display()),
        ),
    }
}

fn proxy_check(settings: &AppSettings) -> DoctorCheck {
    let resolved = http::resolve_proxy(&settings.http_proxy, &http::env_proxy());
    match resolved {
        Some(proxy) => check(
            "proxy",
            "HTTP 代理",
            DoctorStatus::Ok,
            format!(
                "{}。此代理用于应用内 API 连通测试；CLI Provider 仍读取系统 HTTP_PROXY。",
                http::display_proxy(&proxy)
            ),
        ),
        None => check(
            "proxy",
            "HTTP 代理",
            DoctorStatus::Warn,
            "未配置。办公网访问公网 API 时可能需要在设置里填写 HTTP 代理。",
        ),
    }
}

fn workspace_check(count: usize) -> DoctorCheck {
    if count == 0 {
        check(
            "workspace",
            "工作区",
            DoctorStatus::Warn,
            "还没有打开工作区。",
        )
    } else {
        check(
            "workspace",
            "工作区",
            DoctorStatus::Ok,
            format!("已记录 {count} 个工作区"),
        )
    }
}

fn provider_checks(profiles: &[ProviderProfile], health: &[ProviderHealth]) -> Vec<DoctorCheck> {
    let mut checks = Vec::new();
    let enabled: Vec<_> = profiles.iter().filter(|profile| profile.enabled).collect();
    let available = health.iter().filter(|item| item.available).count();
    checks.push(check(
        "providers",
        "Provider",
        if available == 0 {
            DoctorStatus::Warn
        } else {
            DoctorStatus::Ok
        },
        format!("{available} 个可用 / {} 个已启用", enabled.len()),
    ));
    for profile in enabled {
        let item = health.iter().find(|entry| entry.id == profile.id);
        let available = item.map(|entry| entry.available).unwrap_or(false);
        checks.push(check(
            format!("provider:{}", profile.id),
            profile.display_name.clone(),
            if available {
                DoctorStatus::Ok
            } else {
                DoctorStatus::Warn
            },
            if available {
                item.and_then(|entry| entry.version.clone())
                    .or_else(|| item.and_then(|entry| entry.path.clone()))
                    .unwrap_or_else(|| "已连接".into())
            } else {
                item.and_then(|entry| entry.detail.clone())
                    .unwrap_or_else(|| "未连接".into())
            },
        ));
    }
    checks
}

fn mcp_checks(servers: &[McpServer]) -> Vec<DoctorCheck> {
    let enabled: Vec<_> = servers.iter().filter(|server| server.enabled).collect();
    if enabled.is_empty() {
        return vec![check(
            "mcp",
            "本地 MCP",
            DoctorStatus::Ok,
            "没有已启用的 MCP 服务。",
        )];
    }
    enabled
        .into_iter()
        .map(|server| {
            let status_label = server.status.as_deref().unwrap_or("");
            let (status, detail) = if status_label == "needs_secret" {
                (DoctorStatus::Fail, "缺少密钥，还不能启动".to_string())
            } else if status_label == "error" || status_label == "failed" {
                (
                    DoctorStatus::Fail,
                    server.status.clone().unwrap_or_else(|| "启动失败".into()),
                )
            } else if !server.tools.is_empty()
                || status_label == "ready"
                || status_label == "running"
            {
                (
                    DoctorStatus::Ok,
                    if server.tools.is_empty() {
                        "已启用".into()
                    } else {
                        format!("{} 个工具", server.tools.len())
                    },
                )
            } else {
                (DoctorStatus::Warn, "已启用，尚未探测到工具".into())
            };
            check(
                format!("mcp:{}", server.id),
                format!("MCP · {}", server.name),
                status,
                detail,
            )
        })
        .collect()
}

fn probe_summary(probes: &[ProbeResult]) -> DoctorCheck {
    if probes.is_empty() {
        return check(
            "network",
            "网络连通",
            DoctorStatus::Warn,
            "没有可探测的地址。",
        );
    }
    let fail = probes
        .iter()
        .filter(|item| item.status == DoctorStatus::Fail)
        .count();
    let warn = probes
        .iter()
        .filter(|item| item.status == DoctorStatus::Warn)
        .count();
    let ok = probes.len() - fail - warn;
    if fail == probes.len() {
        check(
            "network",
            "网络连通",
            DoctorStatus::Fail,
            "探测全部失败。办公网可能需要 HTTP 代理。",
        )
    } else if fail > 0 || warn > 0 {
        check(
            "network",
            "网络连通",
            DoctorStatus::Warn,
            format!("可达 {ok}，警告 {warn}，失败 {fail}"),
        )
    } else {
        check(
            "network",
            "网络连通",
            DoctorStatus::Ok,
            format!("已探测 {ok} 个地址"),
        )
    }
}

pub async fn run_doctor(
    snapshot: &DoctorSnapshot,
    data_dir: &Path,
    health: &[ProviderHealth],
    requested_urls: Option<&[String]>,
) -> DoctorReport {
    http::set_configured_proxy(snapshot.settings.http_proxy.clone());
    let bases: Vec<String> = snapshot
        .profiles
        .iter()
        .filter(|profile| profile.enabled)
        .filter_map(|profile| profile.base_url.clone())
        .filter(|value| !value.trim().is_empty())
        .collect();
    let urls = probe_targets(&bases, requested_urls);
    let probes = probe_urls(&urls).await;
    let mut checks = vec![
        data_dir_check(data_dir),
        proxy_check(&snapshot.settings),
        workspace_check(snapshot.workspace_count),
    ];
    checks.extend(provider_checks(&snapshot.profiles, health));
    checks.extend(mcp_checks(&snapshot.mcp_servers));
    checks.push(probe_summary(&probes));
    checks.extend(stall_checks(
        &snapshot.runs,
        &snapshot.last_event_ts,
        Utc::now(),
    ));
    DoctorReport {
        generated_at: Utc::now().to_rfc3339(),
        checks,
        probes,
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let taken: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{taken}…")
    } else {
        taken
    }
}

fn compact_runs(runs: &[Run]) -> Value {
    json!(runs
        .iter()
        .take(40)
        .map(|run| {
            json!({
                "id": run.id,
                "status": run.status,
                "providerId": run.provider_id,
                "model": run.model,
                "prompt": truncate_chars(&run.prompt, 200),
                "errorMessage": run.error_message,
                "createdAt": run.created_at,
                "updatedAt": run.updated_at,
            })
        })
        .collect::<Vec<_>>())
}

pub fn write_diagnostic_zip(dest: &Path, files: &[(&str, String)]) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::File::create(dest).with_context(|| format!("create {}", dest.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in files {
        zip.start_file(*name, options)?;
        zip.write_all(body.as_bytes())?;
    }
    zip.finish()?;
    Ok(())
}

pub async fn export_doctor(
    snapshot: &DoctorSnapshot,
    health: &[ProviderHealth],
    data_dir: &Path,
    platform: &PlatformInfo,
    dest: Option<&Path>,
) -> Result<PathBuf> {
    let report = run_doctor(snapshot, data_dir, health, None).await;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let path = dest.map(Path::to_path_buf).unwrap_or_else(|| {
        data_dir
            .join("diagnostics")
            .join(format!("herdock-doctor-{stamp}.zip"))
    });
    let files = [
        ("doctor.json", serde_json::to_string_pretty(&report)?),
        ("platform.json", serde_json::to_string_pretty(platform)?),
        (
            "settings.json",
            serde_json::to_string_pretty(&redact_json(serde_json::to_value(&snapshot.settings)?))?,
        ),
        (
            "providers.json",
            serde_json::to_string_pretty(&redact_json(serde_json::to_value(health)?))?,
        ),
        (
            "mcp.json",
            serde_json::to_string_pretty(&redact_json(serde_json::to_value(
                &snapshot.mcp_servers,
            )?))?,
        ),
        (
            "runs.json",
            serde_json::to_string_pretty(&compact_runs(&snapshot.runs))?,
        ),
    ];
    write_diagnostic_zip(&path, &files)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn auth_errors_count_as_reachable() {
        assert_eq!(classify_http(401), DoctorStatus::Ok);
        assert_eq!(classify_http(403), DoctorStatus::Ok);
        assert_eq!(classify_http(404), DoctorStatus::Ok);
        assert_eq!(classify_http(200), DoctorStatus::Ok);
        assert_eq!(classify_http(502), DoctorStatus::Warn);
    }

    #[test]
    fn timeout_is_fail_tls_is_warn() {
        assert_eq!(classify_error("operation timed out"), DoctorStatus::Fail);
        assert_eq!(
            classify_error("invalid peer certificate: UnknownIssuer"),
            DoctorStatus::Warn
        );
    }

    #[test]
    fn skips_localhost_and_dedupes_origins() {
        let urls = probe_targets(
            &[
                "https://api.openai.com/v1".into(),
                "http://127.0.0.1:11434".into(),
            ],
            None,
        );
        assert!(urls.iter().any(|url| url == "https://api.openai.com"));
        assert!(urls.iter().any(|url| url == "https://api.x.ai"));
        assert!(!urls.iter().any(|url| url.contains("127.0.0.1")));
    }

    #[test]
    fn requested_urls_replace_defaults() {
        let urls = probe_targets(&[], Some(&["https://example.com/v1".into()]));
        assert_eq!(urls, vec!["https://example.com".to_string()]);
    }

    #[test]
    fn redacts_keys_and_mcp_env_but_keeps_usage() {
        let value = redact_json(json!({
            "apiKey": "sk-live",
            "tokenUsage": { "total": 12 },
            "env": { "GITHUB_TOKEN": "gho_secret" }
        }));
        assert_eq!(value["apiKey"], json!("[redacted]"));
        assert_eq!(value["tokenUsage"]["total"], json!(12));
        assert_eq!(value["env"]["GITHUB_TOKEN"], json!("[redacted]"));
    }

    #[test]
    fn writes_zip_with_deflate() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("doctor.zip");
        write_diagnostic_zip(&dest, &[("hello.json", "{\"ok\":true}".into())]).unwrap();
        assert!(dest.metadata().unwrap().len() > 0);
    }

    fn sample_run(id: &str, status: &str, updated_at: &str) -> Run {
        Run {
            id: id.into(),
            session_id: "s1".into(),
            workspace_id: "w1".into(),
            provider_id: "codex".into(),
            model: None,
            status: status.into(),
            prompt: "hi".into(),
            plan_progress: None,
            error_message: None,
            token_usage: json!({}),
            created_at: updated_at.into(),
            updated_at: updated_at.into(),
            started_at: Some(updated_at.into()),
            finished_at: None,
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-17T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn stalled_running_run_is_warn() {
        let run = sample_run("run_1", "running", "2026-08-17T11:56:00Z");
        let mut last = HashMap::new();
        last.insert("run_1".into(), "2026-08-17T11:56:00Z".into());
        let checks = stall_checks(&[run], &last, now());
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].status, DoctorStatus::Warn);
        assert_eq!(checks[0].run_id.as_deref(), Some("run_1"));
        assert!(checks[0].detail.contains("分钟"));
    }

    #[test]
    fn recent_running_run_is_ok() {
        let run = sample_run("run_1", "running", "2026-08-17T11:59:30Z");
        let mut last = HashMap::new();
        last.insert("run_1".into(), "2026-08-17T11:59:30Z".into());
        let checks = stall_checks(&[run], &last, now());
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].id, "runs");
        assert_eq!(checks[0].status, DoctorStatus::Ok);
        assert!(checks[0].run_id.is_none());
    }

    #[test]
    fn waiting_statuses_are_not_stall() {
        let stale = "2026-08-17T10:00:00Z";
        let runs = vec![
            sample_run("a", "waiting_approval", stale),
            sample_run("b", "waiting_human", stale),
            sample_run("c", "paused", stale),
        ];
        let checks = stall_checks(&runs, &HashMap::new(), now());
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].id, "runs");
        assert_eq!(checks[0].status, DoctorStatus::Ok);
    }

    #[test]
    fn starting_falls_back_to_updated_at() {
        let run = sample_run("run_2", "starting", "2026-08-17T11:56:59Z");
        let checks = stall_checks(&[run], &HashMap::new(), now());
        assert_eq!(checks[0].run_id.as_deref(), Some("run_2"));
        assert_eq!(checks[0].status, DoctorStatus::Warn);
    }
}
