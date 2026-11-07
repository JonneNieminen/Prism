//! Encoding stems / custom mixes to WAV (24-bit), FLAC (24-bit) or MP3, and
//! zipping all stems. Files are written to `<target>.part` then renamed.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audio::{Audio, read_wav};
use crate::library::{Library, Project};
use crate::util::{CancelToken, sanitize_filename};
use crate::{PrismError, Result};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ExportFormat {
    #[default]
    Wav,
    Flac,
    Mp3,
}

impl ExportFormat {
    pub fn ext(self) -> &'static str {
        match self {
            ExportFormat::Wav => "wav",
            ExportFormat::Flac => "flac",
            ExportFormat::Mp3 => "mp3",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportOptions {
    pub format: ExportFormat,
    /// kbps, MP3 only: 128, 192, 256 or 320.
    pub mp3_bitrate: u32,
}

/// Gain for one stem in a custom mix (0 = removed).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MixGain {
    pub stem_id: String,
    pub gain: f32,
}

/// `Song Title - vocals.wav`
pub fn default_file_name(title: &str, suffix: &str, ext: &str) -> String {
    format!("{} - {}.{}", sanitize_filename(title), sanitize_filename(suffix), ext)
}

fn part_path(target: &Path) -> PathBuf {
    let mut s = target.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

fn write_atomic(target: &Path, f: impl FnOnce(&Path) -> Result<()>) -> Result<()> {
    let tmp = part_path(target);
    match f(&tmp) {
        Ok(()) => {
            fs::rename(&tmp, target)?;
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

pub fn encode(audio: &Audio, opts: &ExportOptions, target: &Path) -> Result<()> {
    write_atomic(target, |tmp| match opts.format {
        ExportFormat::Wav => write_wav24(audio, tmp),
        ExportFormat::Flac => write_flac(audio, tmp),
        ExportFormat::Mp3 => write_mp3(audio, opts.mp3_bitrate, tmp),
    })
}

fn to_i24(v: f32) -> i32 {
    (v.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32
}

fn write_wav24(a: &Audio, p: &Path) -> Result<()> {
    let spec = hound::WavSpec {
        channels: a.channels.len() as u16,
        sample_rate: a.sample_rate,
        bits_per_sample: 24,
        sample_format: hound::SampleFormat::Int,
    };
    let err = |e: hound::Error| PrismError::Io(format!("Couldn't write WAV: {e}"));
    let mut w = hound::WavWriter::create(p, spec).map_err(err)?;
    for i in 0..a.frames() {
        for c in &a.channels {
            w.write_sample(to_i24(c[i])).map_err(err)?;
        }
    }
    w.finalize().map_err(err)
}

fn write_flac(a: &Audio, p: &Path) -> Result<()> {
    use flacenc::component::BitRepr;
    use flacenc::error::Verify;
    let err = |m: String| PrismError::Io(format!("Couldn't write FLAC: {m}"));
    let nch = a.channels.len();
    let mut inter = Vec::with_capacity(a.frames() * nch);
    for i in 0..a.frames() {
        for c in &a.channels {
            inter.push(to_i24(c[i]));
        }
    }
    let cfg = flacenc::config::Encoder::default().into_verified().map_err(|e| err(format!("{e:?}")))?;
    let src = flacenc::source::MemSource::from_samples(&inter, nch, 24, a.sample_rate as usize);
    let stream = flacenc::encode_with_fixed_block_size(&cfg, src, cfg.block_size).map_err(|e| err(format!("{e:?}")))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream.write(&mut sink).map_err(|e| err(format!("{e:?}")))?;
    let mut bytes = sink.as_slice().to_vec();
    // flacenc records the short final block as STREAMINFO's min block size, which
    // makes strict decoders (Core Audio, symphonia) reject a fixed-blocksize stream.
    // Spec: the last block is excluded, so min = max here.
    if bytes.len() > 12 && &bytes[..4] == b"fLaC" {
        let (max0, max1) = (bytes[10], bytes[11]);
        bytes[8] = max0;
        bytes[9] = max1;
    }
    fs::write(p, bytes)?;
    Ok(())
}

fn write_mp3(a: &Audio, kbps: u32, p: &Path) -> Result<()> {
    use mp3lame_encoder::{Bitrate, Builder, DualPcm, FlushNoGap, Quality};
    let err = |m: String| PrismError::Io(format!("Couldn't write MP3: {m}"));
    let br = match kbps {
        0..=128 => Bitrate::Kbps128,
        129..=192 => Bitrate::Kbps192,
        193..=256 => Bitrate::Kbps256,
        _ => Bitrate::Kbps320,
    };
    let mut b = Builder::new().ok_or_else(|| err("LAME init failed".into()))?;
    b.set_num_channels(2).map_err(|e| err(format!("{e:?}")))?;
    b.set_sample_rate(a.sample_rate).map_err(|e| err(format!("{e:?}")))?;
    b.set_brate(br).map_err(|e| err(format!("{e:?}")))?;
    b.set_quality(Quality::Best).map_err(|e| err(format!("{e:?}")))?;
    let mut enc = b.build().map_err(|e| err(format!("{e:?}")))?;
    let l = &a.channels[0];
    let r = a.channels.get(1).unwrap_or(l);
    let q = |v: f32| (v.clamp(-1.0, 1.0) * 32767.0).round() as i16;
    let mut f = fs::File::create(p)?;
    let mut out = Vec::new();
    const BLOCK: usize = 1152 * 32;
    for start in (0..a.frames()).step_by(BLOCK) {
        let end = (start + BLOCK).min(a.frames());
        let left: Vec<i16> = l[start..end].iter().map(|v| q(*v)).collect();
        let right: Vec<i16> = r[start..end].iter().map(|v| q(*v)).collect();
        out.clear();
        out.reserve(mp3lame_encoder::max_required_buffer_size(left.len()));
        enc.encode_to_vec(DualPcm { left: &left, right: &right }, &mut out).map_err(|e| err(format!("{e:?}")))?;
        f.write_all(&out)?;
    }
    out.clear();
    out.reserve(7200);
    enc.flush_to_vec::<FlushNoGap>(&mut out).map_err(|e| err(format!("{e:?}")))?;
    f.write_all(&out)?;
    Ok(())
}

pub fn export_stem(lib: &Library, p: &Project, stem_id: &str, opts: &ExportOptions, target: &Path) -> Result<()> {
    let a = read_wav(&lib.stem_path(p, stem_id)?)?;
    encode(&a, opts, target)
}

/// Sum the stems with the given gains (stems not listed are left out).
pub fn render_mix(lib: &Library, p: &Project, gains: &[MixGain]) -> Result<Audio> {
    let mut mix: Option<Audio> = None;
    for g in gains.iter().filter(|g| g.gain > 0.0) {
        let a = read_wav(&lib.stem_path(p, &g.stem_id)?)?;
        match mix.as_mut() {
            None => {
                let mut a = a;
                a.channels.iter_mut().flatten().for_each(|v| *v *= g.gain);
                mix = Some(a);
            }
            Some(m) => {
                for (mc, ac) in m.channels.iter_mut().zip(&a.channels) {
                    mc.iter_mut().zip(ac).for_each(|(x, y)| *x += y * g.gain);
                }
            }
        }
    }
    mix.ok_or_else(|| PrismError::Other("Every stem is muted — turn at least one on to export a mix.".into()))
}

pub fn export_mix(lib: &Library, p: &Project, gains: &[MixGain], opts: &ExportOptions, target: &Path) -> Result<()> {
    encode(&render_mix(lib, p, gains)?, opts, target)
}

/// All stems in one zip (stored, audio doesn't deflate usefully).
pub fn export_zip(
    lib: &Library,
    p: &Project,
    opts: &ExportOptions,
    target: &Path,
    tmp_dir: &Path,
    progress: &mut dyn FnMut(f32),
    cancel: &CancelToken,
) -> Result<()> {
    fs::create_dir_all(tmp_dir)?;
    write_atomic(target, |tmp| {
        let f = fs::File::create(tmp)?;
        let mut z = zip::ZipWriter::new(f);
        let zopts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let n = p.stems.len();
        for (i, s) in p.stems.iter().enumerate() {
            cancel.check()?;
            let name = default_file_name(&p.title, &s.id, opts.format.ext());
            let enc_path = tmp_dir.join(format!("{}-{}", uuid::Uuid::new_v4(), name));
            let r = export_stem(lib, p, &s.id, opts, &enc_path).and_then(|_| {
                z.start_file(name, zopts).map_err(|e| PrismError::Io(format!("Zip error: {e}")))?;
                let mut src = fs::File::open(&enc_path)?;
                std::io::copy(&mut src, &mut z)?;
                Ok(())
            });
            let _ = fs::remove_file(&enc_path);
            r?;
            progress((i + 1) as f32 / n as f32);
        }
        z.finish().map_err(|e| PrismError::Io(format!("Zip error: {e}")))?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone() -> Audio {
        let sr = 44100;
        let c: Vec<f32> = (0..sr).map(|i| 0.5 * (i as f32 * 0.05).sin()).collect();
        Audio { sample_rate: sr as u32, channels: vec![c.clone(), c] }
    }

    #[test]
    fn encodes_all_formats_and_decodes_back() {
        let t = tempfile::tempdir().unwrap();
        for fmt in [ExportFormat::Wav, ExportFormat::Flac, ExportFormat::Mp3] {
            let p = t.path().join(format!("x.{}", fmt.ext()));
            encode(&tone(), &ExportOptions { format: fmt, mp3_bitrate: 192 }, &p).unwrap();
            let (a, _) = crate::audio::decode_file(&p, &CancelToken::new()).unwrap();
            assert_eq!(a.channels.len(), 2);
            assert!((a.frames() as i64 - 44100).abs() < 3000, "{fmt:?} frames {}", a.frames());
            assert!(!part_path(&p).exists());
        }
    }

    #[test]
    fn default_names() {
        assert_eq!(default_file_name("My: Song", "Vocals", "wav"), "My_ Song - Vocals.wav");
    }
}
