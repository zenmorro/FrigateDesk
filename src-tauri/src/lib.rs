mod commands;
pub mod error;
pub mod frigate;
mod profiles;
mod proxy;
mod secrets;
mod state;
mod video;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install a process-wide rustls crypto provider for the live-view proxy's
    // upstream TLS connections.
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::has_saved_password,
            commands::connect,
            commands::disconnect,
            commands::play_recording,
            commands::player_set_speed,
            commands::player_seek,
            commands::player_toggle_pause,
            commands::player_stop,
            commands::start_proxy,
            commands::stop_proxy,
            commands::download_clip,
            commands::get_review,
            commands::get_events,
            commands::search_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
