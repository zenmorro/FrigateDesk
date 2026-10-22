//! Typed models for the subset of the Frigate HTTP API used so far.
//! Unknown fields are preserved in `extra` maps so we stay forward-compatible
//! across Frigate versions (0.14 → 0.16+).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_true() -> bool {
    true
}

/// Partial model of `GET /api/config`.
#[derive(Debug, Clone, Deserialize)]
pub struct FrigateConfig {
    #[serde(default)]
    pub cameras: HashMap<String, CameraConfig>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CameraConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub live: Option<LiveConfig>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LiveConfig {
    /// go2rtc stream name used for live playback (often equals the camera name).
    #[serde(default)]
    pub stream_name: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Lightweight camera descriptor sent to the UI after discovery.
#[derive(Debug, Clone, Serialize)]
pub struct CameraSummary {
    pub name: String,
    pub enabled: bool,
    pub stream_name: String,
}

/// A Frigate review segment (`GET /api/review`) — the colored timeline bars
/// (severity `alert` → red, `detection` → orange in Frigate's own UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewItem {
    pub id: String,
    pub camera: String,
    pub start_time: f64,
    #[serde(default)]
    pub end_time: Option<f64>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// A Frigate tracked-object event (`GET /api/events`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventItem {
    pub id: String,
    pub camera: String,
    #[serde(default)]
    pub label: Option<String>,
    pub start_time: f64,
    #[serde(default)]
    pub end_time: Option<f64>,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub has_clip: Option<bool>,
    #[serde(default)]
    pub has_snapshot: Option<bool>,
}

impl FrigateConfig {
    /// Build a stable, name-sorted list of cameras for the UI.
    pub fn camera_summaries(&self) -> Vec<CameraSummary> {
        let mut cams: Vec<CameraSummary> = self
            .cameras
            .iter()
            .map(|(name, cfg)| {
                let stream_name = cfg
                    .live
                    .as_ref()
                    .and_then(|l| l.stream_name.clone())
                    .unwrap_or_else(|| name.clone());
                CameraSummary {
                    name: name.clone(),
                    enabled: cfg.enabled,
                    stream_name,
                }
            })
            .collect();
        cams.sort_by(|a, b| a.name.cmp(&b.name));
        cams
    }
}
