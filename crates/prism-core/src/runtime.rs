//! ONNX Runtime session creation with hardware acceleration and CPU fallback.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ort::environment::Environment;

use ort::ep::coreml::{ComputeUnits, ModelFormat};
use ort::session::Session;
use ort::session::builder::{AutoDevicePolicy, GraphOptimizationLevel};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{PrismError, Result};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Acceleration {
    /// GPU / Neural Engine when available, else CPU.
    #[default]
    Auto,
    Cpu,
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeOptions {
    pub acceleration: Acceleration,
    /// Where accelerators may cache compiled models (inside the app cache dir).
    pub cache_dir: Option<PathBuf>,
}

pub const CPU_LABEL: &str = "CPU";
pub const ACCELERATED_LABEL: &str = "Apple Silicon (Core ML)";

/// Accelerators can misbehave numerically on some graphs; adapters call this on
/// every output so the caller can retry on CPU.
pub fn ensure_finite(data: &[f32]) -> Result<()> {
    if data.iter().any(|v| !v.is_finite()) {
        return Err(PrismError::Inference(NON_FINITE.into()));
    }
    Ok(())
}
pub const NON_FINITE: &str = "The model produced invalid output on this device.";

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

static ENV: OnceLock<std::result::Result<Environment, String>> = OnceLock::new();

fn env() -> Result<&'static Environment> {
    ENV.get_or_init(|| ort::init().with_name("prism").build().map_err(|e| e.to_string()))
        .as_ref()
        .map_err(|e| PrismError::Inference(format!("Couldn't start ONNX Runtime: {e}")))
}

fn builder() -> Result<ort::session::builder::SessionBuilder> {
    let e = |e: ort::Error| PrismError::Inference(format!("Couldn't start ONNX Runtime: {e}"));
    let b = Session::builder(env()?).map_err(e)?;
    // ort defaults to an automatic EP policy that, on macOS, registers Core ML in a
    // configuration that produces NaNs for Demucs. We always pick EPs explicitly.
    let b = b.with_auto_device(AutoDevicePolicy::PreferCPU).map_err(|x| e(x.into()))?;
    let b = b.with_optimization_level(GraphOptimizationLevel::Level3).map_err(|x| e(x.into()))?;
    b.with_intra_threads(threads()).map_err(|x| e(x.into()))
}

/// Returns the session and a human-readable device label.
pub fn session(path: &Path, opts: &RuntimeOptions) -> Result<(Session, String)> {
    if !path.exists() {
        return Err(PrismError::ModelMissing(format!(
            "The model weights “{}” are missing. Reinstall the model from the Model manager.",
            path.file_name().map(|f| f.to_string_lossy()).unwrap_or_default()
        )));
    }
    if opts.acceleration == Acceleration::Auto
        && let Some(s) = accelerated(path, opts)
    {
        return Ok(s);
    }
    let s = builder()?.commit_from_file(path).map_err(load_err)?;
    Ok((s, CPU_LABEL.into()))
}

#[cfg(target_os = "macos")]
fn accelerated(path: &Path, opts: &RuntimeOptions) -> Option<(Session, String)> {
    let mut ep =
        ort::ep::CoreML::default().with_model_format(ModelFormat::MLProgram).with_compute_units(ComputeUnits::All);
    if let Some(dir) = &opts.cache_dir {
        let _ = std::fs::create_dir_all(dir);
        ep = ep.with_model_cache_dir(dir.display().to_string());
    }
    let b = builder().ok()?;
    let mut b = b.with_execution_providers([ep.build().error_on_failure()]).ok()?;
    match b.commit_from_file(path) {
        Ok(s) => Some((s, ACCELERATED_LABEL.into())),
        Err(e) => {
            eprintln!("[prism] Core ML unavailable, using CPU: {e}");
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn accelerated(_path: &Path, _opts: &RuntimeOptions) -> Option<(Session, String)> {
    // CUDA / DirectML providers can be added here behind cargo features.
    None
}

fn load_err(e: impl std::fmt::Display) -> PrismError {
    PrismError::InvalidModel(format!(
        "The model file couldn't be loaded — it may be corrupt or not a valid ONNX model ({e})."
    ))
}
