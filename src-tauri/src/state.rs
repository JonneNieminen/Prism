use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use prism_core::audio::{Audio, TrackInfo};
use prism_core::library::Library;
use prism_core::models::ModelStore;
use prism_core::separator::Separator;
use prism_core::settings::Settings;
use prism_core::util::CancelToken;
use tauri::{AppHandle, Manager};

pub struct Paths {
    pub data: PathBuf,
    pub cache: PathBuf,
    pub accel_cache: PathBuf,
    pub settings: PathBuf,
}

/// A loaded separator kept warm between runs (model load / Core ML compile is slow).
pub struct Loaded {
    pub key: String,
    pub sep: Box<dyn Separator>,
}

pub struct Inner {
    pub paths: Paths,
    pub store: ModelStore,
    pub library: Library,
    settings: Mutex<Settings>,
    jobs: Mutex<HashMap<String, CancelToken>>,
    pub loaded: Mutex<Option<Loaded>>,
    decoded: Mutex<Option<(PathBuf, Audio, TrackInfo)>>,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl std::ops::Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data = app.path().app_data_dir()?;
        let cache = app.path().app_cache_dir()?;
        std::fs::create_dir_all(&data)?;
        std::fs::create_dir_all(&cache)?;
        // Dev builds read the bundled models straight from the repo.
        let bundled = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../models")
        } else {
            app.path().resource_dir()?.join("models")
        };
        let paths = Paths {
            settings: data.join("settings.json"),
            accel_cache: cache.join("accelerator"),
            cache,
            data: data.clone(),
        };
        let settings = Settings::load(&paths.settings);
        Ok(AppState(Arc::new(Inner {
            store: ModelStore::new(bundled, data.join("models")),
            library: Library::new(data.join("projects")),
            settings: Mutex::new(settings),
            jobs: Mutex::new(HashMap::new()),
            loaded: Mutex::new(None),
            decoded: Mutex::new(None),
            paths,
        })))
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn save_settings(&self, s: Settings) -> prism_core::Result<Settings> {
        let old = self.settings();
        if old.acceleration != s.acceleration {
            self.drop_loaded();
        }
        s.save(&self.paths.settings)?;
        *self.settings.lock().unwrap() = s.clone();
        if old.library_retention_days != s.library_retention_days {
            self.purge_expired();
        }
        Ok(s)
    }

    /// Apply the "delete old songs" setting. Returns how many projects were removed.
    pub fn purge_expired(&self) -> usize {
        self.library.purge_older_than(self.settings().library_retention_days)
    }

    pub fn register(&self, id: &str) -> CancelToken {
        let t = CancelToken::new();
        self.jobs.lock().unwrap().insert(id.to_string(), t.clone());
        t
    }
    pub fn unregister(&self, id: &str) {
        self.jobs.lock().unwrap().remove(id);
    }
    pub fn cancel(&self, id: &str) {
        if let Some(t) = self.jobs.lock().unwrap().get(id) {
            t.cancel();
        }
    }
    /// A job with this prefix is running and hasn't been cancelled. A cancelled one may still be
    /// unwinding (a model compile can't be interrupted) but no longer blocks starting the next.
    pub fn busy(&self, prefix: &str) -> bool {
        self.jobs.lock().unwrap().iter().any(|(k, t)| k.starts_with(prefix) && !t.is_cancelled())
    }

    /// Any job with this prefix other than `me` is still registered, cancelled or not.
    pub fn other_jobs_running(&self, prefix: &str, me: &str) -> bool {
        self.jobs.lock().unwrap().keys().any(|k| k.starts_with(prefix) && k != me)
    }

    pub fn drop_loaded(&self) {
        *self.loaded.lock().unwrap() = None;
    }

    pub fn remember_decoded(&self, p: PathBuf, a: Audio, i: TrackInfo) {
        *self.decoded.lock().unwrap() = Some((p, a, i));
    }
    pub fn take_decoded(&self, p: &PathBuf) -> Option<(Audio, TrackInfo)> {
        let mut g = self.decoded.lock().unwrap();
        match g.take() {
            Some((pp, a, i)) if &pp == p => Some((a, i)),
            other => {
                *g = other;
                None
            }
        }
    }
}
