//! Downloadable model catalog: a JSON index (URL in settings). Downloads are
//! HTTPS-only, size-checked, SHA-256 verified *before* the model is installed,
//! and staged so a cancelled/failed download never leaves a usable model.
//! The app works fully without the catalog.

use std::fs;
use std::io::{Read, Write};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::manifest::{MAX_WEIGHT_BYTES, ModelManifest};
use crate::models::{InstalledModel, ModelStore};
use crate::util::CancelToken;
use crate::{PrismError, Result};

const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct Catalog {
    pub schema_version: u32,
    pub models: Vec<CatalogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct CatalogEntry {
    pub manifest: ModelManifest,
    pub files: Vec<CatalogFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct CatalogFile {
    /// Must match a `weights` file name in the manifest.
    pub file: String,
    pub url: String,
    #[ts(type = "number")]
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DownloadProgress {
    #[ts(type = "number")]
    pub done: u64,
    #[ts(type = "number")]
    pub total: u64,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .https_only(true)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_body(None)
        .user_agent(concat!("Prism/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn net(e: impl std::fmt::Display) -> PrismError {
    PrismError::Network(format!("Couldn't reach the model catalog: {e}"))
}

impl CatalogEntry {
    pub fn total_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.bytes).sum()
    }

    /// Catalog entries must be fully pinned: every weight has a checksum and an https URL.
    pub fn validate(&self) -> Result<()> {
        self.manifest.validate()?;
        let bad = |m: String| Err(PrismError::InvalidModel(format!("Catalog entry “{}”: {m}", self.manifest.id)));
        let weights = self.manifest.weight_files();
        if weights.len() != self.files.len() {
            return bad("files don't match the manifest's weights".into());
        }
        for w in &weights {
            let Some(f) = self.files.iter().find(|f| f.file == w.file) else {
                return bad(format!("no download for “{}”", w.file));
            };
            if w.sha256.is_none() {
                return bad(format!("“{}” has no sha256", w.file));
            }
            if !f.url.starts_with("https://") {
                return bad("downloads must use https".into());
            }
            if f.bytes == 0 || f.bytes > MAX_WEIGHT_BYTES {
                return bad("invalid file size".into());
            }
        }
        Ok(())
    }
}

/// Fetch and validate the index. Invalid entries are dropped (reported in `Err` only
/// if the index itself is unusable).
pub fn fetch(url: &str) -> Result<(Catalog, Vec<String>)> {
    if !url.starts_with("https://") {
        return Err(PrismError::Network("The catalog URL must start with https://".into()));
    }
    let mut resp = agent().get(url).call().map_err(net)?;
    let text = resp.body_mut().with_config().limit(MAX_INDEX_BYTES).read_to_string().map_err(net)?;
    parse(&text)
}

pub fn parse(text: &str) -> Result<(Catalog, Vec<String>)> {
    let mut c: Catalog = serde_json::from_str(text)
        .map_err(|e| PrismError::Network(format!("The model catalog is malformed: {e}")))?;
    if c.schema_version != 1 {
        return Err(PrismError::Network("This catalog needs a newer version of Prism.".into()));
    }
    let mut warnings = vec![];
    c.models.retain(|e| match e.validate() {
        Ok(()) => true,
        Err(err) => {
            warnings.push(err.to_string());
            false
        }
    });
    Ok((c, warnings))
}

/// Download, verify and install. `progress` gets bytes done / total.
pub fn install(
    entry: &CatalogEntry,
    store: &ModelStore,
    progress: &mut dyn FnMut(DownloadProgress),
    cancel: &CancelToken,
) -> Result<InstalledModel> {
    entry.validate()?;
    if store.exists(&entry.manifest.id) {
        return Err(PrismError::InvalidModel(format!("“{}” is already installed.", entry.manifest.name)));
    }
    let staging = store.new_staging()?;
    let res = (|| -> Result<()> {
        let total = entry.total_bytes();
        let mut done = 0u64;
        let agent = agent();
        for w in entry.manifest.weight_files() {
            let f = entry.files.iter().find(|f| f.file == w.file).unwrap();
            let mut resp = agent.get(&f.url).call().map_err(net)?;
            let mut reader = resp.body_mut().with_config().limit(f.bytes + 1).reader();
            let mut out = fs::File::create(staging.join(&w.file))?;
            let mut h = Sha256::new();
            let mut buf = vec![0u8; 1 << 20];
            let mut got = 0u64;
            let mut last = 0u64;
            loop {
                cancel.check()?;
                let n = reader.read(&mut buf).map_err(net)?;
                if n == 0 {
                    break;
                }
                got += n as u64;
                if got > f.bytes {
                    return Err(PrismError::Network(format!("“{}” is larger than the catalog says.", w.file)));
                }
                h.update(&buf[..n]);
                out.write_all(&buf[..n])?;
                if got - last > (1 << 20) * 4 {
                    last = got;
                    progress(DownloadProgress { done: done + got, total });
                }
            }
            out.flush()?;
            let digest = hex::encode(h.finalize());
            if !w.sha256.as_deref().is_some_and(|s| s.eq_ignore_ascii_case(&digest)) {
                return Err(PrismError::InvalidModel(format!(
                    "“{}” failed checksum verification and was discarded.",
                    w.file
                )));
            }
            done += got;
            progress(DownloadProgress { done, total });
        }
        fs::write(staging.join(crate::manifest::MANIFEST_FILE), serde_json::to_vec_pretty(&entry.manifest)?)?;
        Ok(())
    })();
    if let Err(e) = res {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    store.commit_staged(&staging, &entry.manifest)
}

#[cfg(test)]
mod tests {
    #[test]
    fn repo_catalog_is_valid() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/index.json")).unwrap();
        let (c, warnings) = super::parse(&text).unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        assert!(c.models.len() >= 2);
    }

    #[test]
    fn rejects_http_and_unpinned_entries() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../catalog/index.json")).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&text).unwrap();
        v["models"][0]["files"][0]["url"] = "http://example.com/x.onnx".into();
        v["models"][1]["manifest"]["weights"][0]["sha256"] = serde_json::Value::Null;
        let (c, warnings) = super::parse(&v.to_string()).unwrap();
        assert_eq!(warnings.len(), 2);
        assert_eq!(c.models.len(), v["models"].as_array().unwrap().len() - 2);
    }
}
