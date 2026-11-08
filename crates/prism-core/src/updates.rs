//! What the latest GitHub release says. The updater itself (checking, verifying and installing)
//! lives in `src-tauri`; this only fetches the release notes so Settings can show them even when
//! the app is already up to date. Two calls an hour at most is far below GitHub's anonymous limit.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{PrismError, Result};

/// The repository releases are published to.
pub const REPO: &str = "JonneNieminen/Prism";

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReleaseInfo {
    /// "1.2.0" (the tag without its "v").
    pub version: String,
    pub name: String,
    /// The release notes, in Markdown.
    pub notes: String,
    pub url: String,
    /// "2026-11-08".
    pub date: Option<String>,
    pub prerelease: bool,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
}

const MAX_BYTES: u64 = 512 * 1024;

fn net(e: impl std::fmt::Display) -> PrismError {
    PrismError::Network(format!("Couldn't reach GitHub: {e}"))
}

/// The newest published release of `repo` ("owner/name").
pub fn latest_release(repo: &str) -> Result<ReleaseInfo> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .https_only(true)
        .timeout_global(Some(Duration::from_secs(20)))
        .user_agent(concat!("Prism/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let mut resp = agent.get(&url).header("Accept", "application/vnd.github+json").call().map_err(|e| match e {
        ureq::Error::StatusCode(404) => PrismError::Network("There are no published releases yet.".into()),
        other => net(other),
    })?;
    let text = resp.body_mut().with_config().limit(MAX_BYTES).read_to_string().map_err(net)?;
    parse_release(&text)
}

fn parse_release(json: &str) -> Result<ReleaseInfo> {
    let r: GitHubRelease = serde_json::from_str(json)
        .map_err(|_| PrismError::Network("GitHub sent a release Prism couldn't read.".into()))?;
    let version = r.tag_name.trim_start_matches('v').to_string();
    Ok(ReleaseInfo {
        name: r.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("Prism {version}")),
        version,
        notes: r.body.unwrap_or_default().replace("\r\n", "\n"),
        url: r.html_url,
        date: r.published_at.map(|d| d.chars().take(10).collect()),
        prerelease: r.prerelease,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_github_release() {
        let r = parse_release(
            r###"{"tag_name":"v1.2.0","name":"Prism 1.2.0","body":"## What's new\r\n- Faster","html_url":"https://github.com/o/r/releases/tag/v1.2.0","published_at":"2026-11-08T10:11:12Z","prerelease":false,"extra":1}"###,
        )
        .unwrap();
        assert_eq!(r.version, "1.2.0");
        assert_eq!(r.date.as_deref(), Some("2026-11-08"));
        assert_eq!(r.notes, "## What's new\n- Faster");
    }

    #[test]
    fn falls_back_when_the_release_has_no_name_or_notes() {
        let r =
            parse_release(r#"{"tag_name":"v2.0.0","name":"","body":null,"html_url":"https://x","published_at":null}"#)
                .unwrap();
        assert_eq!(r.name, "Prism 2.0.0");
        assert_eq!(r.notes, "");
        assert!(r.date.is_none());
    }

    #[test]
    fn rejects_something_that_is_not_a_release() {
        assert!(parse_release("[]").is_err());
    }
}
