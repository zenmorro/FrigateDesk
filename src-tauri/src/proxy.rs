//! Local authenticated reverse-proxy.
//!
//! The live player runs inside the WebView, but Frigate protects its streams
//! (JWT cookie on :8971, `SameSite=Lax`) and often uses a self-signed cert —
//! so the WebView cannot reach them directly. This proxy listens on
//! `127.0.0.1:<port>`, injects the `Authorization: Bearer` token, and
//! terminates the self-signed TLS, exposing Frigate same-origin to the WebView.
//!
//! It transparently forwards both plain HTTP (snapshots, VOD, …) and
//! WebSocket upgrades (go2rtc MSE/WebRTC at `/live/mse/api/ws`,
//! `/live/webrtc/api/ws`).

use crate::error::AppResult;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::ws::{Message as AxMsg, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, State};
use axum::http::{header, Request, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::Message as TMsg;
use tokio_tungstenite::Connector;

struct ProxyState {
    upstream_base: String,
    token: Option<String>,
    allow_insecure: bool,
    http: reqwest::Client,
}

struct ProxyHandle {
    port: u16,
    shutdown: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct ProxyManager {
    inner: Mutex<Option<ProxyHandle>>,
}

impl ProxyManager {
    /// Start the proxy (replacing any running instance) and return its port.
    pub async fn start(
        &self,
        upstream_base: String,
        token: Option<String>,
        allow_insecure: bool,
    ) -> AppResult<u16> {
        self.stop();

        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(allow_insecure)
            .build()?;
        let state = Arc::new(ProxyState {
            upstream_base: upstream_base.trim_end_matches('/').to_string(),
            token,
            allow_insecure,
            http,
        });

        let app = Router::new().fallback(handler).with_state(state);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();

        let (tx, rx) = oneshot::channel::<()>();
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });

        *self.inner.lock().unwrap() = Some(ProxyHandle { port, shutdown: tx });
        Ok(port)
    }

    pub fn stop(&self) {
        if let Some(h) = self.inner.lock().unwrap().take() {
            let _ = h.shutdown.send(());
        }
    }

    pub fn port(&self) -> Option<u16> {
        self.inner.lock().unwrap().as_ref().map(|h| h.port)
    }
}

async fn handler(State(st): State<Arc<ProxyState>>, req: Request<Body>) -> Response {
    let is_ws = req
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);

    let (mut parts, body) = req.into_parts();

    if is_ws {
        match WebSocketUpgrade::from_request_parts(&mut parts, &st).await {
            Ok(ws) => {
                let st = st.clone();
                let uri = parts.uri.clone();
                return ws.on_upgrade(move |socket| ws_proxy(socket, st, uri));
            }
            Err(e) => return e.into_response(),
        }
    }

    http_proxy(st, parts.method, parts.uri, parts.headers, body).await
}

// ---- WebSocket proxying ---------------------------------------------------

async fn ws_proxy(client: WebSocket, st: Arc<ProxyState>, uri: Uri) {
    let url = upstream_url(&st.upstream_base, &uri, true);
    let mut request = match url.into_client_request() {
        Ok(r) => r,
        Err(_) => return,
    };
    if let Some(tok) = &st.token {
        if let Ok(v) = format!("Bearer {tok}").parse() {
            request.headers_mut().insert(AUTHORIZATION, v);
        }
    }

    let connector = if st.allow_insecure {
        Some(Connector::Rustls(insecure_tls_config()))
    } else {
        None
    };

    let upstream = match tokio_tungstenite::connect_async_tls_with_config(
        request, None, false, connector,
    )
    .await
    {
        Ok((ws, _resp)) => ws,
        Err(_) => return,
    };

    let (mut client_tx, mut client_rx) = client.split();
    let (mut up_tx, mut up_rx) = upstream.split();

    let c2u = async {
        while let Some(Ok(msg)) = client_rx.next().await {
            if let Some(m) = ax_to_t(msg) {
                if up_tx.send(m).await.is_err() {
                    break;
                }
            }
        }
    };
    let u2c = async {
        while let Some(Ok(msg)) = up_rx.next().await {
            if let Some(m) = t_to_ax(msg) {
                if client_tx.send(m).await.is_err() {
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = c2u => {}
        _ = u2c => {}
    }
}

fn ax_to_t(m: AxMsg) -> Option<TMsg> {
    Some(match m {
        AxMsg::Text(t) => TMsg::Text(t.into()),
        AxMsg::Binary(b) => TMsg::Binary(b.into()),
        AxMsg::Ping(b) => TMsg::Ping(b.into()),
        AxMsg::Pong(b) => TMsg::Pong(b.into()),
        AxMsg::Close(_) => TMsg::Close(None),
    })
}

fn t_to_ax(m: TMsg) -> Option<AxMsg> {
    Some(match m {
        TMsg::Text(t) => AxMsg::Text(t.to_string()),
        TMsg::Binary(b) => AxMsg::Binary(b.to_vec()),
        TMsg::Ping(b) => AxMsg::Ping(b.to_vec()),
        TMsg::Pong(b) => AxMsg::Pong(b.to_vec()),
        TMsg::Close(_) => AxMsg::Close(None),
        TMsg::Frame(_) => return None,
    })
}

// ---- HTTP proxying --------------------------------------------------------

async fn http_proxy(
    st: Arc<ProxyState>,
    method: axum::http::Method,
    uri: Uri,
    headers: axum::http::HeaderMap,
    body: Body,
) -> Response {
    let url = upstream_url(&st.upstream_base, &uri, false);
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .unwrap_or_default();

    let mut rb = st.http.request(method, &url).body(bytes.to_vec());
    for (k, v) in headers.iter() {
        let name = k.as_str().to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "host" | "connection" | "authorization" | "content-length"
        ) {
            continue;
        }
        rb = rb.header(k, v);
    }
    if let Some(tok) = &st.token {
        rb = rb.bearer_auth(tok);
    }

    match rb.send().await {
        Ok(resp) => {
            let mut builder = Response::builder().status(resp.status());
            for (k, v) in resp.headers().iter() {
                if k == header::TRANSFER_ENCODING {
                    continue;
                }
                builder = builder.header(k, v);
            }
            builder
                .body(Body::from_stream(resp.bytes_stream()))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(_) => StatusCode::BAD_GATEWAY.into_response(),
    }
}

// ---- helpers --------------------------------------------------------------

/// Build the upstream URL, swapping the scheme to ws/wss when `websocket`.
fn upstream_url(base: &str, uri: &Uri, websocket: bool) -> String {
    let pq = uri
        .path_and_query()
        .map(|x| x.as_str())
        .unwrap_or("/");
    let base = if websocket {
        if let Some(rest) = base.strip_prefix("https://") {
            format!("wss://{rest}")
        } else if let Some(rest) = base.strip_prefix("http://") {
            format!("ws://{rest}")
        } else {
            base.to_string()
        }
    } else {
        base.to_string()
    };
    format!("{}{}", base.trim_end_matches('/'), pq)
}

/// A rustls config that accepts any server certificate (for self-signed
/// Frigate servers). Only used when the profile opts into `allow_insecure`.
fn insecure_tls_config() -> Arc<rustls::ClientConfig> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("ring provider supports default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertVerifier(provider)))
        .with_no_client_auth();
    Arc::new(config)
}

#[derive(Debug)]
struct NoCertVerifier(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::upstream_url;
    use axum::http::Uri;

    #[test]
    fn builds_ws_url_from_https_base() {
        let uri: Uri = "/live/mse/api/ws?src=driveway".parse().unwrap();
        assert_eq!(
            upstream_url("https://nvr.local:8971", &uri, true),
            "wss://nvr.local:8971/live/mse/api/ws?src=driveway"
        );
    }

    #[test]
    fn builds_http_url_from_https_base() {
        let uri: Uri = "/api/driveway/latest.jpg".parse().unwrap();
        assert_eq!(
            upstream_url("https://nvr.local:8971/", &uri, false),
            "https://nvr.local:8971/api/driveway/latest.jpg"
        );
    }
}
