//! MDX-Net (ONNX, as used by Ultimate Vocal Remover).
//!
//! The graph maps a complex-as-channels spectrogram `[1, 4, dimF, dimT]` to the
//! spectrogram of one target stem. Port of UVR's `SeperateMDX.demix`: hanning
//! windowed overlap-add over `hop * (dimT - 1)` sample chunks, low bins zeroed,
//! optional "denoise" (average of f(x) and −f(−x)), then `compensate` gain.
//! The complementary stem is declared with `"source": "residual"`.

use std::path::Path;

use ort::session::Session;
use realfft::num_complex::Complex32;
use serde::Deserialize;

use super::common::{input_names, params, run_f32};
use crate::audio::Audio;
use crate::dsp::{Spec, Stft};
use crate::manifest::{ModelManifest, StemSource};
use crate::runtime::{LoadStep, RuntimeOptions, session};
use crate::separator::{SeparateOptions, Separator, StemOutput};
use crate::util::CancelToken;
use crate::{PrismError, Result};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    n_fft: usize,
    #[serde(default = "hop")]
    hop: usize,
    dim_f: usize,
    /// Frames per chunk (UVR's 2^dim_t_set, typically 256).
    dim_t: usize,
    #[serde(default = "one")]
    compensate: f32,
    #[serde(default)]
    denoise: bool,
}
fn hop() -> usize {
    1024
}
fn one() -> f32 {
    1.0
}

pub fn validate(m: &ModelManifest) -> Result<()> {
    let p: Params = params(m)?;
    let bad = |s: &str| Err(PrismError::InvalidModel(format!("MDX-Net params: {s}")));
    if p.n_fft < 512 || p.n_fft > 16384 || !p.n_fft.is_multiple_of(2) {
        return bad("nFft must be an even number between 512 and 16384");
    }
    if p.dim_f == 0 || p.dim_f > p.n_fft / 2 + 1 {
        return bad("dimF must be between 1 and nFft/2 + 1");
    }
    if p.dim_t < 8 || p.dim_t > 2048 || p.hop == 0 || p.hop * (p.dim_t - 1) <= p.n_fft {
        return bad("dimT/hop give a chunk shorter than nFft");
    }
    if !(0.5..=2.0).contains(&p.compensate) {
        return bad("compensate must be between 0.5 and 2.0");
    }
    if m.channels != 2 {
        return bad("MDX-Net models are stereo (channels = 2)");
    }
    let primary = m.stems.iter().filter(|s| s.source != Some(StemSource::Residual)).count();
    if primary != 1 {
        return bad("declare exactly one model stem; mark the other as \"source\": \"residual\"");
    }
    Ok(())
}

pub struct MdxNet {
    manifest: ModelManifest,
    sess: Session,
    input: String,
    stft: Stft,
    p: Params,
    device: String,
}

impl MdxNet {
    pub fn new(m: &ModelManifest, dir: &Path, rt: &RuntimeOptions, on_step: &mut dyn FnMut(LoadStep)) -> Result<Self> {
        let p: Params = params(m)?;
        let wf = m.weight_files();
        if wf.len() != 1 {
            return Err(PrismError::InvalidModel("MDX-Net models have exactly one weights file.".into()));
        }
        let bytes = std::fs::metadata(dir.join(&wf[0].file)).map_or(0, |m| m.len());
        on_step(LoadStep { index: 0, total: 1, stem: None, file: wf[0].file.clone(), bytes });
        let (sess, device) = session(&dir.join(&wf[0].file), rt)?;
        let input = input_names(&sess).into_iter().next().unwrap_or_else(|| "input".into());
        Ok(MdxNet { manifest: m.clone(), sess, input, stft: Stft::new(p.n_fft, p.hop, false), p, device })
    }

    fn chunk_size(&self) -> usize {
        self.p.hop * (self.p.dim_t - 1)
    }

    fn model(&mut self, spec: &[f32]) -> Result<Vec<f32>> {
        let shape = [1, 4, self.p.dim_f as i64, self.p.dim_t as i64];
        let mut outs = run_f32(&mut self.sess, &[(self.input.as_str(), &shape, spec)])?;
        let (sh, data) = outs.swap_remove(0);
        if sh.iter().product::<i64>() as usize != spec.len() {
            return Err(PrismError::InvalidModel(format!(
                "MDX-Net output shape {sh:?} doesn't match input {shape:?} — check dimF/dimT in model.json."
            )));
        }
        Ok(data)
    }

    /// `[2][chunk]` → `[2][chunk]` target waveform.
    fn run_chunk(&mut self, x: &[Vec<f32>]) -> Result<Vec<Vec<f32>>> {
        let (df, dt) = (self.p.dim_f, self.p.dim_t);
        let mut spec = vec![0f32; 4 * df * dt];
        for (ch, xc) in x.iter().enumerate() {
            let z = self.stft.forward(xc);
            for f in 3.min(df)..df {
                for t in 0..dt.min(z.frames) {
                    let c = z.at(t, f);
                    spec[((ch * 2) * df + f) * dt + t] = c.re;
                    spec[((ch * 2 + 1) * df + f) * dt + t] = c.im;
                }
            }
        }
        let mut pred = self.model(&spec)?;
        if self.p.denoise {
            let neg: Vec<f32> = spec.iter().map(|v| -v).collect();
            let pn = self.model(&neg)?;
            pred.iter_mut().zip(pn).for_each(|(a, b)| *a = 0.5 * *a - 0.5 * b);
        }
        let bins = self.stft.bins();
        let len = self.chunk_size();
        Ok((0..2)
            .map(|ch| {
                let mut z = Spec::zeros(dt, bins);
                for f in 0..df {
                    for t in 0..dt {
                        let re = pred[((ch * 2) * df + f) * dt + t];
                        let im = pred[((ch * 2 + 1) * df + f) * dt + t];
                        *z.at_mut(t, f) = Complex32::new(re, im);
                    }
                }
                self.stft.inverse(&z, len)
            })
            .collect())
    }
}

impl Separator for MdxNet {
    fn manifest(&self) -> &ModelManifest {
        &self.manifest
    }
    fn device(&self) -> &str {
        &self.device
    }

    fn separate(
        &mut self,
        audio: &Audio,
        opts: &SeparateOptions,
        progress: &mut dyn FnMut(f32),
        cancel: &CancelToken,
    ) -> Result<Vec<StemOutput>> {
        let overlap = opts.preset(&self.manifest).overlap.unwrap_or(self.manifest.overlap);
        let n = audio.frames();
        let chunk = self.chunk_size();
        let trim = self.p.n_fft / 2;
        let gen_size = chunk - 2 * trim;
        let pad = gen_size + trim - (n % gen_size);
        let total = trim + n + pad;
        let mixture: Vec<Vec<f32>> = audio
            .channels
            .iter()
            .map(|c| {
                let mut m = vec![0f32; trim];
                m.extend_from_slice(c);
                m.resize(total, 0.0);
                m
            })
            .collect();
        let step = (((1.0 - overlap) * chunk as f64) as usize).clamp(1, chunk);
        let n_chunks = total.div_ceil(step).max(1);
        let mut result = vec![vec![0f32; total]; 2];
        let mut divider = vec![0f32; total];
        let mut i = 0;
        let mut k = 0;
        while i < total {
            cancel.check()?;
            let end = (i + chunk).min(total);
            let actual = end - i;
            // np.hanning (symmetric)
            let window: Vec<f32> = if actual > 1 {
                (0..actual)
                    .map(|j| (0.5 - 0.5 * (std::f64::consts::TAU * j as f64 / (actual - 1) as f64).cos()) as f32)
                    .collect()
            } else {
                vec![1.0]
            };
            let part: Vec<Vec<f32>> = mixture
                .iter()
                .map(|c| {
                    let mut v = c[i..end].to_vec();
                    v.resize(chunk, 0.0);
                    v
                })
                .collect();
            let y = self.run_chunk(&part)?;
            for ch in 0..2 {
                for j in 0..actual {
                    result[ch][i + j] += y[ch][j] * window[j];
                }
            }
            for j in 0..actual {
                divider[i + j] += window[j];
            }
            k += 1;
            progress(k as f32 / n_chunks as f32);
            i += step;
        }
        let comp = self.p.compensate;
        let channels: Vec<Vec<f32>> =
            result.iter().map(|r| (0..n).map(|j| r[trim + j] / divider[trim + j].max(1e-8) * comp).collect()).collect();
        let def = self.manifest.stems.iter().find(|s| s.source != Some(StemSource::Residual)).unwrap();
        Ok(vec![StemOutput { id: def.id.clone(), audio: Audio { sample_rate: self.manifest.sample_rate, channels } }])
    }
}
