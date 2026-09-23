// Prevent a console window from opening alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod format;
mod menu;

use format::Document;
use std::path::PathBuf;

/// Load a document from disk. Accepts either a `.hmango` package or a `.hweb`
/// file; the frontend gets the same shape either way.
#[tauri::command]
fn load_document(path: String) -> Result<Document, String> {
    format::load(&PathBuf::from(path)).map_err(|e| e.to_string())
}

/// Save as a native `.hmango` package.
#[tauri::command]
fn save_document(path: String, doc: Document) -> Result<(), String> {
    let mut p = PathBuf::from(path);
    if p.extension().is_none() {
        p.set_extension("hmango");
    }
    format::save_package(&p, &doc).map_err(|e| e.to_string())
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
fn set_document_edited(window: tauri::Window, edited: bool, title: String) -> Result<(), String> {
    let suffix = if edited { " \u{2022}" } else { "" };
    window
        .set_title(&format!("{}{}", title, suffix))
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle();
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
            set_document_edited,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperMango");
}
