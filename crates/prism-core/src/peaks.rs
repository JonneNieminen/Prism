//! Waveform overview data (so the UI never scans raw audio to draw).

use crate::audio::Audio;

pub const PEAK_BUCKETS: usize = 2000;

/// Max |sample| across channels per bucket. Absolute (not normalised) so
/// stems stay visually comparable to each other.
pub fn peaks(audio: &Audio, buckets: usize) -> Vec<f32> {
    let n = audio.frames();
    if n == 0 {
        return vec![0.0; buckets];
    }
    (0..buckets)
        .map(|b| {
            let s = b * n / buckets;
            let e = ((b + 1) * n / buckets).max(s + 1).min(n);
            audio.channels.iter().flat_map(|c| c[s..e].iter()).fold(0f32, |m, v| m.max(v.abs()))
        })
        .map(|v| (v * 1000.0).round() / 1000.0)
        .collect()
}
