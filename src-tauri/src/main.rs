// Prevent a console window from opening alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod drive;
mod format;
mod menu;
mod recent;

use format::Document;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, RunEvent};

/// Whether the editor's document has unsaved changes, mirrored from the
/// frontend so app-level quit requests (e.g. Dock ▸ Quit) can be intercepted.
#[derive(Default)]
struct Edited(AtomicBool);

/// Record a document the user opened or saved, for File ▸ Open Recent.
#[tauri::command]
fn note_recent(app: tauri::AppHandle, path: String) {
    recent::add(&app, &path);
    menu::refresh(&app);
}

/// Drop a recent entry that could not be opened.
#[tauri::command]
fn forget_recent(app: tauri::AppHandle, path: String) {
    recent::remove(&app, &path);
    menu::refresh(&app);
}

/// Load a document from disk. Accepts a `.hmango` (single file or legacy
/// package) or a `.hweb`; the frontend gets the same shape either way.
#[tauri::command]
fn load_document(path: String) -> Result<Document, String> {
    format::load(&PathBuf::from(path)).map_err(|e| e.to_string())
}

/// Save as a native single-file `.hmango`.
#[tauri::command]
fn save_document(path: String, doc: Document) -> Result<(), String> {
    let mut p = PathBuf::from(path);
    if p.extension().is_none() {
        p.set_extension("hmango");
    }
    format::save_native(&p, &doc).map_err(|e| e.to_string())
}

/// Autosave a copy of the open document to `<app data>/hmango-backups/`.
/// There is one backup per document: the name combines the file's name with a
/// hash of its full path, so two `Quest.hmango` files in different folders
/// don't overwrite each other's backups. An unsaved stack backs up under its
/// project name.
#[tauri::command]
fn write_backup(app: tauri::AppHandle, path: Option<String>, doc: Document) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("hmango-backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = match path {
        Some(p) => {
            let stem = PathBuf::from(&p)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Stack")
                .to_string();
            format!("{}-{:08x}.hmango", format::safe_file_name(&stem), format::path_hash(&p))
        }
        None => format!("{} (unsaved).hmango", format::safe_file_name(&doc.project_name)),
    };
    format::save_native(&dir.join(name), &doc).map_err(|e| e.to_string())
}

/// Upload the document to the user's Google Drive, signing in first if needed.
/// Returns the Drive file id, which the frontend passes back on later saves of
/// an untitled stack so they update the same file.
#[tauri::command]
async fn drive_save(
    app: tauri::AppHandle,
    local_path: Option<String>,
    file_id: Option<String>,
    name: String,
    doc: Document,
) -> Result<String, String> {
    drive::save(&app, local_path, file_id, name, doc).await
}

#[tauri::command]
async fn drive_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    drive::sign_out(&app).await
}

/// Export to the web version's single-file `.hweb` format.
#[tauri::command]
fn export_hweb(path: String, doc: Document) -> Result<(), String> {
    format::save_hweb(&PathBuf::from(path), &doc).map_err(|e| e.to_string())
}

/// Write an already-rendered standalone HTML export.
#[tauri::command]
fn export_html(path: String, html: String) -> Result<(), String> {
    format::write_text(&PathBuf::from(path), &html).map_err(|e| e.to_string())
}

/// Reflect unsaved state in the window title. Tauri v2 exposes no cross-platform
/// hook for macOS's proxy-icon dot, so a trailing bullet stands in for it on
/// every platform — one behaviour, no per-OS divergence to maintain.
#[tauri::command]
fn set_document_edited(
    window: tauri::Window,
    state: tauri::State<Edited>,
    edited: bool,
    title: String,
) -> Result<(), String> {
    state.0.store(edited, Ordering::SeqCst);
    let suffix = if edited { " \u{2022}" } else { "" };
    window
        .set_title(&format!("{}{}", title, suffix))
        .map_err(|e| e.to_string())
}

/// Exit after the frontend has resolved any unsaved changes.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(recent::Recent::default())
        .manage(Edited::default())
        .manage(drive::Drive::default())
        .setup(|app| {
            let handle = app.handle();
            *app.state::<recent::Recent>().0.lock().unwrap() = recent::load(handle);
            let m = menu::build(handle)?;
            app.set_menu(m)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::dispatch(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            load_document,
            save_document,
            export_hweb,
            export_html,
            write_backup,
            drive_save,
            drive_sign_out,
            set_document_edited,
            note_recent,
            forget_recent,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building HyperMango")
        .run(|app, event| {
            // A quit from outside the menu bar (Dock, logout) arrives with no
            // exit code. Hold it and let the editor ask about unsaved changes;
            // it calls `quit_app` once the user has decided.
            if let RunEvent::ExitRequested { code: None, api, .. } = event {
                let edited = app.state::<Edited>().0.load(Ordering::SeqCst);
                if let (true, Some(main)) = (edited, app.get_webview_window("main")) {
                    api.prevent_exit();
                    let _ = main.emit("menu", "app.quit");
                }
            }
        });
}
