//! Track downloads: runs the bundled `yt-dlp` for a pasted link and reports progress as
//! `track-download` events. The command line and output parsing live in `prism_core::track`.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use prism_core::audio::SUPPORTED_EXTENSIONS;
use prism_core::error::AppError;
use prism_core::track::{self, Line, Platform};
use prism_core::{PrismError, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackStage {
    Fetch,
    Download,
    Save,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TrackEvent {
    #[serde(rename_all = "camelCase")]
    Progress {
        job_id: String,
        stage: TrackStage,
        platform: Platform,
        title: Option<String>,
        uploader: Option<String>,
        fraction: Option<f32>,
        done_bytes: Option<u64>,
        total_bytes: Option<u64>,
        speed: Option<f32>,
        eta_secs: Option<f32>,
    },
    #[serde(rename_all = "camelCase")]
    Done { job_id: String, path: String, title: String, separable: bool },
    #[serde(rename_all = "camelCase")]
    Error { job_id: String, error: AppError },
}

/// Folder downloads go to: the user's choice, else `Downloads/Prism`.
pub fn download_dir(app: &AppHandle, st: &AppState) -> Result<PathBuf> {
    if let Some(d) = st.settings().track_download_dir.filter(|d| !d.trim().is_empty()) {
        return Ok(PathBuf::from(d));
    }
    let base = app.path().download_dir().map_err(|_| {
        PrismError::Other("Couldn't find your Downloads folder. Choose a download folder in Settings.".into())
    })?;
    Ok(base.join("Prism"))
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" }
}

/// The bundled downloader, else one the user installed themselves.
fn find_ytdlp(app: &AppHandle) -> Result<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(exe_name()));
    }
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("bin").join(exe_name()));
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        candidates.push(Path::new(d).join(exe_name()));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(exe_name())));
    }
    candidates.into_iter().find(|p| p.is_file()).ok_or_else(|| {
        PrismError::ModelMissing(
            "The downloader that comes with Prism is missing. Reinstall Prism, or run “npm run fetch-ytdlp” if you're building it yourself."
                .into(),
        )
    })
}

/// A JavaScript engine yt-dlp can use to read YouTube pages: `deno` first (its default), then `node`.
fn find_js_runtime() -> Option<(&'static str, PathBuf)> {
    let exe = |n: &str| if cfg!(windows) { format!("{n}.exe") } else { n.to_string() };
    let mut dirs: Vec<PathBuf> =
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].iter().map(PathBuf::from).collect();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    ["deno", "node"]
        .into_iter()
        .find_map(|name| dirs.iter().map(|d| d.join(exe(name))).find(|p| p.is_file()).map(|p| (name, p)))
}

pub fn start(app: AppHandle, st: AppState, url: String) -> Result<String> {
    let link = track::classify(&url)?;
    if st.busy("track-") {
        return Err(PrismError::Other("A download is already running.".into()));
    }
    let dir = download_dir(&app, &st)?;
    let bin = find_ytdlp(&app)?;
    let job_id = format!("track-{}", uuid::Uuid::new_v4());
    let cancel = st.register(&job_id);
    let jid = job_id.clone();
    std::thread::Builder::new()
        .name("prism-track".into())
        .spawn(move || {
            let emit = |e: TrackEvent| {
                let _ = app.emit("track-download", e);
            };
            let res = run(&bin, &dir, &link, &cancel, &jid, &emit);
            st.unregister(&jid);
            match res {
                Ok(ev) => emit(ev),
                Err(e) => emit(TrackEvent::Error { job_id: jid, error: e.to_app() }),
            }
        })
        .map_err(|e| PrismError::Other(format!("Couldn't start the download: {e}")))?;
    Ok(job_id)
}

fn run(
    bin: &Path,
    dir: &Path,
    link: &track::Link,
    cancel: &prism_core::util::CancelToken,
    jid: &str,
    emit: &dyn Fn(TrackEvent),
) -> Result<TrackEvent> {
    std::fs::create_dir_all(dir)
        .map_err(|e| PrismError::Io(format!("Couldn't create the download folder “{}”: {e}", dir.display())))?;
    let platform = link.platform;
    let mut title: Option<String> = None;
    let mut uploader: Option<String> = None;
    let progress = |stage, title: &Option<String>, uploader: &Option<String>, done, total, speed, eta, fraction| {
        emit(TrackEvent::Progress {
            job_id: jid.into(),
            stage,
            platform,
            title: title.clone(),
            uploader: uploader.clone(),
            fraction,
            done_bytes: done,
            total_bytes: total,
            speed,
            eta_secs: eta,
        })
    };
    progress(TrackStage::Fetch, &title, &uploader, None, None, None, None, None);

    let mut cmd = Command::new(bin);
    let runtime = find_js_runtime();
    cmd.args(track::ytdlp_args(
        &link.url,
        &dir.display().to_string(),
        runtime.as_ref().map(|(n, p)| (*n, p.to_str().unwrap_or_default())),
    ))
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| PrismError::Io(format!("Couldn't start the downloader: {e}")))?;

    // The pipes are read on their own threads so the loop below can watch for cancellation.
    let (tx, rx) = mpsc::channel::<Line>();
    let out = child.stdout.take().expect("piped");
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(std::result::Result::ok) {
            if tx.send(track::parse_line(&line)).is_err() {
                break;
            }
        }
    });
    let err = child.stderr.take().expect("piped");
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.take(32 * 1024).read_to_string(&mut s);
        s
    });

    let mut file: Option<String> = None;
    loop {
        if cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(PrismError::Cancelled);
        }
        match rx.recv_timeout(Duration::from_millis(150)) {
            Ok(Line::Info { title: t, uploader: u }) => {
                title = Some(t).filter(|t| !t.is_empty() && t != "NA");
                uploader = u;
                progress(TrackStage::Download, &title, &uploader, None, None, None, None, Some(0.0));
            }
            Ok(Line::Progress { finished, done, total, speed, eta }) => {
                let stage = if finished { TrackStage::Save } else { TrackStage::Download };
                let fraction = match (done, total) {
                    (Some(d), Some(t)) if t > 0 => Some((d as f32 / t as f32).clamp(0.0, 1.0)),
                    _ if finished => Some(1.0),
                    _ => None,
                };
                progress(stage, &title, &uploader, done, total, speed, eta, fraction);
            }
            Ok(Line::File(p)) => file = Some(p),
            Ok(Line::Other) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = reader.join();
    let status = child.wait().map_err(|e| PrismError::Io(format!("The downloader stopped unexpectedly: {e}")))?;
    let stderr = err_reader.join().unwrap_or_default();

    let path = file.map(PathBuf::from).filter(|p| p.is_file());
    match (status.success(), path) {
        (true, Some(path)) => {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            let title =
                title.unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
            Ok(TrackEvent::Done {
                job_id: jid.into(),
                path: path.display().to_string(),
                title,
                separable: SUPPORTED_EXTENSIONS.contains(&ext.as_str()),
            })
        }
        _ => Err(PrismError::Network(track::friendly_error(&stderr, platform))),
    }
}
