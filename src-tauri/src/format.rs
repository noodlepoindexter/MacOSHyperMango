//! Document formats.
//!
//! Two formats are supported, and the frontend sees neither of them directly:
//! it always receives and returns a `Document` whose card paint layers are PNG
//! data URLs, exactly like the original web app's in-memory model. This module
//! is the only place that knows the difference between them.
//!
//!   .hmango  — a directory package. `stack.json` plus real PNG/audio files.
//!              Efficient, diffable, and inspectable in Finder.
//!   .hweb    — the web version's single JSON file with base64 data URLs
//!              inlined. Supported for import/export interop only.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Schema version written into `stack.json`. Bump only on breaking changes.
const PACKAGE_VERSION: u32 = 1;

/// The payload exchanged with the frontend. Cards carry `imageData` as a PNG
/// data URL regardless of which format backs them on disk.
#[derive(Serialize, Deserialize, Debug)]
pub struct Document {
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(default)]
    pub variables: Value,
    #[serde(rename = "customSounds", default)]
    pub custom_sounds: Value,
    pub stack: Vec<Value>,
}

#[derive(Debug)]
pub enum Error {
    Io(String),
    Parse(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Io(m) => write!(f, "{}", m),
            Error::Parse(m) => write!(f, "{}", m),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e.to_string())
    }
}

type Result<T> = std::result::Result<T, Error>;

// ---------------------------------------------------------------------------
// Data URL helpers
// ---------------------------------------------------------------------------

/// Split a `data:<mime>;base64,<payload>` URL into its decoded bytes and the
/// file extension implied by its MIME type. Returns None for anything that
/// isn't a base64 data URL, so callers can pass through plain paths untouched.
fn decode_data_url(url: &str) -> Option<(Vec<u8>, &'static str)> {
    let rest = url.strip_prefix("data:")?;
    let comma = rest.find(',')?;
    let (meta, payload) = rest.split_at(comma);
    if !meta.contains("base64") {
        return None;
    }
    let bytes = STANDARD.decode(payload[1..].as_bytes()).ok()?;
    let ext = if meta.starts_with("image/png") {
        "png"
    } else if meta.starts_with("image/jpeg") {
        "jpg"
    } else if meta.starts_with("audio/mpeg") || meta.starts_with("audio/mp3") {
        "mp3"
    } else if meta.starts_with("audio/ogg") {
        "ogg"
    } else if meta.starts_with("audio/wav") || meta.starts_with("audio/x-wav") {
        "wav"
    } else {
        "bin"
    };
    Some((bytes, ext))
}

fn encode_data_url(bytes: &[u8], mime: &str) -> String {
    format!("data:{};base64,{}", mime, STANDARD.encode(bytes))
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

pub fn load(path: &Path) -> Result<Document> {
    if is_package(path) {
        load_package(path)
    } else {
        load_hweb(path)
    }
}

fn is_package(path: &Path) -> bool {
    path.is_dir() || path.extension().map(|e| e == "hmango").unwrap_or(false)
}

/// Read a `.hweb` file. This is the web app's exact schema, so the only work
/// is validating the shape and normalising fields the web version treats as
/// optional (older stacks predate `textObjects` and per-button `nameId`).
fn load_hweb(path: &Path) -> Result<Document> {
    let text = fs::read_to_string(path)?;
    let v: Value =
        serde_json::from_str(&text).map_err(|e| Error::Parse(format!("invalid JSON: {}", e)))?;

    let stack = v
        .get("stack")
        .and_then(|s| s.as_array())
        .ok_or_else(|| Error::Parse("missing 'stack' array".into()))?
        .iter()
        .map(normalize_card)
        .collect();

    Ok(Document {
        project_name: v
            .get("projectName")
            .and_then(|s| s.as_str())
            .unwrap_or("Untitled Stack")
            .to_string(),
        variables: v.get("variables").cloned().unwrap_or_else(|| json!({})),
        custom_sounds: v.get("customSounds").cloned().unwrap_or_else(|| json!({})),
        stack,
    })
}

/// Fill in fields the web version allows to be absent, so the frontend never
/// has to null-check. Mirrors the defaulting in the web app's
/// `loadStackFromData()`.
fn normalize_card(card: &Value) -> Value {
    let mut c = card.as_object().cloned().unwrap_or_default();
    c.entry("name").or_insert_with(|| json!("Card"));
    c.entry("script").or_insert_with(|| json!(""));
    c.entry("imageData").or_insert(Value::Null);
    c.entry("textObjects").or_insert_with(|| json!([]));

    let buttons = c
        .get("buttons")
        .and_then(|b| b.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|b| {
            let mut btn = b.as_object().cloned().unwrap_or_default();
            btn.entry("invisible").or_insert(json!(false));
            btn.entry("effect").or_insert(json!(""));
            btn.entry("isCanvas").or_insert(json!(false));
            btn.entry("canvasData").or_insert(Value::Null);
            btn.entry("nameId").or_insert(json!(""));
            btn.entry("script").or_insert(json!(""));
            btn.entry("goto").or_insert(json!(0));
            btn.entry("sound").or_insert(json!(""));
            Value::Object(btn)
        })
        .collect::<Vec<_>>();
    c.insert("buttons".into(), Value::Array(buttons));
    Value::Object(c)
}

/// Read a `.hmango` package, re-inlining every referenced file as a data URL
/// so the frontend receives the same shape it would from a `.hweb`.
fn load_package(dir: &Path) -> Result<Document> {
    let manifest = fs::read_to_string(dir.join("stack.json"))
        .map_err(|_| Error::Parse("not a HyperMango package: stack.json missing".into()))?;
    let v: Value = serde_json::from_str(&manifest)
        .map_err(|e| Error::Parse(format!("invalid stack.json: {}", e)))?;

    let mut stack = Vec::new();
    for card in v
        .get("stack")
        .and_then(|s| s.as_array())
        .ok_or_else(|| Error::Parse("stack.json missing 'stack' array".into()))?
    {
        let mut c = normalize_card(card);
        let obj = c.as_object_mut().unwrap();

        // "paint" holds a package-relative path; swap it for the inline data
        // URL the canvas layer expects.
        if let Some(rel) = obj.remove("paint").and_then(|p| p.as_str().map(String::from)) {
            obj.insert("imageData".into(), read_as_data_url(dir, &rel)?);
        }

        if let Some(buttons) = obj.get_mut("buttons").and_then(|b| b.as_array_mut()) {
            for btn in buttons.iter_mut() {
                if let Some(bo) = btn.as_object_mut() {
                    if let Some(rel) = bo.remove("surface").and_then(|p| p.as_str().map(String::from))
                    {
                        bo.insert("canvasData".into(), read_as_data_url(dir, &rel)?);
                    }
                }
            }
        }
        stack.push(c);
    }

    // Custom sounds are stored as files; rebuild the { name: { dataUrl } } map.
    let mut sounds = Map::new();
    if let Some(map) = v.get("customSounds").and_then(|s| s.as_object()) {
        for (name, entry) in map {
            let rel = entry.get("file").and_then(|f| f.as_str()).unwrap_or("");
            if rel.is_empty() {
                continue;
            }
            sounds.insert(
                name.clone(),
                json!({ "dataUrl": read_as_data_url(dir, rel)? }),
            );
        }
    }

    Ok(Document {
        project_name: v
            .get("projectName")
            .and_then(|s| s.as_str())
            .unwrap_or("Untitled Stack")
            .to_string(),
        variables: v.get("variables").cloned().unwrap_or_else(|| json!({})),
        custom_sounds: Value::Object(sounds),
        stack,
    })
}

fn read_as_data_url(dir: &Path, rel: &str) -> Result<Value> {
    let p = dir.join(rel);
    let bytes = fs::read(&p).map_err(|e| Error::Io(format!("{}: {}", rel, e)))?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_lowercase();
    Ok(json!(encode_data_url(&bytes, mime_for_ext(&ext))))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Write a `.hmango` package. The package is built in a sibling temp directory
/// and swapped into place, so an interrupted save can never leave a partially
/// written document where the original used to be.
pub fn save_package(dir: &Path, doc: &Document) -> Result<()> {
    let staging = staging_path(dir);
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(staging.join("cards"))?;
    fs::create_dir_all(staging.join("surfaces"))?;
    fs::create_dir_all(staging.join("sounds"))?;

    let mut cards = Vec::new();
    for (i, card) in doc.stack.iter().enumerate() {
        let mut c = card.as_object().cloned().unwrap_or_default();

        // Paint layer -> cards/card-N.png
        if let Some(url) = c.remove("imageData").and_then(|d| d.as_str().map(String::from)) {
            if let Some((bytes, ext)) = decode_data_url(&url) {
                let rel = format!("cards/card-{}.{}", i + 1, ext);
                fs::write(staging.join(&rel), bytes)?;
                c.insert("paint".into(), json!(rel));
            }
        }

        // Canvas-button faces -> surfaces/card-N-<buttonId>.png
        if let Some(buttons) = c.get_mut("buttons").and_then(|b| b.as_array_mut()) {
            for btn in buttons.iter_mut() {
                let bo = match btn.as_object_mut() {
                    Some(o) => o,
                    None => continue,
                };
                let id = bo
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("btn")
                    .to_string();
                if let Some(url) = bo.remove("canvasData").and_then(|d| d.as_str().map(String::from))
                {
                    if let Some((bytes, ext)) = decode_data_url(&url) {
                        let rel = format!("surfaces/card-{}-{}.{}", i + 1, sanitize(&id), ext);
                        fs::write(staging.join(&rel), bytes)?;
                        bo.insert("surface".into(), json!(rel));
                    }
                }
            }
        }
        cards.push(Value::Object(c));
    }

    // Custom sounds -> sounds/<name>.<ext>
    let mut sounds = Map::new();
    if let Some(map) = doc.custom_sounds.as_object() {
        for (name, entry) in map {
            let url = entry.get("dataUrl").and_then(|d| d.as_str()).unwrap_or("");
            if let Some((bytes, ext)) = decode_data_url(url) {
                let rel = format!("sounds/{}.{}", sanitize(name), ext);
                fs::write(staging.join(&rel), bytes)?;
                sounds.insert(name.clone(), json!({ "file": rel }));
            }
        }
    }

    let manifest = json!({
        "format": "hypermango-package",
        "version": PACKAGE_VERSION,
        "projectName": doc.project_name,
        "variables": doc.variables,
        "customSounds": Value::Object(sounds),
        "stack": cards,
    });
    fs::write(
        staging.join("stack.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| Error::Parse(e.to_string()))?,
    )?;

    // Swap: move any existing document aside, promote staging, then delete the
    // old copy. The window where neither exists is a single rename.
    let backup = backup_path(dir);
    if dir.exists() {
        if backup.exists() {
            fs::remove_dir_all(&backup)?;
        }
        fs::rename(dir, &backup)?;
    }
    match fs::rename(&staging, dir) {
        Ok(()) => {
            if backup.exists() {
                let _ = fs::remove_dir_all(&backup);
            }
            Ok(())
        }
        Err(e) => {
            // Promotion failed — put the original back before surfacing the error.
            if backup.exists() {
                let _ = fs::rename(&backup, dir);
            }
            Err(Error::Io(e.to_string()))
        }
    }
}

/// Write a `.hweb` file: the web version's schema, with everything inlined.
pub fn save_hweb(path: &Path, doc: &Document) -> Result<()> {
    let payload = json!({
        "version": 2,
        "projectName": doc.project_name,
        "customSounds": doc.custom_sounds,
        "variables": doc.variables,
        "stack": doc.stack,
    });
    write_atomic(
        path,
        &serde_json::to_vec(&payload).map_err(|e| Error::Parse(e.to_string()))?,
    )
}

pub fn write_text(path: &Path, contents: &str) -> Result<()> {
    write_atomic(path, contents.as_bytes())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("out")
    ));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn staging_path(dir: &Path) -> PathBuf {
    sibling(dir, ".hypermango-save")
}

fn backup_path(dir: &Path) -> PathBuf {
    sibling(dir, ".hypermango-old")
}

fn sibling(dir: &Path, suffix: &str) -> PathBuf {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document");
    dir.with_file_name(format!("{}{}", name, suffix))
}

/// Keep generated filenames safe across macOS and Windows.
fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
