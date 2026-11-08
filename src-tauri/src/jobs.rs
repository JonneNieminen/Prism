//! Background jobs (separation, model download). One thread each; progress,
//! completion and errors are emitted as events keyed by job id.

use std::path::PathBuf;
use std::time::Instant;

use prism_core::catalog::{self, CatalogEntry};
use prism_core::error::AppError;
use prism_core::library::Project;
use prism_core::manifest::Quality;
use prism_core::runtime::{Acceleration, CPU_LABEL, LoadStep, NON_FINITE, RuntimeOptions};
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

/// How the activity log shows a line.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Info,
    Warn,
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
        /// What is happening right now, in plain words ("Optimizing model 2 of 4 · Bass").
        detail: Option<String>,
        /// A longer reassurance shown under the steps ("first run only…").
        note: Option<String>,
    },
    /// One line of the activity log: what is happening under the hood.
    #[serde(rename_all = "camelCase")]
    Log { job_id: String, level: Level, text: String },
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

/// "3:34" for a number of seconds.
fn fmt_clock(secs: f64) -> String {
    let s = secs.max(0.0).round() as u64;
    format!("{}:{:02}", s / 60, s % 60)
}

fn run_separation(
    st: &AppState,
    path: &PathBuf,
    model: prism_core::models::InstalledModel,
    quality: Quality,
    cancel: &CancelToken,
    jid: &str,
    emit: &(dyn Fn(JobEvent) + Sync),
) -> Result<Project> {
    // `progress` drives the step list (a plain-words status); `log` is the low-level stream.
    let progress = |stage, fraction, eta, device: Option<String>, detail: Option<String>, note: Option<String>| {
        emit(JobEvent::Progress { job_id: jid.into(), stage, fraction, eta_secs: eta, device, detail, note })
    };
    let log = |level: Level, text: String| emit(JobEvent::Log { job_id: jid.into(), level, text });
    let info = |text: String| log(Level::Info, text);

    // A cancelled job can still be winding down (a model compile can't be interrupted). Start
    // working only once it has let go, so the two never compile the same model at once.
    let mut told = false;
    while st.other_jobs_running("sep-", jid) {
        cancel.check()?;
        if !told {
            told = true;
            progress(Stage::Decoding, 0.0, None, None, Some("Waiting for the cancelled separation".into()), None);
            log(
                Level::Warn,
                "The previous, cancelled separation is still winding down — waiting for it to let go".into(),
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    let m = &model.manifest;
    let file_name = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let networks = m.weight_files().len();
    info(format!(
        "Model: {} · {} {} · {} network{} · {} stems ({})",
        m.name,
        m.architecture,
        m.version.as_deref().unwrap_or(""),
        networks,
        if networks == 1 { "" } else { "s" },
        m.stems.len(),
        m.stems.iter().map(|s| s.id.as_str()).collect::<Vec<_>>().join(", ")
    ));
    progress(Stage::Decoding, 0.0, None, None, Some(format!("Reading “{file_name}”")), None);
    info(format!("Opening “{file_name}” and decoding it to raw audio"));
    let (raw, track) = match st.take_decoded(path) {
        Some(x) => {
            info("Using the audio already decoded for the preview".into());
            x
        }
        None => audio::decode_file(path, cancel)?,
    };
    let src_rate = track.sample_rate as f32 / 1000.0;
    let src_channels = if track.channels == 1 { "mono" } else { "stereo" };
    info(format!(
        "Decoded {} of audio · {src_rate:.1} kHz {src_channels} · {} samples per channel",
        fmt_clock(track.duration_secs),
        (track.duration_secs * track.sample_rate as f64).round() as u64
    ));
    progress(Stage::Decoding, 1.0, None, None, Some("Preparing the audio for the model".into()), None);
    let want_rate = m.sample_rate as f32 / 1000.0;
    let want_channels = if m.channels == 1 { "mono" } else { "stereo" };
    if track.sample_rate != m.sample_rate {
        info(format!("Resampling {src_rate:.1} → {want_rate:.1} kHz (the model's sample rate)"));
    }
    if track.channels != m.channels {
        info(format!("Converting {src_channels} → {want_channels}"));
    }
    if track.sample_rate == m.sample_rate && track.channels == m.channels {
        info(format!("Already {want_rate:.1} kHz {want_channels}: no conversion needed"));
    }
    let audio = audio::conform(raw, m.sample_rate, m.channels as usize)?;
    cancel.check()?;
    progress(Stage::Decoding, 1.0, None, None, Some("Detecting key and tempo".into()), None);
    info("Analysing the whole track for tempo and musical key".into());
    let music = prism_core::musicinfo::analyze(&audio);
    info(format!(
        "Tempo {} · key {}",
        music.bpm.map_or("unclear".to_string(), |b| format!("{b:.1} BPM")),
        music.key.as_ref().map_or("unclear".to_string(), |k| format!("{} ({})", k.name, k.camelot))
    ));
    cancel.check()?;

    let settings = st.settings();
    let mut accel = settings.acceleration;
    let started = Instant::now();
    loop {
        let rt = RuntimeOptions { acceleration: accel, cache_dir: Some(st.paths.accel_cache.clone()) };
        let key = format!("{}@{:?}", m.id, accel);
        let mut slot = st.loaded.lock().unwrap().take().filter(|l| l.key == key);
        if slot.is_some() {
            info("The model is still loaded from the last separation — nothing to load".into());
        } else {
            let first = accel == Acceleration::Auto && !st.paths.accel_cache.join(&m.id).exists();
            let note = first.then(|| {
                "First run with this model: Prism is optimizing it for your Mac. This is a one-time wait — next time it loads in seconds.".to_string()
            });
            let verb = if first { "Optimizing" } else { "Loading" };
            progress(Stage::Loading, 0.0, None, None, Some(format!("{verb} the model")), note.clone());
            let mut rt = rt.clone();
            rt.cache_dir = rt.cache_dir.map(|d| d.join(&m.id));
            if accel == Acceleration::Cpu {
                info("Hardware acceleration is off: running on the CPU, no compile needed".into());
            } else if first {
                info("No compiled copy found: Core ML will compile each network once and keep the result".into());
            } else {
                info("Found the compiled copy from an earlier run: loading it from the cache".into());
            }

            // What the heartbeat below reports on, and when the current network started.
            let label = std::sync::Mutex::new(String::from("the model"));
            let current: std::sync::Mutex<Option<(String, Instant)>> = std::sync::Mutex::new(None);
            let ready = |current: &std::sync::Mutex<Option<(String, Instant)>>| {
                if let Some((what, t)) = current.lock().unwrap().take() {
                    info(format!("{what} ready in {:.1} s", t.elapsed().as_secs_f32()));
                }
            };
            let mut on_step = |s: LoadStep| {
                ready(&current);
                let what = match (s.total, &s.stem) {
                    (1, _) => "Model".to_string(),
                    (n, Some(stem)) => format!("Model {} of {n} ({stem})", s.index + 1),
                    (n, None) => format!("Model {} of {n}", s.index + 1),
                };
                let detail = match (s.total, &s.stem) {
                    (1, _) => format!("{verb} the model"),
                    (n, Some(stem)) => format!("{verb} model {} of {n} · {stem}", s.index + 1),
                    (n, None) => format!("{verb} model {} of {n}", s.index + 1),
                };
                *label.lock().unwrap() = what.to_lowercase();
                progress(Stage::Loading, s.index as f32 / s.total as f32, None, None, Some(detail), note.clone());
                info(format!("{what}: reading the weights “{}” ({:.0} MB)", s.file, s.bytes as f64 / 1e6));
                let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
                info(format!(
                    "{what}: creating the inference session · ONNX Runtime · {threads} threads · full graph optimization"
                ));
                if accel == Acceleration::Auto {
                    info(format!("{what}: handing the graph to Core ML (ML Program, GPU + Neural Engine allowed)"));
                }
                *current.lock().unwrap() = Some((what, Instant::now()));
            };
            let stop = std::sync::atomic::AtomicBool::new(false);
            let loaded_sep = std::thread::scope(|sc| {
                // A compile gives no progress of its own, so say honestly that it is still going.
                sc.spawn(|| {
                    use std::sync::atomic::Ordering::Relaxed;
                    let t0 = Instant::now();
                    let (mut next, mut warned) = (5u64, false);
                    while !stop.load(Relaxed) {
                        std::thread::sleep(std::time::Duration::from_millis(250));
                        if cancel.is_cancelled() && !warned {
                            warned = true;
                            log(Level::Warn, "Cancel requested — a model compile can't be interrupted, so Prism stops as soon as this one finishes".into());
                        }
                        let secs = t0.elapsed().as_secs();
                        if secs >= next && !stop.load(Relaxed) {
                            next += 5;
                            let word = if first { "compiling" } else { "loading" };
                            info(format!("Still {word} {} · {} so far", label.lock().unwrap(), fmt_clock(secs as f64)));
                        }
                    }
                });
                let r = separator::load_with(&model, &rt, &mut on_step);
                stop.store(true, std::sync::atomic::Ordering::Relaxed);
                r
            })?;
            ready(&current);
            slot = Some(Loaded { key: key.clone(), sep: loaded_sep });
        }
        let mut loaded = slot.unwrap();
        cancel.check()?;
        let device = loaded.sep.device().to_string();
        progress(Stage::Loading, 1.0, None, Some(device.clone()), Some("Model ready".into()), None);
        info(format!("Running on {device}"));
        let opts = SeparateOptions { quality, preset_override: None };
        let preset = opts.preset(m);
        let overlap = preset.overlap.unwrap_or(m.overlap);
        info(format!(
            "Quality “{quality:?}”: {} random shift pass{}, {:.0}% overlap between chunks",
            preset.shifts.max(1),
            if preset.shifts.max(1) == 1 { "" } else { "es" },
            overlap * 100.0
        ));
        info(format!("Cutting the track into chunks of {:.1} s and running each through the model", m.chunk_seconds));
        let mut ticks = 0u32;
        let res = separator::run(
            loaded.sep.as_mut(),
            &audio,
            &opts,
            &mut |p| {
                let detail = format!("Splitting the song into {} stems", m.stems.len());
                if p.fraction > 0.0 {
                    ticks += 1;
                    let total = (ticks as f32 / p.fraction).round() as u32;
                    let left = p.eta_secs.map_or(String::new(), |e| format!(" · about {} left", fmt_clock(e as f64)));
                    info(format!(
                        "Chunk {ticks} of {total} · {:.0}% · {} elapsed{left}",
                        p.fraction * 100.0,
                        fmt_clock(p.elapsed_secs as f64)
                    ));
                }
                progress(Stage::Separating, p.fraction, p.eta_secs, Some(device.clone()), Some(detail), None)
            },
            cancel,
        );
        match res {
            Ok(stems) => {
                *st.loaded.lock().unwrap() = Some(loaded);
                info(format!("Separation finished in {}", fmt_clock(started.elapsed().as_secs_f64())));
                progress(
                    Stage::Saving,
                    1.0,
                    None,
                    Some(device.clone()),
                    Some(format!("Writing {} stems to your library", m.stems.len())),
                    None,
                );
                info(format!("Writing {} stems as 32-bit WAV files and drawing their waveforms", m.stems.len()));
                let project = st.library.create(
                    &track,
                    m,
                    &stems,
                    quality,
                    &device,
                    started.elapsed().as_secs_f32(),
                    Some(music),
                )?;
                info("Saved to the library".into());
                return Ok(project);
            }
            Err(PrismError::Inference(msg)) if msg == NON_FINITE && device != CPU_LABEL => {
                eprintln!("[prism] accelerator produced invalid output; retrying on CPU");
                log(
                    Level::Warn,
                    "The accelerator returned invalid audio — retrying the whole separation on the CPU".into(),
                );
                progress(Stage::Loading, 0.0, None, None, Some("Retrying on the CPU".into()), None);
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
