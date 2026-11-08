use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Result;
use crate::export::ExportFormat;
use crate::manifest::Quality;
use crate::models::DEFAULT_MODEL_ID;
use crate::runtime::Acceleration;

pub const DEFAULT_CATALOG_URL: &str = "https://raw.githubusercontent.com/JonneNieminen/Prism/main/catalog/index.json";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Theme {
    #[default]
    System,
    Dark,
    Light,
}

/// The language of the interface. English is the default; it is never picked from the system.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Language {
    #[default]
    En,
    Fi,
    Sv,
}

/// How the "Recent" songs on the Separate screen are shown.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RecentLayout {
    #[default]
    Tiles,
    List,
}

/// Separated songs are deleted from the library this many days after they were made.
pub const DEFAULT_LIBRARY_RETENTION_DAYS: u32 = 7;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub active_model_id: String,
    pub quality: Quality,
    pub export_format: ExportFormat,
    pub mp3_bitrate: u32,
    pub default_save_dir: Option<String>,
    pub theme: Theme,
    pub acceleration: Acceleration,
    pub catalog_url: String,
    pub hidden_models: Vec<String>,
    /// Model ids whose license the user has acknowledged.
    pub accepted_licenses: Vec<String>,
    /// Delete library songs after this many days; 0 keeps them forever.
    pub library_retention_days: u32,
    pub recent_layout: RecentLayout,
    /// Where downloaded tracks are saved; `None` means the "Prism" folder inside Downloads.
    pub track_download_dir: Option<String>,
    pub language: Language,
    /// Check GitHub for a new version on start and every four hours.
    pub updates_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            active_model_id: DEFAULT_MODEL_ID.into(),
            quality: Quality::Balanced,
            export_format: ExportFormat::Wav,
            mp3_bitrate: 320,
            default_save_dir: None,
            theme: Theme::System,
            acceleration: Acceleration::Auto,
            catalog_url: DEFAULT_CATALOG_URL.into(),
            hidden_models: vec![],
            accepted_licenses: vec![],
            library_retention_days: DEFAULT_LIBRARY_RETENTION_DAYS,
            recent_layout: RecentLayout::Tiles,
            track_download_dir: None,
            language: Language::En,
            updates_enabled: true,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        crate::util::replace_file(&tmp, path)?;
        Ok(())
    }
}
