use std::{collections::BTreeMap, path::PathBuf};

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, RETRY_AFTER};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::{process::Command, sync::mpsc};
use tokio_util::sync::CancellationToken;

use crate::domain::models::{ProviderEvent, ProviderHealth, ProviderProfile, ToolDescriptor};

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone)]
pub struct ProviderTurn {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub assistant_message: Value,
    pub events: Vec<ProviderEvent>,
}

#[derive(Debug, Clone)]
pub struct CliLaunch {
    pub executable: PathBuf,
    pub args: Vec<String>,
}

pub struct ProviderRequest<'a> {
    pub workspace: &'a str,
    pub prompt: &'a str,
    pub system: &'a str,
    pub messages: &'a [Value],
    pub tools: &'a [ToolDescriptor],
    pub api_key: &'a str,
    pub deltas: Option<mpsc::UnboundedSender<String>>,
    pub allow_retry: bool,
}

pub enum ProviderStart {
    Cli(CliLaunch),
    Api(ProviderTurn),
}

#[derive(Debug, Error)]
pub enum ProviderFailure {
    #[error("authentication failed: {0}")]
    Authentication(String),
    #[error("provider rate limited the request{0}")]
    RateLimited(String),
    #[error("provider request timed out")]
    Timeout,
    #[error("provider protocol error: {0}")]
    Protocol(String),
    #[error("provider process failed: {0}")]
    Process(String),
    #[error("provider request was cancelled")]
    Cancelled,
}

impl ProviderFailure {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Authentication(_) => "provider_authentication",
            Self::RateLimited(_) => "provider_rate_limited",
            Self::Timeout => "provider_timeout",
            Self::Protocol(_) => "provider_protocol",
            Self::Process(_) => "provider_process",
            Self::Cancelled => "provider_cancelled",
        }
    }

    pub fn retriable(&self) -> bool {
        matches!(
            self,
            Self::RateLimited(_) | Self::Timeout | Self::Protocol(_)
        )
    }
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    async fn detect(&self) -> ProviderHealth;
    fn capabilities(&self) -> crate::domain::models::ProviderCapabilities;
    async fn validate(&self, api_key: Option<&str>) -> Result<String>;
    async fn start(&self, request: ProviderRequest<'_>) -> Result<ProviderStart>;
    fn cancel(&self, token: &CancellationToken) {
        token.cancel();
    }
}

pub struct ConfiguredProvider<'a> {
    profile: &'a ProviderProfile,
    has_secret: Option<bool>,
}

pub fn adapter(profile: &ProviderProfile) -> ConfiguredProvider<'_> {
    ConfiguredProvider {
        profile,
        has_secret: None,
    }
}

pub fn adapter_with_secret(profile: &ProviderProfile, has_secret: bool) -> ConfiguredProvider<'_> {
    ConfiguredProvider {
        profile,
        has_secret: Some(has_secret),
    }
}

#[async_trait]
impl ProviderAdapter for ConfiguredProvider<'_> {
    async fn detect(&self) -> ProviderHealth {
        health(
            self.profile,
            self.has_secret
                .unwrap_or_else(|| self.profile.credential_ref.is_some()),
        )
        .await
    }

    fn capabilities(&self) -> crate::domain::models::ProviderCapabilities {
        crate::domain::models::ProviderCapabilities {
            chat: true,
            streaming: true,
            tools: true,
            usage: true,
            attachments: true,
        }
    }

    async fn validate(&self, api_key: Option<&str>) -> Result<String> {
        validate(self.profile, api_key).await
    }

    async fn start(&self, request: ProviderRequest<'_>) -> Result<ProviderStart> {
        if self.profile.provider_type == "cli" {
            if self.profile.id == "grok" {
                let auth = crate::services::grok::read_auth_profile();
                if !auth.signed_in || (auth.expired && !auth.has_refresh) {
                    return Err(ProviderFailure::Authentication(
                        "Grok Build CLI 尚未登录，请先在设置的 Provider 页面完成登录".into(),
                    )
                    .into());
                }
            }
            let executable = resolve_cli(self.profile)
                .ok_or_else(|| anyhow!("{} executable was not found", self.profile.display_name))?;
            return Ok(ProviderStart::Cli(CliLaunch {
                executable,
                args: cli_args(
                    &self.profile.id,
                    request.workspace,
                    request.prompt,
                    self.profile.model.as_deref(),
                ),
            }));
        }
        Ok(ProviderStart::Api(
            complete(
                self.profile,
                request.api_key,
                request.system,
                request.messages,
                request.tools,
                request.deltas,
                request.allow_retry,
            )
            .await?,
        ))
    }
}

pub async fn health(profile: &ProviderProfile, has_secret: bool) -> ProviderHealth {
    let features = adapter(profile).capabilities();
    let capabilities = [
        features.chat.then_some("chat"),
        features.streaming.then_some("stream"),
        features.tools.then_some("tools"),
        features.usage.then_some("usage"),
        features.attachments.then_some("attachments"),
    ]
    .into_iter()
    .flatten()
    .map(str::to_string)
    .collect::<Vec<_>>();
    if profile.provider_type == "cli" {
        let path = resolve_cli(profile);
        let mut version = None;
        if let Some(path) = &path {
            version = Command::new(path)
                .arg("--version")
                .output()
                .await
                .ok()
                .and_then(|output| {
                    let text = if output.stdout.is_empty() {
                        output.stderr
                    } else {
                        output.stdout
                    };
                    let value = String::from_utf8_lossy(&text).trim().to_string();
                    (!value.is_empty()).then_some(value)
                });
        }
        let (available, auth, detail) = if profile.id == "grok" {
            let profile = crate::services::grok::read_auth_profile();
            let usable = profile.signed_in && (!profile.expired || profile.has_refresh);
            (
                path.is_some() && usable,
                if usable {
                    profile.auth_mode.unwrap_or_else(|| "oauth".into())
                } else {
                    "missing".into()
                },
                if path.is_none() {
                    Some("未找到 Grok Build CLI".into())
                } else if usable {
                    profile.email.map(|email| format!("已登录 {email}"))
                } else if profile.expired {
                    Some("Grok Build 登录已过期，请重新登录".into())
                } else {
                    Some("请在设置中登录 Grok Build CLI".into())
                },
            )
        } else {
            (path.is_some(), "cli".into(), None)
        };
        return ProviderHealth {
            id: profile.id.clone(),
            display_name: profile.display_name.clone(),
            provider_type: profile.provider_type.clone(),
            available,
            path: path.map(|value| value.to_string_lossy().to_string()),
            version,
            auth,
            detail,
            model: profile.model.clone(),
            base_url: None,
            capabilities,
        };
    }
    ProviderHealth {
        id: profile.id.clone(),
        display_name: profile.display_name.clone(),
        provider_type: profile.provider_type.clone(),
        available: profile.enabled
            && (has_secret || profile.id == "compatible")
            && profile
                .model
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
        path: None,
        version: None,
        auth: if has_secret { "keychain" } else { "missing" }.into(),
        detail: (!has_secret).then(|| "请在设置中保存 API Key".into()),
        model: profile.model.clone(),
        base_url: profile.base_url.clone(),
        capabilities,
    }
}

pub fn resolve_cli(profile: &ProviderProfile) -> Option<PathBuf> {
    if let Some(executable) = profile
        .executable
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let path = PathBuf::from(executable);
        if path.is_file() {
            return Some(path);
        }
        if let Ok(path) = which::which(executable) {
            return Some(path);
        }
    }
    if let Ok(path) = which::which(&profile.id) {
        return Some(path);
    }
    if profile.id == "grok" {
        return crate::services::grok::cli_candidates()
            .into_iter()
            .find(|path| path.is_file());
    }
    None
}

pub fn cli_args(
    provider_id: &str,
    workspace: &str,
    prompt: &str,
    model: Option<&str>,
) -> Vec<String> {
    let mut args = match provider_id {
        "codex" => vec![
            "exec".into(),
            "--json".into(),
            "--ephemeral".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--skip-git-repo-check".into(),
            "-C".into(),
            workspace.into(),
        ],
        "claude" => vec![
            "-p".into(),
            prompt.into(),
            "--output-format".into(),
            "stream-json".into(),
            "--include-partial-messages".into(),
            "--verbose".into(),
            "--no-session-persistence".into(),
            "--permission-mode".into(),
            "acceptEdits".into(),
            "--add-dir".into(),
            workspace.into(),
        ],
        "grok" => vec![
            "--cwd".into(),
            workspace.into(),
            "--single".into(),
            prompt.into(),
            "--output-format".into(),
            "streaming-json".into(),
            "--permission-mode".into(),
            "acceptEdits".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--no-memory".into(),
        ],
        _ => Vec::new(),
    };
    if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
        args.push("--model".into());
        args.push(model.into());
    }
    if provider_id == "codex" {
        args.push(prompt.into());
    }
    args
}

pub fn cli_events(provider_id: &str, line: &str) -> Vec<ProviderEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
        return Vec::new();
    };
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match provider_id {
        "codex" => codex_cli_events(event_type, &value),
        "claude" => claude_cli_events(event_type, &value),
        "grok" => grok_cli_events(event_type, &value),
        _ => Vec::new(),
    }
}

#[cfg(test)]
pub fn cli_assistant_message(provider_id: &str, line: &str) -> Option<String> {
    cli_events(provider_id, line)
        .into_iter()
        .find_map(|event| match event {
            ProviderEvent::AssistantDelta(text) => Some(text),
            _ => None,
        })
}

fn codex_cli_events(event_type: &str, value: &Value) -> Vec<ProviderEvent> {
    let item_type = value
        .pointer("/item/type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match (event_type, item_type) {
        ("item.completed", "agent_message") => value
            .pointer("/item/text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| vec![ProviderEvent::AssistantDelta(text.to_string())])
            .unwrap_or_default(),
        ("item.started", "command_execution" | "mcp_tool_call" | "web_search") => {
            vec![ProviderEvent::ToolCall(json!({
                "id": value.pointer("/item/id").and_then(Value::as_str).unwrap_or("cli-tool"),
                "name": item_type,
                "arguments": value.pointer("/item/command").cloned().unwrap_or(Value::Null)
            }))]
        }
        (
            "item.completed",
            "command_execution" | "mcp_tool_call" | "web_search" | "file_change",
        ) => vec![ProviderEvent::ToolOutput(json!({
            "toolCallId": value.pointer("/item/id").and_then(Value::as_str).unwrap_or("cli-tool"),
            "name": item_type,
            "output": value.pointer("/item/aggregated_output").cloned().unwrap_or_else(|| value.pointer("/item/status").cloned().unwrap_or(Value::Null)),
            "failed": value.pointer("/item/status").and_then(Value::as_str) == Some("failed")
        }))],
        ("item.completed", "todo_list" | "plan") => vec![ProviderEvent::PlanUpdated(
            value
                .pointer("/item/items")
                .cloned()
                .unwrap_or_else(|| value["item"].clone()),
        )],
        ("turn.completed", _) => usage_event(value.get("usage")),
        ("turn.failed", _) | ("error", _) | ("item.completed", "error") => {
            vec![ProviderEvent::Failed(failure_payload(value))]
        }
        _ => Vec::new(),
    }
}

fn claude_cli_events(event_type: &str, value: &Value) -> Vec<ProviderEvent> {
    match event_type {
        "stream_event"
            if value.pointer("/event/type").and_then(Value::as_str)
                == Some("content_block_delta")
                && value.pointer("/event/delta/type").and_then(Value::as_str)
                    == Some("text_delta") =>
        {
            value
                .pointer("/event/delta/text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(|text| vec![ProviderEvent::AssistantDelta(text.to_string())])
                .unwrap_or_default()
        }
        "assistant" => value
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
            .map(|block| {
                ProviderEvent::ToolCall(json!({
                    "id": block.get("id").and_then(Value::as_str).unwrap_or("cli-tool"),
                    "name": block.get("name").and_then(Value::as_str).unwrap_or("claude_tool"),
                    "arguments": block.get("input").cloned().unwrap_or(Value::Null)
                }))
            })
            .collect(),
        "result" => {
            let mut events = usage_event(value.get("usage"));
            if value.get("is_error").and_then(Value::as_bool) == Some(true) {
                events.push(ProviderEvent::Failed(failure_payload(value)));
            } else {
                events.push(ProviderEvent::Completed);
            }
            events
        }
        _ => Vec::new(),
    }
}

fn grok_cli_events(event_type: &str, value: &Value) -> Vec<ProviderEvent> {
    match event_type {
        "text" => value
            .get("data")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(|text| vec![ProviderEvent::AssistantDelta(text.to_string())])
            .unwrap_or_default(),
        "usage" => usage_event(value.get("usage")),
        "tool_call" | "tool_use" => vec![ProviderEvent::ToolCall(json!({
            "id": value.get("id").and_then(Value::as_str).unwrap_or("cli-tool"),
            "name": value.get("name").and_then(Value::as_str).unwrap_or("grok_tool"),
            "arguments": value.get("arguments").or_else(|| value.get("input")).cloned().unwrap_or(Value::Null)
        }))],
        "tool_result" => vec![ProviderEvent::ToolOutput(json!({
            "toolCallId": value.get("id").and_then(Value::as_str).unwrap_or("cli-tool"),
            "name": value.get("name").and_then(Value::as_str).unwrap_or("grok_tool"),
            "output": value.get("output").or_else(|| value.get("data")).cloned().unwrap_or(Value::Null),
            "failed": value.get("is_error").and_then(Value::as_bool).unwrap_or(false)
        }))],
        "plan" | "todo" => vec![ProviderEvent::PlanUpdated(
            value.get("items").cloned().unwrap_or_else(|| value.clone()),
        )],
        "error" => vec![ProviderEvent::Failed(failure_payload(value))],
        "end" => {
            let mut events = usage_event(value.get("usage"));
            events.push(ProviderEvent::Completed);
            events
        }
        _ => Vec::new(),
    }
}

fn usage_event(value: Option<&Value>) -> Vec<ProviderEvent> {
    let Some(value) = value else {
        return Vec::new();
    };
    let input = value
        .get("input_tokens")
        .or_else(|| value.get("inputTokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output = value
        .get("output_tokens")
        .or_else(|| value.get("outputTokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    vec![ProviderEvent::Usage(
        json!({"input":input,"output":output,"total":input+output}),
    )]
}

fn failure_payload(value: &Value) -> Value {
    let message = value
        .get("error")
        .and_then(Value::as_str)
        .or_else(|| value.get("result").and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))
        .or_else(|| value.pointer("/item/message").and_then(Value::as_str))
        .unwrap_or("provider CLI reported an error");
    let lower = message.to_ascii_lowercase();
    let code = if lower.contains("auth") || lower.contains("401") {
        "provider_authentication"
    } else if lower.contains("429") || lower.contains("rate") {
        "provider_rate_limited"
    } else if lower.contains("timeout") {
        "provider_timeout"
    } else {
        "provider_process"
    };
    json!({"code":code,"message":message,"retriable":matches!(code,"provider_rate_limited"|"provider_timeout")})
}

pub async fn complete(
    profile: &ProviderProfile,
    api_key: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDescriptor],
    deltas: Option<mpsc::UnboundedSender<String>>,
    allow_retry: bool,
) -> Result<ProviderTurn> {
    match profile.provider_type.as_str() {
        "anthropic" => {
            complete_anthropic(
                profile,
                api_key,
                system,
                messages,
                tools,
                deltas,
                allow_retry,
            )
            .await
        }
        "openai" | "openai_compatible" => {
            complete_openai(
                profile,
                api_key,
                system,
                messages,
                tools,
                deltas,
                allow_retry,
            )
            .await
        }
        value => Err(anyhow!(
            "provider type {value} does not support direct API calls"
        )),
    }
}

pub fn user_message(provider_type: &str, text: &str) -> Value {
    chat_message(provider_type, "user", text)
}

pub fn chat_message(provider_type: &str, role: &str, text: &str) -> Value {
    if provider_type == "anthropic" {
        json!({"role":role,"content":[{"type":"text","text":text}]})
    } else {
        json!({"role":role,"content":text})
    }
}

pub fn tool_result_message(
    provider_type: &str,
    call: &ToolCall,
    result: &str,
    failed: bool,
) -> Value {
    if provider_type == "anthropic" {
        json!({"role":"user","content":[{"type":"tool_result","tool_use_id":call.id,"content":result,"is_error":failed}]})
    } else {
        json!({"role":"tool","tool_call_id":call.id,"content":result})
    }
}

async fn complete_openai(
    profile: &ProviderProfile,
    api_key: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDescriptor],
    deltas: Option<mpsc::UnboundedSender<String>>,
    allow_retry: bool,
) -> Result<ProviderTurn> {
    let client = crate::services::http::build_client(
        std::time::Duration::from_secs(15),
        std::time::Duration::from_secs(180),
    )?;
    let base = if profile.provider_type == "openai_compatible" {
        profile
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("Base URL is required for OpenAI-compatible providers"))?
    } else {
        profile
            .base_url
            .as_deref()
            .unwrap_or("https://api.openai.com")
    };
    let url = endpoint(base, "v1/chat/completions");
    let mut all_messages = vec![json!({"role":"system","content":system})];
    all_messages.extend_from_slice(messages);
    let mut body = json!({
        "model": profile.model.as_deref().ok_or_else(|| anyhow!("model is required"))?,
        "messages": all_messages,
        "tools": openai_tools(tools),
        "tool_choice": "auto",
        "stream": true
    });
    if profile.id != "compatible" {
        body["stream_options"] = json!({"include_usage": true});
    }
    let mut request = client.post(url).json(&body);
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = send_with_retry(request, allow_retry).await?;
    let status = response.status();
    if !status.is_success() {
        return Err(http_failure(response).await.into());
    }
    let mut text = String::new();
    let mut raw_calls = BTreeMap::<usize, (String, String, String)>::new();
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    consume_sse(response, |data| {
        if data == "[DONE]" {
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).context("decode OpenAI stream event")?;
        if let Some(usage) = value.get("usage") {
            input_tokens = usage
                .get("prompt_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(input_tokens);
            output_tokens = usage
                .get("completion_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(output_tokens);
        }
        let Some(delta) = value.pointer("/choices/0/delta") else {
            return Ok(());
        };
        if let Some(part) = delta.get("content").and_then(Value::as_str) {
            text.push_str(part);
            if !part.is_empty() {
                if let Some(sender) = &deltas {
                    let _ = sender.send(part.to_string());
                }
            }
        }
        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let index = call
                .get("index")
                .and_then(Value::as_u64)
                .unwrap_or_default() as usize;
            let entry = raw_calls.entry(index).or_default();
            if let Some(value) = call.get("id").and_then(Value::as_str) {
                entry.0.push_str(value);
            }
            if let Some(value) = call.pointer("/function/name").and_then(Value::as_str) {
                entry.1.push_str(value);
            }
            if let Some(value) = call.pointer("/function/arguments").and_then(Value::as_str) {
                entry.2.push_str(value);
            }
        }
        Ok(())
    })
    .await?;
    let tool_calls = raw_calls
        .values()
        .map(|(id, name, arguments)| ToolCall {
            id: id.clone(),
            name: name.clone(),
            arguments: serde_json::from_str(arguments).unwrap_or_else(|_| json!({})),
        })
        .collect::<Vec<_>>();
    let serialized_calls = raw_calls
        .values()
        .map(|(id, name, arguments)| {
            json!({
                "id": id,
                "type": "function",
                "function": {"name": name, "arguments": arguments}
            })
        })
        .collect::<Vec<_>>();
    let message = if serialized_calls.is_empty() {
        json!({"role":"assistant","content":text})
    } else {
        json!({"role":"assistant","content":text,"tool_calls":serialized_calls})
    };
    if text.is_empty() && tool_calls.is_empty() {
        return Err(ProviderFailure::Protocol("empty OpenAI-compatible response".into()).into());
    }
    let events = normalized_events(&text, &tool_calls, input_tokens, output_tokens);
    Ok(ProviderTurn {
        text,
        tool_calls,
        input_tokens,
        output_tokens,
        assistant_message: message,
        events,
    })
}

async fn complete_anthropic(
    profile: &ProviderProfile,
    api_key: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDescriptor],
    deltas: Option<mpsc::UnboundedSender<String>>,
    allow_retry: bool,
) -> Result<ProviderTurn> {
    let client = crate::services::http::build_client(
        std::time::Duration::from_secs(15),
        std::time::Duration::from_secs(180),
    )?;
    let base = profile
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com");
    let url = endpoint(base, "v1/messages");
    let mut headers = HeaderMap::new();
    headers.insert("x-api-key", HeaderValue::from_str(api_key)?);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let body = json!({
        "model": profile.model.as_deref().ok_or_else(|| anyhow!("model is required"))?,
        "max_tokens": 8192,
        "system": system,
        "messages": messages,
        "tools": anthropic_tools(tools),
        "stream": true
    });
    let response =
        send_with_retry(client.post(url).headers(headers).json(&body), allow_retry).await?;
    let status = response.status();
    if !status.is_success() {
        return Err(http_failure(response).await.into());
    }
    let mut text = String::new();
    let mut raw_calls = BTreeMap::<usize, (String, String, String)>::new();
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    consume_sse(response, |data| {
        let value: Value = serde_json::from_str(data).context("decode Anthropic stream event")?;
        match value.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                input_tokens = value
                    .pointer("/message/usage/input_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(input_tokens);
            }
            Some("content_block_start") => {
                let index = value
                    .get("index")
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize;
                let block = value.get("content_block").cloned().unwrap_or(Value::Null);
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    raw_calls.insert(
                        index,
                        (
                            block
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            block
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            String::new(),
                        ),
                    );
                }
            }
            Some("content_block_delta") => {
                let index = value
                    .get("index")
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize;
                let delta = value.get("delta").cloned().unwrap_or(Value::Null);
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        let part = delta
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        text.push_str(part);
                        if !part.is_empty() {
                            if let Some(sender) = &deltas {
                                let _ = sender.send(part.to_string());
                            }
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some(entry) = raw_calls.get_mut(&index) {
                            entry.2.push_str(
                                delta
                                    .get("partial_json")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default(),
                            );
                        }
                    }
                    _ => {}
                }
            }
            Some("message_delta") => {
                output_tokens = value
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(output_tokens);
            }
            Some("error") => {
                return Err(anyhow!(
                    "Anthropic stream error: {}",
                    provider_error(&value)
                ))
            }
            _ => {}
        }
        Ok(())
    })
    .await?;
    let tool_calls = raw_calls
        .values()
        .map(|(id, name, arguments)| ToolCall {
            id: id.clone(),
            name: name.clone(),
            arguments: serde_json::from_str(arguments).unwrap_or_else(|_| json!({})),
        })
        .collect::<Vec<_>>();
    let mut content = Vec::new();
    if !text.is_empty() {
        content.push(json!({"type":"text","text":text}));
    }
    content.extend(tool_calls.iter().map(
        |call| json!({"type":"tool_use","id":call.id,"name":call.name,"input":call.arguments}),
    ));
    if text.is_empty() && tool_calls.is_empty() {
        return Err(ProviderFailure::Protocol("empty Anthropic response".into()).into());
    }
    let events = normalized_events(&text, &tool_calls, input_tokens, output_tokens);
    Ok(ProviderTurn {
        text,
        tool_calls,
        input_tokens,
        output_tokens,
        assistant_message: json!({"role":"assistant","content":content}),
        events,
    })
}

fn normalized_events(
    text: &str,
    tool_calls: &[ToolCall],
    input_tokens: i64,
    output_tokens: i64,
) -> Vec<ProviderEvent> {
    let mut events = Vec::new();
    if !text.is_empty() {
        events.push(ProviderEvent::AssistantDelta(text.to_string()));
    }
    events.extend(tool_calls.iter().map(|call| {
        ProviderEvent::ToolCall(json!({"id":call.id,"name":call.name,"arguments":call.arguments}))
    }));
    events.push(ProviderEvent::Usage(
        json!({"input":input_tokens,"output":output_tokens,"total":input_tokens+output_tokens}),
    ));
    events.push(ProviderEvent::Completed);
    events
}

pub async fn validate(profile: &ProviderProfile, api_key: Option<&str>) -> Result<String> {
    if profile.provider_type == "cli" {
        let path = resolve_cli(profile)
            .ok_or_else(|| anyhow!("{} executable was not found", profile.display_name))?;
        let output = Command::new(&path).arg("--version").output().await?;
        if !output.status.success() {
            return Err(anyhow!("provider executable returned {}", output.status));
        }
        let text = if output.stdout.is_empty() {
            output.stderr
        } else {
            output.stdout
        };
        let version = String::from_utf8_lossy(&text).trim().to_string();
        if profile.id == "grok" {
            let auth = crate::services::grok::read_auth_profile();
            if !auth.signed_in || (auth.expired && !auth.has_refresh) {
                return Err(ProviderFailure::Authentication(
                    "Grok Build CLI 已安装但尚未登录".into(),
                )
                .into());
            }
            return Ok(auth
                .email
                .map(|email| format!("{version} · 已登录 {email}"))
                .unwrap_or_else(|| format!("{version} · 已登录")));
        }
        return Ok(version);
    }
    let key = api_key.unwrap_or("");
    if key.is_empty() && profile.id != "compatible" {
        return Err(anyhow!("API Key is missing"));
    }
    let turn = complete(
        profile,
        key,
        "Reply with OK only.",
        &[user_message(&profile.provider_type, "OK")],
        &[],
        None,
        true,
    )
    .await?;
    Ok(if turn.text.is_empty() {
        "连接成功".into()
    } else {
        turn.text
    })
}

fn endpoint(base: &str, path: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.ends_with("/v1") && path.starts_with("v1/") {
        format!("{base}/{}", &path[3..])
    } else {
        format!("{base}/{path}")
    }
}

async fn consume_sse(
    response: reqwest::Response,
    mut handle: impl FnMut(&str) -> Result<()>,
) -> Result<()> {
    let mut stream = response.bytes_stream();
    let mut pending = String::new();
    while let Some(chunk) = stream.next().await {
        pending.push_str(&String::from_utf8_lossy(&chunk?));
        while let Some(end) = pending.find('\n') {
            let line = pending.drain(..=end).collect::<String>();
            handle_sse_line(&line, &mut handle)?;
        }
    }
    if !pending.is_empty() {
        handle_sse_line(&pending, &mut handle)?;
    }
    Ok(())
}

async fn send_with_retry(
    request: reqwest::RequestBuilder,
    allow_retry: bool,
) -> Result<reqwest::Response> {
    let mut attempt = 0u32;
    loop {
        let current = request
            .try_clone()
            .ok_or_else(|| ProviderFailure::Protocol("request cannot be retried".into()))?;
        match current.send().await {
            Ok(response)
                if allow_retry
                    && attempt < 2
                    && (response.status().as_u16() == 429
                        || response.status().is_server_error()) =>
            {
                let retry_after = response
                    .headers()
                    .get(RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(1)
                    .min(5);
                tokio::time::sleep(std::time::Duration::from_secs(retry_after)).await;
                attempt += 1;
            }
            Ok(response) => return Ok(response),
            Err(error)
                if allow_retry && attempt < 2 && (error.is_connect() || error.is_timeout()) =>
            {
                tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1) as u64))
                    .await;
                attempt += 1;
            }
            Err(error) if error.is_timeout() => return Err(ProviderFailure::Timeout.into()),
            Err(error) => return Err(ProviderFailure::Protocol(error.to_string()).into()),
        }
    }
}

async fn http_failure(response: reqwest::Response) -> ProviderFailure {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(|value| format!("; retry after {value}"))
        .unwrap_or_default();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .map(|value| provider_error(&value))
        .filter(|value| value != "unknown provider error")
        .unwrap_or_else(|| body.chars().take(500).collect());
    match status.as_u16() {
        401 | 403 => ProviderFailure::Authentication(message),
        429 => ProviderFailure::RateLimited(retry_after),
        _ => ProviderFailure::Protocol(format!("HTTP {status}: {message}")),
    }
}

fn handle_sse_line(line: &str, handle: &mut impl FnMut(&str) -> Result<()>) -> Result<()> {
    let line = line.trim_end_matches(['\r', '\n']);
    if let Some(data) = line.strip_prefix("data:") {
        let data = data.trim_start();
        if !data.is_empty() {
            handle(data)?;
        }
    }
    Ok(())
}

fn provider_error(value: &Value) -> String {
    value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("unknown provider error")
        .to_string()
}

fn openai_tools(tools: &[ToolDescriptor]) -> Value {
    Value::Array(tools.iter().map(|tool| json!({"type":"function","function":{"name":tool.name,"description":tool.description,"parameters":tool.input_schema}})).collect())
}

fn anthropic_tools(tools: &[ToolDescriptor]) -> Value {
    Value::Array(tools.iter().map(|tool| json!({"name":tool.name,"description":tool.description,"input_schema":tool.input_schema})).collect())
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        thread,
        time::Duration,
    };

    use super::*;

    fn profile(id: &str, provider_type: &str, base_url: String) -> ProviderProfile {
        ProviderProfile {
            id: id.into(),
            provider_type: provider_type.into(),
            display_name: id.into(),
            model: Some("test-model".into()),
            base_url: Some(base_url),
            executable: None,
            credential_ref: Some(format!("provider:{id}")),
            enabled: true,
            config: json!({}),
        }
    }

    fn sse_server(expected_path: &'static str, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = Vec::new();
            let mut buffer = [0u8; 2048];
            loop {
                let count = stream.read(&mut buffer).expect("read request");
                request.extend_from_slice(&buffer[..count]);
                if request.windows(4).any(|part| part == b"\r\n\r\n") || count == 0 {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&request);
            assert!(
                request.starts_with(&format!("POST {expected_path} ")),
                "{request}"
            );
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).expect("write headers");
            for part in body.as_bytes().chunks(37) {
                stream.write_all(part).expect("write stream part");
                stream.flush().expect("flush stream part");
                thread::sleep(Duration::from_millis(2));
            }
        });
        format!("http://{address}")
    }

    fn retry_server(attempts: Arc<AtomicUsize>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind retry server");
        let address = listener.local_addr().expect("retry address");
        thread::spawn(move || {
            for index in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept retry request");
                let mut request = Vec::new();
                let mut buffer = [0u8; 2048];
                loop {
                    let count = stream.read(&mut buffer).expect("read retry request");
                    request.extend_from_slice(&buffer[..count]);
                    if request.windows(4).any(|part| part == b"\r\n\r\n") || count == 0 {
                        break;
                    }
                }
                attempts.fetch_add(1, Ordering::SeqCst);
                if index == 0 {
                    write!(stream, "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                } else {
                    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"retried\"}}]}\n\ndata: [DONE]\n\n";
                    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
                }
            }
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn parses_openai_sse_text_tools_and_usage() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"world\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":7}}\n\n",
            "data: [DONE]\n\n"
        );
        let base = sse_server("/v1/chat/completions", body);
        let (tx, mut rx) = mpsc::unbounded_channel();
        let turn = complete(
            &profile("openai", "openai", base),
            "secret",
            "system",
            &[json!({"role":"user","content":"hi"})],
            &[],
            Some(tx),
            true,
        )
        .await
        .expect("complete");
        let mut streamed = String::new();
        while let Ok(part) = rx.try_recv() {
            streamed.push_str(&part);
        }
        assert_eq!(turn.text, "Hello world");
        assert_eq!(streamed, turn.text);
        assert_eq!(turn.tool_calls[0].name, "read_file");
        assert_eq!(turn.tool_calls[0].arguments["path"], "README.md");
        assert_eq!((turn.input_tokens, turn.output_tokens), (11, 7));
    }

    #[tokio::test]
    async fn parses_anthropic_sse_text_tools_and_usage() {
        let body = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9}}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Done\"}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"git_diff\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":4}}\n\n"
        );
        let base = sse_server("/v1/messages", body);
        let turn = complete(
            &profile("anthropic", "anthropic", base),
            "secret",
            "system",
            &[user_message("anthropic", "hi")],
            &[],
            None,
            true,
        )
        .await
        .expect("complete");
        assert_eq!(turn.text, "Done");
        assert_eq!(turn.tool_calls[0].name, "git_diff");
        assert_eq!((turn.input_tokens, turn.output_tokens), (9, 4));
    }

    #[tokio::test]
    async fn retries_429_before_tool_side_effects() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let base = retry_server(attempts.clone());
        let turn = complete(
            &profile("xai", "openai_compatible", base),
            "secret",
            "system",
            &[json!({"role":"user","content":"hi"})],
            &[],
            None,
            true,
        )
        .await
        .unwrap();
        assert_eq!(turn.text, "retried");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn rejects_empty_stream_and_missing_compatible_base_url() {
        let base = sse_server("/v1/chat/completions", "data: [DONE]\n\n");
        let empty = complete(
            &profile("openai", "openai", base),
            "secret",
            "system",
            &[],
            &[],
            None,
            false,
        )
        .await
        .unwrap_err();
        assert!(empty.to_string().contains("empty"));

        let mut compatible = profile("compatible", "openai_compatible", "".into());
        compatible.base_url = None;
        let missing = complete(&compatible, "", "system", &[], &[], None, false)
            .await
            .unwrap_err();
        assert!(missing.to_string().contains("Base URL"));
    }

    #[tokio::test]
    async fn classifies_request_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(250));
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(40))
            .build()
            .unwrap();
        let error = send_with_retry(client.get(format!("http://{address}")), false)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("timed out"));
    }

    #[test]
    fn joins_versioned_and_unversioned_endpoints() {
        assert_eq!(
            endpoint("https://api.example/v1", "v1/chat/completions"),
            "https://api.example/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://api.example", "v1/messages"),
            "https://api.example/v1/messages"
        );
    }

    #[test]
    fn normalizes_cli_assistant_messages() {
        let codex =
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"Codex result"}}"#;
        let claude = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude result"}}}"#;
        let grok = r#"{"type":"text","data":"Grok result"}"#;
        assert_eq!(
            cli_assistant_message("codex", codex).as_deref(),
            Some("Codex result")
        );
        assert_eq!(
            cli_assistant_message("claude", claude).as_deref(),
            Some("Claude result")
        );
        assert_eq!(
            cli_assistant_message("grok", grok).as_deref(),
            Some("Grok result")
        );
        assert!(cli_assistant_message("grok", "plain text").is_none());
    }

    #[test]
    fn normalizes_cli_usage_tools_and_failures() {
        let codex_tool = r#"{"type":"item.started","item":{"id":"tool-1","type":"command_execution","command":"git status"}}"#;
        assert!(matches!(
            cli_events("codex", codex_tool).first(),
            Some(ProviderEvent::ToolCall(value)) if value["name"] == "command_execution"
        ));

        let grok_usage = r#"{"type":"usage","usage":{"input_tokens":12,"output_tokens":3}}"#;
        assert!(matches!(
            cli_events("grok", grok_usage).first(),
            Some(ProviderEvent::Usage(value)) if value["total"] == 15
        ));

        let claude_auth = r#"{"type":"result","is_error":true,"error":"authentication_failed","result":"API Error: 401 OAuth access token has expired","usage":{"input_tokens":0,"output_tokens":0}}"#;
        let events = cli_events("claude", claude_auth);
        assert!(events.iter().any(|event| matches!(
            event,
            ProviderEvent::Failed(value) if value["code"] == "provider_authentication"
        )));
    }

    #[test]
    fn configures_all_cli_adapters_with_machine_output_and_workspace_sandbox() {
        let codex = cli_args("codex", "C:/workspace", "test", Some("model-a"));
        assert!(codex
            .windows(2)
            .any(|args| args == ["--sandbox", "workspace-write"]));
        assert!(codex.contains(&"--json".into()) && codex.contains(&"--ephemeral".into()));

        let capabilities = adapter(&ProviderProfile {
            id: "codex".into(),
            provider_type: "cli".into(),
            display_name: "Codex CLI".into(),
            model: None,
            base_url: None,
            executable: None,
            credential_ref: None,
            enabled: true,
            config: Value::Null,
        })
        .capabilities();
        assert!(capabilities.tools && capabilities.usage && capabilities.attachments);

        let claude = cli_args("claude", "C:/workspace", "test", None);
        assert!(claude
            .windows(2)
            .any(|args| args == ["--output-format", "stream-json"]));
        assert!(claude
            .windows(2)
            .any(|args| args == ["--permission-mode", "acceptEdits"]));
        assert!(claude.contains(&"--no-session-persistence".into()));
        assert_eq!(&claude[..2], ["-p", "test"]);

        let grok = cli_args("grok", "C:/workspace", "test", None);
        assert!(grok
            .windows(2)
            .any(|args| args == ["--output-format", "streaming-json"]));
        assert!(grok
            .windows(2)
            .any(|args| args == ["--sandbox", "workspace-write"]));
        assert!(grok.contains(&"--no-memory".into()));
        assert!(grok.windows(2).any(|args| args == ["--single", "test"]));
    }
}
