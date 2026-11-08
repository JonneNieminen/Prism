//! Downloading a track from a link: recognising the platform, building the `yt-dlp` command
//! line and reading its output. Running the process lives in `src-tauri` (it needs the app's
//! resource directory); everything here is pure so it can be tested.

use serde::Serialize;
use ts_rs::TS;

use crate::{PrismError, Result};

#[derive(Clone, Copy, Debug, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Platform {
    YouTube,
    SoundCloud,
    Instagram,
    TikTok,
    /// Any other https link; the downloader decides whether it can handle it.
    Other,
}

impl Platform {
    pub fn label(self) -> &'static str {
        match self {
            Platform::YouTube => "YouTube",
            Platform::SoundCloud => "SoundCloud",
            Platform::Instagram => "Instagram",
            Platform::TikTok => "TikTok",
            Platform::Other => "this link",
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Link {
    pub url: String,
    pub platform: Platform,
}

const SPOTIFY_HOSTS: &[&str] = &["spotify.com", "spotify.link", "spoti.fi"];
const KNOWN: &[(&str, Platform)] = &[
    ("youtube.com", Platform::YouTube),
    ("youtu.be", Platform::YouTube),
    ("youtube-nocookie.com", Platform::YouTube),
    ("soundcloud.com", Platform::SoundCloud),
    ("snd.sc", Platform::SoundCloud),
    ("instagram.com", Platform::Instagram),
    ("instagr.am", Platform::Instagram),
    ("tiktok.com", Platform::TikTok),
];

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.strip_suffix(domain).is_some_and(|rest| rest.ends_with('.'))
}

/// The lower-case host of an http(s) URL, or `None` if it isn't one.
fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit('@').next()?; // drop user:pass@
    let host = authority.split(':').next()?.trim_end_matches('.').to_ascii_lowercase();
    (host.contains('.') && !host.is_empty()).then_some(host)
}

/// Recognise the platform of a pasted link, or explain why Prism can't download it.
pub fn classify(input: &str) -> Result<Link> {
    let url = input.trim();
    if url.is_empty() {
        return Err(PrismError::Other("Paste a link to a track.".into()));
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(PrismError::Other("That doesn't look like a single link.".into()));
    }
    let Some(host) = host_of(url) else {
        return Err(PrismError::Other("That doesn't look like a web link. It should start with https://".into()));
    };
    if SPOTIFY_HOSTS.iter().any(|d| host_matches(&host, d)) {
        return Err(PrismError::Other(
            "Spotify streams are copy-protected, so Prism can't download them. If you have the track as a file (MP3, WAV, FLAC…), drop it onto Separate instead."
                .into(),
        ));
    }
    let platform = KNOWN.iter().find(|(d, _)| host_matches(&host, d)).map_or(Platform::Other, |(_, p)| *p);
    Ok(Link { url: url.to_string(), platform })
}

/// Field separator in the lines we ask `yt-dlp` to print (never appears in titles).
const SEP: char = '\u{1f}';

/// Command-line arguments for downloading one track's audio into `out_dir`.
/// The URL goes last, after `--`, so it can never be read as an option.
///
/// `js_runtime` is a JavaScript engine (`deno` or `node`) with its path: recent YouTube pages need
/// one to be read, and without it some formats are missing.
pub fn ytdlp_args(url: &str, out_dir: &str, js_runtime: Option<(&str, &str)>) -> Vec<String> {
    let progress = [
        "download:PRISMPROG",
        "%(progress.status)s",
        "%(progress.downloaded_bytes)s",
        "%(progress.total_bytes)s",
        "%(progress.total_bytes_estimate)s",
        "%(progress.speed)s",
        "%(progress.eta)s",
    ]
    .join(&SEP.to_string());
    let info = format!("before_dl:PRISMINFO{SEP}%(title)s{SEP}%(uploader)s");
    let sep = std::path::MAIN_SEPARATOR;
    let template = format!("{}{sep}%(title).100B [%(id)s].%(ext)s", out_dir.trim_end_matches(sep));
    let runtime = js_runtime.map(|(name, path)| format!("{name}:{path}"));
    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-playlist",
        "--playlist-items",
        "1",
        "--no-mtime",
        "--no-warnings",
        "--windows-filenames",
        "--socket-timeout",
        "30",
        "--newline",
        "--progress",
        "--no-simulate",
        // Formats Prism can decode first; anything else only as a last resort.
        "-f",
        "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[acodec^=mp4a]/best[ext=mp4]/bestaudio/best",
        "-o",
        &template,
        "--progress-template",
        &progress,
        "--print",
        &info,
        "--print",
        &format!("after_move:PRISMFILE{SEP}%(filepath)s"),
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(r) = runtime {
        args.extend(["--js-runtimes".to_string(), r]);
    }
    args.extend(["--".to_string(), url.to_string()]);
    args
}

#[derive(Debug, PartialEq)]
pub enum Line {
    Info { title: String, uploader: Option<String> },
    Progress { finished: bool, done: Option<u64>, total: Option<u64>, speed: Option<f32>, eta: Option<f32> },
    File(String),
    Other,
}

fn num<T: std::str::FromStr>(s: &str) -> Option<T> {
    match s.trim() {
        "" | "NA" | "None" => None,
        v => v.parse().ok().or_else(|| v.parse::<f64>().ok().and_then(|f| f.round().to_string().parse().ok())),
    }
}

pub fn parse_line(line: &str) -> Line {
    let mut f = line.trim_end().split(SEP);
    match f.next() {
        Some("PRISMINFO") => {
            let title = f.next().unwrap_or("").trim();
            let up = f.next().map(str::trim).filter(|s| !s.is_empty() && *s != "NA");
            Line::Info { title: title.to_string(), uploader: up.map(String::from) }
        }
        Some("PRISMPROG") => {
            let status = f.next().unwrap_or("");
            let done = f.next().and_then(num::<u64>);
            let exact = f.next().and_then(num::<u64>);
            let estimate = f.next().and_then(num::<u64>);
            let speed = f.next().and_then(num::<f32>);
            let eta = f.next().and_then(num::<f32>);
            Line::Progress { finished: status == "finished", done, total: exact.or(estimate), speed, eta }
        }
        Some("PRISMFILE") => Line::File(f.collect::<Vec<_>>().join(&SEP.to_string())),
        _ => Line::Other,
    }
}

/// A short, human explanation for a failed download, from what `yt-dlp` printed.
pub fn friendly_error(stderr: &str, platform: Platform) -> String {
    let low = stderr.to_ascii_lowercase();
    let name = platform.label();
    let has = |needles: &[&str]| needles.iter().any(|n| low.contains(n));
    if has(&["unsupported url"]) {
        "Prism couldn't find a track at that link. Check that it points to a single song or video.".into()
    } else if has(&["private", "sign in", "log in", "login", "members-only", "age-restricted", "confirm your age"]) {
        format!("{name} says this one needs you to be signed in, so Prism can't download it. Only public tracks work.")
    } else if has(&["not available", "unavailable", "removed", "deleted", "copyright", "geo", "blocked"]) {
        format!(
            "This track isn't available to download from {name} right now. It may be removed, blocked in your country, or restricted by its owner."
        )
    } else if has(&["http error 429", "too many requests"]) {
        format!("{name} is limiting requests from this connection. Wait a few minutes and try again.")
    } else if has(&[
        "timed out",
        "unable to download",
        "network is unreachable",
        "name or service not known",
        "connection",
        "nodename nor servname",
    ]) {
        "Prism couldn't reach the site. Check your internet connection and try again.".into()
    } else if has(&["requested format is not available"]) {
        "This link has no audio Prism can download.".into()
    } else {
        let last = stderr.lines().rev().find(|l| l.contains("ERROR")).unwrap_or("").trim();
        let last = last.trim_start_matches("ERROR:").trim();
        if last.is_empty() {
            "The download didn't finish. Try again, or try a different link.".into()
        } else {
            format!("The download didn't finish: {}", last.chars().take(160).collect::<String>())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(u: &str) -> Platform {
        classify(u).unwrap().platform
    }

    #[test]
    fn recognises_platforms() {
        assert_eq!(p("https://www.youtube.com/watch?v=abc"), Platform::YouTube);
        assert_eq!(p("https://youtu.be/abc"), Platform::YouTube);
        assert_eq!(p("https://music.youtube.com/watch?v=abc"), Platform::YouTube);
        assert_eq!(p("https://soundcloud.com/artist/track"), Platform::SoundCloud);
        assert_eq!(p("https://on.soundcloud.com/xyz"), Platform::SoundCloud);
        assert_eq!(p("https://www.instagram.com/reel/abc/"), Platform::Instagram);
        assert_eq!(p("https://vm.tiktok.com/abc/"), Platform::TikTok);
        assert_eq!(p("  https://www.tiktok.com/@a/video/1  "), Platform::TikTok);
        assert_eq!(p("https://example.org/some/track"), Platform::Other);
    }

    #[test]
    fn host_tricks_do_not_fool_it() {
        assert_eq!(p("https://youtube.com@evil.example/x"), Platform::Other);
        assert_eq!(p("https://notyoutube.com/x"), Platform::Other);
        assert_eq!(p("https://youtube.com.evil.example/x"), Platform::Other);
        assert_eq!(p("https://evil.example/?u=https://youtube.com"), Platform::Other);
    }

    #[test]
    fn refuses_spotify_and_non_links() {
        assert!(classify("https://open.spotify.com/track/abc").unwrap_err().to_string().contains("Spotify"));
        assert!(classify("https://spotify.link/abc").is_err());
        assert!(classify("").is_err());
        assert!(classify("not a link").is_err());
        assert!(classify("file:///etc/passwd").is_err());
        assert!(classify("javascript:alert(1)").is_err());
        assert!(classify("https://a.com/x https://b.com/y").is_err());
    }

    #[test]
    fn url_is_last_and_after_double_dash() {
        let a = ytdlp_args("https://youtu.be/abc", "/tmp/out", Some(("node", "/usr/bin/node")));
        assert_eq!(a[a.len() - 2], "--");
        assert_eq!(a[a.len() - 1], "https://youtu.be/abc");
        assert!(a.iter().any(|x| x == "--no-playlist"));
        assert!(a.iter().any(|x| x == "--ignore-config"));
        let i = a.iter().position(|x| x == "--js-runtimes").unwrap();
        assert_eq!(a[i + 1], "node:/usr/bin/node");
        assert!(!ytdlp_args("https://youtu.be/abc", "/tmp/out", None).iter().any(|x| x == "--js-runtimes"));
    }

    #[test]
    fn parses_output_lines() {
        let s = SEP;
        assert_eq!(
            parse_line(&format!("PRISMINFO{s}A | B{s}Some Artist")),
            Line::Info { title: "A | B".into(), uploader: Some("Some Artist".into()) }
        );
        assert_eq!(
            parse_line(&format!("PRISMPROG{s}downloading{s}1024{s}NA{s}4096{s}2048.5{s}3")),
            Line::Progress {
                finished: false,
                done: Some(1024),
                total: Some(4096),
                speed: Some(2048.5),
                eta: Some(3.0)
            }
        );
        assert_eq!(
            parse_line(&format!("PRISMPROG{s}finished{s}4096{s}4096{s}NA{s}NA{s}NA")),
            Line::Progress { finished: true, done: Some(4096), total: Some(4096), speed: None, eta: None }
        );
        assert_eq!(
            parse_line(&format!("PRISMFILE{s}/Users/me/Downloads/Prism/x [abc].m4a")),
            Line::File("/Users/me/Downloads/Prism/x [abc].m4a".into())
        );
        assert_eq!(parse_line("[download] 12.0% of 3MiB"), Line::Other);
    }

    #[test]
    fn explains_failures() {
        assert!(friendly_error("ERROR: [youtube] x: Private video. Sign in", Platform::YouTube).contains("signed in"));
        assert!(
            friendly_error("ERROR: Unsupported URL: https://a.b", Platform::Other).contains("couldn't find a track")
        );
        assert!(friendly_error("", Platform::Other).contains("didn't finish"));
    }
}
