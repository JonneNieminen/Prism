//! Tauri shell: thin commands over `prism-core`. Heavy work runs on background
//! threads and reports through events, so the UI thread never blocks.

mod jobs;
mod menu;
mod state;

use std::path::PathBuf;

use prism_core::audio::{SUPPORTED_EXTENSIONS, TrackInfo};
use prism_core::catalog::{self, CatalogEntry};
use prism_core::error::AppError;
use prism_core::export::{self, ExportOptions, MixGain};
use prism_core::library::{Peaks, Project};
use prism_core::manifest::Quality;
use prism_core::models::ModelListing;
use prism_core::settings::Settings;
use prism_core::util::{CancelToken, dir_size};
use prism_core::{PrismError, peaks};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use state::AppState;

type Res<T> = Result<T, AppError>;

fn app_err(e: PrismError) -> AppError {
    e.to_app()
}

/// Run blocking work off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> prism_core::Result<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError { kind: prism_core::error::ErrorKind::Other, message: e.to_string() })?
        .map_err(app_err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    library_bytes: u64,
    accel_cache_bytes: u64,
    models_bytes: u64,
    supported_extensions: Vec<String>,
}

#[tauri::command]
async fn app_info(app: AppHandle, state: State<'_, AppState>) -> Res<AppInfo> {
    let s = state.inner().clone();
    // The bundle version (stamped by CI/release builds), not the crate version.
    let version = app.package_info().version.to_string();
    blocking(move || {
        Ok(AppInfo {
            version,
            data_dir: s.paths.data.display().to_string(),
            library_bytes: s.library.size_bytes(),
            accel_cache_bytes: dir_size(&s.paths.accel_cache),
            models_bytes: dir_size(&s.store.user_dir),
            supported_extensions: SUPPORTED_EXTENSIONS.iter().map(|s| s.to_string()).collect(),
        })
    })
    .await
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
fn set_settings(state: State<'_, AppState>, settings: Settings) -> Res<Settings> {
    state.save_settings(settings).map_err(app_err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Probe {
    info: TrackInfo,
    peaks: Vec<f32>,
}

/// Decode for the preview (title, duration, waveform). The decoded audio is kept
/// so starting the separation doesn't decode twice.
#[tauri::command]
async fn probe_audio(state: State<'_, AppState>, path: String) -> Res<Probe> {
    let s = state.inner().clone();
    blocking(move || {
        let p = PathBuf::from(&path);
        let (audio, info) = prism_core::audio::decode_file(&p, &CancelToken::new())?;
        let pk = peaks::peaks(&audio, 1200);
        s.remember_decoded(p, audio, info.clone());
        Ok(Probe { info, peaks: pk })
    })
    .await
}

#[tauri::command]
fn start_separation(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    model_id: String,
    quality: Quality,
) -> Res<String> {
    jobs::start_separation(app, state.inner().clone(), PathBuf::from(path), model_id, quality).map_err(app_err)
}

#[tauri::command]
fn cancel_job(state: State<'_, AppState>, job_id: String) {
    state.cancel(&job_id);
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Vec<Project> {
    state.library.list()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenProject {
    project: Project,
    peaks: Peaks,
    /// stem id → absolute path of the cached WAV (served via the asset protocol).
    stem_paths: std::collections::BTreeMap<String, String>,
}

#[tauri::command]
async fn open_project(state: State<'_, AppState>, id: String) -> Res<OpenProject> {
    let s = state.inner().clone();
    blocking(move || {
        let project = s.library.get(&id)?;
        let peaks = s.library.peaks(&id).unwrap_or_default();
        let mut stem_paths = std::collections::BTreeMap::new();
        for st in &project.stems {
            stem_paths.insert(st.id.clone(), s.library.stem_path(&project, &st.id)?.display().to_string());
        }
        Ok(OpenProject { project, peaks, stem_paths })
    })
    .await
}

#[tauri::command]
fn rename_project(state: State<'_, AppState>, id: String, title: String) -> Res<Project> {
    state.library.rename(&id, &title).map_err(app_err)
}

#[tauri::command]
async fn delete_project(state: State<'_, AppState>, id: String) -> Res<()> {
    let s = state.inner().clone();
    blocking(move || s.library.delete(&id)).await
}

#[tauri::command]
async fn clear_cache(state: State<'_, AppState>, library: bool, accelerator: bool) -> Res<()> {
    let s = state.inner().clone();
    blocking(move || {
        if library {
            s.library.clear()?;
        }
        if accelerator {
            s.drop_loaded();
            if s.paths.accel_cache.exists() {
                std::fs::remove_dir_all(&s.paths.accel_cache)?;
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
fn suggest_file_name(title: String, suffix: String, ext: String) -> String {
    export::default_file_name(&title, &suffix, &ext)
}

#[tauri::command]
async fn export_stem(
    state: State<'_, AppState>,
    project_id: String,
    stem_id: String,
    options: ExportOptions,
    target: String,
) -> Res<()> {
    let s = state.inner().clone();
    blocking(move || {
        let p = s.library.get(&project_id)?;
        export::export_stem(&s.library, &p, &stem_id, &options, &PathBuf::from(target))
    })
    .await
}

#[tauri::command]
async fn export_mix(
    state: State<'_, AppState>,
    project_id: String,
    gains: Vec<MixGain>,
    options: ExportOptions,
    target: String,
) -> Res<()> {
    let s = state.inner().clone();
    blocking(move || {
        let p = s.library.get(&project_id)?;
        export::export_mix(&s.library, &p, &gains, &options, &PathBuf::from(target))
    })
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    job_id: String,
    fraction: f32,
}

#[tauri::command]
async fn export_zip(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    project_id: String,
    options: ExportOptions,
    target: String,
) -> Res<()> {
    let s = state.inner().clone();
    let cancel = s.register(&job_id);
    let jid = job_id.clone();
    let res = blocking(move || {
        let p = s.library.get(&project_id)?;
        let tmp = s.paths.cache.join("export-tmp");
        export::export_zip(
            &s.library,
            &p,
            &options,
            &PathBuf::from(target),
            &tmp,
            &mut |f| {
                let _ = app.emit("export-progress", ExportProgress { job_id: jid.clone(), fraction: f });
            },
            &cancel,
        )
    })
    .await;
    state.unregister(&job_id);
    res
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Models {
    listing: ModelListing,
    active_id: String,
}

#[tauri::command]
fn list_models(state: State<'_, AppState>) -> Models {
    Models { listing: state.store.list(), active_id: state.settings().active_model_id }
}

#[tauri::command]
async fn import_model(state: State<'_, AppState>, path: String) -> Res<prism_core::manifest::ModelManifest> {
    let s = state.inner().clone();
    blocking(move || Ok(s.store.import(&PathBuf::from(path), &CancelToken::new())?.manifest)).await
}

#[tauri::command]
async fn remove_model(state: State<'_, AppState>, id: String) -> Res<()> {
    let s = state.inner().clone();
    blocking(move || {
        s.drop_loaded();
        s.store.remove(&id)?;
        let mut st = s.settings();
        if st.active_model_id == id {
            st.active_model_id = prism_core::models::DEFAULT_MODEL_ID.into();
            s.save_settings(st)?;
        }
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogResponse {
    entries: Vec<CatalogEntry>,
    warnings: Vec<String>,
}

#[tauri::command]
async fn fetch_catalog(state: State<'_, AppState>) -> Res<CatalogResponse> {
    let url = state.settings().catalog_url;
    blocking(move || {
        let (c, warnings) = catalog::fetch(&url)?;
        Ok(CatalogResponse { entries: c.models, warnings })
    })
    .await
}

#[tauri::command]
fn install_catalog_model(app: AppHandle, state: State<'_, AppState>, job_id: String, entry: CatalogEntry) -> Res<()> {
    jobs::start_download(app, state.inner().clone(), job_id, entry);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let st = AppState::new(app.handle())?;
            // Remove expired songs now, then re-check hourly for long-running sessions.
            st.purge_expired();
            let sweeper = st.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(60 * 60));
                    sweeper.purge_expired();
                }
            });
            app.manage(st);
            let m = menu::build(app.handle())?;
            app.set_menu(m)?;
            app.on_menu_event(|app, e| menu::forward(app, e.id().as_ref()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            quit_app,
            get_settings,
            set_settings,
            probe_audio,
            start_separation,
            cancel_job,
            list_projects,
            open_project,
            rename_project,
            delete_project,
            clear_cache,
            suggest_file_name,
            export_stem,
            export_mix,
            export_zip,
            list_models,
            import_model,
            remove_model,
            fetch_catalog,
            install_catalog_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prism");
}
