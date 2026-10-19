//! Document formats.
//!
//! Two formats are supported, and the frontend sees neither of them directly:
//! it always receives and returns a `Document` whose card paint layers are PNG
//! data URLs, exactly like the original web app's in-memory model. This module
//! is the only place that knows the difference between them.
//!
//!   .hmango  — a single JSON file with base64 data URLs inlined. Earlier
//!              builds wrote `.hmango` as a directory package (`stack.json`
//!              plus PNG/audio files); those still open, and are replaced by
//!              a single file the next time they are saved.
//!   .hweb    — the web version's single JSON file. Same shape as `.hmango`,
//!              supported for import/export interop only.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// Schema version written into `.hmango` files. Bump only on breaking changes.
const FORMAT_VERSION: u32 = 2;

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
    if path.is_dir() {
        load_package(path)
    } else {
        load_file(path)
    }
}

/// Read a single-file `.hmango` or `.hweb`. Both use the web app's schema, so
/// the only work is validating the shape and normalising fields the web
/// version treats as optional (older stacks predate `textObjects` and
/// per-button `nameId`).
fn load_file(path: &Path) -> Result<Document> {
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

/// Read a legacy directory-package `.hmango`, re-inlining every referenced file as a data URL
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

/// Write a native `.hmango` file: a single JSON document with every image and
/// sound inlined as a data URL.
pub fn save_native(path: &Path, doc: &Document) -> Result<()> {
    write_atomic(path, &native_bytes(doc)?)
}

/// The bytes of a native `.hmango` file, for writing locally or uploading.
pub fn native_bytes(doc: &Document) -> Result<Vec<u8>> {
    let payload = json!({
        "format": "hypermango",
        "version": FORMAT_VERSION,
        "projectName": doc.project_name,
        "variables": doc.variables,
        "customSounds": doc.custom_sounds,
        "stack": doc.stack,
    });
    serde_json::to_vec(&payload).map_err(|e| Error::Parse(e.to_string()))
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

/// Write via a sibling temp file and rename, so an interrupted save never
/// leaves a half-written document. If a legacy directory package sits at
/// `path`, it is moved aside first and only deleted once the new file is in
/// place.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("out")
    ));
    fs::write(&tmp, bytes)?;

    if !path.is_dir() {
        return fs::rename(&tmp, path).map_err(Error::from);
    }

    let backup = backup_path(path);
    if backup.exists() {
        fs::remove_dir_all(&backup)?;
    }
    fs::rename(path, &backup)?;
    match fs::rename(&tmp, path) {
        Ok(()) => {
            let _ = fs::remove_dir_all(&backup);
            Ok(())
        }
        Err(e) => {
            // Promotion failed — put the original back before surfacing the error.
            let _ = fs::rename(&backup, path);
            Err(Error::Io(e.to_string()))
        }
    }
}

/// FNV-1a over the path's bytes. Stable across runs and Rust versions (unlike
/// `DefaultHasher`), so a document keeps the same backup file forever.
pub fn path_hash(path: &str) -> u32 {
    path.bytes().fold(0x811c_9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x0100_0193))
}

/// Replace characters that are awkward in filenames on macOS and Windows.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    if trimmed.is_empty() { "Untitled".into() } else { trimmed.into() }
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


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_over_a_legacy_package_leaves_a_single_file() {
        let dir = std::env::temp_dir().join(format!("hm-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("Quest.hmango");
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("stack.json"),
            r#"{"projectName":"Quest","stack":[{"name":"One","buttons":[]}]}"#,
        )
        .unwrap();

        let doc = load(&path).unwrap();
        assert_eq!(doc.stack.len(), 1);
        save_native(&path, &doc).unwrap();

        assert!(path.is_file());
        assert!(!backup_path(&path).exists());
        let reloaded = load(&path).unwrap();
        assert_eq!(reloaded.project_name, "Quest");
        assert_eq!(reloaded.stack[0]["name"], "One");
        fs::remove_dir_all(&dir).unwrap();
    }
}
