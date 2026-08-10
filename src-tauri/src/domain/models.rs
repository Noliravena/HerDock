use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub desktop: bool,
    pub data_dir: String,
    pub path_separator: String,
    pub modifier_key: String,
    pub command_hint: String,
    pub new_hint: String,
    pub submit_hint: String,
    pub default_shell: String,
    pub window_control: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub branch: Option<String>,
    pub dirty_summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub kind: String,
    pub provider_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub session_id: String,
    pub workspace_id: String,
    pub provider_id: String,
    pub model: Option<String>,
    pub status: String,
    pub prompt: String,
    pub plan_progress: Option<String>,
    pub error_message: Option<String>,
    pub token_usage: Value,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub provider_type: String,
    pub display_name: String,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub executable: Option<String>,
    pub credential_ref: Option<String>,
    pub enabled: bool,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub id: String,
    pub display_name: String,
    pub provider_type: String,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub auth: String,
    pub detail: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokAuthStatus {
    pub cli_found: bool,
    pub cli_path: Option<String>,
    pub version: Option<String>,
    pub signed_in: bool,
    pub expired: bool,
    pub auth_mode: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub expires_at: Option<String>,
    pub login_running: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokLoginEvent {
    pub event_type: String,
    pub message: String,
    pub url: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokLoginResult {
    pub ok: bool,
    pub method: String,
    pub message: String,
    pub timed_out: bool,
    pub device_url: Option<String>,
    pub device_code: Option<String>,
    pub status: GrokAuthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub chat: bool,
    pub streaming: bool,
    pub tools: bool,
    pub usage: bool,
    pub attachments: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub risk: String,
    pub source: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ProviderEvent {
    AssistantDelta(String),
    PlanUpdated(Value),
    ToolCall(Value),
    ToolOutput(Value),
    Usage(Value),
    Completed,
    Failed(Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub retriable: bool,
    pub details: Option<Value>,
}

impl CommandError {
    pub fn from_message(message: String) -> Self {
        let lower = message.to_ascii_lowercase();
        let (code, retriable) = if lower.contains("auth") || lower.contains("api key") {
            ("authentication", false)
        } else if lower.contains("rate limit") || lower.contains("429") {
            ("rate_limited", true)
        } else if lower.contains("timeout") || lower.contains("timed out") {
            ("timeout", true)
        } else if lower.contains("cancel") {
            ("cancelled", false)
        } else if lower.contains("protocol") || lower.contains("empty response") {
            ("protocol", true)
        } else {
            ("command_failed", false)
        };
        Self {
            code: code.into(),
            message,
            retriable,
            details: None,
        }
    }
}

impl From<String> for CommandError {
    fn from(value: String) -> Self {
        Self::from_message(value)
    }
}

impl From<&str> for CommandError {
    fn from(value: &str) -> Self {
        Self::from_message(value.into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: String,
    pub workspace_id: Option<String>,
    pub source_kind: String,
    pub display_name: String,
    pub relative_path: Option<String>,
    pub stored_path: Option<String>,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRule {
    pub id: String,
    pub rule_type: String,
    pub scope_key: String,
    pub effect: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub enabled: bool,
    pub channel: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub state: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub git_status: Option<String>,
    pub children: Option<Vec<FsNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub path: String,
    pub content: String,
    pub binary: bool,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub run_id: String,
    pub label: String,
    pub snapshot_ref: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub run_id: Option<String>,
    pub workspace_id: String,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size_bytes: Option<i64>,
    pub kind: String,
    pub renderer: Option<String>,
    pub entry_path: Option<String>,
    pub status: String,
    pub manifest: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSystem {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub scope: String,
    pub has_tokens: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSystemContent {
    pub system: DesignSystem,
    pub design_markdown: String,
    pub tokens_css: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPreview {
    pub path: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub approval_id: String,
    pub run_id: String,
    pub title: String,
    pub detail: String,
    pub risk: String,
    pub kind: String,
    pub scope_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub cron: String,
    pub prompt: String,
    pub provider_id: String,
    pub enabled: bool,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub glyph: String,
    pub name: String,
    pub status: String,
    pub detail: String,
    pub path: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Value,
    pub enabled: bool,
    pub workspace_id: Option<String>,
    pub status: Option<String>,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    pub key: String,
    pub label: String,
    pub tokens: i64,
    pub runs: i64,
    pub calls: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub buckets: Vec<UsageBucket>,
    pub context: UsageContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageContext {
    pub used: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub run_id: String,
    pub name: String,
    pub workspace_id: String,
    pub status: String,
    pub meta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContext {
    pub files: Vec<ContextFile>,
    pub rules: Vec<String>,
    pub output_dir: String,
    pub test_command: Option<String>,
    pub auto_execute: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextFile {
    pub path: String,
    pub kind: String,
    pub size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_provider: String,
    pub default_model: String,
    pub auto_execute: String,
    pub terminal_shell: String,
    pub close_to_tray: bool,
    pub launch_shortcut: String,
    pub update_channel: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_provider: "codex".into(),
            default_model: "".into(),
            auto_execute: "ask_risky".into(),
            terminal_shell: String::new(),
            close_to_tray: true,
            launch_shortcut: "CommandOrControl+Shift+Space".into(),
            update_channel: "stable".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunRequest {
    pub session_id: String,
    pub workspace_id: String,
    pub provider_id: String,
    pub model: Option<String>,
    pub prompt: String,
    pub auto_execute: Option<String>,
    #[serde(default)]
    pub context_paths: Vec<String>,
    #[serde(default)]
    pub context_item_ids: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub mcp_server_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextImportRequest {
    pub workspace_id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInputs {
    pub model: Option<String>,
    pub context_item_ids: Vec<String>,
    pub skill_ids: Vec<String>,
    pub mcp_server_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScheduleRequest {
    pub id: Option<String>,
    pub workspace_id: String,
    pub name: String,
    pub cron: String,
    pub prompt: String,
    pub provider_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderRequest {
    pub id: String,
    pub provider_type: String,
    pub display_name: String,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub executable: Option<String>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub candidate_models: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMcpRequest {
    pub id: Option<String>,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Value,
    pub enabled: bool,
    pub workspace_id: Option<String>,
}
