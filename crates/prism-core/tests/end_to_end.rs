//! Full pipeline on real weights: decode → separate → library → export → re-decode.
//! Skips (passes) when the bundled weights aren't present (run `npm run fetch-models`).
//! Set PRISM_TEST_AUDIO to a song to use real music instead of a synthetic mix.

use std::path::{Path, PathBuf};

use prism_core::audio::{Audio, TrackInfo, conform, decode_file};
use prism_core::export::{ExportFormat, ExportOptions, MixGain, export_mix, export_stem, export_zip};
use prism_core::library::Library;
use prism_core::manifest::Quality;
use prism_core::models::ModelStore;
use prism_core::runtime::{Acceleration, RuntimeOptions};
use prism_core::separator::{self, SeparateOptions};
use prism_core::util::CancelToken;

fn models_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models")
}

fn synthetic() -> (Audio, TrackInfo) {
    let sr = 44100;
    let n = sr * 12;
    let c: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / sr as f32;
            0.3 * (t * 220.0 * std::f32::consts::TAU).sin() + 0.2 * ((t * 2.0).fract() < 0.05) as u8 as f32
        })
        .collect();
    let a = Audio { sample_rate: sr as u32, channels: vec![c.clone(), c] };
    let info = TrackInfo {
        title: "Test: Song".into(),
        artist: None,
        duration_secs: 12.0,
        sample_rate: sr as u32,
        channels: 2,
        file_name: "t.wav".into(),
    };
    (a, info)
}

#[test]
fn separate_store_export() {
    if !models_dir().join("htdemucs/htdemucs.onnx").exists() {
        eprintln!("skipping: bundled weights missing");
        return;
    }
    let t = tempfile::tempdir().unwrap();
    let store = ModelStore::new(models_dir(), t.path().join("user-models"));
    let model = store.get("htdemucs").unwrap();
    let cancel = CancelToken::new();
    let (audio, info) = match std::env::var("PRISM_TEST_AUDIO") {
        Ok(p) => {
            let (mut a, i) = decode_file(Path::new(&p), &cancel).unwrap();
            a.channels.iter_mut().for_each(|c| c.truncate(a.sample_rate as usize * 20));
            (a, i)
        }
        Err(_) => synthetic(),
    };
    let audio = conform(audio, 44100, 2).unwrap();
    let rt = RuntimeOptions { acceleration: Acceleration::Cpu, cache_dir: None };
    let mut sep = separator::load(&model, &rt).unwrap();
    let mut last = 0.0;
    let stems = separator::run(
        sep.as_mut(),
        &audio,
        &SeparateOptions { quality: Quality::Fast, preset_override: None },
        &mut |p| {
            assert!(p.fraction >= last - 1e-6, "progress must not go backwards");
            last = p.fraction;
        },
        &cancel,
    )
    .unwrap();
    assert_eq!(last, 1.0);
    assert_eq!(stems.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["drums", "bass", "other", "vocals"]);

    // The stems must add back up to (almost) the input.
    let mut err = 0f64;
    let mut sig = 0f64;
    for i in (0..audio.frames()).step_by(7) {
        let sum: f32 = stems.iter().map(|s| s.audio.channels[0][i]).sum();
        err += ((sum - audio.channels[0][i]) as f64).powi(2);
        sig += (audio.channels[0][i] as f64).powi(2);
    }
    let snr = 10.0 * (sig / err.max(1e-12)).log10();
    assert!(snr > 10.0, "stems don't sum back to the mix (SNR {snr:.1} dB)");

    let lib = Library::new(t.path().join("projects"));
    let p = lib.create(&info, &model.manifest, &stems, Quality::Fast, sep.device(), 1.0, None).unwrap();
    assert_eq!(lib.list().len(), 1);
    assert_eq!(lib.peaks(&p.id).unwrap().len(), 4);

    let out = t.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
    for fmt in [ExportFormat::Wav, ExportFormat::Flac, ExportFormat::Mp3] {
        let o = ExportOptions { format: fmt, mp3_bitrate: 320 };
        let f = out.join(format!("vocals.{}", fmt.ext()));
        export_stem(&lib, &p, "vocals", &o, &f).unwrap();
        let (a, _) = decode_file(&f, &cancel).unwrap();
        assert!((a.duration_secs() - audio.duration_secs()).abs() < 0.2, "{fmt:?}");
    }
    let karaoke: Vec<MixGain> = p
        .stems
        .iter()
        .map(|s| MixGain { stem_id: s.id.clone(), gain: if s.id == "vocals" { 0.0 } else { 1.0 } })
        .collect();
    export_mix(
        &lib,
        &p,
        &karaoke,
        &ExportOptions { format: ExportFormat::Wav, mp3_bitrate: 320 },
        &out.join("karaoke.wav"),
    )
    .unwrap();
    let zip_path = out.join("stems.zip");
    export_zip(
        &lib,
        &p,
        &ExportOptions { format: ExportFormat::Flac, mp3_bitrate: 320 },
        &zip_path,
        &t.path().join("tmp"),
        &mut |_| {},
        &cancel,
    )
    .unwrap();
    let z = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
    let mut names: Vec<String> = z.file_names().map(|n| n.unwrap().into_owned()).collect();
    names.sort();
    let t = prism_core::util::sanitize_filename(&p.title);
    let want: Vec<String> = ["bass", "drums", "other", "vocals"].iter().map(|s| format!("{t} - {s}.flac")).collect();
    assert_eq!(names, want);

    lib.delete(&p.id).unwrap();
    assert!(lib.list().is_empty());
}

#[test]
fn cancel_stops_separation() {
    if !models_dir().join("htdemucs/htdemucs.onnx").exists() {
        return;
    }
    let store = ModelStore::new(models_dir(), tempfile::tempdir().unwrap().path().to_path_buf());
    let model = store.get("htdemucs").unwrap();
    let (audio, _) = synthetic();
    let mut sep =
        separator::load(&model, &RuntimeOptions { acceleration: Acceleration::Cpu, cache_dir: None }).unwrap();
    let cancel = CancelToken::new();
    let c2 = cancel.clone();
    let r = separator::run(
        sep.as_mut(),
        &audio,
        &SeparateOptions::default(),
        &mut |p| {
            if p.fraction > 0.0 {
                c2.cancel()
            }
        },
        &cancel,
    );
    assert!(matches!(r, Err(prism_core::PrismError::Cancelled)));
}
