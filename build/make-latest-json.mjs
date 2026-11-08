// Builds the update feed (latest.json) that installed apps read from the latest GitHub release.
// Run by the release workflow after the installers are built and signed:
//   node build/make-latest-json.mjs <artifacts-dir> <version> <tag> <owner/repo> <notes.md>
// Each platform needs its updater file plus a `.sig` next to it (made when the build has
// TAURI_SIGNING_PRIVATE_KEY). Platforms without a signature are skipped; with none at all no
// feed is written, so a release without the signing secret simply doesn't offer in-app updates.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version, tag, repo, notesFile] = process.argv.slice(2);
if (!dir || !version || !tag || !repo) {
  console.error("usage: make-latest-json.mjs <artifacts-dir> <version> <tag> <owner/repo> [notes.md]");
  process.exit(2);
}

// Tauri's platform key -> the file Prism publishes for it.
const PLATFORMS = {
  "darwin-aarch64": `Prism-${version}-osx-arm64.app.tar.gz`,
  "darwin-x86_64": `Prism-${version}-osx-x64.app.tar.gz`,
  "windows-x86_64": `Prism-${version}-win-x64-setup.exe`,
  "windows-aarch64": `Prism-${version}-win-arm64-setup.exe`,
  "linux-x86_64": `Prism-${version}-linux-x64.AppImage`,
  "linux-aarch64": `Prism-${version}-linux-arm64.AppImage`,
};

const platforms = {};
for (const [key, file] of Object.entries(PLATFORMS)) {
  const sig = join(dir, `${file}.sig`);
  if (!existsSync(join(dir, file)) || !existsSync(sig)) {
    console.log(`- ${key}: no signed ${file}, skipped`);
    continue;
  }
  platforms[key] = { signature: readFileSync(sig, "utf8").trim(), url: `https://github.com/${repo}/releases/download/${tag}/${file}` };
  console.log(`✓ ${key}: ${file}`);
}

if (Object.keys(platforms).length === 0) {
  console.log("No signed update files found, so no latest.json was written (add the TAURI_SIGNING_PRIVATE_KEY secret to enable in-app updates).");
  process.exit(0);
}

const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";
writeFileSync(join(dir, "latest.json"), JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n");
console.log(`latest.json written for ${version}`);
