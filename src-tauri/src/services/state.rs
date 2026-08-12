use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
};

use tauri::{ipc::Channel, AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::events::RunEvent,
    infra::database::Database,
    services::{
        browser::BrowserManager, grok::GrokAuthManager, mcp::McpManager, terminal::TerminalHandle,
    },
};

#[derive(Clone)]
pub struct EventSink {
    channel: Option<Channel<RunEvent>>,
    app: AppHandle,
}

impl EventSink {
    pub fn new(app: AppHandle, channel: Option<Channel<RunEvent>>) -> Self {
        Self { channel, app }
    }

    pub fn send(&self, event: RunEvent) {
        if let Some(channel) = &self.channel {
            if channel.send(event.clone()).is_ok() {
                return;
            }
        }
        let _ = self.app.emit("run-event", event);
    }

    pub fn notify(&self, title: &str, body: &str) {
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub runs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub approvals: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    /// Scope keys the operator allowed for the remainder of a single run. Kept in
    /// memory only: a run-scoped allowance must not outlive the process.
    pub run_allowances: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    pub terminals: Arc<Mutex<HashMap<String, TerminalHandle>>>,
    pub mcp: Arc<McpManager>,
    pub grok_auth: Arc<GrokAuthManager>,
    pub browser: Arc<BrowserManager>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(database: Database, data_dir: PathBuf) -> Self {
        Self {
            db: Arc::new(Mutex::new(database)),
            runs: Arc::new(Mutex::new(HashMap::new())),
            approvals: Arc::new(Mutex::new(HashMap::new())),
            run_allowances: Arc::new(Mutex::new(HashMap::new())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            mcp: Arc::new(McpManager::new()),
            grok_auth: Arc::new(GrokAuthManager::default()),
            browser: Arc::new(BrowserManager::new()),
            data_dir,
        }
    }
}
