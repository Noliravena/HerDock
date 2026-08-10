use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{
    commands::error::{err, CommandResult},
    domain::models::{AppSettings, PlatformInfo},
    services::state::AppState,
};

#[tauri::command]
pub async fn app_platform(state: State<'_, AppState>) -> CommandResult<PlatformInfo> {
    let apple = cfg!(target_os = "macos");
    let windows = cfg!(target_os = "windows");
    Ok(PlatformInfo {
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
    })
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
    state
        .db
        .lock()
        .await
        .save_settings(&settings)
        .map_err(err)?;
    Ok(settings)
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
