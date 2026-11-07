//! Native macOS menu bar. App commands mirror `src/lib/shortcuts.ts` and are
//! forwarded to the UI as a `menu` event carrying the command id. Standard
//! items (Edit, Minimize ⌘M, Hide, Quit, Full Screen) are handled by macOS.

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, text);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let about = AboutMetadata {
        name: Some("Prism".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: Some("Local AI stem separation".into()),
        license: Some("MIT".into()),
        website: Some("https://github.com/JonneNieminen/Prism".into()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "Prism")
        .about(Some(about))
        .separator()
        .item(&item("goSettings", "Settings…", Some("CmdOrCtrl+Comma"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open", "Open Song…", Some("CmdOrCtrl+O"))?)
        .item(&item("separate", "Separate", Some("CmdOrCtrl+Enter"))?)
        .item(&item("cancel", "Cancel Separation", Some("CmdOrCtrl+Period"))?)
        .separator()
        .item(&item("exportMix", "Export Current Mix…", Some("CmdOrCtrl+E"))?)
        .item(&item("exportStems", "Export All Stems…", Some("CmdOrCtrl+Shift+E"))?)
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;

    let appearance = SubmenuBuilder::new(app, "Appearance")
        .item(&item("theme:system", "Match System", None)?)
        .item(&item("theme:light", "Light", None)?)
        .item(&item("theme:dark", "Dark", None)?)
        .separator()
        .item(&item("toggleTheme", "Switch Light / Dark", Some("CmdOrCtrl+Shift+L"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("goSeparate", "Separate", Some("CmdOrCtrl+1"))?)
        .item(&item("goPlayer", "Player", Some("CmdOrCtrl+2"))?)
        .item(&item("goLibrary", "Library", Some("CmdOrCtrl+3"))?)
        .item(&item("goModels", "Models", Some("CmdOrCtrl+4"))?)
        .separator()
        .item(&appearance)
        .separator()
        .fullscreen()
        .build()?;

    // Single-key player shortcuts (Space, ←/→, 1–9, K, A, R) are handled by the
    // page so they never steal keys from text fields; listed here for discovery.
    let playback = SubmenuBuilder::new(app, "Playback")
        .item(&item("playPause", "Play / Pause", None)?)
        .item(&item("toStart", "Go to Start", None)?)
        .item(&item("seekBack", "Back 5 Seconds", None)?)
        .item(&item("seekForward", "Forward 5 Seconds", None)?)
        .separator()
        .item(&item("karaoke", "Karaoke (Remove Vocals)", None)?)
        .item(&item("acapella", "A Cappella (Vocals Only)", None)?)
        .item(&item("resetMix", "Reset Mix", None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().bring_all_to_front().build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("goHelp", "Prism Help", Some("CmdOrCtrl+Shift+Slash"))?)
        .item(&item("goShortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+Slash"))?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &playback, &window, &help])
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id.to_string());
}
