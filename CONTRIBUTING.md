# Contributing to Prism

Thanks for helping! Prism is a small project, so the process is light.

## Setup

```bash
npm install
npm run fetch-models   # bundled Demucs weights, SHA-256 verified
npx tauri dev
```

`npm run dev` runs only the UI in a browser with a mock backend, which is the fastest way to work on the interface.

## Before you open a pull request

```bash
npm run typecheck
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

CI runs the same checks on macOS and builds the app bundle.

## Guidelines

- **No model special cases.** Stems, colors and names come from `model.json`. A new architecture is a new adapter in `crates/prism-core/src/adapters/` plus a parity test — see the README.
- **ONNX only.** Never add code that loads pickled checkpoints (`.pt`, `.th`, `.ckpt`).
- **Design tokens only.** Colors live in `src/styles/tokens.css` (light and dark). Components use the variables, never raw hex values.
- **Shortcuts in one place.** Add a shortcut to `src/lib/shortcuts.ts`, mirror ⌘ shortcuts in `src-tauri/src/menu.rs`, and update the README table.
- **Rust types shared with the UI** are generated with ts-rs — run `cargo test -p prism-core` and commit `src/bindings`.
- **Keep the UI thread free.** Heavy work belongs in Rust background jobs.

## Reporting bugs

Use the bug report template. Please don't attach copyrighted audio; describe the file (format, length, sample rate) instead.
