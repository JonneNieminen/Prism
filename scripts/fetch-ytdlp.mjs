// Download the yt-dlp release binary for this platform into src-tauri/bin (not stored in git)
// and verify it against the SHA2-256SUMS file published with the same release.
// Usage: npm run fetch-ytdlp   (PRISM_YTDLP_URL overrides the release base URL)
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A failure should read as one clear message, not a stack trace.
process.on("uncaughtException", (e) => {
  console.error(`\n✗ Couldn't fetch the downloader: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  console.error("  GitHub has to be reachable. Check your connection (or githubstatus.com) and run: npm run fetch-ytdlp");
  process.exit(1);
});

const BASE = (process.env.PRISM_YTDLP_URL ?? "https://github.com/yt-dlp/yt-dlp/releases/latest/download").replace(/\/+$/, "");
if (!BASE.startsWith("https://")) throw new Error("Downloader fetches must use https");

// Windows on ARM runs the x64 build under emulation.
const asset =
  process.platform === "darwin"
    ? "yt-dlp_macos"
    : process.platform === "win32"
      ? "yt-dlp.exe"
      : process.arch === "arm64"
        ? "yt-dlp_linux_aarch64"
        : "yt-dlp_linux";
const dest = fileURLToPath(new URL(`../src-tauri/bin/${process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"}`, import.meta.url));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// GitHub has the odd blip (5xx, dropped connection): retry a few times before giving up.
const get = async (name) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/${name}`, { redirect: "follow" });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`${name}: HTTP ${res.status}`), { final: true });
      throw new Error(`${name}: HTTP ${res.status}`);
    } catch (e) {
      if (e.final || attempt >= 5) throw e;
      console.log(`… ${e.message}, retrying (${attempt}/4)`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
};

let sums;
try {
  sums = (await get("SHA2-256SUMS")).toString("utf8");
} catch (e) {
  if (existsSync(dest)) {
    console.warn(`! ${e.message}. Couldn't check for a newer downloader; keeping the one already in src-tauri/bin.`);
    process.exit(0);
  }
  throw e;
}
const want = sums
  .split("\n")
  .map((l) => l.trim().split(/\s+/))
  .find(([, file]) => file === asset)?.[0];
if (!want) throw new Error(`No checksum published for ${asset}`);

if (existsSync(dest) && sha256(readFileSync(dest)) === want) {
  console.log(`✓ ${asset} (already up to date)`);
  process.exit(0);
}
console.log(`↓ ${asset}`);
const bin = await get(asset);
const got = sha256(bin);
if (got !== want) throw new Error(`${asset}: checksum mismatch (got ${got})`);
mkdirSync(dirname(dest), { recursive: true });
const part = join(dirname(dest), ".yt-dlp.part");
writeFileSync(part, bin);
chmodSync(part, 0o755);
renameSync(part, dest);
rmSync(part, { force: true });
console.log(`✓ ${asset} verified → src-tauri/bin`);
