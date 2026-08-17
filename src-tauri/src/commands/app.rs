use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{
    commands::error::{err, CommandResult},
    domain::models::{AppSettings, PlatformInfo},
    services::{
        doctor::{self, DoctorReport, ProbeResult},
        http,
        state::AppState,
    },
};

pub fn platform_info(state: &AppState) -> PlatformInfo {
    let apple = cfg!(target_os = "macos");
    let windows = cfg!(target_os = "windows");
    PlatformInfo {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        desktop: true,
        data_dir: state.data_dir.to_string_lossy().to_string(),
        path_separator: std::path::MAIN_SEPARATOR.to_string(),
        modifier_key: if apple { "⌘" } else { "Ctrl" }.into(),
        command_hint: if apple { "⌘K" } else { "Ctrl K" }.into(),
        new_hint: if apple { "⌘N" } else { "Ctrl N" }.into(),
        submit_hint: if apple { "⌘↵" } else { "Ctrl ↵" }.into(),
        default_shell: default_shell(),
        window_control: if windows { "windows" } else { "macos" }.into(),
    }
}

#[tauri::command]
pub async fn app_platform(state: State<'_, AppState>) -> CommandResult<PlatformInfo> {
    Ok(platform_info(&state))
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> CommandResult<AppSettings> {
    state.db.lock().await.settings().map_err(err)
}

#[tauri::command]
pub async fn settings_save(
    settings: AppSettings,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<AppSettings> {
    let previous = state.db.lock().await.settings().map_err(err)?;
    if previous.launch_shortcut != settings.launch_shortcut {
        app.global_shortcut().unregister_all().map_err(err)?;
        if let Err(error) = app
            .global_shortcut()
            .register(settings.launch_shortcut.as_str())
        {
            let _ = app
                .global_shortcut()
                .register(previous.launch_shortcut.as_str());
            return Err(error.to_string().into());
        }
    }
    http::set_configured_proxy(settings.http_proxy.clone());
    state
        .db
        .lock()
        .await
        .save_settings(&settings)
        .map_err(err)?;
    Ok(settings)
}

#[tauri::command]
pub async fn doctor_run(state: State<'_, AppState>) -> CommandResult<DoctorReport> {
    let snapshot = {
        let db = state.db.lock().await;
        doctor::DoctorSnapshot::from_db(&db).map_err(err)?
    };
    let health = doctor::provider_health(&snapshot.profiles).await;
    Ok(doctor::run_doctor(&snapshot, &state.data_dir, &health, None).await)
}

#[tauri::command]
pub async fn network_probe(
    urls: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProbeResult>> {
    let (settings_proxy, bases) = {
        let db = state.db.lock().await;
        let settings = db.settings().map_err(err)?;
        let bases: Vec<String> = db
            .list_providers()
            .map_err(err)?
            .into_iter()
            .filter(|profile| profile.enabled)
            .filter_map(|profile| profile.base_url)
            .filter(|value| !value.trim().is_empty())
            .collect();
        (settings.http_proxy, bases)
    };
    http::set_configured_proxy(settings_proxy);
    let targets = doctor::probe_targets(&bases, urls.as_deref());
    Ok(doctor::probe_urls(&targets).await)
}

#[tauri::command]
pub async fn doctor_export(
    dest_path: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<String> {
    let platform = platform_info(&state);
    let snapshot = {
        let db = state.db.lock().await;
        doctor::DoctorSnapshot::from_db(&db).map_err(err)?
    };
    let health = doctor::provider_health(&snapshot.profiles).await;
    let dest = dest_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    doctor::export_doctor(
        &snapshot,
        &health,
        &state.data_dir,
        &platform,
        dest.as_deref(),
    )
    .await
    .map(|path| path.to_string_lossy().into_owned())
    .map_err(err)
}

#[tauri::command]
pub fn app_show(app: AppHandle) -> CommandResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.show().map_err(err)?;
    window.set_focus().map_err(err)
}

#[tauri::command]
pub async fn app_quit(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    state.grok_auth.cancel_and_wait().await;
    state.mcp.stop_all().await;
    state.browser.close_all().await;
    app.exit(0);
    Ok(())
}

pub fn default_shell() -> String {
    std::env::var(if cfg!(target_os = "windows") {
        "COMSPEC"
    } else {
        "SHELL"
    })
    .unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "powershell.exe"
        } else {
            "/bin/zsh"
        }
        .into()
    })
}
