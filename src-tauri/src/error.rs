use serde::Serialize;

/// Application-wide error type. Serializes to a plain string so it can be
/// returned directly from Tauri commands and shown in the UI.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("HTTP error: {0}")]
    Http(String),

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Not connected to a server")]
    NotConnected,

    #[error("Profile not found: {0}")]
    ProfileNotFound(String),

    #[error("Credential store error: {0}")]
    Keyring(String),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("Video player error: {0}")]
    Video(String),

    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Http(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(format!("serialization error: {e}"))
    }
}

impl From<url::ParseError> for AppError {
    fn from(e: url::ParseError) -> Self {
        AppError::Other(format!("invalid URL: {e}"))
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Other(e.to_string())
    }
}
