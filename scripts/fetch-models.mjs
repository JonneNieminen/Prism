// Download the bundled model weights (not stored in git) from this repo's
// `models-v1` GitHub release and verify each file against model.json's sha256.
// Usage: npm run fetch-models   (PRISM_MODELS_URL overrides the base URL)
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const BASE = process.env.PRISM_MODELS_URL ?? "https://github.com/JonneNieminen/Prism/releases/download/models-v1/";
const root = fileURLToPath(new URL("../models/", import.meta.url));

const sha256 = (p) =>
  new Promise((ok, err) => {
    const h = createHash("sha256");
    createReadStream(p).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", err);
  });

for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const m = JSON.parse(readFileSync(join(root, dir.name, "model.json"), "utf8"));
  const files = typeof m.weights === "string" ? [{ file: m.weights, sha256: m.sha256 }] : m.weights;
  for (const { file, sha256: want } of files) {
    const dest = join(root, dir.name, file);
    if (existsSync(dest) && (await sha256(dest)) === want) {
      console.log(`✓ ${dir.name}/${file} (already verified)`);
      continue;
    }
    if (!BASE.startsWith("https://")) throw new Error("Model downloads must use https");
    console.log(`↓ ${dir.name}/${file}`);
    const res = await fetch(BASE + file, { redirect: "follow" });
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const part = dest + ".part";
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    const got = await sha256(part);
    if (got !== want) {
      rmSync(part);
      throw new Error(`${file}: checksum mismatch (got ${got})`);
    }
    renameSync(part, dest);
    console.log(`✓ ${dir.name}/${file} verified`);
  }
}
