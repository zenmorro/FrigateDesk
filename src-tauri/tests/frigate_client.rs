//! Integration tests for the Frigate API client against a mock HTTP server.

use frigatedesk_lib::frigate::FrigateClient;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn login_version_and_config_discovery() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/login"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("set-cookie", "frigate_token=abc.def.ghi; Path=/; HttpOnly"),
        )
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/version"))
        .respond_with(ResponseTemplate::new(200).set_body_string("0.14.1"))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/config"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "cameras": {
                "garden": { "enabled": false },
                "driveway": { "enabled": true, "live": { "stream_name": "driveway_sub" } }
            }
        })))
        .mount(&server)
        .await;

    let mut client = FrigateClient::new(&server.uri(), false).unwrap();
    client.login("admin", "secret").await.unwrap();
    assert_eq!(client.token(), Some("abc.def.ghi"));

    assert_eq!(client.version().await.unwrap(), "0.14.1");

    let cfg = client.config().await.unwrap();
    let cams = cfg.camera_summaries();
    assert_eq!(cams.len(), 2);
    // Sorted by name.
    assert_eq!(cams[0].name, "driveway");
    assert!(cams[0].enabled);
    assert_eq!(cams[0].stream_name, "driveway_sub");
    assert_eq!(cams[1].name, "garden");
    assert!(!cams[1].enabled);
    // Falls back to the camera name when no stream_name is configured.
    assert_eq!(cams[1].stream_name, "garden");
}

#[tokio::test]
async fn login_rejects_bad_credentials() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/login"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let mut client = FrigateClient::new(&server.uri(), false).unwrap();
    assert!(client.login("admin", "wrong").await.is_err());
}

#[test]
fn vod_url_is_built_correctly() {
    // Trailing slash on the base URL must be normalized away.
    let client = FrigateClient::new("https://nvr.local:8971/", false).unwrap();
    assert_eq!(
        client.vod_url("driveway", 100, 200),
        "https://nvr.local:8971/vod/driveway/start/100/end/200/master.m3u8"
    );
}
