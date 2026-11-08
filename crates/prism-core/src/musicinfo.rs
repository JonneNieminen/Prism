//! Tempo and musical key estimation for a finished mix.
//!
//! Tempo: log-band spectral flux → detrended onset envelope → autocorrelation, scored
//! at the beat period and its multiples and weighted by a prior around 120 BPM.
//! Key: tuning-corrected chroma from spectral peaks (plus a bass-weighted chroma) matched
//! against the Krumhansl–Kessler and Temperley major/minor profiles.
//!
//! Both are estimates. Tempo can land on half or double time, and relative major/minor
//! keys (C major / A minor) are close neighbours, so the UI presents them as estimates.

use std::f32::consts::TAU;

use realfft::RealFftPlanner;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audio::Audio;

/// Shortest clip worth analysing, in seconds.
const MIN_SECS: f32 = 6.0;
/// Longest stretch analysed (taken from the middle, skipping intros and outros).
const MAX_SECS: f32 = 150.0;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MusicInfo {
    /// Estimated tempo in beats per minute, rounded to 0.1.
    pub bpm: Option<f32>,
    /// 0 to 1: how clearly one tempo stood out.
    pub bpm_confidence: f32,
    pub key: Option<MusicKey>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MusicKey {
    /// Pitch class of the tonic, 0 = C … 11 = B.
    pub tonic: u8,
    pub minor: bool,
    /// For example "A♭ major" or "F♯ minor".
    pub name: String,
    /// Camelot wheel code used by DJs, for example "8B".
    pub camelot: String,
    /// 0 to 1: how far the best key stood out from the runner-up.
    pub confidence: f32,
}

const MAJOR_NAMES: [&str; 12] = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_NAMES: [&str; 12] = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
const MAJOR_CAMELOT: [u8; 12] = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT: [u8; 12] = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

const KK_MAJOR: [f32; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR: [f32; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const TP_MAJOR: [f32; 12] = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const TP_MINOR: [f32; 12] = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

impl MusicKey {
    fn new(tonic: u8, minor: bool, confidence: f32) -> Self {
        let t = (tonic % 12) as usize;
        let (names, camelot) = if minor { (&MINOR_NAMES, &MINOR_CAMELOT) } else { (&MAJOR_NAMES, &MAJOR_CAMELOT) };
        MusicKey {
            tonic: t as u8,
            minor,
            name: format!("{} {}", names[t], if minor { "minor" } else { "major" }),
            camelot: format!("{}{}", camelot[t], if minor { "A" } else { "B" }),
            confidence,
        }
    }
}

/// Estimate tempo and key. Returns empty results for clips under six seconds or silence.
pub fn analyze(audio: &Audio) -> MusicInfo {
    let sr = audio.sample_rate as f32;
    let frames = audio.frames();
    if audio.channels.is_empty() || sr < 8000.0 || (frames as f32) < MIN_SECS * sr {
        return MusicInfo::default();
    }
    let max_frames = (MAX_SECS * sr) as usize;
    let start = frames.saturating_sub(max_frames) / 2;
    let end = (start + max_frames).min(frames);
    let n = audio.channels.len() as f32;
    let mono: Vec<f32> = (start..end).map(|i| audio.channels.iter().map(|c| c[i]).sum::<f32>() / n).collect();

    let rms = (mono.iter().map(|v| v * v).sum::<f32>() / mono.len() as f32).sqrt();
    if rms < 1.0e-4 {
        return MusicInfo::default();
    }

    let tempo = estimate_tempo(&mono, sr);
    MusicInfo {
        bpm: tempo.map(|(b, _)| (b * 10.0).round() / 10.0),
        bpm_confidence: tempo.map_or(0.0, |(_, c)| c),
        key: estimate_key(&mono, sr),
    }
}

// ─── Tempo ────────────────────────────────────────────────────────────────

fn estimate_tempo(x: &[f32], sr: f32) -> Option<(f32, f32)> {
    let hop = (sr / 100.0).round().max(1.0) as usize;
    let fps = sr / hop as f32;
    let n_fft = if sr > 30_000.0 { 2048 } else { 1024 };
    let flux = onset_envelope(x, sr, n_fft, hop);
    if flux.len() < (fps * 5.0) as usize {
        return None;
    }

    // Remove the slow trend so loudness changes don't dominate the autocorrelation.
    let win = (fps as usize).max(3);
    let mut prefix = vec![0.0f64; flux.len() + 1];
    for (i, v) in flux.iter().enumerate() {
        prefix[i + 1] = prefix[i] + f64::from(*v);
    }
    let nov: Vec<f32> = (0..flux.len())
        .map(|i| {
            let a = i.saturating_sub(win / 2);
            let b = (i + win / 2 + 1).min(flux.len());
            let mean = ((prefix[b] - prefix[a]) / (b - a) as f64) as f32;
            (flux[i] - mean).max(0.0)
        })
        .collect();
    let energy: f32 = nov.iter().map(|v| v * v).sum();
    if energy < 1.0e-6 {
        return None;
    }

    // Unbiased, normalised autocorrelation up to four beats at the slowest tempo (60 BPM).
    let max_lag = (fps * 4.0) as usize + 2;
    let mut ac = vec![0.0f32; max_lag + 1];
    for (lag, slot) in ac.iter_mut().enumerate() {
        let mut s = 0.0f64;
        for i in lag..nov.len() {
            s += f64::from(nov[i]) * f64::from(nov[i - lag]);
        }
        *slot = (s / (nov.len() - lag) as f64) as f32;
    }
    let zero = ac[0].max(1.0e-12);
    ac.iter_mut().for_each(|v| *v /= zero);

    let at = |lag: f32| -> f32 {
        let i = lag.floor() as usize;
        if i + 1 >= ac.len() {
            return 0.0;
        }
        let f = lag - i as f32;
        (ac[i] * (1.0 - f) + ac[i + 1] * f).max(0.0)
    };

    let mut scores = Vec::new();
    let mut bpm = 60.0f32;
    while bpm <= 200.0 {
        let lag = fps * 60.0 / bpm;
        let prior = (-0.5 * ((bpm / 120.0).log2() / 1.0).powi(2)).exp();
        scores.push((bpm, (at(lag) + 0.5 * at(2.0 * lag) + 0.25 * at(4.0 * lag)) * prior));
        bpm += 0.25;
    }
    let (best_bpm, best) = scores.iter().copied().fold((0.0, f32::MIN), |m, s| if s.1 > m.1 { s } else { m });
    if best < 1.0e-4 {
        return None;
    }
    let mean = scores.iter().map(|s| s.1).sum::<f32>() / scores.len() as f32;
    Some((best_bpm, ((best - mean) / best).clamp(0.0, 1.0)))
}

/// Sum of positive log-energy changes in twelve log-spaced bands, one value per hop.
fn onset_envelope(x: &[f32], sr: f32, n_fft: usize, hop: usize) -> Vec<f32> {
    let r2c = RealFftPlanner::<f32>::new().plan_fft_forward(n_fft);
    let window = hann(n_fft);
    let bin_hz = sr / n_fft as f32;
    let f_hi = 10_000.0f32.min(sr * 0.45);
    let edges: Vec<usize> = (0..=12)
        .map(|i| ((40.0 * (f_hi / 40.0).powf(i as f32 / 12.0)) / bin_hz).round() as usize)
        .map(|b| b.clamp(1, n_fft / 2))
        .collect();

    let mut input = r2c.make_input_vec();
    let mut spectrum = r2c.make_output_vec();
    let mut prev = [0.0f32; 12];
    let mut flux = Vec::new();
    let mut pos = 0;
    while pos + n_fft <= x.len() {
        for (i, v) in input.iter_mut().enumerate() {
            *v = x[pos + i] * window[i];
        }
        if r2c.process(&mut input, &mut spectrum).is_err() {
            break;
        }
        let mut sum = 0.0;
        for b in 0..12 {
            let hi = edges[b + 1].max(edges[b] + 1);
            let e: f32 = spectrum[edges[b]..hi.min(spectrum.len())].iter().map(|c| c.norm_sqr()).sum();
            let level = (1.0 + 100.0 * e / n_fft as f32).ln();
            if !flux.is_empty() {
                sum += (level - prev[b]).max(0.0);
            }
            prev[b] = level;
        }
        flux.push(sum);
        pos += hop;
    }
    flux
}

// ─── Key ──────────────────────────────────────────────────────────────────

fn estimate_key(x: &[f32], sr: f32) -> Option<MusicKey> {
    let n_fft = 1usize << ((sr * 0.18).log2().round() as u32).clamp(10, 14);
    let hop = n_fft / 2;
    let r2c = RealFftPlanner::<f32>::new().plan_fft_forward(n_fft);
    let window = hann(n_fft);
    let bin_hz = sr / n_fft as f32;
    let k_lo = ((65.0 / bin_hz).floor() as usize).max(2);
    let k_hi = ((2100.0 / bin_hz).ceil() as usize).min(n_fft / 2 - 2);
    let bass_hz = 260.0;

    let mut input = r2c.make_input_vec();
    let mut spectrum = r2c.make_output_vec();
    let mut mags = vec![0.0f32; n_fft / 2 + 1];
    let mut all = [0.0f64; 36];
    let mut bass = [0.0f64; 36];
    let mut pos = 0;
    while pos + n_fft <= x.len() {
        let frame = &x[pos..pos + n_fft];
        pos += hop;
        let rms = (frame.iter().map(|v| v * v).sum::<f32>() / n_fft as f32).sqrt();
        if rms < 1.0e-4 {
            continue;
        }
        for (i, v) in input.iter_mut().enumerate() {
            *v = frame[i] * window[i];
        }
        if r2c.process(&mut input, &mut spectrum).is_err() {
            break;
        }
        for (m, c) in mags.iter_mut().zip(spectrum.iter()) {
            *m = c.norm();
        }
        let top = mags[k_lo..=k_hi].iter().copied().fold(0.0f32, f32::max);
        if top <= 0.0 {
            continue;
        }
        let (mut f_all, mut f_bass) = ([0.0f64; 36], [0.0f64; 36]);
        let (mut t_all, mut t_bass) = (0.0f64, 0.0f64);
        for k in k_lo..=k_hi {
            let (a, b, c) = (mags[k - 1], mags[k], mags[k + 1]);
            if b <= a || b < c || b < 0.05 * top {
                continue;
            }
            let denom = a - 2.0 * b + c;
            let shift = if denom.abs() > 1.0e-12 { 0.5 * (a - c) / denom } else { 0.0 };
            let freq = (k as f32 + shift.clamp(-0.5, 0.5)) * bin_hz;
            let idx = (((69.0 + 12.0 * (freq / 440.0).log2()) * 3.0).round() as i64).rem_euclid(36) as usize;
            let w = f64::from(b.sqrt());
            f_all[idx] += w;
            t_all += w;
            if freq < bass_hz {
                f_bass[idx] += w;
                t_bass += w;
            }
        }
        // Normalise per frame so loud passages don't drown out quiet ones.
        if t_all > 0.0 {
            all.iter_mut().zip(f_all).for_each(|(a, f)| *a += f / t_all);
        }
        if t_bass > 0.0 {
            bass.iter_mut().zip(f_bass).for_each(|(a, f)| *a += f / t_bass);
        }
    }
    if all.iter().sum::<f64>() <= 0.0 {
        return None;
    }

    // Tuning: which third-of-a-semitone offset do the peaks cluster around?
    let offset = (0..3)
        .max_by(|&a, &b| {
            let s = |k: usize| (0..12).map(|p| all[(3 * p + k) % 36]).sum::<f64>();
            s(a).total_cmp(&s(b))
        })
        .unwrap_or(0);
    let fold = |v: &[f64; 36]| -> [f32; 12] {
        let at = |i: usize| v[i % 36];
        let mut out = [0.0f32; 12];
        for (p, o) in out.iter_mut().enumerate() {
            let c = 3 * p + offset + 36; // offset 2 means one third of a semitone flat
            let c = if offset == 2 { c - 3 } else { c };
            *o = (at(c) + 0.5 * (at(c + 35) + at(c + 1))) as f32;
        }
        out
    };
    let normalise = |v: [f32; 12]| -> [f32; 12] {
        let s: f32 = v.iter().sum();
        if s > 0.0 { v.map(|x| x / s) } else { v }
    };
    let (ca, cb) = (normalise(fold(&all)), normalise(fold(&bass)));
    let mut chroma = [0.0f32; 12];
    for i in 0..12 {
        chroma[i] = ca[i] + 0.5 * cb[i];
    }

    let mut scored: Vec<(f32, u8, bool)> = Vec::with_capacity(24);
    for tonic in 0..12u8 {
        for minor in [false, true] {
            let (kk, tp) = if minor { (&KK_MINOR, &TP_MINOR) } else { (&KK_MAJOR, &TP_MAJOR) };
            let rotated = |p: &[f32; 12]| -> [f32; 12] { std::array::from_fn(|i| p[(i + 12 - tonic as usize) % 12]) };
            let score = 0.5 * (pearson(&chroma, &rotated(kk)) + pearson(&chroma, &rotated(tp)));
            scored.push((score, tonic, minor));
        }
    }
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let (best, second) = (scored[0], scored[1]);
    if best.0 < 0.3 {
        return None;
    }
    Some(MusicKey::new(best.1, best.2, ((best.0 - second.0) * 6.0).clamp(0.0, 1.0)))
}

fn pearson(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let (ma, mb) = (a.iter().sum::<f32>() / 12.0, b.iter().sum::<f32>() / 12.0);
    let (mut num, mut da, mut db) = (0.0, 0.0, 0.0);
    for i in 0..12 {
        let (x, y) = (a[i] - ma, b[i] - mb);
        num += x * y;
        da += x * x;
        db += y * y;
    }
    if da <= 0.0 || db <= 0.0 { 0.0 } else { num / (da.sqrt() * db.sqrt()) }
}

fn hann(n: usize) -> Vec<f32> {
    (0..n).map(|i| 0.5 - 0.5 * (TAU * i as f32 / n as f32).cos()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 44_100;

    fn buffer(secs: f32) -> Audio {
        Audio::silent(SR, 1, (secs * SR as f32) as usize)
    }

    /// Plucked tone with a few harmonics, like a guitar or piano note.
    fn note(a: &mut Audio, start: f32, secs: f32, midi: f32, level: f32) {
        let f = 440.0 * 2f32.powf((midi - 69.0) / 12.0);
        let s0 = (start * SR as f32) as usize;
        let n = (secs * SR as f32) as usize;
        for i in 0..n {
            let t = i as f32 / SR as f32;
            let env = (-3.0 * t / secs).exp().min(1.0) * (1.0 - (-t * 200.0).exp());
            let v: f32 = (1..=6).map(|h| (TAU * f * h as f32 * t).sin() / h as f32).sum();
            if let Some(slot) = a.channels[0].get_mut(s0 + i) {
                *slot += v * env * level;
            }
        }
    }

    fn chord(a: &mut Audio, start: f32, secs: f32, root: f32, minor: bool) {
        note(a, start, secs, root - 12.0, 0.5);
        note(a, start, secs, root, 0.3);
        note(a, start, secs, root + if minor { 3.0 } else { 4.0 }, 0.3);
        note(a, start, secs, root + 7.0, 0.3);
    }

    fn drums(a: &mut Audio, bpm: f32) {
        let beat = 60.0 / bpm;
        let total = a.duration_secs() as f32;
        let mut seed = 7u32;
        let mut noise = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1u32 << 23) as f32 - 1.0
        };
        let mut t = 0.0;
        let mut i = 0;
        while t < total {
            let s0 = (t * SR as f32) as usize;
            let kick = i % 2 == 0;
            for k in 0..(0.12 * SR as f32) as usize {
                let tt = k as f32 / SR as f32;
                let v = if kick {
                    (TAU * 55.0 * tt).sin() * (-tt * 30.0).exp()
                } else {
                    noise() * (-tt * 45.0).exp() * 0.6
                };
                if let Some(slot) = a.channels[0].get_mut(s0 + k) {
                    *slot += v * 0.8;
                }
            }
            t += beat;
            i += 1;
        }
    }

    #[test]
    fn short_or_silent_audio_gives_nothing() {
        assert_eq!(analyze(&buffer(3.0)), MusicInfo::default());
        assert_eq!(analyze(&buffer(20.0)), MusicInfo::default());
    }

    #[test]
    fn finds_tempo_of_a_drum_pattern() {
        for bpm in [90.0, 128.0, 140.0] {
            let mut a = buffer(32.0);
            drums(&mut a, bpm);
            let found = analyze(&a).bpm.expect("tempo");
            assert!((found - bpm).abs() < 2.0, "expected {bpm}, found {found}");
        }
    }

    #[test]
    fn finds_a_major_key() {
        // D major: D, G, A, D with the I-IV-V-I cadence
        let mut a = buffer(24.0);
        for (i, root) in [62.0, 67.0, 69.0, 62.0, 62.0, 67.0, 69.0, 62.0].iter().enumerate() {
            chord(&mut a, i as f32 * 3.0, 3.0, *root, false);
        }
        let key = analyze(&a).key.expect("key");
        assert_eq!((key.name.as_str(), key.camelot.as_str()), ("D major", "10B"));
    }

    #[test]
    fn finds_a_minor_key() {
        // A minor: Am, Dm, E (with G♯), Am
        let mut a = buffer(24.0);
        let prog = [(57.0, true), (62.0, true), (64.0, false), (57.0, true)];
        for (i, (root, minor)) in prog.iter().cycle().take(8).enumerate() {
            chord(&mut a, i as f32 * 3.0, 3.0, *root, *minor);
        }
        let key = analyze(&a).key.expect("key");
        assert_eq!((key.name.as_str(), key.camelot.as_str()), ("A minor", "8A"));
    }

    #[test]
    fn follows_a_detuned_recording() {
        // The same D major tune, 30 cents flat.
        let mut a = buffer(24.0);
        for (i, root) in [61.7, 66.7, 68.7, 61.7, 61.7, 66.7, 68.7, 61.7].iter().enumerate() {
            chord(&mut a, i as f32 * 3.0, 3.0, *root, false);
        }
        assert_eq!(analyze(&a).key.expect("key").name, "D major");
    }

    #[test]
    fn names_use_conventional_spellings() {
        assert_eq!(MusicKey::new(8, false, 1.0).name, "A♭ major");
        assert_eq!(MusicKey::new(6, true, 1.0).camelot, "11A");
        assert_eq!(MusicKey::new(1, true, 1.0).name, "C♯ minor");
    }
}
