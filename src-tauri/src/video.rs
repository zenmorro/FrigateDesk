//! Native video playback via mpv.
//!
//! Design decision (Milestone (a) spike): instead of linking libmpv at
//! compile time, we drive a bundled `mpv.exe` over its JSON IPC named pipe.
//! This keeps the build simple (no FFI/linking of mpv dev libs) while giving
//! us exactly what the browser stack cannot: native **H.265/HEVC** decoding
//! with **D3D11VA hardware acceleration** (`--hwdec=auto-safe`, which prefers
//! D3D11VA and falls back to software automatically) and **explicit codec/error
//! reporting** (no infinite spinner — fatal errors arrive as `end-file` events).
//!
//! In-UI embedding (mpv rendered inside the app window via `--wid`) is planned
//! for Milestone (b); for now mpv opens its own window, which fully validates
//! the decoding path.

use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::UnboundedSender;

const PIPE_NAME: &str = r"\\.\pipe\frigatedesk-mpv";

pub struct MpvManager {
    handle: Mutex<Option<MpvHandle>>,
}

struct MpvHandle {
    child: tokio::process::Child,
    tx: UnboundedSender<String>,
}

impl Default for MpvManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MpvManager {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }

    /// Launch mpv (if needed) and start playing `url`.
    /// `token` is sent as an `Authorization: Bearer` header so authenticated
    /// Frigate VOD/recording URLs work; `allow_insecure` disables TLS verify.
    pub async fn play(
        &self,
        app: &AppHandle,
        url: &str,
        token: Option<&str>,
        allow_insecure: bool,
    ) -> AppResult<()> {
        // Replace any existing instance.
        self.stop();

        let mpv = find_mpv(app)?;
        let mut cmd = tokio::process::Command::new(&mpv);
        cmd.arg(format!("--input-ipc-server={PIPE_NAME}"))
            .arg("--idle=yes")
            .arg("--force-window=yes")
            .arg("--keep-open=yes")
            .arg("--no-terminal")
            // Prefer D3D11VA hardware decode, fall back to software automatically.
            .arg("--hwdec=auto-safe")
            .arg("--title=FrigateDesk Player")
            .arg("--osc=yes");
        if let Some(t) = token {
            cmd.arg(format!("--http-header-fields=Authorization: Bearer {t}"));
        }
        if allow_insecure {
            cmd.arg("--tls-verify=no");
        }

        let child = cmd.spawn().map_err(|e| {
            AppError::Video(format!(
                "could not launch mpv at '{}': {e}. Install mpv and either add it \
                 to PATH, place mpv.exe next to the app, or set the FRIGATEDESK_MPV \
                 environment variable.",
                mpv.display()
            ))
        })?;

        let tx = attach_ipc(app.clone()).await?;

        // Observe the properties the UI cares about, then load the file.
        for (id, prop) in [
            (1u64, "pause"),
            (2, "time-pos"),
            (3, "duration"),
            (4, "speed"),
            (5, "video-codec"),
            (6, "hwdec-current"),
            (7, "core-idle"),
        ] {
            let _ = tx.send(
                serde_json::json!({ "command": ["observe_property", id, prop] }).to_string(),
            );
        }
        tx.send(serde_json::json!({ "command": ["loadfile", url, "replace"] }).to_string())
            .map_err(|_| AppError::Video("mpv channel closed before load".into()))?;

        *self.handle.lock().unwrap() = Some(MpvHandle { child, tx });
        Ok(())
    }

    /// Send a raw JSON-IPC command to mpv.
    pub fn send_command(&self, value: serde_json::Value) -> AppResult<()> {
        let guard = self.handle.lock().unwrap();
        let h = guard
            .as_ref()
            .ok_or_else(|| AppError::Video("player is not running".into()))?;
        h.tx
            .send(value.to_string())
            .map_err(|_| AppError::Video("player channel closed".into()))
    }

    pub fn set_speed(&self, speed: f64) -> AppResult<()> {
        self.send_command(serde_json::json!({ "command": ["set_property", "speed", speed] }))
    }

    pub fn seek(&self, seconds: f64) -> AppResult<()> {
        self.send_command(serde_json::json!({ "command": ["seek", seconds, "relative"] }))
    }

    pub fn toggle_pause(&self) -> AppResult<()> {
        self.send_command(serde_json::json!({ "command": ["cycle", "pause"] }))
    }

    /// Quit mpv and drop the handle.
    pub fn stop(&self) {
        if let Some(mut h) = self.handle.lock().unwrap().take() {
            let _ = h.tx.send(serde_json::json!({ "command": ["quit"] }).to_string());
            let _ = h.child.start_kill();
        }
    }
}

/// Locate an mpv executable:
/// env override → bundled Tauri resource → next to the app → PATH.
fn find_mpv(app: &AppHandle) -> AppResult<PathBuf> {
    if let Ok(p) = std::env::var("FRIGATEDESK_MPV") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
    }
    // Bundled with the installer (see `bundle.resources` in tauri.conf.json).
    if let Ok(res) = app.path().resource_dir() {
        let pb = res.join("mpv").join("mpv.exe");
        if pb.exists() {
            return Ok(pb);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for cand in ["mpv/mpv.exe", "mpv.exe", "resources/mpv/mpv.exe"] {
                let pb = dir.join(cand);
                if pb.exists() {
                    return Ok(pb);
                }
            }
        }
    }
    // Rely on PATH as a last resort.
    Ok(PathBuf::from("mpv.exe"))
}

/// Forward one line of mpv IPC output to the frontend, flagging fatal errors.
fn handle_mpv_line(app: &AppHandle, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(val) => {
            if val.get("event").and_then(|e| e.as_str()) == Some("end-file")
                && val.get("reason").and_then(|r| r.as_str()) == Some("error")
            {
                let _ = app.emit("mpv://error", val.clone());
            }
            let _ = app.emit("mpv://message", val);
        }
        Err(_) => {
            let _ = app.emit("mpv://message", serde_json::json!({ "raw": line }));
        }
    }
}

#[cfg(windows)]
async fn attach_ipc(app: AppHandle) -> AppResult<UnboundedSender<String>> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::time::{sleep, Duration};

    // mpv creates the pipe shortly after launch; retry until it appears.
    let pipe = {
        let mut connected = None;
        for _ in 0..100 {
            match ClientOptions::new().open(PIPE_NAME) {
                Ok(client) => {
                    connected = Some(client);
                    break;
                }
                Err(_) => sleep(Duration::from_millis(50)).await,
            }
        }
        connected.ok_or_else(|| AppError::Video("timed out waiting for mpv IPC pipe".into()))?
    };

    let (read_half, write_half) = tokio::io::split(pipe);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Writer task: drain the channel into the pipe.
    tauri::async_runtime::spawn(async move {
        let mut writer = write_half;
        while let Some(msg) = rx.recv().await {
            if writer.write_all(msg.as_bytes()).await.is_err() {
                break;
            }
            let _ = writer.write_all(b"\n").await;
            let _ = writer.flush().await;
        }
    });

    // Reader task: forward every IPC line to the UI.
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(read_half).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            handle_mpv_line(&app, &line);
        }
        let _ = app.emit("mpv://closed", ());
    });

    Ok(tx)
}

#[cfg(not(windows))]
async fn attach_ipc(_app: AppHandle) -> AppResult<UnboundedSender<String>> {
    Err(AppError::Video(
        "mpv IPC is currently implemented for Windows only".into(),
    ))
}
