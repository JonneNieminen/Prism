//! Torch-compatible STFT / iSTFT, done outside the ONNX graphs.
//!
//! Matches `torch.stft(center=True, pad_mode="reflect", window=hann_window(n_fft))`
//! and `torch.istft(center=True)`; `normalized` scales by `n_fft^-0.5` like torch.

use std::sync::Arc;

use realfft::num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};

pub struct Stft {
    pub n_fft: usize,
    pub hop: usize,
    pub normalized: bool,
    window: Vec<f32>,
    fwd: Arc<dyn RealToComplex<f32>>,
    inv: Arc<dyn ComplexToReal<f32>>,
}

/// Complex spectrogram, `data[t * bins + f]`.
pub struct Spec {
    pub frames: usize,
    pub bins: usize,
    pub data: Vec<Complex32>,
}

impl Spec {
    pub fn zeros(frames: usize, bins: usize) -> Self {
        Spec { frames, bins, data: vec![Complex32::new(0.0, 0.0); frames * bins] }
    }
    #[inline]
    pub fn at(&self, t: usize, f: usize) -> Complex32 {
        self.data[t * self.bins + f]
    }
    #[inline]
    pub fn at_mut(&mut self, t: usize, f: usize) -> &mut Complex32 {
        &mut self.data[t * self.bins + f]
    }
}

/// Periodic Hann window (torch.hann_window default).
pub fn hann(n: usize) -> Vec<f32> {
    (0..n).map(|i| (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos()) as f32).collect()
}

/// numpy/torch "reflect" padding (edge sample not repeated). Like Demucs'
/// `pad1d`, zero-pads first if the signal is too short to reflect.
pub fn pad_reflect(x: &[f32], left: usize, right: usize) -> Vec<f32> {
    let n = x.len();
    let max_pad = left.max(right);
    if n <= max_pad {
        let extra = max_pad - n + 1;
        let extra_r = right.min(extra);
        let extra_l = extra - extra_r;
        let mut z = vec![0.0; extra_l];
        z.extend_from_slice(x);
        z.extend(std::iter::repeat_n(0.0, extra_r));
        return pad_reflect(&z, left - extra_l, right - extra_r);
    }
    let mut out = Vec::with_capacity(n + left + right);
    for i in (1..=left).rev() {
        out.push(x[i]);
    }
    out.extend_from_slice(x);
    for i in 0..right {
        out.push(x[n - 2 - i]);
    }
    out
}

impl Stft {
    pub fn new(n_fft: usize, hop: usize, normalized: bool) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        Stft {
            n_fft,
            hop,
            normalized,
            window: hann(n_fft),
            fwd: planner.plan_fft_forward(n_fft),
            inv: planner.plan_fft_inverse(n_fft),
        }
    }

    pub fn bins(&self) -> usize {
        self.n_fft / 2 + 1
    }

    /// Frames produced for a signal of `len` samples (center=True).
    pub fn frames_for(&self, len: usize) -> usize {
        1 + len / self.hop
    }

    pub fn forward(&self, x: &[f32]) -> Spec {
        let pad = self.n_fft / 2;
        let padded = pad_reflect(x, pad, pad);
        let frames = 1 + (padded.len() - self.n_fft) / self.hop;
        let bins = self.bins();
        let scale = if self.normalized { 1.0 / (self.n_fft as f32).sqrt() } else { 1.0 };
        let mut spec = Spec::zeros(frames, bins);
        let mut buf = self.fwd.make_input_vec();
        let mut out = self.fwd.make_output_vec();
        let mut scratch = self.fwd.make_scratch_vec();
        for t in 0..frames {
            let s = &padded[t * self.hop..t * self.hop + self.n_fft];
            for ((b, v), w) in buf.iter_mut().zip(s).zip(&self.window) {
                *b = v * w;
            }
            self.fwd.process_with_scratch(&mut buf, &mut out, &mut scratch).expect("fft size");
            let row = &mut spec.data[t * bins..(t + 1) * bins];
            for (r, o) in row.iter_mut().zip(&out) {
                *r = o * scale;
            }
        }
        spec
    }

    /// Inverse with torch.istft semantics; returns exactly `length` samples.
    pub fn inverse(&self, spec: &Spec, length: usize) -> Vec<f32> {
        assert_eq!(spec.bins, self.bins());
        let n = self.n_fft;
        let pad = n / 2;
        let total = n + self.hop * (spec.frames.saturating_sub(1));
        let mut ola = vec![0f32; total];
        let mut env = vec![0f32; total];
        let mut buf = self.inv.make_input_vec();
        let mut out = self.inv.make_output_vec();
        let mut scratch = self.inv.make_scratch_vec();
        // irfft is unnormalised (×n); torch divides by n, and normalized=True multiplies by sqrt(n).
        let scale = if self.normalized { 1.0 / (n as f32).sqrt() } else { 1.0 / n as f32 };
        let last = buf.len() - 1;
        for t in 0..spec.frames {
            buf.copy_from_slice(&spec.data[t * spec.bins..(t + 1) * spec.bins]);
            buf[0].im = 0.0;
            buf[last].im = 0.0;
            self.inv.process_with_scratch(&mut buf, &mut out, &mut scratch).expect("ifft size");
            let off = t * self.hop;
            for i in 0..n {
                let w = self.window[i];
                ola[off + i] += out[i] * scale * w;
                env[off + i] += w * w;
            }
        }
        let mut y = vec![0f32; length];
        for (i, v) in y.iter_mut().enumerate() {
            let j = i + pad;
            if j < total && env[j] > 1e-11 {
                *v = ola[j] / env[j];
            }
        }
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflect_matches_numpy() {
        assert_eq!(pad_reflect(&[1., 2., 3., 4.], 2, 3), vec![3., 2., 1., 2., 3., 4., 3., 2., 1.]);
    }

    #[test]
    fn roundtrip() {
        let st = Stft::new(4096, 1024, true);
        let x: Vec<f32> = (0..50_000).map(|i| ((i * 7919) % 1000) as f32 / 1000.0 - 0.5).collect();
        let s = st.forward(&x);
        assert_eq!(s.frames, st.frames_for(x.len()));
        let y = st.inverse(&s, x.len());
        let err = x.iter().zip(&y).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(err < 1e-4, "max err {err}");
    }
}
