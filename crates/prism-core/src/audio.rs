//! Decoding (symphonia), channel/sample-rate conversion (rubato) and the WAV
//! cache format used for stems.

use std::fs::File;
use std::path::Path;

use serde::Serialize;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{CODEC_TYPE_NULL, DecoderOptions};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, MetadataRevision, StandardTagKey};
use symphonia::core::probe::Hint;
use ts_rs::TS;

use crate::util::CancelToken;
use crate::{PrismError, Result};

/// Formats the import screen accepts.
pub const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "wav", "flac", "m4a", "ogg", "oga", "aac"];

/// Planar f32 audio. `channels[c][i]`.
#[derive(Clone, Debug, Default)]
pub struct Audio {
    pub sample_rate: u32,
    pub channels: Vec<Vec<f32>>,
}

impl Audio {
    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, |c| c.len())
    }
    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 { 0.0 } else { self.frames() as f64 / self.sample_rate as f64 }
    }
    pub fn silent(sample_rate: u32, channels: usize, frames: usize) -> Self {
        Audio { sample_rate, channels: vec![vec![0.0; frames]; channels] }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrackInfo {
    pub title: String,
    pub artist: Option<String>,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub file_name: String,
}

pub fn check_extension(path: &Path) -> Result<()> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    match ext {
        Some(e) if SUPPORTED_EXTENSIONS.contains(&e.as_str()) => Ok(()),
        Some(e) => {
            Err(PrismError::UnsupportedFile(format!("“.{e}” files aren't supported. Try MP3, WAV, FLAC, M4A or OGG.")))
        }
        None => Err(PrismError::UnsupportedFile("This file has no extension. Try MP3, WAV, FLAC, M4A or OGG.".into())),
    }
}

/// Decode a whole file to planar f32 at its native rate.
pub fn decode_file(path: &Path, cancel: &CancelToken) -> Result<(Audio, TrackInfo)> {
    check_extension(path)?;
    let file_name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let file = File::open(path).map_err(|e| PrismError::Io(format!("Couldn't open “{file_name}”: {e}")))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let corrupt = |why: String| PrismError::CorruptFile(format!("“{file_name}” couldn't be read — {why}"));

    let mut probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| match e {
            SymError::Unsupported(_) => {
                PrismError::UnsupportedFile(format!("“{file_name}” uses an audio format Prism can't decode."))
            }
            other => corrupt(format!("the file looks damaged ({other})")),
        })?;

    let mut title = None;
    let mut artist = None;
    let mut read_tags = |rev: &MetadataRevision| {
        for tag in rev.tags() {
            match tag.std_key {
                Some(StandardTagKey::TrackTitle) if title.is_none() => title = Some(tag.value.to_string()),
                Some(StandardTagKey::Artist) if artist.is_none() => artist = Some(tag.value.to_string()),
                _ => {}
            }
        }
    };
    if let Some(m) = probed.metadata.get()
        && let Some(rev) = m.current()
    {
        read_tags(rev);
    }
    let mut format = probed.format;
    if let Some(rev) = format.metadata().current() {
        read_tags(rev);
    }

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| corrupt("it contains no audio track".into()))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| PrismError::UnsupportedFile(format!("“{file_name}” uses an audio codec Prism can't decode.")))?;

    let mut channels: Vec<Vec<f32>> = Vec::new();
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut sbuf: Option<SampleBuffer<f32>> = None;
    let mut decode_errors = 0usize;
    let mut packets = 0usize;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => {
                if channels.first().is_some_and(|c| !c.is_empty()) {
                    break; // truncated tail: keep what we have
                }
                return Err(corrupt(format!("{e}")));
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        packets += 1;
        if packets.is_multiple_of(256) {
            cancel.check()?;
        }
        match decoder.decode(&packet) {
            Ok(buf) => {
                let spec = *buf.spec();
                sample_rate = spec.rate;
                let nch = spec.channels.count();
                if channels.is_empty() {
                    channels = vec![Vec::new(); nch];
                }
                if nch != channels.len() {
                    continue;
                }
                let need = buf.capacity() as u64;
                if sbuf.as_ref().is_none_or(|b| b.capacity() < need as usize) {
                    sbuf = Some(SampleBuffer::<f32>::new(need, spec));
                }
                let sb = sbuf.as_mut().unwrap();
                sb.copy_interleaved_ref(buf);
                for (i, s) in sb.samples().iter().enumerate() {
                    channels[i % nch].push(*s);
                }
            }
            Err(SymError::DecodeError(_)) => {
                decode_errors += 1;
                if decode_errors > 64 && channels.first().is_none_or(|c| c.is_empty()) {
                    return Err(corrupt("too many decoding errors".into()));
                }
            }
            Err(e) => return Err(corrupt(format!("{e}"))),
        }
    }
    let frames = channels.first().map_or(0, |c| c.len());
    if frames == 0 || sample_rate == 0 {
        return Err(corrupt("it contains no playable audio".into()));
    }
    let audio = Audio { sample_rate, channels };
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let info = TrackInfo {
        title: title.filter(|t| !t.trim().is_empty()).unwrap_or(stem),
        artist,
        duration_secs: audio.duration_secs(),
        sample_rate,
        channels: audio.channels.len() as u32,
        file_name,
    };
    Ok((audio, info))
}

/// Mono → duplicated stereo; >2 channels → average into stereo; then to `n`.
pub fn to_channels(audio: Audio, n: usize) -> Audio {
    let have = audio.channels.len();
    if have == n {
        return audio;
    }
    let sr = audio.sample_rate;
    let frames = audio.frames();
    let channels = match (have, n) {
        (1, _) => vec![audio.channels[0].clone(); n],
        (_, 1) => {
            let mut m = vec![0f32; frames];
            for c in &audio.channels {
                for (o, s) in m.iter_mut().zip(c) {
                    *o += s / have as f32;
                }
            }
            vec![m]
        }
        _ => {
            // fold extra channels alternately into L/R
            let mut out = vec![vec![0f32; frames]; n];
            let mut counts = vec![0f32; n];
            for (i, c) in audio.channels.iter().enumerate() {
                let o = i % n;
                counts[o] += 1.0;
                for (d, s) in out[o].iter_mut().zip(c) {
                    *d += s;
                }
            }
            for (o, k) in out.iter_mut().zip(counts) {
                o.iter_mut().for_each(|s| *s /= k.max(1.0));
            }
            out
        }
    };
    Audio { sample_rate: sr, channels }
}

/// High quality synchronous resampling. Output length = round(n * to / from).
pub fn resample(audio: Audio, to: u32) -> Result<Audio> {
    use rubato::{FftFixedIn, Resampler};
    let from = audio.sample_rate;
    if from == to || audio.frames() == 0 {
        return Ok(audio);
    }
    let nch = audio.channels.len();
    let n = audio.frames();
    let expected = (n as f64 * to as f64 / from as f64).round() as usize;
    let err = |e: &dyn std::fmt::Display| PrismError::Other(format!("Resampling failed: {e}"));
    let mut r = FftFixedIn::<f32>::new(from as usize, to as usize, 1024, 2, nch).map_err(|e| err(&e))?;
    let delay = r.output_delay();
    let mut out: Vec<Vec<f32>> = vec![Vec::with_capacity(expected + delay + 4096); nch];
    let push = |o: Vec<Vec<f32>>, out: &mut Vec<Vec<f32>>| {
        for (d, s) in out.iter_mut().zip(o) {
            d.extend_from_slice(&s);
        }
    };
    let mut pos = 0;
    while pos + r.input_frames_next() <= n {
        let need = r.input_frames_next();
        let slices: Vec<&[f32]> = audio.channels.iter().map(|c| &c[pos..pos + need]).collect();
        let o = r.process(&slices, None).map_err(|e| err(&e))?;
        push(o, &mut out);
        pos += need;
    }
    if pos < n {
        let slices: Vec<&[f32]> = audio.channels.iter().map(|c| &c[pos..]).collect();
        let o = r.process_partial(Some(&slices), None).map_err(|e| err(&e))?;
        push(o, &mut out);
    }
    while out[0].len() < expected + delay {
        let o = r.process_partial::<&[f32]>(None, None).map_err(|e| err(&e))?;
        if o[0].is_empty() {
            break;
        }
        push(o, &mut out);
    }
    for c in out.iter_mut() {
        let end = (delay + expected).min(c.len());
        *c = c[delay.min(end)..end].to_vec();
        c.resize(expected, 0.0);
    }
    Ok(Audio { sample_rate: to, channels: out })
}

/// Convert to what a model expects.
pub fn conform(audio: Audio, sample_rate: u32, channels: usize) -> Result<Audio> {
    resample(to_channels(audio, channels), sample_rate)
}

/// Stem cache format: 32-bit float WAV (lossless re-export, plays in WebKit).
pub fn write_wav_f32(path: &Path, audio: &Audio) -> Result<()> {
    let spec = hound::WavSpec {
        channels: audio.channels.len() as u16,
        sample_rate: audio.sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut w = hound::WavWriter::create(path, spec).map_err(wav_err)?;
    for i in 0..audio.frames() {
        for c in &audio.channels {
            w.write_sample(c[i]).map_err(wav_err)?;
        }
    }
    w.finalize().map_err(wav_err)?;
    Ok(())
}

pub fn read_wav(path: &Path) -> Result<Audio> {
    let mut r = hound::WavReader::open(path).map_err(wav_err)?;
    let spec = r.spec();
    let nch = spec.channels as usize;
    let mut channels = vec![Vec::with_capacity(r.duration() as usize); nch];
    match spec.sample_format {
        hound::SampleFormat::Float => {
            for (i, s) in r.samples::<f32>().enumerate() {
                channels[i % nch].push(s.map_err(wav_err)?);
            }
        }
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            for (i, s) in r.samples::<i32>().enumerate() {
                channels[i % nch].push(s.map_err(wav_err)? as f32 * scale);
            }
        }
    }
    Ok(Audio { sample_rate: spec.sample_rate, channels })
}

fn wav_err(e: hound::Error) -> PrismError {
    match e {
        hound::Error::IoError(io) => io.into(),
        other => PrismError::CorruptFile(format!("WAV error: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_length_and_tone() {
        let sr = 48000;
        let n = sr as usize * 2;
        let tone: Vec<f32> = (0..n).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / sr as f32).sin()).collect();
        let a = Audio { sample_rate: sr, channels: vec![tone.clone(), tone] };
        let b = resample(a, 44100).unwrap();
        assert_eq!(b.frames(), 88200);
        // amplitude preserved in the middle
        let peak = b.channels[0][20000..60000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - 1.0).abs() < 0.02, "peak {peak}");
    }

    #[test]
    fn mono_to_stereo() {
        let a = Audio { sample_rate: 44100, channels: vec![vec![0.5; 10]] };
        let b = to_channels(a, 2);
        assert_eq!(b.channels.len(), 2);
        assert_eq!(b.channels[1][3], 0.5);
    }
}
