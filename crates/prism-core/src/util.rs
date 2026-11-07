use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{PrismError, Result};

/// Cooperative cancellation shared between a running job and whoever may cancel it.
#[derive(Clone, Default, Debug)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() { Err(PrismError::Cancelled) } else { Ok(()) }
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Make a string safe to use as a file name on macOS/Windows/Linux.
pub fn sanitize_filename(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let out: String = trimmed.chars().take(120).collect();
    if out.is_empty() { "Untitled".into() } else { out }
}

/// A plain file name: no directories, no traversal, no hidden files.
pub fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.starts_with('.') && !name.contains(['/', '\\', '\0']) && name != ".."
}

/// Atomically move `from` over `to`. Windows' rename refuses to replace an existing
/// file, so the old one is removed first there.
pub fn replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)]
    if to.is_file() {
        std::fs::remove_file(to)?;
    }
    std::fs::rename(from, to)
}

pub fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(path) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Small deterministic PRNG (xorshift64*) for Demucs' random shifts.
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    /// Uniform integer in `0..=max`.
    pub fn below_incl(&mut self, max: usize) -> usize {
        (self.next_u64() % (max as u64 + 1)) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sanitizes() {
        assert_eq!(sanitize_filename("AC/DC: Back?"), "AC_DC_ Back_");
        assert_eq!(sanitize_filename("  .. "), "Untitled");
        assert!(!is_plain_file_name("../x.onnx"));
        assert!(is_plain_file_name("htdemucs.onnx"));
    }
}
