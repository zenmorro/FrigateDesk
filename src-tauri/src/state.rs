use crate::frigate::FrigateClient;
use crate::proxy::ProxyManager;
use crate::video::MpvManager;
use tokio::sync::Mutex;

/// An active, authenticated connection to a Frigate server.
pub struct Session {
    pub profile_id: String,
    pub client: FrigateClient,
}

/// Global application state managed by Tauri.
#[derive(Default)]
pub struct AppState {
    pub session: Mutex<Option<Session>>,
    pub mpv: MpvManager,
    pub proxy: ProxyManager,
}
