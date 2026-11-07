//! Recent projects: separated stems cached on disk so they reopen instantly.
//! Layout: `<root>/<uuid>/{project.json, peaks.json, stems/<stem>.wav}`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::audio::{TrackInfo, write_wav_f32};
use crate::manifest::{ModelManifest, Quality};
use crate::peaks::{PEAK_BUCKETS, peaks};
use crate::separator::StemOutput;
use crate::util::{dir_size, now_millis};
use crate::{PrismError, Result};

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub source_file_name: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    #[ts(type = "number")]
    pub created_at: u64,
    pub model: ProjectModel,
    pub quality: Quality,
    pub device: String,
    pub processing_secs: f32,
    pub stems: Vec<ProjectStem>,
}

/// Snapshot of the model that produced the stems (survives model removal).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectModel {
    pub id: String,
    pub name: String,
    pub architecture: String,
    pub version: Option<String>,
    pub license: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectStem {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
    pub file: String,
}

pub type Peaks = BTreeMap<String, Vec<f32>>;

pub struct Library {
    pub root: PathBuf,
}

impl Library {
    pub fn new(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(&root);
        Library { root }
    }

    fn dir(&self, id: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(id).map_err(|_| PrismError::Other("Unknown project.".into()))?;
        Ok(self.root.join(id))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        info: &TrackInfo,
        manifest: &ModelManifest,
        stems: &[StemOutput],
        quality: Quality,
        device: &str,
        processing_secs: f32,
    ) -> Result<Project> {
        let id = uuid::Uuid::new_v4().to_string();
        let dir = self.root.join(format!(".tmp-{id}"));
        fs::create_dir_all(dir.join("stems"))?;
        let res = (|| -> Result<Project> {
            let mut ps = Vec::new();
            let mut pk = Peaks::new();
            for s in stems {
                let def = manifest.stems.iter().find(|d| d.id == s.id);
                let file = format!("stems/{}.wav", s.id);
                write_wav_f32(&dir.join(&file), &s.audio)?;
                pk.insert(s.id.clone(), peaks(&s.audio, PEAK_BUCKETS));
                ps.push(ProjectStem {
                    id: s.id.clone(),
                    label: def.map_or_else(|| s.id.clone(), |d| d.label.clone()),
                    color: def.and_then(|d| d.color.clone()),
                    file,
                });
            }
            let p = Project {
                id: id.clone(),
                title: info.title.clone(),
                artist: info.artist.clone(),
                source_file_name: info.file_name.clone(),
                duration_secs: stems.first().map_or(info.duration_secs, |s| s.audio.duration_secs()),
                sample_rate: stems.first().map_or(info.sample_rate, |s| s.audio.sample_rate),
                created_at: now_millis(),
                model: ProjectModel {
                    id: manifest.id.clone(),
                    name: manifest.name.clone(),
                    architecture: manifest.architecture.clone(),
                    version: manifest.version.clone(),
                    license: manifest.license.clone(),
                },
                quality,
                device: device.into(),
                processing_secs,
                stems: ps,
            };
            fs::write(dir.join("peaks.json"), serde_json::to_vec(&pk)?)?;
            fs::write(dir.join("project.json"), serde_json::to_vec_pretty(&p)?)?;
            Ok(p)
        })();
        match res {
            Ok(p) => {
                fs::rename(&dir, self.root.join(&id))?;
                Ok(p)
            }
            Err(e) => {
                let _ = fs::remove_dir_all(&dir);
                Err(e)
            }
        }
    }

    pub fn list(&self) -> Vec<Project> {
        let Ok(rd) = fs::read_dir(&self.root) else { return vec![] };
        let mut v: Vec<Project> = rd
            .flatten()
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(|e| fs::read(e.path().join("project.json")).ok())
            .filter_map(|b| serde_json::from_slice(&b).ok())
            .collect();
        v.sort_by_key(|p| std::cmp::Reverse(p.created_at));
        v
    }

    pub fn get(&self, id: &str) -> Result<Project> {
        let b = fs::read(self.dir(id)?.join("project.json"))
            .map_err(|_| PrismError::Other("This project is no longer in the library.".into()))?;
        Ok(serde_json::from_slice(&b)?)
    }

    pub fn peaks(&self, id: &str) -> Result<Peaks> {
        let b = fs::read(self.dir(id)?.join("peaks.json"))?;
        Ok(serde_json::from_slice(&b)?)
    }

    pub fn stem_path(&self, p: &Project, stem_id: &str) -> Result<PathBuf> {
        let s = p
            .stems
            .iter()
            .find(|s| s.id == stem_id)
            .ok_or_else(|| PrismError::Other(format!("No “{stem_id}” stem in this project.")))?;
        Ok(self.dir(&p.id)?.join(&s.file))
    }

    pub fn rename(&self, id: &str, title: &str) -> Result<Project> {
        let mut p = self.get(id)?;
        let t = title.trim();
        if t.is_empty() || t.chars().count() > 200 {
            return Err(PrismError::Other("Titles must be 1–200 characters.".into()));
        }
        p.title = t.into();
        fs::write(self.dir(id)?.join("project.json"), serde_json::to_vec_pretty(&p)?)?;
        Ok(p)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let d = self.dir(id)?;
        if d.exists() {
            fs::remove_dir_all(d)?;
        }
        Ok(())
    }

    /// Delete every project older than `days` (0 = keep forever). Returns how many were removed.
    pub fn purge_older_than(&self, days: u32) -> usize {
        self.purge_before(now_millis(), days)
    }

    fn purge_before(&self, now: u64, days: u32) -> usize {
        if days == 0 {
            return 0;
        }
        let max_age = u64::from(days) * 24 * 60 * 60 * 1000;
        self.list()
            .into_iter()
            .filter(|p| now.saturating_sub(p.created_at) > max_age)
            .filter(|p| self.delete(&p.id).is_ok())
            .count()
    }

    pub fn clear(&self) -> Result<()> {
        for e in fs::read_dir(&self.root)?.flatten() {
            if e.path().is_dir() {
                fs::remove_dir_all(e.path())?;
            }
        }
        Ok(())
    }

    pub fn size_bytes(&self) -> u64 {
        dir_size(&self.root)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_project(lib: &Library, age_days: u64) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        fs::create_dir_all(lib.root.join(&id)).unwrap();
        let p = Project {
            id: id.clone(),
            title: "t".into(),
            artist: None,
            source_file_name: "t.wav".into(),
            duration_secs: 1.0,
            sample_rate: 44100,
            created_at: now_millis() - age_days * 24 * 60 * 60 * 1000,
            model: ProjectModel {
                id: "m".into(),
                name: "m".into(),
                architecture: "demucs".into(),
                version: None,
                license: "MIT".into(),
            },
            quality: Quality::Balanced,
            device: "cpu".into(),
            processing_secs: 1.0,
            stems: vec![],
        };
        fs::write(lib.root.join(&id).join("project.json"), serde_json::to_vec(&p).unwrap()).unwrap();
        id
    }

    #[test]
    fn purge_removes_only_expired_projects() {
        let root = std::env::temp_dir().join(format!("prism-purge-{}", uuid::Uuid::new_v4()));
        let lib = Library::new(root.clone());
        let old = fake_project(&lib, 10);
        let fresh = fake_project(&lib, 2);
        assert_eq!(lib.purge_older_than(0), 0, "0 days keeps everything");
        assert_eq!(lib.purge_older_than(7), 1);
        let ids: Vec<_> = lib.list().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![fresh]);
        assert!(!lib.root.join(old).exists());
        let _ = fs::remove_dir_all(root);
    }
}
