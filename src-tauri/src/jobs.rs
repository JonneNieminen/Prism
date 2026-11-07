//! Background jobs (separation, model download). One thread each; progress,
//! completion and errors are emitted as events keyed by job id.

use std::path::PathBuf;
use std::time::Instant;

use prism_core::catalog::{self, CatalogEntry};
use prism_core::error::AppError;
use prism_core::library::Project;
use prism_core::manifest::Quality;
use prism_core::runtime::{Acceleration, CPU_LABEL, NON_FINITE, RuntimeOptions};
use prism_core::separator::{self, SeparateOptions};
use prism_core::util::CancelToken;
use prism_core::{PrismError, Result, audio};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::state::{AppState, Loaded};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Decoding,
    Loading,
    Separating,
    Saving,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum JobEvent {
    #[serde(rename_all = "camelCase")]
    Progress {
        job_id: String,
        stage: Stage,
        fraction: f32,
        eta_secs: Option<f32>,
        device: Option<String>,
        note: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Done { job_id: String, project: Option<Box<Project>> },
    #[serde(rename_all = "camelCase")]
    Error { job_id: String, error: AppError },
}

pub fn start_separation(
    app: AppHandle,
    st: AppState,
    path: PathBuf,
    model_id: String,
    quality: Quality,
) -> Result<String> {
    if st.busy("sep-") {
        return Err(PrismError::Other("A separation is already running.".into()));
    }
    let model = st.store.get(&model_id)?;
    let job_id = format!("sep-{}", uuid::Uuid::new_v4());
    let cancel = st.register(&job_id);
    let jid = job_id.clone();
    std::thread::Builder::new()
        .name("prism-separate".into())
        .spawn(move || {
            let emit = |e: JobEvent| {
                let _ = app.emit("separation", e);
            };
            let res = run_separation(&st, &path, model, quality, &cancel, &jid, &emit);
            st.unregister(&jid);
            match res {
                Ok(p) => emit(JobEvent::Done { job_id: jid, project: Some(Box::new(p)) }),
                Err(e) => emit(JobEvent::Error { job_id: jid, error: e.to_app() }),
            }
        })
        .map_err(|e| PrismError::Other(format!("Couldn't start the separation: {e}")))?;
    Ok(job_id)
}

fn run_separation(
    st: &AppState,
    path: &PathBuf,
    model: prism_core::models::InstalledModel,
    quality: Quality,
    cancel: &CancelToken,
    jid: &str,
    emit: &dyn Fn(JobEvent),
) -> Result<Project> {
    let progress = |stage, fraction, eta, device: Option<String>, note: Option<String>| {
        emit(JobEvent::Progress { job_id: jid.into(), stage, fraction, eta_secs: eta, device, note })
    };
    progress(Stage::Decoding, 0.0, None, None, None);
    let (raw, info) = match st.take_decoded(path) {
        Some(x) => x,
        None => audio::decode_file(path, cancel)?,
    };
    let m = &model.manifest;
    let audio = audio::conform(raw, m.sample_rate, m.channels as usize)?;
    cancel.check()?;

    let settings = st.settings();
    let mut accel = settings.acceleration;
    let started = Instant::now();
    loop {
        let rt = RuntimeOptions { acceleration: accel, cache_dir: Some(st.paths.accel_cache.clone()) };
        let key = format!("{}@{:?}", m.id, accel);
        let mut slot = st.loaded.lock().unwrap().take().filter(|l| l.key == key);
        if slot.is_none() {
            let first = accel == Acceleration::Auto && !st.paths.accel_cache.join(&m.id).exists();
            let note = first.then(|| "Optimizing the model for this Mac — first run only, about a minute".to_string());
            progress(Stage::Loading, 0.0, None, None, note);
            let mut rt = rt.clone();
            rt.cache_dir = rt.cache_dir.map(|d| d.join(&m.id));
            slot = Some(Loaded { key: key.clone(), sep: separator::load(&model, &rt)? });
        }
        let mut loaded = slot.unwrap();
        cancel.check()?;
        let device = loaded.sep.device().to_string();
        let opts = SeparateOptions { quality, preset_override: None };
        let res = separator::run(
            loaded.sep.as_mut(),
            &audio,
            &opts,
            &mut |p| progress(Stage::Separating, p.fraction, p.eta_secs, Some(device.clone()), None),
            cancel,
        );
        match res {
            Ok(stems) => {
                *st.loaded.lock().unwrap() = Some(loaded);
                progress(Stage::Saving, 1.0, None, Some(device.clone()), None);
                return st.library.create(&info, m, &stems, quality, &device, started.elapsed().as_secs_f32());
            }
            Err(PrismError::Inference(msg)) if msg == NON_FINITE && device != CPU_LABEL => {
                eprintln!("[prism] accelerator produced invalid output; retrying on CPU");
                accel = Acceleration::Cpu;
                continue;
            }
            Err(e) => {
                if !matches!(e, PrismError::Inference(_)) {
                    *st.loaded.lock().unwrap() = Some(loaded);
                }
                return Err(e);
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Progress { job_id: String, done: u64, total: u64 },
    #[serde(rename_all = "camelCase")]
    Done { job_id: String, model_id: String },
    #[serde(rename_all = "camelCase")]
    Error { job_id: String, error: AppError },
}

pub fn start_download(app: AppHandle, st: AppState, job_id: String, entry: CatalogEntry) {
    let cancel = st.register(&job_id);
    std::thread::spawn(move || {
        let res = catalog::install(
            &entry,
            &st.store,
            &mut |p| {
                let _ = app.emit(
                    "model-download",
                    DownloadEvent::Progress { job_id: job_id.clone(), done: p.done, total: p.total },
                );
            },
            &cancel,
        );
        st.unregister(&job_id);
        let ev = match res {
            Ok(m) => DownloadEvent::Done { job_id, model_id: m.manifest.id },
            Err(e) => DownloadEvent::Error { job_id, error: e.to_app() },
        };
        let _ = app.emit("model-download", ev);
    });
}
