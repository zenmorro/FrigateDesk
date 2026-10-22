//! Tauri commands — the bridge between the React UI and the Rust backend.

use crate::error::{AppError, AppResult};
use crate::frigate::{CameraSummary, EventItem, FrigateClient, ReviewItem};
use crate::profiles::{self, ServerProfile};
use crate::secrets;
use crate::state::{AppState, Session};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_config_dir()?)
}

#[tauri::command]
pub async fn list_profiles(app: AppHandle) -> AppResult<Vec<ServerProfile>> {
    profiles::load(&config_dir(&app)?)
}

/// Create or update a profile. If `password` is provided it is stored in the
/// Windows Credential Manager, never on disk.
#[tauri::command]
pub async fn save_profile(
    app: AppHandle,
    profile: ServerProfile,
    password: Option<String>,
) -> AppResult<Vec<ServerProfile>> {
    let dir = config_dir(&app)?;
    let list = profiles::upsert(&dir, profile.clone())?;
    if let Some(pw) = password {
        if !pw.is_empty() {
            secrets::set_password(&profile.id, &pw)?;
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Vec<ServerProfile>> {
    {
        let mut sess = state.session.lock().await;
        if sess.as_ref().is_some_and(|s| s.profile_id == id) {
            *sess = None;
            state.mpv.stop();
        }
    }
    let _ = secrets::delete_password(&id);
    profiles::remove(&config_dir(&app)?, &id)
}

/// Report whether a password is stored for the given profile id.
#[tauri::command]
pub async fn has_saved_password(id: String) -> AppResult<bool> {
    Ok(secrets::get_password(&id)?.is_some())
}

#[derive(Serialize)]
pub struct ConnectResult {
    pub profile_id: String,
    pub version: String,
    pub cameras: Vec<CameraSummary>,
}

/// Connect to a server: authenticate (if required), then fetch version and
/// discover cameras from `/api/config`.
#[tauri::command]
pub async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    password: Option<String>,
) -> AppResult<ConnectResult> {
    let dir = config_dir(&app)?;
    let profile = profiles::find(&dir, &profile_id)?
        .ok_or_else(|| AppError::ProfileNotFound(profile_id.clone()))?;

    let mut client = FrigateClient::new(&profile.base_url, profile.allow_insecure)?;

    if profile.requires_auth {
        let pw = match password {
            Some(p) if !p.is_empty() => {
                secrets::set_password(&profile.id, &p)?;
                p
            }
            _ => secrets::get_password(&profile.id)?.ok_or_else(|| {
                AppError::Auth("no stored password for this profile".into())
            })?,
        };
        client.login(&profile.username, &pw).await?;
    }

    let version = client.version().await?;
    let config = client.config().await?;
    let cameras = config.camera_summaries();

    *state.session.lock().await = Some(Session {
        profile_id: profile.id.clone(),
        client,
    });

    Ok(ConnectResult {
        profile_id: profile.id,
        version,
        cameras,
    })
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> AppResult<()> {
    state.mpv.stop();
    state.proxy.stop();
    *state.session.lock().await = None;
    Ok(())
}

/// Start the local authenticated reverse-proxy for the live view and return
/// its loopback port. The WebView connects go2rtc MSE/WebRTC through it.
#[tauri::command]
pub async fn start_proxy(state: State<'_, AppState>) -> AppResult<u16> {
    // Idempotent: if a proxy is already running, reuse it rather than restarting
    // (a restart would drop the live WebSocket and break image previews).
    if let Some(port) = state.proxy.port() {
        return Ok(port);
    }
    let (base, token, insecure) = {
        let guard = state.session.lock().await;
        let session = guard.as_ref().ok_or(AppError::NotConnected)?;
        (
            session.client.base_url().to_string(),
            session.client.token().map(|s| s.to_string()),
            session.client.allow_insecure(),
        )
    };
    state.proxy.start(base, token, insecure).await
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, AppState>) -> AppResult<()> {
    state.proxy.stop();
    Ok(())
}

/// Download a recording clip for a camera/time range to a local file path.
/// Returns the number of bytes written.
#[tauri::command]
pub async fn download_clip(
    state: State<'_, AppState>,
    camera: String,
    start: i64,
    end: i64,
    dest: String,
) -> AppResult<u64> {
    // Clone the client out of the lock so the long download doesn't block
    // other session operations (live view, history, …).
    let client = {
        let guard = state.session.lock().await;
        guard
            .as_ref()
            .ok_or(AppError::NotConnected)?
            .client
            .clone()
    };
    client
        .download_clip(&camera, start, end, std::path::Path::new(&dest))
        .await
}

/// Review segments (timeline bars) for a camera within a Unix-second range.
#[tauri::command]
pub async fn get_review(
    state: State<'_, AppState>,
    camera: String,
    after: i64,
    before: i64,
) -> AppResult<Vec<ReviewItem>> {
    let client = {
        let guard = state.session.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.client.clone()
    };
    client.review(&camera, after, before).await
}

/// Tracked-object events for a camera within a Unix-second range.
#[tauri::command]
pub async fn get_events(
    state: State<'_, AppState>,
    camera: String,
    after: i64,
    before: i64,
) -> AppResult<Vec<EventItem>> {
    let client = {
        let guard = state.session.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.client.clone()
    };
    client.events(&camera, after, before).await
}

/// Search events across cameras (empty `cameras` = all) within a range.
#[tauri::command]
pub async fn search_events(
    state: State<'_, AppState>,
    cameras: Option<String>,
    after: i64,
    before: i64,
    limit: u32,
) -> AppResult<Vec<EventItem>> {
    let client = {
        let guard = state.session.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.client.clone()
    };
    client
        .search_events(cameras.as_deref(), after, before, limit)
        .await
}

/// Spike command: play a recording time range (Unix seconds) for a camera.
/// Builds the HLS VOD URL and hands it to mpv with the session's auth token.
#[tauri::command]
pub async fn play_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    camera: String,
    start: i64,
    end: i64,
) -> AppResult<String> {
    let (url, token, insecure) = {
        let guard = state.session.lock().await;
        let session = guard.as_ref().ok_or(AppError::NotConnected)?;
        (
            session.client.vod_url(&camera, start, end),
            session.client.token().map(|s| s.to_string()),
            session.client.allow_insecure(),
        )
    };
    state
        .mpv
        .play(&app, &url, token.as_deref(), insecure)
        .await?;
    Ok(url)
}

#[tauri::command]
pub async fn player_set_speed(state: State<'_, AppState>, speed: f64) -> AppResult<()> {
    state.mpv.set_speed(speed)
}

#[tauri::command]
pub async fn player_seek(state: State<'_, AppState>, seconds: f64) -> AppResult<()> {
    state.mpv.seek(seconds)
}

#[tauri::command]
pub async fn player_toggle_pause(state: State<'_, AppState>) -> AppResult<()> {
    state.mpv.toggle_pause()
}

#[tauri::command]
pub async fn player_stop(state: State<'_, AppState>) -> AppResult<()> {
    state.mpv.stop();
    Ok(())
}
