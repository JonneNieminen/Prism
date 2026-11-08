//! Architecture adapters: the pre/post-processing (chunking, STFT, overlap-add)
//! for a family of models. The manifest's `architecture` picks one.
//!
//! `roformer` runs BS-RoFormer / Mel-Band RoFormer exports with the STFT outside the graph.
//!
//! ## Adding an architecture (e.g. another RoFormer variant)
//! 1. Create `adapters/<name>.rs` with `validate(&ModelManifest)` (check `params`)
//!    and a type implementing [`crate::separator::Separator`].
//! 2. Add the name to [`SUPPORTED`] and a match arm in [`validate`] and [`create`].
//! 3. Reuse [`crate::dsp::Stft`] and [`crate::runtime::session`]; add a parity
//!    test against the reference implementation. See README "Adding your own model".

use std::path::Path;

use crate::manifest::ModelManifest;
use crate::runtime::{LoadStep, RuntimeOptions};
use crate::separator::Separator;
use crate::{PrismError, Result};

pub mod common;
pub mod demucs;
pub mod mdx;
pub mod roformer;

pub const SUPPORTED: &[&str] = &["demucs", "mdx-net", "bs-roformer"];

pub fn validate(m: &ModelManifest) -> Result<()> {
    match m.architecture.as_str() {
        "demucs" => demucs::validate(m),
        "mdx-net" => mdx::validate(m),
        "bs-roformer" => roformer::validate(m),
        other => Err(PrismError::InvalidModel(format!("Unsupported architecture “{other}”."))),
    }
}

pub fn create(
    m: &ModelManifest,
    dir: &Path,
    rt: &RuntimeOptions,
    on_step: &mut dyn FnMut(LoadStep),
) -> Result<Box<dyn Separator>> {
    // A model flagged `cpuOnly` never goes near the accelerator, whatever the caller asked for.
    let cpu = RuntimeOptions { acceleration: crate::runtime::Acceleration::Cpu, ..rt.clone() };
    let rt = if m.runs_on_cpu_only() { &cpu } else { rt };
    Ok(match m.architecture.as_str() {
        "demucs" => Box::new(demucs::Demucs::new(m, dir, rt, on_step)?),
        "mdx-net" => Box::new(mdx::MdxNet::new(m, dir, rt, on_step)?),
        "bs-roformer" => Box::new(roformer::RoFormer::new(m, dir, rt, on_step)?),
        other => return Err(PrismError::InvalidModel(format!("Unsupported architecture “{other}”."))),
    })
}
