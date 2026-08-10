use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use crate::{
    commands::error::{err, CommandResult},
    domain::models::UpdateStatus,
    services::state::AppState,
};

#[tauri::command]
pub async fn update_status(state: State<'_, AppState>) -> CommandResult<UpdateStatus> {
    let channel = state
        .db
        .lock()
        .await
        .settings()
        .map_err(err)?
        .update_channel;
    Ok(base_status(&channel))
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<UpdateStatus> {
    let channel = state
        .db
        .lock()
        .await
        .settings()
        .map_err(err)?
        .update_channel;
    let mut status = base_status(&channel);
    if !status.enabled {
        return Ok(status);
    }
    let update = updater(&app, &channel)
        .map_err(err)?
        .check()
        .await
        .map_err(err)?;
    if let Some(update) = update {
        status.available_version = Some(update.version.clone());
        status.state = "available".into();
        status.message = format!("发现 HerDock {}", update.version);
    } else {
        status.state = "current".into();
        status.message = "当前已是最新版本".into();
    }
    Ok(status)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<UpdateStatus> {
    let channel = state
        .db
        .lock()
        .await
        .settings()
        .map_err(err)?
        .update_channel;
    let mut status = base_status(&channel);
    if !status.enabled {
        return Ok(status);
    }
    let Some(update) = updater(&app, &channel)
        .map_err(err)?
        .check()
        .await
        .map_err(err)?
    else {
        status.state = "current".into();
        status.message = "当前已是最新版本".into();
        return Ok(status);
    };
    let version = update.version.clone();
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(err)?;
    status.available_version = Some(version);
    status.state = "installed".into();
    status.message = "更新已安装，重新启动后生效".into();
    Ok(status)
}

fn updater(app: &AppHandle, channel: &str) -> anyhow::Result<tauri_plugin_updater::Updater> {
    let endpoint =
        endpoint(channel).ok_or_else(|| anyhow::anyhow!("updater endpoint is missing"))?;
    let public_key = option_env!("HERDOCK_UPDATER_PUBLIC_KEY")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("updater public key is missing"))?;
    Ok(app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint.parse()?])?
        .build()?)
}

fn endpoint(channel: &str) -> Option<&'static str> {
    let value = if channel == "preview" {
        option_env!("HERDOCK_UPDATER_ENDPOINT_PREVIEW")
    } else {
        option_env!("HERDOCK_UPDATER_ENDPOINT_STABLE")
    }?;
    (value.starts_with("https://") && !value.trim().is_empty()).then_some(value)
}

fn base_status(channel: &str) -> UpdateStatus {
    let enabled = option_env!("HERDOCK_UPDATER_PUBLIC_KEY")
        .is_some_and(|value| !value.trim().is_empty())
        && endpoint(channel).is_some();
    UpdateStatus {
        enabled,
        channel: channel.into(),
        current_version: env!("CARGO_PKG_VERSION").into(),
        available_version: None,
        state: if enabled { "idle" } else { "disabled" }.into(),
        message: if enabled {
            "可以检查更新".into()
        } else {
            "此构建未启用更新".into()
        },
    }
}
