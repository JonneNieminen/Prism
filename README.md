# Prism

**A song goes in as white light and comes out as colored beams.** Prism separates music into stems — vocals, drums, bass and more — with a local AI model. Mute the vocals for karaoke, solo the bass to learn a line, export any combination. Everything runs offline on your Mac; your audio never leaves it.

- **Separate** MP3, WAV, FLAC, M4A (AAC/ALAC) and OGG with Demucs v4 (bundled) or any compatible model
- **Play** every stem in sync with mute / solo / volume, a shared playhead, Karaoke and A cappella shortcuts
- **Export** single stems, all stems as a `.zip`, or the current mix — WAV (24-bit), FLAC or MP3 (128–320 kbps)
- **Library** of past separations that reopen instantly, with the model that made them
- **Models**: import your own (folder or `.zip`), or download more from a checksum-verified catalog
- Apple Silicon acceleration via Core ML (≈11× realtime on an M1 Pro), automatic CPU fallback

## Architecture

```
React UI (src/) ──typed IPC──▶ Tauri commands (src-tauri/) ──▶ prism-core (crates/prism-core/)
  Web Audio player                 background jobs + events        decode → Separator → library → export
                                                                    ONNX Runtime (Core ML / CPU), Rust STFT
```

Inference is **ONNX Runtime in Rust** — no Python sidecar. Demucs' STFT/iSTFT don't export cleanly to ONNX, so the graph takes and returns spectrograms and Prism does the STFT, chunking, overlap-add and time-shift averaging in Rust (`crates/prism-core/src/{dsp,adapters}`). The output matches stock PyTorch Demucs to within float rounding (82–95 dB SNR on real music; see *Verifying parity*).

Why not a PyTorch sidecar: ~1 GB larger, slow cold start, painful to sign, and pickled checkpoints can execute code. ONNX can't.

## Setup

Requirements: macOS 13+ on Apple Silicon (primary target), Node 20+, Rust (stable, via rustup), Xcode command line tools.

```bash
npm install
npm run fetch-models     # downloads the bundled Demucs weights (~174 MB) and verifies their SHA-256
npx tauri dev            # run the app
```

`npm run dev` runs only the UI in a browser with a mock backend — handy for UI work.

### Build

```bash
npx tauri build          # → target/release/bundle/{macos/Prism.app, dmg/Prism_*.dmg}
```

The bundled model is copied into the app, so the first launch works fully offline. The build is unsigned; on first open use right-click → Open.

### Tests

```bash
cargo test -p prism-core                       # unit + end-to-end (decode → separate → export)
PRISM_TEST_AUDIO=~/Music/song.mp3 cargo test -p prism-core --test end_to_end
npm run typecheck
```

## Adding your own model

A model is a folder with a `model.json` and ONNX weights. Prism only runs **ONNX** files — PyTorch checkpoints (`.pt`, `.th`, `.ckpt`) are refused because they can execute code when loaded.

```jsonc
{
  "schemaVersion": 1,
  "id": "my-vocals",                 // a–z 0–9 . _ -, unique
  "name": "My vocal model",
  "architecture": "mdx-net",         // which adapter runs it: "demucs" or "mdx-net"
  "weights": "model.onnx",           // or a list: [{ "file", "sha256", "stemWeights" }]
  "sha256": "…64 hex…",              // optional for imports, required in catalogs
  "sampleRate": 44100,
  "channels": 2,
  "stems": [                         // in the model's output order
    { "id": "vocals", "label": "Vocals" },
    { "id": "instrumental", "label": "Instrumental", "color": "#5AB0FF", "source": "residual" }
  ],
  "chunkSeconds": 5.92,
  "overlap": 0.5,
  "license": "MIT",                  // non-commercial licenses (e.g. CC-BY-NC) are flagged in the UI
  "author": "You",
  "description": "Clean vocals",
  "hints": { "speed": 4, "quality": 4 },            // 1–5, shown in the model picker
  "quality": { "fast": { "overlap": 0.25 }, "balanced": { "overlap": 0.5 }, "best": { "overlap": 0.75 } },
  "params": { "nFft": 7680, "hop": 1024, "dimF": 3072, "dimT": 256, "compensate": 1.021 }
}
```

- **Stems** drive everything in the UI: cards, colors, export names. `vocals`, `drums`, `bass`, `guitar`, `piano` and `other` use Prism's palette; others use `color` or a generated color. A `"source": "residual"` stem is computed as *mix − the model's other stems*.
- **Import** it in *Models → Import folder / Import .zip*. Prism validates the manifest, checks the checksum if given, and copies only `model.json`, the listed weights and a LICENSE/README.

### Supported architectures

| `architecture` | Typical models | `params` |
|---|---|---|
| `demucs` | htdemucs, htdemucs_6s, htdemucs_ft (exported with `tools/export`) | `segmentSamples`, `nfft` (4096), `hop` (1024) |
| `mdx-net` | UVR MDX-Net ONNX models (input `[1, 4, dimF, dimT]`) | `nFft`, `hop`, `dimF`, `dimT`, `compensate`, `denoise` |

Converting a Demucs checkpoint: `cd tools/export && uv sync && uv run python export_demucs.py htdemucs_6s` (pinned torch/demucs; dev-time only).

### Writing a new adapter (e.g. BS-RoFormer, Mel-Band RoFormer)

1. Add `crates/prism-core/src/adapters/<name>.rs` with `validate(&ModelManifest)` (check `params`) and a type implementing `Separator` (`separate(audio, options, progress, cancel) → stems`). Reuse `dsp::Stft` (torch-compatible) and `runtime::session` (Core ML/CPU).
2. Register it in `adapters/mod.rs` (`SUPPORTED`, `validate`, `create`). Nothing else in the app needs to change.
3. Add a parity check against the reference implementation (see `tools/export/verify_*.py`).

## Model catalog

*Models → Catalog* reads a JSON index (URL in Settings; default: [`catalog/index.json`](catalog/index.json) in this repo). Each entry is a manifest plus download URLs. Downloads are HTTPS-only, size-checked and SHA-256 verified in a staging folder before the model becomes usable. Demucs variants are hosted on this repo's `models-v1` release; the MDX-Net models link to the official UVR model repository.

## Verifying parity

```bash
cd tools/export && uv sync
uv run python export_demucs.py htdemucs                  # export + torch self-check
uv run python verify_demucs.py song.mp3 --seconds 30     # ONNX vs PyTorch, writes reference stems to out/ref
cd ../.. && cargo build -p prism-cli
./target/debug/prism separate tools/export/out/ref/mix.wav --model models/htdemucs --shifts 0 --overlap 0.25 --cpu --out /tmp/rust
for s in drums bass other vocals; do ./target/debug/prism compare /tmp/rust/$s.wav tools/export/out/ref/$s.wav; done
```

## Privacy & security

- No network access except the model catalog you open yourself.
- Stems and settings live in `~/Library/Application Support/com.jonnenieminen.prism`; compiled Core ML models in `~/Library/Caches/com.jonnenieminen.prism`. Both can be cleared in Settings.
- Model packages are never executed; only `.onnx` weights are loaded.

## Licenses

Prism is MIT. Demucs (code and weights) is MIT, © Meta Platforms. UVR MDX-Net models are from the Ultimate Vocal Remover project (MIT).
