//! Dev harness: run prism-core without the UI.
//!   prism separate <audio> --model <model dir> [--out DIR] [--quality fast|balanced|best] [--cpu] [--seconds N]
//!                  [--shifts N --overlap X]   (override the preset, for parity checks)
//!   prism compare <a.wav> <b.wav>        (SNR in dB, for parity checks)
//!   prism validate <model dir>
//!   prism analyze <audio>...             (estimated tempo and key)

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail};
use prism_core::audio::{conform, decode_file, read_wav, write_wav_f32};
use prism_core::manifest::{ModelManifest, Quality};
use prism_core::models::InstalledModel;
use prism_core::runtime::{Acceleration, RuntimeOptions};
use prism_core::separator::{self, SeparateOptions};
use prism_core::util::CancelToken;

fn arg(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("separate") => separate(&args),
        Some("compare") => compare(Path::new(&args[1]), Path::new(&args[2])),
        Some("validate") => {
            let m = ModelManifest::load(Path::new(&args[1]))?;
            println!(
                "valid: {} ({}), stems: {:?}",
                m.name,
                m.architecture,
                m.stems.iter().map(|s| &s.id).collect::<Vec<_>>()
            );
            Ok(())
        }
        Some("analyze") => {
            for path in &args[1..] {
                let (audio, info) = decode_file(Path::new(path), &CancelToken::new())?;
                let t = Instant::now();
                let m = prism_core::musicinfo::analyze(&audio);
                println!(
                    "{:<28} {:>7}  {:<10} {:>4}  (tempo conf {:.2}, key conf {:.2}, {:.1}s)",
                    info.file_name,
                    m.bpm.map_or("-".into(), |b| format!("{b:.1}")),
                    m.key.as_ref().map_or("-", |k| k.name.as_str()),
                    m.key.as_ref().map_or("", |k| k.camelot.as_str()),
                    m.bpm_confidence,
                    m.key.as_ref().map_or(0.0, |k| k.confidence),
                    t.elapsed().as_secs_f32()
                );
            }
            Ok(())
        }
        _ => bail!("usage: prism separate|compare|validate|analyze …"),
    }
}

fn separate(args: &[String]) -> Result<()> {
    let input = PathBuf::from(args.get(1).context("audio path")?);
    let dir = PathBuf::from(arg(args, "--model").context("--model <dir>")?);
    let out = PathBuf::from(arg(args, "--out").unwrap_or_else(|| "stems".into()));
    let quality = match arg(args, "--quality").as_deref() {
        Some("fast") => Quality::Fast,
        Some("best") => Quality::Best,
        _ => Quality::Balanced,
    };
    let rt = RuntimeOptions {
        acceleration: if args.iter().any(|a| a == "--cpu") { Acceleration::Cpu } else { Acceleration::Auto },
        cache_dir: Some(std::env::temp_dir().join("prism-coreml-cache")),
    };
    let cancel = CancelToken::new();
    let manifest = ModelManifest::load(&dir)?;
    let t0 = Instant::now();
    let (audio, info) = decode_file(&input, &cancel)?;
    let mut audio = conform(audio, manifest.sample_rate, manifest.channels as usize)?;
    if let Some(s) = arg(args, "--seconds") {
        let n = (s.parse::<f64>()? * manifest.sample_rate as f64) as usize;
        audio.channels.iter_mut().for_each(|c| c.truncate(n));
    }
    println!("decoded “{}” {:.1}s in {:.2}s", info.title, audio.duration_secs(), t0.elapsed().as_secs_f32());
    let t1 = Instant::now();
    let model = InstalledModel { manifest: manifest.clone(), dir, bundled: true };
    let mut sep = separator::load(&model, &rt)?;
    println!("model loaded on {} in {:.2}s", sep.device(), t1.elapsed().as_secs_f32());
    let t2 = Instant::now();
    let mut last = -1i32;
    let stems = separator::run(
        sep.as_mut(),
        &audio,
        &SeparateOptions {
            quality,
            preset_override: arg(args, "--shifts").map(|sh| prism_core::manifest::QualityPreset {
                shifts: sh.parse().unwrap(),
                overlap: arg(args, "--overlap").map(|o| o.parse().unwrap()),
            }),
        },
        &mut |p| {
            let pct = (p.fraction * 100.0) as i32;
            if pct / 10 != last / 10 {
                last = pct;
                println!("  {pct:>3}%  eta {:?}", p.eta_secs.map(|e| e.round()));
            }
        },
        &cancel,
    )?;
    let secs = t2.elapsed().as_secs_f32();
    println!("separated in {secs:.1}s ({:.2}x realtime)", audio.duration_secs() as f32 / secs);
    std::fs::create_dir_all(&out)?;
    for s in &stems {
        write_wav_f32(&out.join(format!("{}.wav", s.id)), &s.audio)?;
    }
    println!("wrote {} stems to {}", stems.len(), out.display());
    Ok(())
}

fn compare(a: &Path, b: &Path) -> Result<()> {
    let (x, y) = (read_wav(a)?, read_wav(b)?);
    let n = x.frames().min(y.frames());
    let nonfinite = x.channels.iter().flatten().filter(|v| !v.is_finite()).count();
    if nonfinite > 0 {
        bail!("{}: {nonfinite} non-finite samples", a.display());
    }
    let (mut sig, mut err) = (0f64, 0f64);
    for (cx, cy) in x.channels.iter().zip(&y.channels) {
        for i in 0..n {
            sig += (cy[i] as f64).powi(2);
            err += (cx[i] as f64 - cy[i] as f64).powi(2);
        }
    }
    println!(
        "{}: SNR {:.1} dB (frames {} vs {})",
        a.file_name().unwrap().to_string_lossy(),
        10.0 * (sig / err.max(1e-20)).log10(),
        x.frames(),
        y.frames()
    );
    Ok(())
}
