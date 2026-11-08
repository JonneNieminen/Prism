//! Native menu bar (macOS menu bar, Windows/Linux window menu). App commands mirror `src/lib/shortcuts.ts` and are
//! forwarded to the UI as a `menu` event carrying the command id. Standard
//! items (Edit, Minimize, Hide, Full Screen on macOS) are handled by the OS. Accelerators use
//! `CmdOrCtrl`, so each platform shows and uses its own modifier.

use prism_core::settings::Language;
use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>, lang: Language) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, tr(lang, text));
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let about = AboutMetadata {
        name: Some("Prism".into()),
        version: Some(app.package_info().version.to_string()),
        comments: Some(tr(lang, "Local AI stem separation")),
        license: Some("MIT".into()),
        website: Some("https://github.com/JonneNieminen/Prism".into()),
        ..Default::default()
    };

    // macOS has an application menu; Windows/Linux put Settings and Quit in File instead.
    let app_menu = SubmenuBuilder::new(app, tr(lang, "Prism"))
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

    let mut file = SubmenuBuilder::new(app, tr(lang, "File"))
        .item(&item("open", "Open Song…", Some("CmdOrCtrl+O"))?)
        .item(&item("separate", "Separate", Some("CmdOrCtrl+Enter"))?)
        .item(&item("cancel", "Cancel Separation", Some("CmdOrCtrl+Period"))?)
        .separator()
        .item(&item("exportMix", "Export Current Mix…", Some("CmdOrCtrl+E"))?)
        .item(&item("exportStems", "Export All Stems…", Some("CmdOrCtrl+Shift+E"))?)
        .separator();
    if !cfg!(target_os = "macos") {
        file = file.item(&item("goSettings", "Settings…", Some("CmdOrCtrl+Comma"))?).separator();
        // Windows closes with Alt+F4 (handled by the OS); Linux apps conventionally use Ctrl+Q.
        file = if cfg!(target_os = "linux") { file.item(&item("quit", "Quit", Some("Ctrl+Q"))?) } else { file.quit() };
    } else {
        file = file.close_window();
    }
    let file = file.build()?;

    let edit = SubmenuBuilder::new(app, tr(lang, "Edit"))
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let appearance = SubmenuBuilder::new(app, tr(lang, "Appearance"))
        .item(&item("theme:system", "Match System", None)?)
        .item(&item("theme:light", "Light", None)?)
        .item(&item("theme:dark", "Dark", None)?)
        .separator()
        .item(&item("toggleTheme", "Switch Light / Dark", Some("CmdOrCtrl+Shift+L"))?)
        .build()?;

    let mut view = SubmenuBuilder::new(app, tr(lang, "View"))
        .item(&item("goSeparate", "Separate", Some("CmdOrCtrl+1"))?)
        .item(&item("goPlayer", "Player", Some("CmdOrCtrl+2"))?)
        .item(&item("goLibrary", "Library", Some("CmdOrCtrl+3"))?)
        .item(&item("goModels", "Models", Some("CmdOrCtrl+4"))?)
        .item(&item("goAnalyze", "Key & BPM", Some("CmdOrCtrl+5"))?)
        .item(&item("goDownload", "Download Track", Some("CmdOrCtrl+6"))?)
        .separator()
        .item(&appearance)
        .separator();
    view = if cfg!(target_os = "macos") {
        view.fullscreen()
    } else {
        view.item(&item("fullscreen", "Toggle Full Screen", Some("F11"))?)
    };
    let view = view.build()?;

    // Single-key player shortcuts (Space, ←/→, 1–9, K, A, R, M) are handled by the
    // page so they never steal keys from text fields; listed here for discovery.
    let playback = SubmenuBuilder::new(app, tr(lang, "Playback"))
        .item(&item("playPause", "Play / Pause", None)?)
        .item(&item("toStart", "Go to Start", None)?)
        .item(&item("seekBack", "Back 5 Seconds", None)?)
        .item(&item("seekForward", "Forward 5 Seconds", None)?)
        .separator()
        .item(&item("masterUp", "Master Volume Up", Some("CmdOrCtrl+Up"))?)
        .item(&item("masterDown", "Master Volume Down", Some("CmdOrCtrl+Down"))?)
        .item(&item("masterMute", "Mute / Unmute", None)?)
        .separator()
        .item(&item("karaoke", "Karaoke (Remove Vocals)", None)?)
        .item(&item("acapella", "A Cappella (Vocals Only)", None)?)
        .item(&item("noGuitar", "Remove Guitar", None)?)
        .item(&item("resetMix", "Reset Mix", None)?)
        .build()?;

    let window =
        SubmenuBuilder::new(app, tr(lang, "Window")).minimize().maximize().separator().bring_all_to_front().build()?;

    let help = SubmenuBuilder::new(app, tr(lang, "Help"))
        .item(&item("goHelp", "Prism Help", Some("CmdOrCtrl+Shift+Slash"))?)
        .item(&item("goShortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+Slash"))?)
        .build()?;

    if cfg!(target_os = "macos") {
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &playback, &window, &help])
    } else {
        Menu::with_items(app, &[&file, &edit, &view, &playback, &help])
    }
}

/// Menu text in the chosen language. English is the text in the code; anything not listed stays
/// as written. The standard items the OS provides (Hide, Quit on macOS, Copy…) use the system language.
fn tr(lang: Language, text: &str) -> String {
    let table: &[(&str, &str)] = match lang {
        Language::En => return text.to_string(),
        Language::Fi => &[
            ("Local AI stem separation", "Paikallinen tekoälypohjainen stemmien erottelu"),
            ("File", "Arkisto"),
            ("Edit", "Muokkaa"),
            ("View", "Näytä"),
            ("Appearance", "Ulkoasu"),
            ("Playback", "Toisto"),
            ("Window", "Ikkuna"),
            ("Help", "Ohje"),
            ("Settings…", "Asetukset…"),
            ("Open Song…", "Avaa kappale…"),
            ("Separate", "Erottele"),
            ("Cancel Separation", "Peruuta erottelu"),
            ("Export Current Mix…", "Vie nykyinen miksaus…"),
            ("Export All Stems…", "Vie kaikki stemmit…"),
            ("Quit", "Lopeta"),
            ("Match System", "Seuraa järjestelmää"),
            ("Light", "Vaalea"),
            ("Dark", "Tumma"),
            ("Switch Light / Dark", "Vaihda vaalea / tumma"),
            ("Player", "Soitin"),
            ("Library", "Kirjasto"),
            ("Models", "Mallit"),
            ("Key & BPM", "Sävellaji ja BPM"),
            ("Download Track", "Lataa kappale"),
            ("Toggle Full Screen", "Koko näyttö"),
            ("Play / Pause", "Toisto / tauko"),
            ("Go to Start", "Siirry alkuun"),
            ("Back 5 Seconds", "Taakse 5 sekuntia"),
            ("Forward 5 Seconds", "Eteenpäin 5 sekuntia"),
            ("Master Volume Up", "Päävoimakkuus ylös"),
            ("Master Volume Down", "Päävoimakkuus alas"),
            ("Mute / Unmute", "Mykistä / palauta ääni"),
            ("Karaoke (Remove Vocals)", "Karaoke (poista laulu)"),
            ("A Cappella (Vocals Only)", "A cappella (vain laulu)"),
            ("Remove Guitar", "Poista kitara"),
            ("Reset Mix", "Palauta miksaus"),
            ("Prism Help", "Prismin ohje"),
            ("Keyboard Shortcuts", "Pikanäppäimet"),
        ],
        Language::Sv => &[
            ("Local AI stem separation", "Lokal AI-baserad stemseparering"),
            ("File", "Arkiv"),
            ("Edit", "Redigera"),
            ("View", "Visa"),
            ("Appearance", "Utseende"),
            ("Playback", "Uppspelning"),
            ("Window", "Fönster"),
            ("Help", "Hjälp"),
            ("Settings…", "Inställningar…"),
            ("Open Song…", "Öppna låt…"),
            ("Separate", "Separera"),
            ("Cancel Separation", "Avbryt separering"),
            ("Export Current Mix…", "Exportera aktuell mix…"),
            ("Export All Stems…", "Exportera alla stems…"),
            ("Quit", "Avsluta"),
            ("Match System", "Följ systemet"),
            ("Light", "Ljust"),
            ("Dark", "Mörkt"),
            ("Switch Light / Dark", "Växla ljust / mörkt"),
            ("Player", "Spelare"),
            ("Library", "Bibliotek"),
            ("Models", "Modeller"),
            ("Key & BPM", "Tonart och BPM"),
            ("Download Track", "Ladda ner låt"),
            ("Toggle Full Screen", "Helskärm"),
            ("Play / Pause", "Spela / pausa"),
            ("Go to Start", "Gå till början"),
            ("Back 5 Seconds", "Bakåt 5 sekunder"),
            ("Forward 5 Seconds", "Framåt 5 sekunder"),
            ("Master Volume Up", "Huvudvolym upp"),
            ("Master Volume Down", "Huvudvolym ned"),
            ("Mute / Unmute", "Tysta / slå på ljudet"),
            ("Karaoke (Remove Vocals)", "Karaoke (ta bort sången)"),
            ("A Cappella (Vocals Only)", "A cappella (bara sång)"),
            ("Remove Guitar", "Ta bort gitarren"),
            ("Reset Mix", "Återställ mixen"),
            ("Prism Help", "Prism Hjälp"),
            ("Keyboard Shortcuts", "Kortkommandon"),
        ],
    };
    table.iter().find(|(en, _)| *en == text).map_or_else(|| text.to_string(), |(_, t)| t.to_string())
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id.to_string());
}
