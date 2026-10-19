//! Save to Google Drive.
//!
//! Uses the `drive.file` scope, which only grants access to files this app
//! creates — enough to save stacks, and non-sensitive in Google's review terms.
//!
//! Sign-in follows Google's flow for installed apps: open the system browser,
//! receive the code on a one-shot loopback listener, exchange it with PKCE.
//! The refresh token lives in the OS keychain; access tokens only in memory.
//!
//! Credentials come from the environment at build time, so they never land in
//! the repository:
//!   HYPERMANGO_GOOGLE_CLIENT_ID      (required)
//!   HYPERMANGO_GOOGLE_CLIENT_SECRET  (the "secret" of a Desktop-app client)

use crate::format::{self, Document};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const CLIENT_ID: Option<&str> = option_env!("HYPERMANGO_GOOGLE_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("HYPERMANGO_GOOGLE_CLIENT_SECRET");

const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";

const FOLDER_NAME: &str = "HyperMango";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const KEYCHAIN_SERVICE: &str = "com.hypermango.desktop.google-drive";
const KEYCHAIN_USER: &str = "refresh-token";
/// How long to wait for the user to finish signing in in the browser.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct Drive(Mutex<Session>);

#[derive(Default)]
struct Session {
    access_token: Option<(String, Instant)>,
    folder_id: Option<String>,
}

type Result<T> = std::result::Result<T, String>;

fn client_id() -> Result<&'static str> {
    CLIENT_ID.filter(|s| !s.is_empty()).ok_or_else(|| {
        "Google Drive isn't configured in this build: set HYPERMANGO_GOOGLE_CLIENT_ID \
         (and HYPERMANGO_GOOGLE_CLIENT_SECRET) and rebuild."
            .into()
    })
}

fn keychain() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Upload `doc` as `<name>.hmango` into the HyperMango folder. Updates the
/// Drive file previously used for this document when there is one — passed in
/// as `file_id`, or remembered for `local_path` — otherwise creates a new one.
/// Returns the Drive file id.
pub async fn save(
    app: &AppHandle,
    local_path: Option<String>,
    file_id: Option<String>,
    name: String,
    doc: Document,
) -> Result<String> {
    let http = reqwest::Client::new();
    let token = access_token(app, &http).await?;
    let file_name = format!("{}.hmango", format::safe_file_name(&name));
    let body = format::native_bytes(&doc).map_err(|e| e.to_string())?;

    let known = file_id.or_else(|| local_path.as_deref().and_then(|p| mapping_get(app, p)));
    let id = match known {
        Some(id) => match upload(&http, &token, Some(&id), &file_name, None, &body).await {
            Ok(id) => id,
            // The old file was deleted on Drive (or isn't ours any more): start fresh.
            Err(UploadError::NotFound) => create(app, &http, &token, &file_name, &body).await?,
            Err(UploadError::Other(e)) => return Err(e),
        },
        None => create(app, &http, &token, &file_name, &body).await?,
    };

    if let Some(p) = local_path {
        mapping_set(app, &p, &id);
    }
    Ok(id)
}

/// Forget the stored sign-in and revoke it with Google.
pub async fn sign_out(app: &AppHandle) -> Result<()> {
    *app.state::<Drive>().0.lock().unwrap() = Session::default();
    let entry = keychain()?;
    if let Ok(refresh) = entry.get_password() {
        let _ = reqwest::Client::new()
            .post(REVOKE_URL)
            .form(&[("token", refresh.as_str())])
            .send()
            .await;
    }
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

enum UploadError {
    NotFound,
    Other(String),
}

impl From<reqwest::Error> for UploadError {
    fn from(e: reqwest::Error) -> Self {
        UploadError::Other(e.to_string())
    }
}

async fn create(
    app: &AppHandle,
    http: &reqwest::Client,
    token: &str,
    file_name: &str,
    body: &[u8],
) -> Result<String> {
    let folder = folder_id(app, http, token).await?;
    match upload(http, token, None, file_name, Some(&folder), body).await {
        Ok(id) => Ok(id),
        Err(UploadError::NotFound) => {
            // The cached folder vanished mid-session; look it up again once.
            app.state::<Drive>().0.lock().unwrap().folder_id = None;
            let folder = folder_id(app, http, token).await?;
            upload(http, token, None, file_name, Some(&folder), body)
                .await
                .map_err(|e| match e {
                    UploadError::NotFound => "Drive folder not found".to_string(),
                    UploadError::Other(e) => e,
                })
        }
        Err(UploadError::Other(e)) => Err(e),
    }
}

/// Resumable upload: one request opens a session with the metadata, a second
/// sends the bytes. Works for stacks of any size, unlike multipart's 5 MB cap.
async fn upload(
    http: &reqwest::Client,
    token: &str,
    existing: Option<&str>,
    file_name: &str,
    parent: Option<&str>,
    body: &[u8],
) -> std::result::Result<String, UploadError> {
    let mut meta = json!({ "name": file_name, "mimeType": "application/json" });
    if let Some(p) = parent {
        meta["parents"] = json!([p]);
    }
    let start = match existing {
        Some(id) => http.patch(format!("{}/{}?uploadType=resumable", UPLOAD_URL, id)),
        None => http.post(format!("{}?uploadType=resumable", UPLOAD_URL)),
    };
    let resp = start
        .bearer_auth(token)
        .header("X-Upload-Content-Type", "application/json")
        .json(&meta)
        .send()
        .await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(UploadError::NotFound);
    }
    let resp = check(resp).await.map_err(UploadError::Other)?;
    let session = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| UploadError::Other("Drive did not return an upload session".into()))?
        .to_string();

    let resp = http
        .put(session)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_vec())
        .send()
        .await?;
    let file: Value = check(resp)
        .await
        .map_err(UploadError::Other)?
        .json()
        .await?;
    file.get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| UploadError::Other("Drive response had no file id".into()))
}

/// Find the app's "HyperMango" folder, creating it on first use. With the
/// `drive.file` scope the search only sees folders this app made, so a user's
/// own folder of the same name is never picked up by mistake.
async fn folder_id(app: &AppHandle, http: &reqwest::Client, token: &str) -> Result<String> {
    if let Some(id) = app.state::<Drive>().0.lock().unwrap().folder_id.clone() {
        return Ok(id);
    }
    let q = format!(
        "name = '{}' and mimeType = '{}' and trashed = false",
        FOLDER_NAME, FOLDER_MIME
    );
    let found: Value = check(
        http.get(FILES_URL)
            .bearer_auth(token)
            .query(&[("q", q.as_str()), ("fields", "files(id)"), ("pageSize", "1")])
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;

    let id = match found["files"][0]["id"].as_str() {
        Some(id) => id.to_string(),
        None => {
            let made: Value = check(
                http.post(FILES_URL)
                    .bearer_auth(token)
                    .query(&[("fields", "id")])
                    .json(&json!({ "name": FOLDER_NAME, "mimeType": FOLDER_MIME }))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
            )
            .await?
            .json()
            .await
            .map_err(|e| e.to_string())?;
            made["id"]
                .as_str()
                .ok_or("Drive did not return a folder id")?
                .to_string()
        }
    };
    app.state::<Drive>().0.lock().unwrap().folder_id = Some(id.clone());
    Ok(id)
}

/// Turn a non-2xx response into an error carrying Google's message.
async fn check(resp: reqwest::Response) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["error_description"].as_str())
                .map(String::from)
        })
        .unwrap_or(text);
    Err(format!("Google Drive error ({}): {}", status, detail))
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/// A valid access token, refreshing or signing in as needed.
async fn access_token(app: &AppHandle, http: &reqwest::Client) -> Result<String> {
    let cached = app.state::<Drive>().0.lock().unwrap().access_token.clone();
    if let Some((tok, expires)) = cached {
        if Instant::now() + Duration::from_secs(60) < expires {
            return Ok(tok);
        }
    }

    let entry = keychain()?;
    let tokens = match entry.get_password() {
        Ok(refresh) => match token_request(
            http,
            &[("grant_type", "refresh_token"), ("refresh_token", &refresh)],
        )
        .await
        {
            Ok(t) => t,
            // Revoked or expired refresh token: fall back to a fresh sign-in.
            Err(_) => sign_in(http).await?,
        },
        Err(_) => sign_in(http).await?,
    };

    if let Some(refresh) = tokens.get("refresh_token").and_then(|v| v.as_str()) {
        entry.set_password(refresh).map_err(|e| e.to_string())?;
    }
    let access = tokens["access_token"]
        .as_str()
        .ok_or("Google did not return an access token")?
        .to_string();
    let ttl = tokens["expires_in"].as_u64().unwrap_or(3600);
    app.state::<Drive>().0.lock().unwrap().access_token =
        Some((access.clone(), Instant::now() + Duration::from_secs(ttl)));
    Ok(access)
}

async fn token_request(http: &reqwest::Client, extra: &[(&str, &str)]) -> Result<Map<String, Value>> {
    let mut form: Vec<(&str, &str)> = vec![("client_id", client_id()?)];
    if let Some(secret) = CLIENT_SECRET.filter(|s| !s.is_empty()) {
        form.push(("client_secret", secret));
    }
    form.extend_from_slice(extra);
    let v: Value = check(
        http.post(TOKEN_URL)
            .form(&form)
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?
    .json()
    .await
    .map_err(|e| e.to_string())?;
    v.as_object().cloned().ok_or_else(|| "bad token response".into())
}

/// Browser sign-in with a loopback redirect and PKCE.
async fn sign_in(http: &reqwest::Client) -> Result<Map<String, Value>> {
    let client_id = client_id()?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());

    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token();

    let url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &code_challenge={}&code_challenge_method=S256&state={}\
         &access_type=offline&prompt=consent",
        AUTH_URL,
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect),
        urlencoding::encode(SCOPE),
        challenge,
        state,
    );
    open::that(&url).map_err(|e| format!("Could not open the browser: {}", e))?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state))
        .await
        .map_err(|e| e.to_string())??;

    token_request(
        http,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ],
    )
    .await
}

/// Accept connections on the loopback listener until Google redirects back
/// with `?code=…&state=…` (or an error), answering each with a small page.
fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err("Timed out waiting for Google sign-in.".into());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.split_whitespace().nth(1).unwrap_or("");
        let params = query_params(target);

        // Browsers also ask for /favicon.ico; ignore anything without our params.
        let result = if let Some(err) = params.get("error") {
            Some(Err(format!("Google sign-in was not completed ({}).", err)))
        } else if let Some(code) = params.get("code") {
            if params.get("state").map(String::as_str) == Some(expected_state) {
                Some(Ok(code.clone()))
            } else {
                Some(Err("Google sign-in response did not match this request.".into()))
            }
        } else {
            None
        };

        let page = match &result {
            Some(Ok(_)) => "Signed in to Google Drive. You can close this tab and return to HyperMango.",
            Some(Err(_)) => "Google sign-in did not complete. You can close this tab and try again from HyperMango.",
            None => "",
        };
        let html = format!(
            "<!doctype html><meta charset=utf-8><title>HyperMango</title>\
             <body style=\"font:16px system-ui;padding:3em;text-align:center\">{}</body>",
            page
        );
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        if let Some(r) = result {
            return r;
        }
    }
}

fn query_params(target: &str) -> std::collections::HashMap<String, String> {
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| {
            let v = urlencoding::decode(&v.replace('+', " ")).map(|c| c.into_owned());
            (k.to_string(), v.unwrap_or_default())
        })
        .collect()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

// ---------------------------------------------------------------------------
// Local path -> Drive file id, so re-saving a document updates the same file
// ---------------------------------------------------------------------------

fn mapping_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("drive-files.json"))
}

fn mapping_load(app: &AppHandle) -> Map<String, Value> {
    mapping_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn mapping_get(app: &AppHandle, local: &str) -> Option<String> {
    mapping_load(app).get(local).and_then(|v| v.as_str()).map(String::from)
}

fn mapping_set(app: &AppHandle, local: &str, id: &str) {
    let Some(p) = mapping_path(app) else { return };
    let mut map = mapping_load(app);
    map.insert(local.to_string(), json!(id));
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(s) = serde_json::to_string_pretty(&map) {
        let _ = std::fs::write(p, s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_oauth_redirect() {
        let p = query_params("/?state=abc&code=4%2F0Ab_x-y&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file");
        assert_eq!(p["code"], "4/0Ab_x-y");
        assert_eq!(p["state"], "abc");
        assert!(query_params("/favicon.ico").is_empty());
    }

    #[test]
    fn loopback_listener_returns_the_code() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(s, "GET /?code=xyz&state=st HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            out
        });
        assert_eq!(wait_for_code(listener, "st").unwrap(), "xyz");
        assert!(browser.join().unwrap().contains("Signed in"));
    }
}
