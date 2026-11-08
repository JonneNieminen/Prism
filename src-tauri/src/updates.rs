//! In-app updates through Tauri's updater plugin. Releases live on GitHub; the app reads
//! `latest.json` from the latest release, verifies the download against the public key in
//! `tauri.conf.json`, installs it and restarts. This module checks (on start and every four hours
//! when updates are enabled, or when asked), reports progress and installs.

use std::sync::Mutex;
use std::time::Duration;

use prism_core::{PrismError, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::AppState;

/// How often a running app looks for a new version.
const EVERY: Duration = Duration::from_secs(4 * 60 * 60);
/// Wait a little after launch so start-up stays quick.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(8);

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum UpdateEvent {
    /// A new version was found by the background check.
    Available { info: UpdateInfo },
    #[serde(rename_all = "camelCase")]
    Progress { downloaded: u64, total: Option<u64> },
    /// Downloaded and installed; the app restarts next.
    Installed,
}

fn net(what: &str, e: impl std::fmt::Display) -> PrismError {
    PrismError::Network(format!("{what}: {e}"))
}

pub async fn check(app: &AppHandle) -> Result<UpdateInfo> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| net("Updates aren't set up in this build", e))?;
    let found = updater.check().await.map_err(|e| net("Couldn't check for updates", e))?;
    let pending = app.state::<Pending>();
    match found {
        Some(update) => {
            let info = UpdateInfo {
                current_version,
                available: true,
                version: Some(update.version.clone()),
                notes: update.body.clone().filter(|n| !n.trim().is_empty()),
                date: update.date.map(|d| d.date().to_string()),
            };
            *pending.0.lock().unwrap() = Some(update);
            Ok(info)
        }
        None => {
            *pending.0.lock().unwrap() = None;
            Ok(UpdateInfo { current_version, available: false, version: None, notes: None, date: None })
        }
    }
}

/// Download and install the update found by the last check, then restart.
pub async fn install(app: &AppHandle) -> Result<()> {
    let update = app.state::<Pending>().0.lock().unwrap().take();
    let update = match update {
        Some(u) => u,
        None => {
            check(app).await?;
            app.state::<Pending>()
                .0
                .lock()
                .unwrap()
                .take()
                .ok_or_else(|| PrismError::Other("Prism is already up to date.".into()))?
        }
    };
    let mut downloaded = 0u64;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("update", UpdateEvent::Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| net("The update couldn't be installed", e))?;
    let _ = app.emit("update", UpdateEvent::Installed);
    app.restart();
}

/// Check in the background: shortly after start, then every four hours, for as long as the setting
/// is on. Each new version is announced once. Development builds don't check by themselves.
pub fn start_background_checks(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    std::thread::Builder::new()
        .name("prism-updates".into())
        .spawn(move || {
            let mut announced: Option<String> = None;
            std::thread::sleep(FIRST_CHECK_AFTER);
            loop {
                if app.state::<AppState>().settings().updates_enabled
                    && let Ok(info) = tauri::async_runtime::block_on(check(&app))
                    && info.available
                    && info.version != announced
                {
                    announced = info.version.clone();
                    let _ = app.emit("update", UpdateEvent::Available { info });
                }
                std::thread::sleep(EVERY);
            }
        })
        .ok();
}
