//! Hybrid Transformer Demucs (htdemucs, htdemucs_6s, htdemucs_ft).
//!
//! Port of `demucs.apply.apply_model` (shifts, split, overlap, triangular
//! weights, bag of models) with the spectrogram front/back end in Rust. The ONNX
//! graph contract is documented in `tools/export/export_demucs.py`.

use std::path::Path;

use ort::session::Session;
use serde::Deserialize;

use super::common::{params, run_f32};
use crate::audio::Audio;
use crate::dsp::{Spec, Stft, pad_reflect};
use crate::manifest::{ModelManifest, StemSource};
use crate::runtime::{RuntimeOptions, session};
use crate::separator::{SeparateOptions, Separator, StemOutput};
use crate::util::{CancelToken, Rng};
use crate::{PrismError, Result};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    /// Fixed input length of the graph, `int(segment * sampleRate)`.
    segment_samples: usize,
    #[serde(default = "nfft")]
    nfft: usize,
    #[serde(default = "hop")]
    hop: usize,
}
fn nfft() -> usize {
    4096
}
fn hop() -> usize {
    1024
}

pub fn validate(m: &ModelManifest) -> Result<()> {
    let p: Params = params(m)?;
    let bad = |s: &str| Err(PrismError::InvalidModel(format!("Demucs params: {s}")));
    if !p.nfft.is_power_of_two() || p.nfft < 256 || p.nfft > 16384 {
        return bad("nfft must be a power of two between 256 and 16384");
    }
    if p.hop * 4 != p.nfft {
        return bad("hop must be nfft / 4");
    }
    if p.segment_samples < p.nfft * 2 || p.segment_samples > 60 * m.sample_rate as usize {
        return bad("segmentSamples is out of range");
    }
    if m.channels != 2 {
        return bad("Demucs models are stereo (channels = 2)");
    }
    if m.stems.iter().any(|s| s.source == Some(StemSource::Residual)) {
        return bad("Demucs predicts every stem; residual stems aren't allowed");
    }
    Ok(())
}

pub struct Demucs {
    manifest: ModelManifest,
    /// One session per bag member, with its per-stem weights.
    models: Vec<(Session, Vec<f32>)>,
    stft: Stft,
    seg: usize,
    device: String,
}

impl Demucs {
    pub fn new(m: &ModelManifest, dir: &Path, rt: &RuntimeOptions) -> Result<Self> {
        let p: Params = params(m)?;
        let mut models = Vec::new();
        let mut device = String::new();
        for wf in m.weight_files() {
            let (s, d) = session(&dir.join(&wf.file), rt)?;
            device = d;
            let w = wf.stem_weights.clone().unwrap_or_else(|| vec![1.0; m.stems.len()]);
            models.push((s, w));
        }
        Ok(Demucs { manifest: m.clone(), models, stft: Stft::new(p.nfft, p.hop, true), seg: p.segment_samples, device })
    }

    fn le(&self) -> usize {
        self.seg.div_ceil(self.stft.hop)
    }

    /// One fixed-size chunk through the graph: `[2][seg]` → `[S][2][seg]`.
    fn run_chunk(&self, sess: &mut Session, x: &[Vec<f32>]) -> Result<Vec<Vec<Vec<f32>>>> {
        let (seg, hop, le) = (self.seg, self.stft.hop, self.le());
        let bins = self.stft.n_fft / 2; // last bin dropped
        let pad = hop / 2 * 3;
        let mut spec = vec![0f32; 4 * bins * le];
        let mut mix = Vec::with_capacity(2 * seg);
        for (ch, xc) in x.iter().enumerate() {
            mix.extend_from_slice(xc);
            let padded = pad_reflect(xc, pad, pad + le * hop - seg);
            let z = self.stft.forward(&padded);
            debug_assert_eq!(z.frames, le + 4);
            for f in 0..bins {
                for t in 0..le {
                    let c = z.at(t + 2, f);
                    spec[((ch * 2) * bins + f) * le + t] = c.re;
                    spec[((ch * 2 + 1) * bins + f) * le + t] = c.im;
                }
            }
        }
        let outs = run_f32(
            sess,
            &[("mix", &[1, 2, seg as i64], &mix), ("spec", &[1, 4, bins as i64, le as i64], &spec)],
        )?;
        let (freq, time) = (&outs[0], &outs[1]);
        let s_count = time.0[1] as usize;
        if s_count != self.manifest.stems.len() || freq.0[1] as usize != s_count {
            return Err(PrismError::InvalidModel(format!(
                "The model outputs {s_count} stems but model.json declares {}.",
                self.manifest.stems.len()
            )));
        }
        let le2 = hop * le + 2 * pad;
        let mut out = vec![vec![vec![0f32; seg]; 2]; s_count];
        for (s, os) in out.iter_mut().enumerate() {
            for (ch, oc) in os.iter_mut().enumerate() {
                let mut z = Spec::zeros(le + 4, bins + 1);
                let base = (s * 4 + ch * 2) * bins * le;
                for f in 0..bins {
                    for t in 0..le {
                        let re = freq.1[base + f * le + t];
                        let im = freq.1[base + bins * le + f * le + t];
                        *z.at_mut(t + 2, f) = realfft::num_complex::Complex32::new(re, im);
                    }
                }
                let y = self.stft.inverse(&z, le2);
                let tbase = (s * 2 + ch) * seg;
                for i in 0..seg {
                    oc[i] = y[pad + i] + time.1[tbase + i];
                }
            }
        }
        Ok(out)
    }

    /// `apply_model(split=True)` over `data[.., base..base+len]`, where chunk
    /// padding may read neighbouring samples of `data` (TensorChunk semantics).
    #[allow(clippy::too_many_arguments)]
    fn split(
        &self,
        sess: &mut Session,
        data: &[Vec<f32>],
        base: usize,
        len: usize,
        overlap: f64,
        tick: &mut dyn FnMut() -> Result<()>,
    ) -> Result<Vec<Vec<Vec<f32>>>> {
        let seg = self.seg;
        let s_count = self.manifest.stems.len();
        let stride = (((1.0 - overlap) * seg as f64) as usize).max(1);
        let half = seg / 2;
        let mut weight: Vec<f32> = (1..=half).map(|v| v as f32).collect();
        weight.extend((1..=seg - half).rev().map(|v| v as f32));
        let wmax = weight.iter().cloned().fold(0f32, f32::max);
        weight.iter_mut().for_each(|w| *w /= wmax);

        let mut out = vec![vec![vec![0f32; len]; 2]; s_count];
        let mut sum_w = vec![0f32; len];
        let total = data[0].len();
        let mut off = 0;
        while off < len {
            let chunk_len = seg.min(len - off);
            let delta = seg - chunk_len;
            let start = (base + off) as i64 - (delta / 2) as i64;
            let padded: Vec<Vec<f32>> = data
                .iter()
                .map(|c| {
                    (0..seg as i64)
                        .map(|i| {
                            let j = start + i;
                            if j >= 0 && (j as usize) < total { c[j as usize] } else { 0.0 }
                        })
                        .collect()
                })
                .collect();
            let y = self.run_chunk(sess, &padded)?;
            let trim = delta / 2;
            for (s, ys) in y.iter().enumerate() {
                for (ch, yc) in ys.iter().enumerate() {
                    let o = &mut out[s][ch][off..off + chunk_len];
                    for i in 0..chunk_len {
                        o[i] += weight[i] * yc[trim + i];
                    }
                }
            }
            for i in 0..chunk_len {
                sum_w[off + i] += weight[i];
            }
            tick()?;
            off += stride;
        }
        for os in out.iter_mut() {
            for oc in os.iter_mut() {
                oc.iter_mut().zip(&sum_w).for_each(|(v, w)| *v /= w.max(1e-12));
            }
        }
        Ok(out)
    }

    fn chunks(&self, len: usize, overlap: f64) -> usize {
        let stride = (((1.0 - overlap) * self.seg as f64) as usize).max(1);
        len.div_ceil(stride)
    }
}

impl Separator for Demucs {
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
        let preset = opts.preset(&self.manifest);
        let shifts = preset.shifts as usize;
        let overlap = preset.overlap.unwrap_or(self.manifest.overlap);
        let n = audio.frames();
        let s_count = self.manifest.stems.len();
        let sr = self.manifest.sample_rate as usize;
        let max_shift = sr / 2;

        // Whole-track normalisation, as `demucs.separate` does.
        let mono: Vec<f32> = (0..n).map(|i| (audio.channels[0][i] + audio.channels[1][i]) * 0.5).collect();
        let mean = mono.iter().map(|&v| v as f64).sum::<f64>() / n as f64;
        let var = mono.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / (n.max(2) - 1) as f64;
        let std = var.sqrt().max(1e-8);
        let (meanf, stdf) = (mean as f32, std as f32);
        let wav: Vec<Vec<f32>> =
            audio.channels.iter().map(|c| c.iter().map(|&v| (v - meanf) / stdf).collect()).collect();

        let per_pass = if shifts > 0 { self.chunks(n + max_shift, overlap) } else { self.chunks(n, overlap) };
        let total_units = (self.models.len() * shifts.max(1) * per_pass).max(1);
        let mut done = 0usize;

        let mut est = vec![vec![vec![0f32; n]; 2]; s_count];
        let mut totals = vec![0f32; s_count];
        let mut rng = Rng::new(0x5EED_0F_D3C0D5 ^ n as u64);
        let mut models = std::mem::take(&mut self.models);
        let result = (|| -> Result<()> {
            for (sess, w) in models.iter_mut() {
                let mut tick = || -> Result<()> {
                    cancel.check()?;
                    done += 1;
                    progress(done as f32 / total_units as f32);
                    Ok(())
                };
                let out = if shifts > 0 {
                    let padded: Vec<Vec<f32>> = wav
                        .iter()
                        .map(|c| {
                            let mut p = vec![0f32; max_shift];
                            p.extend_from_slice(c);
                            p.extend(std::iter::repeat_n(0.0, max_shift));
                            p
                        })
                        .collect();
                    let mut acc = vec![vec![vec![0f32; n]; 2]; s_count];
                    for _ in 0..shifts {
                        let offset = rng.below_incl(max_shift);
                        let len = n + max_shift - offset;
                        let o = self.split(sess, &padded, offset, len, overlap, &mut tick)?;
                        for (a, os) in acc.iter_mut().zip(&o) {
                            for (ac, oc) in a.iter_mut().zip(os) {
                                let src = &oc[max_shift - offset..max_shift - offset + n];
                                ac.iter_mut().zip(src).for_each(|(x, y)| *x += y);
                            }
                        }
                    }
                    let inv = 1.0 / shifts as f32;
                    acc.iter_mut().flatten().flatten().for_each(|v| *v *= inv);
                    acc
                } else {
                    self.split(sess, &wav, 0, n, overlap, &mut tick)?
                };
                for (k, os) in out.into_iter().enumerate() {
                    if w[k] == 0.0 {
                        continue;
                    }
                    totals[k] += w[k];
                    for (e, oc) in est[k].iter_mut().zip(os) {
                        e.iter_mut().zip(oc).for_each(|(x, y)| *x += y * w[k]);
                    }
                }
            }
            Ok(())
        })();
        self.models = models;
        result?;

        let sr = self.manifest.sample_rate;
        Ok(est
            .into_iter()
            .zip(&self.manifest.stems)
            .zip(totals)
            .map(|((mut chans, def), t)| {
                let k = if t > 0.0 { 1.0 / t } else { 0.0 };
                chans.iter_mut().flatten().for_each(|v| *v = *v * k * stdf + meanf * (t > 0.0) as u8 as f32);
                StemOutput { id: def.id.clone(), audio: Audio { sample_rate: sr, channels: chans } }
            })
            .collect())
    }
}
