// Regenerate the README screenshots from the browser preview (mock data). Drives headless Chrome
// over the DevTools protocol in real time, so animations and the mock's timers behave as in the app.
// Needs Google Chrome and `npm run dev` on port 1420.   Usage: npm run screenshots
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:1420/";
const OUT = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
const PORT = 9333;

// name, query, window height, milliseconds to wait after loading
const SHOTS = [
  ["player-dark", "view=player&theme=dark", 700, 2500],
  ["player-light", "view=player&theme=light", 700, 2500],
  ["separate-dark", "view=separate&theme=dark", 760, 2000],
  ["separating-dark", "view=separate&theme=dark&demo=separating", 860, 8800],
  ["download-dark", "view=download&theme=dark&demo=download", 860, 3600],
  ["library-dark", "view=library&theme=dark", 600, 2000],
  ["models-light", "view=models&theme=light", 760, 2500],
  ["settings-dark", "view=settings&theme=dark", 1480, 2000],
  ["shortcuts-dark", "view=shortcuts&theme=dark", 900, 2000],
  ["separate-fi-dark", "view=separate&theme=dark&lang=fi", 760, 2000],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await fetch(BASE);
} catch {
  console.error("Start the preview first: npm run dev");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "prism-shots-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
const cleanup = async () => {
  const closed = new Promise((ok) => chrome.once("exit", ok));
  chrome.kill();
  await closed;
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* a temp folder; the OS clears it */
  }
};

let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page");
  } catch {
    /* Chrome is still starting */
  }
  if (!target) await sleep(200);
}
if (!target) throw new Error("Couldn't reach Chrome's DevTools port");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
});
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? fail(new Error(m.error.message)) : ok(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

mkdirSync(OUT, { recursive: true });
await send("Page.enable");
for (const [name, query, height, wait] of SHOTS) {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `${BASE}?${query}` });
  await sleep(wait);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("  " + name);
}
console.log("rendered → docs/screenshots");
ws.close();
await cleanup();
process.exit(0);
