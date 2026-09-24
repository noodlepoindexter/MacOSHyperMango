//! Recently opened documents, persisted as JSON in the app's config directory
//! and shown in File ▸ Open Recent.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// Long enough to be useful, short enough that the submenu stays scannable.
const MAX_RECENT: usize = 20;

/// Menu ids for recent items are this prefix followed by the full path.
pub const MENU_PREFIX: &str = "recent:";

#[derive(Default)]
pub struct Recent(pub Mutex<Vec<String>>);

fn store_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("recent.json"))
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    store_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist<R: Runtime>(app: &AppHandle<R>, list: &[String]) {
    let Some(p) = store_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(list) {
        let _ = std::fs::write(p, json);
    }
}

/// Move `path` to the front of the list (adding it if new), then persist.
pub fn add<R: Runtime>(app: &AppHandle<R>, path: &str) {
    let state = app.state::<Recent>();
    let mut list = state.0.lock().unwrap();
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
    persist(app, &list);
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, path: &str) {
    let state = app.state::<Recent>();
    let mut list = state.0.lock().unwrap();
    list.retain(|p| p != path);
    persist(app, &list);
}

pub fn clear<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<Recent>();
    let mut list = state.0.lock().unwrap();
    list.clear();
    persist(app, &list);
}

/// Entries that still exist on disk, paired with their menu labels. Labels are
/// file names, with the parent folder appended when two names would collide.
pub fn menu_entries<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, String)> {
    let list = app.state::<Recent>().0.lock().unwrap().clone();
    let live: Vec<String> = list.into_iter().filter(|p| Path::new(p).exists()).collect();

    let name = |p: &str| {
        Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.to_string())
    };
    live.iter()
        .map(|p| {
            let n = name(p);
            let clashes = live.iter().filter(|q| name(q) == n).count() > 1;
            let label = match Path::new(p).parent().and_then(|d| d.file_name()) {
                Some(dir) if clashes => format!("{} — {}", n, dir.to_string_lossy()),
                _ => n,
            };
            (format!("{MENU_PREFIX}{p}"), label)
        })
        .collect()
}
