//! BS-RoFormer / Mel-Band RoFormer style ONNX models with the STFT stripped out.
//!
//! The graph takes the complex spectrogram of a fixed-length chunk as two tensors,
//! `spec_real` and `spec_imag` of shape `[1, 2, bins, T]` (2 = left/right), and returns the
//! already-masked spectrogram of every stem: `out_spec_real` / `out_spec_imag`, shape
//! `[1, stems, 2, bins, T]`. The host does the STFT (torch-style, centred, periodic Hann), the
//! inverse STFT, the chunking and the overlap-add; stems come out in the order the manifest lists
//! them (for BS-RoFormer-SW: bass, drums, other, vocals, guitar, piano).
//!
//! `T` is fixed by the chunk length (`1 + chunkSamples / hop`): rotary embeddings are cached for
//! one sequence length, so every chunk, including the last, is zero-padded to full length.

use std::path::Path;

use ort::session::Session;
use realfft::num_complex::Complex32;
use serde::Deserialize;

use super::common::{params, run_f32};
use crate::audio::Audio;
use crate::dsp::{Spec, Stft, hann, pad_reflect};
use crate::manifest::{ModelManifest, StemSource};
use crate::runtime::{LoadStep, RuntimeOptions, session};
use crate::separator::{SeparateOptions, Separator, StemOutput};
use crate::util::CancelToken;
use crate::{PrismError, Result};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    n_fft: usize,
    hop: usize,
    /// Samples per model chunk (176 400 = 4 s at 44.1 kHz for BS-RoFormer-SW).
    chunk_samples: usize,
}

pub fn validate(m: &ModelManifest) -> Result<()> {
    let p: Params = params(m)?;
    let bad = |s: &str| Err(PrismError::InvalidModel(format!("RoFormer params: {s}")));
    if p.n_fft < 512 || p.n_fft > 16384 || !p.n_fft.is_multiple_of(2) {
        return bad("nFft must be an even number between 512 and 16384");
    }
    if p.hop == 0 || p.hop > p.n_fft {
        return bad("hop must be between 1 and nFft");
    }
    if p.chunk_samples < p.n_fft * 2 || p.chunk_samples > 60 * m.sample_rate as usize {
        return bad("chunkSamples must be at least 2 × nFft and at most 60 s");
    }
    if m.channels != 2 {
        return bad("RoFormer models are stereo (channels = 2)");
    }
    if m.stems.iter().any(|s| s.source == Some(StemSource::Residual)) {
        return bad("list every stem the model outputs, in output order; residual stems aren't supported");
    }
    if m.weight_files().len() != 1 {
        return bad("RoFormer models have exactly one weights file");
    }
    Ok(())
}

pub struct RoFormer {
    manifest: ModelManifest,
    sess: Session,
    stft: Stft,
    p: Params,
    device: String,
}

impl RoFormer {
    pub fn new(m: &ModelManifest, dir: &Path, rt: &RuntimeOptions, on_step: &mut dyn FnMut(LoadStep)) -> Result<Self> {
        let p: Params = params(m)?;
        let wf = m.weight_files();
        let path = dir.join(&wf[0].file);
        let bytes = std::fs::metadata(&path).map_or(0, |m| m.len());
        on_step(LoadStep { index: 0, total: 1, stem: None, file: wf[0].file.clone(), bytes });
        let (sess, device) = session(&path, rt)?;
        let stft = Stft::new(p.n_fft, p.hop, false);
        Ok(RoFormer { manifest: m.clone(), sess, stft, p, device })
    }

    /// Run the model on exactly one chunk (`[2][chunk_samples]`) and return `[stem][2][chunk_samples]`.
    /// Public for the parity test, which compares it to the PyTorch reference chunk.
    #[doc(hidden)]
    pub fn infer_chunk(&mut self, x: &[Vec<f32>]) -> Result<Vec<Vec<Vec<f32>>>> {
        let chunk = self.p.chunk_samples;
        let bins = self.stft.bins();
        let stems = self.manifest.stems.len();
        let t = self.stft.frames_for(chunk);
        let mut real = vec![0f32; 2 * bins * t];
        let mut imag = vec![0f32; 2 * bins * t];
        for (ch, xc) in x.iter().enumerate().take(2) {
            let z = self.stft.forward(xc);
            if z.frames != t {
                return Err(PrismError::InvalidModel(format!("The chunk gave {} frames, expected {t}.", z.frames)));
            }
            for f in 0..bins {
                for fr in 0..t {
                    let c = z.at(fr, f);
                    real[(ch * bins + f) * t + fr] = c.re;
                    imag[(ch * bins + f) * t + fr] = c.im;
                }
            }
        }
        let shape = [1, 2, bins as i64, t as i64];
        let names: Vec<String> = self.sess.inputs().iter().map(|i| i.name().to_string()).collect();
        let (n_re, n_im) = (name_like(&names, "real", 0), name_like(&names, "imag", 1));
        let out_names: Vec<String> = self.sess.outputs().iter().map(|o| o.name().to_string()).collect();
        let outs = run_f32(&mut self.sess, &[(n_re.as_str(), &shape, &real), (n_im.as_str(), &shape, &imag)])?;
        let (i_re, i_im) = (index_like(&out_names, "real", 0), index_like(&out_names, "imag", 1));
        let (sh, out_re) = &outs[i_re];
        let out_im = &outs[i_im].1;
        let want = [1, stems as i64, 2, bins as i64, t as i64];
        if sh.as_slice() != want {
            return Err(PrismError::InvalidModel(format!(
                "The model's output has shape {sh:?}, but model.json lists {stems} stems (expected {want:?}). Check the stems, nFft and chunkSamples."
            )));
        }
        let mut result = Vec::with_capacity(stems);
        for s in 0..stems {
            let mut per_ch = Vec::with_capacity(2);
            for ch in 0..2 {
                let mut z = Spec::zeros(t, bins);
                for f in 0..bins {
                    for fr in 0..t {
                        let i = (((s * 2 + ch) * bins) + f) * t + fr;
                        *z.at_mut(fr, f) = Complex32::new(out_re[i], out_im[i]);
                    }
                }
                per_ch.push(self.stft.inverse(&z, chunk));
            }
            result.push(per_ch);
        }
        Ok(result)
    }
}

fn name_like(names: &[String], needle: &str, fallback: usize) -> String {
    names
        .iter()
        .find(|n| n.to_ascii_lowercase().contains(needle))
        .or_else(|| names.get(fallback))
        .cloned()
        .unwrap_or_default()
}

fn index_like(names: &[String], needle: &str, fallback: usize) -> usize {
    names.iter().position(|n| n.to_ascii_lowercase().contains(needle)).unwrap_or(fallback)
}

impl Separator for RoFormer {
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
        let overlap = opts.preset(&self.manifest).overlap.unwrap_or(self.manifest.overlap).clamp(0.0, 0.9);
        let chunk = self.p.chunk_samples;
        let step = (((1.0 - overlap) * chunk as f64) as usize).clamp(1, chunk);
        let n = audio.frames();
        let stems = self.manifest.stems.len();
        // Reflect-pad so the quiet edges of the first and last windows fall outside the song.
        let border = chunk - step;
        let padded: Vec<Vec<f32>> = audio.channels.iter().map(|c| pad_reflect(c, border, border)).collect();
        let total = n + 2 * border;
        let window: Vec<f32> = hann(chunk).into_iter().map(|w| w.max(1e-4)).collect();
        let n_chunks = total.saturating_sub(border).div_ceil(step).max(1);

        let mut sum = vec![vec![vec![0f32; total]; 2]; stems];
        let mut weight = vec![0f32; total];
        let (mut i, mut k) = (0usize, 0usize);
        while i + border < total || k == 0 {
            cancel.check()?;
            let end = (i + chunk).min(total);
            let part: Vec<Vec<f32>> = padded
                .iter()
                .map(|c| {
                    let mut v = c[i..end].to_vec();
                    v.resize(chunk, 0.0);
                    v
                })
                .collect();
            let y = self.infer_chunk(&part)?;
            for (s, per_ch) in y.iter().enumerate() {
                for (ch, yc) in per_ch.iter().enumerate() {
                    for j in 0..end - i {
                        sum[s][ch][i + j] += yc[j] * window[j];
                    }
                }
            }
            for j in 0..end - i {
                weight[i + j] += window[j];
            }
            k += 1;
            progress((k as f32 / n_chunks as f32).min(1.0));
            i += step;
        }
        Ok(self
            .manifest
            .stems
            .iter()
            .enumerate()
            .map(|(s, def)| StemOutput {
                id: def.id.clone(),
                audio: Audio {
                    sample_rate: self.manifest.sample_rate,
                    channels: (0..2)
                        .map(|ch| (0..n).map(|j| sum[s][ch][border + j] / weight[border + j].max(1e-8)).collect())
                        .collect(),
                },
            })
            .collect())
    }
}
