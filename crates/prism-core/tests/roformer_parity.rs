//! Parity of the BS-RoFormer adapter with the PyTorch reference that ships with the ONNX export
//! (`reference.npz`: one 4 s chunk, its spectrogram, and the reference stems). The weights are not
//! in the repository, so the test skips itself unless they have been downloaded:
//!
//!   tools/export/out/bs-roformer-sw/bs_roformer_sw_6stem_fp16.onnx
//!   tools/export/out/bs-roformer-sw/reference.npz
//!
//! (from https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx). It also checks that the
//! manifest shipped in `catalog/index.json` is valid for the adapter.

use std::io::Read;
use std::path::PathBuf;

use prism_core::adapters::roformer::RoFormer;
use prism_core::dsp::Stft;
use prism_core::manifest::ModelManifest;
use prism_core::runtime::{Acceleration, RuntimeOptions};

const CHUNK: usize = 176_400;
const BINS: usize = 1025;
const FRAMES: usize = 345;
const STEMS: usize = 6;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn catalog_manifest() -> ModelManifest {
    let text = std::fs::read_to_string(root().join("catalog/index.json")).expect("catalog/index.json");
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    let entry = v["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["manifest"]["id"] == "bs-roformer-sw")
        .expect("bs-roformer-sw in the catalog");
    ModelManifest::from_json(&entry["manifest"].to_string()).expect("the catalog manifest validates")
}

/// A float32 `.npy` array out of the npz: just the values (the shape is checked by length).
fn npy(npz: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Vec<f32> {
    let mut f = npz.by_name(name).unwrap_or_else(|_| panic!("{name} in reference.npz"));
    let mut b = Vec::new();
    f.read_to_end(&mut b).unwrap();
    assert_eq!(&b[..6], b"\x93NUMPY");
    let header = if b[6] == 1 {
        10 + u16::from_le_bytes([b[8], b[9]]) as usize
    } else {
        12 + u32::from_le_bytes([b[8], b[9], b[10], b[11]]) as usize
    };
    assert!(String::from_utf8_lossy(&b[10..header.min(b.len())]).contains("<f4"), "{name} is not float32");
    b[header..].as_chunks::<4>().0.iter().map(|c| f32::from_le_bytes(*c)).collect()
}

fn snr_db(reference: &[f32], got: &[f32]) -> f64 {
    let sig: f64 = reference.iter().map(|v| (*v as f64).powi(2)).sum();
    let err: f64 = reference.iter().zip(got).map(|(a, b)| ((*a - *b) as f64).powi(2)).sum();
    10.0 * (sig / err.max(1e-30)).log10()
}

#[test]
fn the_catalog_manifest_is_valid() {
    let m = catalog_manifest();
    assert_eq!(
        m.stems.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        ["bass", "drums", "other", "vocals", "guitar", "piano"]
    );
    assert!(m.is_non_commercial(), "the licence is unverified, so the model is flagged non-commercial");
}

#[test]
fn matches_the_pytorch_reference() {
    let dir = root().join("tools/export/out/bs-roformer-sw");
    let (onnx, npz) = (dir.join("bs_roformer_sw_6stem_fp16.onnx"), dir.join("reference.npz"));
    if !onnx.exists() || !npz.exists() {
        eprintln!("skipped: download the ONNX export and reference.npz into {} to run this test", dir.display());
        return;
    }
    // A model folder for the adapter: the shipped manifest plus the downloaded weights.
    let tmp = std::env::temp_dir().join(format!("prism-roformer-parity-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let manifest = catalog_manifest();
    let weights = manifest.weight_files()[0].file.clone();
    let _ = std::fs::remove_file(tmp.join(&weights));
    #[cfg(unix)]
    std::os::unix::fs::symlink(&onnx, tmp.join(&weights)).unwrap();
    #[cfg(not(unix))]
    std::fs::copy(&onnx, tmp.join(&weights)).unwrap();

    let mut npz = zip::ZipArchive::new(std::fs::File::open(&npz).unwrap()).unwrap();
    let input = npy(&mut npz, "input_audio.npy");
    assert_eq!(input.len(), 2 * CHUNK);
    let mix: Vec<Vec<f32>> = input.chunks(CHUNK).map(|c| c.to_vec()).collect();

    // 1. The host STFT is the one the model was exported against.
    let (spec_re, spec_im) = (npy(&mut npz, "spec_real.npy"), npy(&mut npz, "spec_imag.npy"));
    assert_eq!(spec_re.len(), 2 * BINS * FRAMES);
    let stft = Stft::new(2048, 512, false);
    let mut worst = 0f32;
    for (ch, x) in mix.iter().enumerate() {
        let z = stft.forward(x);
        assert_eq!(z.frames, FRAMES);
        for f in 0..BINS {
            for t in 0..FRAMES {
                let c = z.at(t, f);
                let i = (ch * BINS + f) * FRAMES + t;
                worst = worst.max((c.re - spec_re[i]).abs()).max((c.im - spec_im[i]).abs());
            }
        }
    }
    assert!(worst < 5e-3, "STFT differs from the reference by up to {worst}");

    // 2. The whole chunk pipeline (STFT → model → inverse STFT) matches the reference stems.
    let rt = RuntimeOptions { acceleration: Acceleration::Cpu, cache_dir: None };
    let mut model = RoFormer::new(&manifest, &tmp, &rt, &mut |_| {}).expect("the session loads");
    let stems = model.infer_chunk(&mix).expect("inference runs");
    let reference = npy(&mut npz, "ref_audio.npy");
    assert_eq!(reference.len(), STEMS * 2 * CHUNK);
    for (s, per_ch) in stems.iter().enumerate() {
        let got: Vec<f32> = per_ch.iter().flatten().copied().collect();
        let want = &reference[s * 2 * CHUNK..(s + 1) * 2 * CHUNK];
        let snr = snr_db(want, &got);
        eprintln!("{:>7}: {snr:.1} dB", manifest.stems[s].id);
        assert!(snr > 35.0, "{} differs from the reference (SNR {snr:.1} dB)", manifest.stems[s].id);
    }
    let _ = std::fs::remove_dir_all(&tmp);
}
