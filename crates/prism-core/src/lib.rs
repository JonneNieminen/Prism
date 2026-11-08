//! Prism engine. Everything the UI needs, with no UI or Tauri dependencies.
//!
//! Flow: [`audio::decode_file`] → [`separator::load`] (picks an adapter from the
//! manifest's `architecture`) → [`separator::Separator::separate`] → [`library`]
//! caches stems → [`export`] encodes them.

pub mod adapters;
pub mod audio;
pub mod catalog;
pub mod dsp;
pub mod error;
pub mod export;
pub mod library;
pub mod manifest;
pub mod models;
pub mod musicinfo;
pub mod peaks;
pub mod runtime;
pub mod separator;
pub mod settings;
pub mod track;
pub mod util;

pub use error::{PrismError, Result};
