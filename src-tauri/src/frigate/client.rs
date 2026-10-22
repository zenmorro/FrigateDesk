//! Frigate HTTP API client.
//!
//! All calls go through here so the UI never touches the network directly and
//! secrets/cookies stay in the Rust backend. The client keeps a cookie jar
//! (for the Frigate JWT) and also extracts the raw token so it can be handed to
//! the native video player (mpv) as an `Authorization: Bearer` header.

use crate::error::{AppError, AppResult};
use crate::frigate::models::{EventItem, FrigateConfig, ReviewItem};

/// Name of the JWT cookie set by Frigate 0.14+ on successful login.
const TOKEN_COOKIE: &str = "frigate_token";

#[derive(Clone)]
pub struct FrigateClient {
    base_url: String,
    http: reqwest::Client,
    token: Option<String>,
    allow_insecure: bool,
}

impl FrigateClient {
    pub fn new(base_url: &str, allow_insecure: bool) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(allow_insecure)
            .cookie_store(true)
            .user_agent(concat!("FrigateDesk/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
            token: None,
            allow_insecure,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    pub fn allow_insecure(&self) -> bool {
        self.allow_insecure
    }

    /// Authenticate against `POST /api/login`. On success Frigate sets the JWT
    /// as a cookie (kept by the jar) and we also capture the raw token.
    pub async fn login(&mut self, user: &str, password: &str) -> AppResult<()> {
        let url = format!("{}/api/login", self.base_url);
        let resp = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "user": user, "password": password }))
            .send()
            .await?;

        let status = resp.status();
        // Capture the token from Set-Cookie before consuming the response.
        for value in resp.headers().get_all(reqwest::header::SET_COOKIE).iter() {
            if let Ok(s) = value.to_str() {
                if let Some(tok) = extract_cookie(s, TOKEN_COOKIE) {
                    self.token = Some(tok);
                }
            }
        }

        if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::BAD_REQUEST
        {
            return Err(AppError::Auth("invalid username or password".into()));
        }
        if !status.is_success() {
            return Err(AppError::Auth(format!("login returned HTTP {status}")));
        }
        Ok(())
    }

    async fn get(&self, path: &str) -> AppResult<reqwest::Response> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.get(&url);
        if let Some(t) = &self.token {
            req = req.bearer_auth(t);
        }
        let resp = req.send().await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("session expired or unauthorized".into()));
        }
        Ok(resp)
    }

    /// `GET /api/version` returns a plain-text version string, e.g. `0.14.1`.
    pub async fn version(&self) -> AppResult<String> {
        let resp = self.get("/api/version").await?;
        if !resp.status().is_success() {
            return Err(AppError::Http(format!(
                "version returned HTTP {}",
                resp.status()
            )));
        }
        Ok(resp.text().await?.trim().to_string())
    }

    /// `GET /api/config` — full configuration, including camera discovery.
    pub async fn config(&self) -> AppResult<FrigateConfig> {
        let resp = self.get("/api/config").await?;
        if !resp.status().is_success() {
            return Err(AppError::Http(format!(
                "config returned HTTP {}",
                resp.status()
            )));
        }
        Ok(resp.json::<FrigateConfig>().await?)
    }

    /// Build the HLS VOD URL for a recording time range (Unix seconds).
    /// `GET /vod/<camera>/start/<ts>/end/<ts>/master.m3u8`
    pub fn vod_url(&self, camera: &str, start: i64, end: i64) -> String {
        format!(
            "{}/vod/{}/start/{}/end/{}/master.m3u8",
            self.base_url, camera, start, end
        )
    }

    /// Download a muxed recording clip for a time range to `dest`, returning
    /// the number of bytes written. Tries the `/api/...` route first and falls
    /// back to the root route for compatibility across Frigate versions.
    pub async fn download_clip(
        &self,
        camera: &str,
        start: i64,
        end: i64,
        dest: &std::path::Path,
    ) -> AppResult<u64> {
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        let candidates = [
            format!("/api/{camera}/start/{start}/end/{end}/clip.mp4"),
            format!("/{camera}/start/{start}/end/{end}/clip.mp4"),
        ];

        for path in candidates {
            let resp = self.get(&path).await?;
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                continue;
            }
            if !resp.status().is_success() {
                return Err(AppError::Http(format!(
                    "clip download returned HTTP {}",
                    resp.status()
                )));
            }

            let mut file = tokio::fs::File::create(dest).await?;
            let mut stream = resp.bytes_stream();
            let mut total: u64 = 0;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                file.write_all(&chunk).await?;
                total += chunk.len() as u64;
            }
            file.flush().await?;
            return Ok(total);
        }

        Err(AppError::Other("clip endpoint not found (HTTP 404)".into()))
    }

    /// `GET /api/review` — review segments (timeline bars) for a camera/range.
    pub async fn review(
        &self,
        camera: &str,
        after: i64,
        before: i64,
    ) -> AppResult<Vec<ReviewItem>> {
        let path = format!(
            "/api/review?cameras={camera}&after={after}&before={before}&limit=1000"
        );
        let resp = self.get(&path).await?;
        if !resp.status().is_success() {
            return Err(AppError::Http(format!(
                "review returned HTTP {}",
                resp.status()
            )));
        }
        Ok(resp.json::<Vec<ReviewItem>>().await?)
    }

    /// `GET /api/events` — tracked-object events for a camera/range.
    pub async fn events(
        &self,
        camera: &str,
        after: i64,
        before: i64,
    ) -> AppResult<Vec<EventItem>> {
        let path = format!(
            "/api/events?cameras={camera}&after={after}&before={before}&limit=1000"
        );
        let resp = self.get(&path).await?;
        if !resp.status().is_success() {
            return Err(AppError::Http(format!(
                "events returned HTTP {}",
                resp.status()
            )));
        }
        Ok(resp.json::<Vec<EventItem>>().await?)
    }

    /// `GET /api/events` with optional camera filter (empty = all cameras).
    pub async fn search_events(
        &self,
        cameras: Option<&str>,
        after: i64,
        before: i64,
        limit: u32,
    ) -> AppResult<Vec<EventItem>> {
        let mut path = format!("/api/events?after={after}&before={before}&limit={limit}");
        if let Some(c) = cameras {
            if !c.is_empty() {
                path.push_str(&format!("&cameras={c}"));
            }
        }
        let resp = self.get(&path).await?;
        if !resp.status().is_success() {
            return Err(AppError::Http(format!(
                "events returned HTTP {}",
                resp.status()
            )));
        }
        Ok(resp.json::<Vec<EventItem>>().await?)
    }
}

/// Extract a cookie value by name from a single `Set-Cookie` header line.
fn extract_cookie(header: &str, name: &str) -> Option<String> {
    // A Set-Cookie line looks like: `frigate_token=abc...; Path=/; HttpOnly`
    let first = header.split(';').next()?.trim();
    let (k, v) = first.split_once('=')?;
    if k.trim() == name {
        Some(v.trim().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::extract_cookie;

    #[test]
    fn parses_token_cookie() {
        let line = "frigate_token=eyJABC.def.ghi; Path=/; HttpOnly; SameSite=Lax";
        assert_eq!(
            extract_cookie(line, "frigate_token").as_deref(),
            Some("eyJABC.def.ghi")
        );
    }

    #[test]
    fn ignores_other_cookies() {
        assert_eq!(extract_cookie("other=1; Path=/", "frigate_token"), None);
    }
}
