//! The `Separator` interface. Every model architecture implements it; the UI,
//! player, export and library only ever see [`StemOutput`]s and manifest data.

use std::time::Instant;

use serde::Serialize;
use ts_rs::TS;

use crate::audio::Audio;
use crate::manifest::{ModelManifest, Quality, StemSource};
use crate::models::InstalledModel;
use crate::runtime::RuntimeOptions;
use crate::util::CancelToken;
use crate::{PrismError, Result, adapters};

#[derive(Clone, Debug, Default)]
pub struct SeparateOptions {
    pub quality: Quality,
    /// Overrides the manifest preset (tests / benchmarks).
    pub preset_override: Option<crate::manifest::QualityPreset>,
}

impl SeparateOptions {
    pub fn preset(&self, m: &ModelManifest) -> crate::manifest::QualityPreset {
        self.preset_override.clone().unwrap_or_else(|| m.preset(self.quality))
    }
}

pub struct StemOutput {
    pub id: String,
    pub audio: Audio,
}

/// `load` = [`load`] (adapters are constructed from an installed model);
/// `cancel` = trigger the [`CancelToken`] passed to `separate`.
pub trait Separator: Send {
    fn manifest(&self) -> &ModelManifest;
    /// Label of the device actually used ("CPU", "Apple GPU / Neural Engine (Core ML)").
    fn device(&self) -> &str;
    /// `audio` is already at the manifest's sample rate / channel count.
    /// Must return every stem whose `source` is not `residual`, in any order.
    /// `progress` receives 0..=1 for this call.
    fn separate(
        &mut self,
        audio: &Audio,
        opts: &SeparateOptions,
        progress: &mut dyn FnMut(f32),
        cancel: &CancelToken,
    ) -> Result<Vec<StemOutput>>;
}

pub fn load(model: &InstalledModel, rt: &RuntimeOptions) -> Result<Box<dyn Separator>> {
    adapters::create(&model.manifest, &model.dir, rt)
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Progress {
    /// 0..=1 for the separation step.
    pub fraction: f32,
    pub elapsed_secs: f32,
    pub eta_secs: Option<f32>,
}

/// Rough memory check before we start (stems + working buffers + model).
pub fn check_memory(manifest: &ModelManifest, frames: usize) -> Result<()> {
    let stems = manifest.stems.len() as u64;
    let ch = manifest.channels as u64;
    let need = frames as u64 * ch * 4 * (stems * 2 + 4) + 1_500_000_000;
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let avail = sys.available_memory().max(sys.free_memory());
    if avail > 0 && need > avail.saturating_add(sys.total_memory() / 4) {
        return Err(PrismError::OutOfMemory(format!(
            "This track needs about {:.1} GB of memory but only {:.1} GB is free. Close other apps or trim the track.",
            need as f64 / 1e9,
            avail as f64 / 1e9
        )));
    }
    Ok(())
}

/// Runs a separator with ETA reporting and fills in `residual` stems, returning
/// stems in manifest order.
pub fn run(
    sep: &mut dyn Separator,
    audio: &Audio,
    opts: &SeparateOptions,
    on_progress: &mut dyn FnMut(Progress),
    cancel: &CancelToken,
) -> Result<Vec<StemOutput>> {
    check_memory(sep.manifest(), audio.frames())?;
    let start = Instant::now();
    let mut eta_smooth: Option<f32> = None;
    let mut report = |f: f32| {
        let el = start.elapsed().as_secs_f32();
        let eta = if f > 0.02 {
            let raw = el / f * (1.0 - f);
            let e = eta_smooth.map_or(raw, |p| p * 0.7 + raw * 0.3);
            eta_smooth = Some(e);
            Some(e)
        } else {
            None
        };
        on_progress(Progress { fraction: f.clamp(0.0, 1.0), elapsed_secs: el, eta_secs: eta });
    };
    report(0.0);
    let mut produced = sep.separate(audio, opts, &mut report, cancel)?;
    cancel.check()?;
    let manifest = sep.manifest().clone();
    let mut out = Vec::with_capacity(manifest.stems.len());
    for def in &manifest.stems {
        if def.source == Some(StemSource::Residual) {
            let mut res = audio.clone();
            for s in &produced {
                for (r, c) in res.channels.iter_mut().zip(&s.audio.channels) {
                    r.iter_mut().zip(c).for_each(|(a, b)| *a -= b);
                }
            }
            out.push(StemOutput { id: def.id.clone(), audio: res });
        } else {
            let i = produced
                .iter()
                .position(|s| s.id == def.id)
                .ok_or_else(|| PrismError::Inference(format!("The model didn't produce the “{}” stem.", def.id)))?;
            out.push(produced.swap_remove(i));
        }
    }
    report(1.0);
    Ok(out)
}
