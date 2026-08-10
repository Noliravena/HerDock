mod commands;
mod domain;
mod infra;
mod services;

use std::time::Duration;

use chrono::Utc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use commands::{app, browser, design, integrations, runs, terminal, updater, workspace};
use domain::models::{Session, StartRunRequest};
use infra::database::Database;
use services::{agent, mcp, scheduler, state::AppState};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        );
    builder
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database = Database::open(&data_dir.join("herdock-v1.db"))?;
            database.seed_providers()?;
            for mut server in database.list_mcp()? {
                match mcp::migrate_legacy_env(&mut server) {
                    Ok(true) => database.upsert_mcp(&server)?,
                    Ok(false) => {}
                    Err(_) => {
                        server.env = serde_json::json!({});
                        server.status = Some("needs_secret".into());
                        database.upsert_mcp(&server)?;
                    }
                }
            }
            let state = AppState::new(database, data_dir);
            app.manage(state.clone());
            let show = MenuItem::with_id(app, "show", "显示 HerDock", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            app.state::<AppState>().grok_auth.cancel_and_wait().await;
                            app.state::<AppState>().mcp.stop_all().await;
                            app.state::<AppState>().browser.close_all().await;
                            app.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            let shortcut = state.db.blocking_lock().settings()?.launch_shortcut;
            app.global_shortcut().register(shortcut.as_str())?;
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(schedule_loop(app_handle, state));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .state::<AppState>()
                    .db
                    .blocking_lock()
                    .settings()
                    .map(|settings| settings.close_to_tray)
                    .unwrap_or(true);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app::app_platform,
            app::settings_get,
            app::settings_save,
            app::app_show,
            app::app_quit,
            workspace::workspace_list,
            workspace::workspace_open,
            workspace::workspace_tree,
            workspace::file_read,
            workspace::file_write,
            workspace::file_create,
            workspace::file_rename,
            workspace::file_delete,
            workspace::file_search,
            workspace::git_diff,
            workspace::workspace_context,
            workspace::context_list,
            workspace::context_import,
            workspace::context_remove,
            workspace::artifact_list,
            workspace::artifact_reveal,
            workspace::artifact_export,
            design::artifact_preview,
            design::design_system_list,
            design::design_system_read,
            workspace::checkpoint_restore,
            workspace::checkpoint_preview,
            runs::session_list,
            runs::session_create,
            runs::run_list,
            runs::run_recent,
            runs::run_events,
            runs::run_events_page,
            runs::run_inputs,
            runs::run_checkpoints,
            runs::run_start,
            runs::run_continue,
            runs::run_retry,
            runs::run_cancel,
            runs::approval_list,
            runs::approval_resolve,
            runs::policy_rule_list,
            runs::policy_rule_delete,
            runs::run_queue,
            runs::usage_get,
            integrations::provider_list,
            integrations::provider_profiles,
            integrations::provider_save,
            integrations::provider_validate,
            integrations::grok_auth_status,
            integrations::grok_login,
            integrations::grok_login_submit_code,
            integrations::grok_login_cancel,
            integrations::grok_logout,
            integrations::mcp_list,
            integrations::mcp_save,
            integrations::mcp_delete,
            integrations::mcp_test,
            integrations::mcp_start,
            integrations::mcp_stop,
            integrations::skill_list,
            integrations::schedule_list,
            integrations::schedule_save,
            integrations::schedule_toggle,
            integrations::schedule_delete,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            updater::update_status,
            updater::update_check,
            updater::update_install,
            browser::browser_create,
            browser::browser_show,
            browser::browser_set_bounds,
            browser::browser_hide,
            browser::browser_close,
            browser::browser_navigate,
            browser::browser_search,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_status,
            browser::browser_list,
            browser::browser_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HerDock");
}

async fn schedule_loop(app: tauri::AppHandle, state: AppState) {
    let initial = state
        .db
        .lock()
        .await
        .list_schedules(None)
        .unwrap_or_default();
    for mut schedule in initial {
        if scheduler::roll_forward_missed(&mut schedule, Utc::now()) {
            let _ = state.db.lock().await.upsert_schedule(&schedule);
        }
    }
    loop {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let schedules = state
            .db
            .lock()
            .await
            .list_schedules(None)
            .unwrap_or_default();
        for mut schedule in schedules.into_iter().filter(|schedule| schedule.enabled) {
            let due = schedule
                .next_run_at
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_some_and(|value| value.to_utc() <= Utc::now());
            if !due {
                continue;
            }
            let stamp = Utc::now().to_rfc3339();
            let session = Session {
                id: format!("sess_{}", uuid::Uuid::new_v4().simple()),
                workspace_id: schedule.workspace_id.clone(),
                title: schedule.name.clone(),
                kind: "mixed".into(),
                provider_id: schedule.provider_id.clone(),
                created_at: stamp.clone(),
                updated_at: stamp,
            };
            if state.db.lock().await.insert_session(&session).is_ok() {
                let request = StartRunRequest {
                    session_id: session.id,
                    workspace_id: schedule.workspace_id.clone(),
                    provider_id: schedule.provider_id.clone(),
                    model: None,
                    prompt: schedule.prompt.clone(),
                    auto_execute: Some("ask_risky".into()),
                    context_paths: vec![],
                    context_item_ids: vec![],
                    skill_ids: vec![],
                    mcp_server_ids: vec![],
                };
                let _ = agent::start(app.clone(), state.clone(), request, None).await;
            }
            schedule.last_run_at = Some(Utc::now().to_rfc3339());
            schedule.next_run_at =
                scheduler::next_run(&schedule.cron, Utc::now()).map(|value| value.to_rfc3339());
            schedule.updated_at = Utc::now().to_rfc3339();
            let _ = state.db.lock().await.upsert_schedule(&schedule);
        }
    }
}
