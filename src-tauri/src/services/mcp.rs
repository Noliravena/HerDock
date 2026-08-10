use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::{anyhow, Context, Result};
use rmcp::{
    model::CallToolRequestParams,
    service::{RoleClient, RunningService},
    transport::{ConfigureCommandExt, TokioChildProcess},
    ServiceExt,
};
use serde_json::{Map, Value};
use tokio::{process::Command, sync::Mutex};
use tokio_util::sync::CancellationToken;

use crate::{domain::models::McpServer, infra::secrets};

pub type McpClient = RunningService<RoleClient, ()>;

#[derive(Debug, Clone)]
pub struct McpToolSpec {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub read_only: bool,
}

pub struct McpManager {
    clients: Mutex<HashMap<String, McpClientEntry>>,
    call_timeout: Duration,
}

#[derive(Clone)]
struct McpClientEntry {
    client: Arc<Mutex<McpClient>>,
    cancel: CancellationToken,
}

impl Default for McpManager {
    fn default() -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            call_timeout: Duration::from_secs(120),
        }
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start(&self, server: &McpServer) -> Result<Vec<McpToolSpec>> {
        if let Some(entry) = self.clients.lock().await.get(&server.id).cloned() {
            if !entry.cancel.is_cancelled() && !entry.client.lock().await.is_closed() {
                return list_tools(server, &entry.client).await;
            }
            self.clients.lock().await.remove(&server.id);
        }
        let env = resolve_env(server)?;
        let transport =
            TokioChildProcess::new(Command::new(&server.command).configure(|command| {
                command.args(&server.args);
                command.kill_on_drop(true);
                for (key, value) in &env {
                    command.env(key, value);
                }
            }))
            .map_err(|error| anyhow!(error))?;
        let client = tokio::time::timeout(Duration::from_secs(15), ().serve(transport))
            .await
            .context("MCP initialization timed out")??;
        let client = Arc::new(Mutex::new(client));
        let tools = list_tools(server, &client).await?;
        self.clients.lock().await.insert(
            server.id.clone(),
            McpClientEntry {
                client,
                cancel: CancellationToken::new(),
            },
        );
        Ok(tools)
    }

    pub async fn stop(&self, server_id: &str) -> Result<()> {
        let entry = self.clients.lock().await.remove(server_id);
        if let Some(entry) = entry {
            entry.cancel.cancel();
            entry
                .client
                .lock()
                .await
                .close_with_timeout(Duration::from_secs(3))
                .await?;
        }
        Ok(())
    }

    pub async fn stop_all(&self) {
        let ids = self
            .clients
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.stop(&id).await;
        }
    }

    pub async fn call(
        &self,
        server: &McpServer,
        tool_name: &str,
        arguments: Value,
    ) -> Result<String> {
        self.start(server).await?;
        let entry = self
            .clients
            .lock()
            .await
            .get(&server.id)
            .cloned()
            .ok_or_else(|| anyhow!("MCP server is not running"))?;
        let arguments = arguments
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow!("MCP tool arguments must be an object"))?;
        let client = entry.client.lock().await;
        let request = client
            .call_tool(CallToolRequestParams::new(tool_name.to_string()).with_arguments(arguments));
        let result = tokio::select! {
            _ = entry.cancel.cancelled() => return Err(anyhow!("MCP tool call was cancelled")),
            result = tokio::time::timeout(self.call_timeout, request) => result.context("MCP tool timed out")??,
        };
        let output = serde_json::to_string_pretty(&result)?;
        if output.len() > 1024 * 1024 {
            return Err(anyhow!("MCP tool output exceeded 1 MiB"));
        }
        Ok(output)
    }
}

#[cfg(test)]
impl McpManager {
    fn with_timeout(timeout: Duration) -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            call_timeout: timeout,
        }
    }
}

async fn list_tools(
    server: &McpServer,
    client: &Arc<Mutex<McpClient>>,
) -> Result<Vec<McpToolSpec>> {
    let response = tokio::time::timeout(
        Duration::from_secs(15),
        client.lock().await.list_tools(Default::default()),
    )
    .await
    .context("MCP tool discovery timed out")??;
    Ok(response
        .tools
        .into_iter()
        .map(|tool| McpToolSpec {
            server_id: server.id.clone(),
            name: tool.name.to_string(),
            description: tool
                .description
                .map(|value| value.to_string())
                .unwrap_or_default(),
            input_schema: Value::Object((*tool.input_schema).clone()),
            read_only: tool
                .annotations
                .as_ref()
                .and_then(|annotations| annotations.read_only_hint)
                .unwrap_or(false),
        })
        .collect())
}

fn resolve_env(server: &McpServer) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    let Some(values) = server.env.as_object() else {
        return Ok(out);
    };
    for (key, value) in values {
        let Some(value) = value.as_str() else {
            continue;
        };
        if let Some(reference) = value.strip_prefix("keyring:") {
            if let Some(secret) = secrets::get_secret(reference)? {
                out.insert(key.clone(), secret);
            }
        } else if value != "********" {
            out.insert(key.clone(), value.to_string());
        }
    }
    Ok(out)
}

pub fn masked_env(env: &Value) -> Value {
    Value::Object(
        env.as_object()
            .into_iter()
            .flatten()
            .map(|(key, _)| (key.clone(), Value::String("********".into())))
            .collect::<Map<_, _>>(),
    )
}

pub fn public_server(mut server: McpServer) -> McpServer {
    server.env = masked_env(&server.env);
    server
}

pub fn secure_env(server_id: &str, new_env: &Value, existing_env: Option<&Value>) -> Result<Value> {
    let existing = existing_env
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let requested = new_env.as_object().cloned().unwrap_or_default();
    let mut secured = Map::new();
    for (key, value) in &requested {
        let value = value.as_str().unwrap_or_default();
        if value == "********" {
            if let Some(reference) = existing.get(key).cloned() {
                secured.insert(key.clone(), reference);
            }
            continue;
        }
        if value.is_empty() {
            continue;
        }
        let reference = format!("mcp:{server_id}:env:{key}");
        secrets::set_secret(&reference, value)?;
        secured.insert(key.clone(), Value::String(format!("keyring:{reference}")));
    }
    for (key, reference) in existing {
        if requested.contains_key(&key) {
            continue;
        }
        if let Some(reference) = reference
            .as_str()
            .and_then(|value| value.strip_prefix("keyring:"))
        {
            let _ = secrets::delete_secret(reference);
        }
    }
    Ok(Value::Object(secured))
}

pub fn migrate_legacy_env(server: &mut McpServer) -> Result<bool> {
    let Some(values) = server.env.as_object().cloned() else {
        return Ok(false);
    };
    let mut changed = false;
    let mut secured = Map::new();
    for (key, value) in values {
        let Some(value) = value.as_str() else {
            changed = true;
            continue;
        };
        if value.starts_with("keyring:") {
            secured.insert(key, Value::String(value.to_string()));
            continue;
        }
        changed = true;
        if value.is_empty() || value == "********" {
            continue;
        }
        let reference = format!("mcp:{}:env:{key}", server.id);
        secrets::set_secret(&reference, value)?;
        let verified = secrets::get_secret(&reference)?;
        if verified.as_deref() != Some(value) {
            let _ = secrets::delete_secret(&reference);
            return Err(anyhow!("failed to verify migrated MCP secret"));
        }
        secured.insert(key, Value::String(format!("keyring:{reference}")));
    }
    if changed {
        server.env = Value::Object(secured);
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fake_server() -> McpServer {
        McpServer {
            id: "fake_mcp".into(),
            name: "Fake MCP".into(),
            command: "node".into(),
            args: vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/fake-mcp.mjs")
                .to_string_lossy()
                .to_string()],
            env: json!({}),
            enabled: true,
            workspace_id: None,
            status: None,
            tools: vec![],
        }
    }

    use std::path::PathBuf;

    #[tokio::test]
    async fn discovers_calls_times_out_and_stops_stdio_server() {
        if Command::new("node")
            .arg("--version")
            .output()
            .await
            .is_err()
        {
            return;
        }
        let manager = McpManager::with_timeout(Duration::from_millis(150));
        let server = fake_server();
        let tools = manager.start(&server).await.expect("start fake MCP");
        assert_eq!(tools.len(), 2);
        assert!(tools
            .iter()
            .any(|tool| tool.name == "echo" && tool.read_only));
        let output = manager
            .call(&server, "echo", json!({"value":"ok"}))
            .await
            .unwrap();
        assert!(output.contains("ok"));
        let error = manager.call(&server, "hang", json!({})).await.unwrap_err();
        assert!(error.to_string().contains("timed out"));
        manager.stop(&server.id).await.unwrap();
    }
}
