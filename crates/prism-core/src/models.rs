//! Installed models: the bundled default(s) (read-only) plus user models in the
//! app data dir. Import validates the manifest, verifies checksums and copies
//! only the manifest, the listed weights and license/readme text. Nothing in a
//! model package is ever executed.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::manifest::{MANIFEST_FILE, MAX_WEIGHT_BYTES, ModelManifest, Quality};
use crate::util::{CancelToken, dir_size, is_plain_file_name};
use crate::{PrismError, Result};

pub const DEFAULT_MODEL_ID: &str = "htdemucs";
const EXTRA_FILES: &[&str] = &["LICENSE", "LICENSE.txt", "LICENSE.md", "README.md", "README.txt"];

#[derive(Clone, Debug)]
pub struct InstalledModel {
    pub manifest: ModelManifest,
    pub dir: PathBuf,
    pub bundled: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelInfo {
    pub manifest: ModelManifest,
    pub bundled: bool,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub non_commercial: bool,
    pub qualities: Vec<Quality>,
    /// Set when weights are missing; the model can't be used.
    pub problem: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelProblem {
    pub folder: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelListing {
    pub models: Vec<ModelInfo>,
    pub problems: Vec<ModelProblem>,
}

pub struct ModelStore {
    pub bundled_dir: PathBuf,
    pub user_dir: PathBuf,
}

impl ModelStore {
    pub fn new(bundled_dir: PathBuf, user_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&user_dir);
        ModelStore { bundled_dir, user_dir }
    }

    fn scan(&self, root: &Path, bundled: bool, out: &mut Vec<InstalledModel>, problems: &mut Vec<ModelProblem>) {
        let Ok(rd) = fs::read_dir(root) else { return };
        let mut dirs: Vec<_> = rd.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for e in dirs {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            match ModelManifest::load(&e.path()) {
                Ok(m) if bundled || m.id == name => out.push(InstalledModel { manifest: m, dir: e.path(), bundled }),
                Ok(m) => problems.push(ModelProblem {
                    folder: name,
                    message: format!("Folder name doesn't match model id “{}”.", m.id),
                }),
                Err(err) => problems.push(ModelProblem { folder: name, message: err.to_string() }),
            }
        }
    }

    pub fn installed(&self) -> (Vec<InstalledModel>, Vec<ModelProblem>) {
        let mut out = Vec::new();
        let mut problems = Vec::new();
        self.scan(&self.bundled_dir, true, &mut out, &mut problems);
        let mut user = Vec::new();
        self.scan(&self.user_dir, false, &mut user, &mut problems);
        for u in user {
            if out.iter().any(|b| b.manifest.id == u.manifest.id) {
                problems.push(ModelProblem {
                    folder: u.manifest.id.clone(),
                    message: "Duplicates a built-in model id and is ignored.".into(),
                });
            } else {
                out.push(u);
            }
        }
        (out, problems)
    }

    pub fn list(&self) -> ModelListing {
        let (models, problems) = self.installed();
        let models = models
            .into_iter()
            .map(|m| {
                let missing: Vec<String> = m
                    .manifest
                    .weight_files()
                    .into_iter()
                    .filter(|w| !m.dir.join(&w.file).is_file())
                    .map(|w| w.file)
                    .collect();
                ModelInfo {
                    size_bytes: dir_size(&m.dir),
                    non_commercial: m.manifest.is_non_commercial(),
                    qualities: m.manifest.supported_qualities(),
                    problem: (!missing.is_empty()).then(|| format!("Missing weights: {}", missing.join(", "))),
                    bundled: m.bundled,
                    manifest: m.manifest,
                }
            })
            .collect();
        ModelListing { models, problems }
    }

    pub fn get(&self, id: &str) -> Result<InstalledModel> {
        self.installed()
            .0
            .into_iter()
            .find(|m| m.manifest.id == id)
            .ok_or_else(|| PrismError::ModelMissing(format!("The model “{id}” isn't installed.")))
    }

    pub fn exists(&self, id: &str) -> bool {
        self.get(id).is_ok()
    }

    /// Import a model folder or a .zip containing one.
    pub fn import(&self, path: &Path, cancel: &CancelToken) -> Result<InstalledModel> {
        if path.is_dir() {
            return self.import_dir(path, cancel);
        }
        let is_zip = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip"));
        if !is_zip {
            return Err(PrismError::InvalidModel(
                "Choose a model folder (with model.json) or a .zip containing one.".into(),
            ));
        }
        let staging = self.staging_dir()?;
        let res = extract_zip(path, &staging).and_then(|root| self.import_dir(&root, cancel));
        let _ = fs::remove_dir_all(&staging);
        res
    }

    fn staging_dir(&self) -> Result<PathBuf> {
        let d = self.user_dir.join(format!(".staging-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d)?;
        Ok(d)
    }

    fn import_dir(&self, src: &Path, cancel: &CancelToken) -> Result<InstalledModel> {
        let m = ModelManifest::load(src)?;
        if self.exists(&m.id) {
            return Err(PrismError::InvalidModel(format!(
                "A model with id “{}” is already installed. Remove it first to replace it.",
                m.id
            )));
        }
        for w in m.weight_files() {
            let p = src.join(&w.file);
            let meta = fs::symlink_metadata(&p)
                .map_err(|_| PrismError::InvalidModel(format!("The weights file “{}” is missing.", w.file)))?;
            if !meta.is_file() {
                return Err(PrismError::InvalidModel(format!("“{}” must be a regular file.", w.file)));
            }
            if meta.len() > MAX_WEIGHT_BYTES {
                return Err(PrismError::InvalidModel(format!("“{}” is larger than 4 GB.", w.file)));
            }
            check_onnx_magic(&p)?;
            if let Some(expected) = &w.sha256 {
                let got = sha256_file(&p, cancel)?;
                if !got.eq_ignore_ascii_case(expected) {
                    return Err(PrismError::InvalidModel(format!(
                        "Checksum mismatch for “{}”. The file is corrupt or not the one model.json describes.",
                        w.file
                    )));
                }
            }
        }
        let staging = self.staging_dir()?;
        let copy = (|| -> Result<()> {
            fs::write(staging.join(MANIFEST_FILE), serde_json::to_vec_pretty(&m)?)?;
            for w in m.weight_files() {
                cancel.check()?;
                fs::copy(src.join(&w.file), staging.join(&w.file))?;
            }
            for extra in EXTRA_FILES {
                let p = src.join(extra);
                if fs::symlink_metadata(&p).is_ok_and(|md| md.is_file() && md.len() < 1_000_000) {
                    fs::copy(&p, staging.join(extra))?;
                }
            }
            Ok(())
        })();
        if let Err(e) = copy {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
        self.commit_staged(&staging, &m)
    }

    /// Atomically move a fully verified staging folder into place.
    pub fn commit_staged(&self, staging: &Path, m: &ModelManifest) -> Result<InstalledModel> {
        let dest = self.user_dir.join(&m.id);
        if dest.exists() {
            let _ = fs::remove_dir_all(staging);
            return Err(PrismError::InvalidModel(format!("“{}” is already installed.", m.id)));
        }
        fs::rename(staging, &dest)?;
        Ok(InstalledModel { manifest: m.clone(), dir: dest, bundled: false })
    }

    pub fn new_staging(&self) -> Result<PathBuf> {
        self.staging_dir()
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let m = self.get(id)?;
        if m.bundled {
            return Err(PrismError::InvalidModel(
                "Built-in models can't be deleted. You can hide them instead.".into(),
            ));
        }
        if !m.dir.starts_with(&self.user_dir) {
            return Err(PrismError::Other("Refusing to delete outside the models folder.".into()));
        }
        fs::remove_dir_all(&m.dir)?;
        Ok(())
    }
}

/// ONNX files are protobuf; reject obvious non-ONNX (zip/pickle) payloads early.
fn check_onnx_magic(p: &Path) -> Result<()> {
    let mut f = fs::File::open(p)?;
    let mut head = [0u8; 4];
    let n = f.read(&mut head)?;
    let looks_zip = n >= 2 && &head[..2] == b"PK";
    let looks_pickle = n >= 1 && head[0] == 0x80;
    if n < 4 || looks_zip || looks_pickle || head[0] != 0x08 {
        return Err(PrismError::InvalidModel(format!(
            "“{}” isn't a valid ONNX model.",
            p.file_name().unwrap_or_default().to_string_lossy()
        )));
    }
    Ok(())
}

pub fn sha256_file(p: &Path, cancel: &CancelToken) -> Result<String> {
    let mut f = fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        cancel.check()?;
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Extract only safe, expected entries; returns the folder holding model.json.
fn extract_zip(zip_path: &Path, dest: &Path) -> Result<PathBuf> {
    let bad = |m: &str| PrismError::InvalidModel(m.to_string());
    let f = fs::File::open(zip_path)?;
    let mut z = zip::ZipArchive::new(f).map_err(|_| bad("The .zip file is damaged or not a zip."))?;
    if z.len() > 64 {
        return Err(bad("The .zip has too many files for a model package."));
    }
    // Locate model.json (at the root or inside a single top-level folder).
    let mut prefix: Option<PathBuf> = None;
    for i in 0..z.len() {
        let e = z.by_index(i).map_err(|_| bad("The .zip file is damaged."))?;
        let Some(p) = e.enclosed_name() else { return Err(bad("The .zip contains unsafe paths.")) };
        if p.file_name().is_some_and(|n| n == MANIFEST_FILE) && p.components().count() <= 2 {
            prefix = Some(p.parent().map(Path::to_path_buf).unwrap_or_default());
        }
    }
    let prefix = prefix.ok_or_else(|| bad("No model.json found in the .zip."))?;
    let mut total: u64 = 0;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|_| bad("The .zip file is damaged."))?;
        if e.is_dir() {
            continue;
        }
        let Some(p) = e.enclosed_name() else { return Err(bad("The .zip contains unsafe paths.")) };
        if p.parent().map(Path::to_path_buf).unwrap_or_default() != prefix {
            continue;
        }
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        let wanted = name == MANIFEST_FILE || name.ends_with(".onnx") || EXTRA_FILES.contains(&name.as_str());
        if !wanted || !is_plain_file_name(&name) {
            continue; // never extract anything else
        }
        total += e.size();
        if e.size() > MAX_WEIGHT_BYTES || total > 2 * MAX_WEIGHT_BYTES {
            return Err(bad("The .zip is too large."));
        }
        let mut out = fs::File::create(dest.join(&name))?;
        let mut buf = vec![0u8; 1 << 20];
        let mut written: u64 = 0;
        loop {
            let n = e.read(&mut buf).map_err(|_| bad("The .zip file is damaged."))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > e.size() {
                return Err(bad("The .zip is malformed."));
            }
            out.write_all(&buf[..n])?;
        }
    }
    Ok(dest.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_model(dir: &Path, id: &str, weights: &[u8], sha: Option<String>) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("w.onnx"), weights).unwrap();
        let mut m = serde_json::json!({
            "id": id, "name": "Test", "architecture": "mdx-net", "weights": "w.onnx",
            "sampleRate": 44100, "channels": 2,
            "stems": [{"id": "vocals", "label": "Vocals"}, {"id": "instrumental", "label": "Instrumental", "source": "residual"}],
            "chunkSeconds": 6, "overlap": 0.25, "license": "MIT", "author": "t", "description": "",
            "params": {"nFft": 6144, "dimF": 2048, "dimT": 256}
        });
        if let Some(s) = sha {
            m["sha256"] = s.into();
        }
        fs::write(dir.join("model.json"), m.to_string()).unwrap();
        fs::write(dir.join("payload.sh"), "echo pwned").unwrap();
    }

    #[test]
    fn import_verifies_and_copies_only_expected_files() {
        let t = tempfile::tempdir().unwrap();
        let store = ModelStore::new(t.path().join("bundled"), t.path().join("user"));
        let src = t.path().join("src");
        let bytes = b"\x08\x07fake-onnx".to_vec();
        let sha = hex::encode(Sha256::digest(&bytes));
        write_model(&src, "test-model", &bytes, Some(sha));
        let m = store.import(&src, &CancelToken::new()).unwrap();
        assert!(m.dir.join("w.onnx").exists());
        assert!(!m.dir.join("payload.sh").exists());
        assert!(store.import(&src, &CancelToken::new()).is_err(), "duplicate id");
        store.remove("test-model").unwrap();
        assert!(!store.exists("test-model"));
    }

    #[test]
    fn import_rejects_bad_checksum_and_pickles() {
        let t = tempfile::tempdir().unwrap();
        let store = ModelStore::new(t.path().join("b"), t.path().join("u"));
        let src = t.path().join("src");
        write_model(&src, "x", b"\x08\x07fake", Some("0".repeat(64)));
        let e = store.import(&src, &CancelToken::new()).unwrap_err().to_string();
        assert!(e.contains("Checksum"), "{e}");
        let src2 = t.path().join("src2");
        write_model(&src2, "y", b"\x80\x02pickle", None);
        assert!(store.import(&src2, &CancelToken::new()).is_err());
    }
}
