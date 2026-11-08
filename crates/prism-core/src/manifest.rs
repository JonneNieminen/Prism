//! `model.json`: the only thing that describes a model. Nothing in the app is
//! hardcoded to a specific model; stems, colors and export names come from here.
//! Validation is strict: unknown fields, unsafe file names and unsupported
//! architectures are rejected with a message the user can act on.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::adapters;
use crate::{PrismError, Result};

pub const MANIFEST_FILE: &str = "model.json";
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
pub const MAX_WEIGHT_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct ModelManifest {
    #[serde(default = "one")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Selects the adapter (see `adapters::SUPPORTED`).
    pub architecture: String,
    /// One file name, or a list (bag of models / several weight files).
    pub weights: Weights,
    /// Checksum for the single-file `weights` form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub sample_rate: u32,
    pub channels: u32,
    /// In model output order.
    pub stems: Vec<StemDef>,
    pub chunk_seconds: f64,
    pub overlap: f64,
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license_url: Option<String>,
    /// Force the non-commercial flag (otherwise inferred from `license`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub non_commercial: Option<bool>,
    /// Always run on the CPU, never on the GPU / Neural Engine. For models the accelerator path
    /// can't handle (BS-RoFormer needs minutes to compile and then exhausts memory).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpu_only: Option<bool>,
    pub author: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hints: Option<Hints>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<QualityPresets>,
    /// Architecture-specific parameters, validated by the adapter.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    #[ts(type = "Record<string, unknown> | null")]
    pub params: serde_json::Value,
}

fn one() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum Weights {
    Single(String),
    Many(Vec<WeightFile>),
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct WeightFile {
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// Bag of models: how much this file contributes to each stem (len == stems).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stem_weights: Option<Vec<f32>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct StemDef {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// `residual`: computed as mix − the other stems (e.g. MDX "instrumental").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<StemSource>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StemSource {
    Model,
    Residual,
}

/// 1 (slow / basic) … 5 (fast / excellent). Shown as the speed/quality hint.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Hints {
    pub speed: u8,
    pub quality: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct QualityPresets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fast: Option<QualityPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balanced: Option<QualityPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best: Option<QualityPreset>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct QualityPreset {
    /// Random time-shift passes averaged together (Demucs "shifts").
    #[serde(default)]
    pub shifts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overlap: Option<f64>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Quality {
    Fast,
    #[default]
    Balanced,
    Best,
}

impl ModelManifest {
    pub fn weight_files(&self) -> Vec<WeightFile> {
        match &self.weights {
            Weights::Single(f) => vec![WeightFile { file: f.clone(), sha256: self.sha256.clone(), stem_weights: None }],
            Weights::Many(v) => v.clone(),
        }
    }

    pub fn runs_on_cpu_only(&self) -> bool {
        self.cpu_only.unwrap_or(false)
    }

    pub fn is_non_commercial(&self) -> bool {
        self.non_commercial.unwrap_or_else(|| {
            let l = self.license.to_ascii_lowercase();
            l.contains("-nc")
                || l.contains("noncommercial")
                || l.contains("non-commercial")
                || l.contains("research only")
        })
    }

    /// Resolve the preset for a quality level, falling back to the manifest overlap.
    pub fn preset(&self, q: Quality) -> QualityPreset {
        let p = self.quality.as_ref().and_then(|p| match q {
            Quality::Fast => p.fast.clone(),
            Quality::Balanced => p.balanced.clone(),
            Quality::Best => p.best.clone(),
        });
        let mut p = p.unwrap_or(QualityPreset { shifts: 0, overlap: None });
        p.overlap = Some(p.overlap.unwrap_or(self.overlap));
        p
    }

    pub fn supported_qualities(&self) -> Vec<Quality> {
        match &self.quality {
            None => vec![Quality::Balanced],
            Some(p) => {
                let mut v = vec![];
                if p.fast.is_some() {
                    v.push(Quality::Fast);
                }
                v.push(Quality::Balanced);
                if p.best.is_some() {
                    v.push(Quality::Best);
                }
                v
            }
        }
    }

    pub fn from_json(text: &str) -> Result<Self> {
        let m: ModelManifest = serde_json::from_str(text)
            .map_err(|e| PrismError::InvalidModel(format!("model.json is malformed: {e}")))?;
        m.validate()?;
        Ok(m)
    }

    pub fn load(dir: &Path) -> Result<Self> {
        let p = dir.join(MANIFEST_FILE);
        let meta = std::fs::metadata(&p)
            .map_err(|_| PrismError::InvalidModel("The model folder has no model.json.".into()))?;
        if meta.len() > MAX_MANIFEST_BYTES {
            return Err(PrismError::InvalidModel("model.json is too large (max 64 KB).".into()));
        }
        Self::from_json(&std::fs::read_to_string(&p)?)
    }

    pub fn validate(&self) -> Result<()> {
        let bad = |m: String| Err(PrismError::InvalidModel(m));
        if self.schema_version != 1 {
            return bad(format!("Unsupported schemaVersion {} (this Prism understands 1).", self.schema_version));
        }
        if !valid_id(&self.id, 64) {
            return bad(
                "“id” must be 1–64 characters of a–z, 0–9, '.', '_' or '-' and start with a letter or digit.".into()
            );
        }
        check_len("name", &self.name, 1, 80)?;
        check_len("author", &self.author, 1, 120)?;
        check_len("license", &self.license, 1, 64)?;
        check_len("description", &self.description, 0, 500)?;
        if let Some(v) = &self.version {
            check_len("version", v, 1, 32)?;
        }
        for (k, u) in [("licenseUrl", &self.license_url), ("homepage", &self.homepage)] {
            if let Some(u) = u
                && (!u.starts_with("https://") || u.len() > 500)
            {
                return bad(format!("“{k}” must be an https:// URL."));
            }
        }
        if !adapters::SUPPORTED.contains(&self.architecture.as_str()) {
            return bad(format!(
                "Architecture “{}” isn't supported. Supported architectures: {}.",
                self.architecture,
                adapters::SUPPORTED.join(", ")
            ));
        }
        if !(8000..=192_000).contains(&self.sample_rate) {
            return bad("“sampleRate” must be between 8000 and 192000.".into());
        }
        if !(1..=2).contains(&self.channels) {
            return bad("“channels” must be 1 or 2.".into());
        }
        if self.stems.is_empty() || self.stems.len() > 16 {
            return bad("A model must declare between 1 and 16 stems.".into());
        }
        let mut seen = HashSet::new();
        for s in &self.stems {
            if !valid_id(&s.id, 32) {
                return bad(format!("Stem id “{}” is invalid (use a–z, 0–9, '_' or '-').", s.id));
            }
            if !seen.insert(s.id.as_str()) {
                return bad(format!("Stem id “{}” appears twice.", s.id));
            }
            check_len("stem label", &s.label, 1, 40)?;
            if let Some(c) = &s.color
                && !valid_hex_color(c)
            {
                return bad(format!("Stem “{}” color must look like #RRGGBB.", s.id));
            }
        }
        if !(0.5..=120.0).contains(&self.chunk_seconds) {
            return bad("“chunkSeconds” must be between 0.5 and 120.".into());
        }
        if !(0.0..0.95).contains(&self.overlap) {
            return bad("“overlap” must be between 0 and 0.95.".into());
        }
        if let Some(h) = &self.hints
            && (!(1..=5).contains(&h.speed) || !(1..=5).contains(&h.quality))
        {
            return bad("“hints.speed” and “hints.quality” must be 1–5.".into());
        }
        if let Some(q) = &self.quality {
            for p in [&q.fast, &q.balanced, &q.best].into_iter().flatten() {
                if p.shifts > 10 || p.overlap.is_some_and(|o| !(0.0..0.95).contains(&o)) {
                    return bad("Quality presets: “shifts” must be 0–10 and “overlap” 0–0.95.".into());
                }
            }
        }
        let files = self.weight_files();
        if files.is_empty() || files.len() > 8 {
            return bad("“weights” must list 1–8 files.".into());
        }
        if matches!(self.weights, Weights::Many(_)) && self.sha256.is_some() {
            return bad("Put “sha256” on each weights entry when “weights” is a list.".into());
        }
        let mut names = HashSet::new();
        for f in &files {
            check_weight_file_name(&f.file)?;
            if !names.insert(f.file.as_str()) {
                return bad(format!("Weights file “{}” is listed twice.", f.file));
            }
            if let Some(h) = &f.sha256
                && (h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return bad(format!("The sha256 for “{}” must be 64 hex characters.", f.file));
            }
            if let Some(w) = &f.stem_weights
                && (w.len() != self.stems.len() || w.iter().any(|x| !x.is_finite() || *x < 0.0))
            {
                return bad("“stemWeights” must have one non-negative number per stem.".into());
            }
        }
        if !(self.params.is_null() || self.params.is_object()) {
            return bad("“params” must be an object.".into());
        }
        adapters::validate(self)
    }
}

/// Security gate: only formats that cannot execute code on load.
pub fn check_weight_file_name(name: &str) -> Result<()> {
    if !crate::util::is_plain_file_name(name) {
        return Err(PrismError::InvalidModel(format!(
            "Weights file “{name}” must be a plain file name inside the model folder."
        )));
    }
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "onnx" => Ok(()),
        "pt" | "pth" | "th" | "ckpt" | "pkl" | "pickle" | "bin" | "tar" => Err(PrismError::InvalidModel(format!(
            "“{name}” is a PyTorch/pickle checkpoint. These can run arbitrary code when loaded, so Prism refuses them. Convert the model to ONNX first."
        ))),
        "safetensors" => Err(PrismError::InvalidModel(
            "safetensors weights aren't runnable by Prism's ONNX runtime yet. Export the model to ONNX.".into(),
        )),
        _ => Err(PrismError::InvalidModel(format!("“{name}”: weights must be an .onnx file."))),
    }
}

fn valid_id(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
}

fn valid_hex_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn check_len(field: &str, v: &str, min: usize, max: usize) -> Result<()> {
    let n = v.chars().count();
    if n < min || n > max || v.chars().any(|c| c.is_control()) {
        return Err(PrismError::InvalidModel(format!("“{field}” must be {min}–{max} characters.")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> serde_json::Value {
        serde_json::json!({
            "id": "htdemucs", "name": "Demucs", "architecture": "demucs",
            "weights": "htdemucs.onnx", "sampleRate": 44100, "channels": 2,
            "stems": [{"id": "vocals", "label": "Vocals", "color": "#FF5D8F"}],
            "chunkSeconds": 7.8, "overlap": 0.25, "license": "MIT", "author": "Meta AI",
            "description": "x", "params": {"segmentSamples": 343980, "nfft": 4096, "hop": 1024}
        })
    }

    fn check(v: serde_json::Value) -> std::result::Result<ModelManifest, String> {
        ModelManifest::from_json(&v.to_string()).map_err(|e| e.to_string())
    }

    #[test]
    fn accepts_valid() {
        check(base()).unwrap();
    }

    #[test]
    fn rejects_pickles_and_traversal() {
        for w in ["model.th", "evil.ckpt", "../x.onnx", "a/b.onnx"] {
            let mut v = base();
            v["weights"] = w.into();
            assert!(check(v).is_err(), "{w}");
        }
    }

    #[test]
    fn rejects_unknown_architecture_listing_supported() {
        let mut v = base();
        v["architecture"] = "scnet".into();
        let e = check(v).unwrap_err();
        assert!(e.contains("demucs") && e.contains("mdx-net") && e.contains("bs-roformer"), "{e}");
    }

    #[test]
    fn rejects_unknown_fields_and_bad_colors() {
        let mut v = base();
        v["exec"] = "rm -rf".into();
        assert!(check(v).is_err());
        let mut v = base();
        v["stems"][0]["color"] = "red".into();
        assert!(check(v).is_err());
    }

    #[test]
    fn cpu_only_is_optional() {
        assert!(!check(base()).unwrap().runs_on_cpu_only());
        let mut v = base();
        v["cpuOnly"] = true.into();
        assert!(check(v).unwrap().runs_on_cpu_only());
    }

    #[test]
    fn infers_non_commercial() {
        let mut v = base();
        v["license"] = "CC-BY-NC-4.0".into();
        assert!(check(v).unwrap().is_non_commercial());
    }
}
