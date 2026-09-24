//! Native menu bar. Every item emits a `menu` event carrying its id; the
//! frontend listens once and dispatches. Keeping the mapping one-way like this
//! means adding a command is a single line here plus a handler in the frontend.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Build the application menu. Accelerators use `CmdOrCtrl` so the same
/// definition produces ⌘-based shortcuts on macOS and Ctrl-based on Windows.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "HyperMango")
        .about(Some(AboutMetadata {
            name: Some("HyperMango".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let mut recent_menu = SubmenuBuilder::new(app, "Open Recent");
    let entries = crate::recent::menu_entries(app);
    for (id, label) in &entries {
        recent_menu = recent_menu.item(&item(app, id, label, None)?);
    }
    if !entries.is_empty() {
        recent_menu = recent_menu.separator();
    }
    let clear = MenuItemBuilder::with_id("file.clearRecent", "Clear Menu")
        .enabled(!entries.is_empty())
        .build(app)?;
    let recent_menu = recent_menu.item(&clear).build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item(app, "file.new", "New Stack", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item(app, "file.open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&recent_menu)
        .separator()
        .item(&item(app, "file.save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item(app, "file.saveAs", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item(app, "file.importHweb", "Import .hweb…", None)?)
        .item(&item(app, "file.exportHweb", "Export .hweb…", None)?)
        .item(&item(app, "file.exportHtml", "Export as HTML…", None)?)
        .separator()
        .item(&item(app, "file.rename", "Rename Project…", None)?)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&item(app, "edit.undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&item(app, "edit.redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item(app, "edit.clearCard", "Clear Card Drawing", None)?)
        .item(&item(app, "edit.deleteCard", "Delete Card", None)?)
        .separator()
        .item(&item(app, "edit.renameCard", "Rename Card…", None)?)
        .item(&item(app, "edit.cardScript", "Edit Card Script…", None)?)
        .build()?;

    let card_menu = SubmenuBuilder::new(app, "Card")
        .item(&item(app, "card.add", "Add Card", Some("CmdOrCtrl+N"))?)
        .item(&item(app, "card.addButton", "Add Button", Some("CmdOrCtrl+B"))?)
        .item(&item(app, "card.addText", "Add Text", Some("CmdOrCtrl+T"))?)
        .separator()
        .item(&item(app, "card.first", "First Card", Some("CmdOrCtrl+Up"))?)
        .item(&item(app, "card.prev", "Previous Card", Some("CmdOrCtrl+Left"))?)
        .item(&item(app, "card.next", "Next Card", Some("CmdOrCtrl+Right"))?)
        .item(&item(app, "card.last", "Last Card", Some("CmdOrCtrl+Down"))?)
        .build()?;

    let stack_menu = SubmenuBuilder::new(app, "Stack")
        .item(&item(app, "stack.play", "Play Stack", Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(app, "stack.variables", "Variables…", None)?)
        .item(&item(app, "stack.reference", "Script Reference…", Some("CmdOrCtrl+/"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item(app, "view.sidebar", "Toggle Card Browser", Some("CmdOrCtrl+1"))?)
        .item(&item(app, "view.inspector", "Toggle Inspector", Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item(app, "view.zoomIn", "Zoom In", Some("CmdOrCtrl+Plus"))?)
        .item(&item(app, "view.zoomOut", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item(app, "view.zoomActual", "Actual Size", Some("CmdOrCtrl+0"))?)
        .item(&item(app, "view.zoomFit", "Zoom to Fit", Some("CmdOrCtrl+9"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &card_menu,
            &stack_menu,
            &view_menu,
            &window_menu,
        ])
        .build()
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accel {
        b = b.accelerator(a);
    }
    b.build(app)
}

/// Rebuild the menu bar, e.g. after the recent-files list changes.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(m) = build(app) {
        let _ = app.set_menu(m);
    }
}

/// Forward a menu selection to whichever window is focused, falling back to
/// the main window. Play mode runs in its own window and ignores editor events.
/// Document-level items (Clear Menu, recent files) always go to the editor.
pub fn dispatch<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "file.clearRecent" {
        crate::recent::clear(app);
        refresh(app);
        return;
    }
    if id.starts_with(crate::recent::MENU_PREFIX) {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
            let _ = main.emit("menu", id);
        }
        return;
    }

    let target = app
        .webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(_, w)| w)
        .or_else(|| app.get_webview_window("main"));

    if let Some(win) = target {
        let _ = win.emit("menu", id);
    }
}
