// E2E proof for the MP4 export: build the real served page from src/page.ts,
// frame it under the exact production sandbox attributes with a stubbed
// parent fetch bridge serving a synthetic recorded run, click Export in a
// real chromium, capture the download, and validate the file with ffprobe
// plus a full ffmpeg decode pass.
//
// Run: npm run test:e2e
// Needs: peckboard/web's playwright chromium (npm run e2e:install there) and
// ffprobe/ffmpeg on PATH.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const requirePlugin = createRequire(path.join(pluginRoot, "package.json"));
const requireWeb = createRequire(
  path.resolve(pluginRoot, "..", "..", "peckboard", "web", "package.json"),
);

const esbuild = requirePlugin("esbuild");
const { chromium } = requireWeb("playwright");

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}

// ── 1. Build the page module (same loaders as the plugin build). ──
const tmp = mkdtempSync(path.join(tmpdir(), "pwv-export-"));
await esbuild.build({
  entryPoints: [path.join(pluginRoot, "src", "page.ts")],
  outfile: path.join(tmp, "page.mjs"),
  bundle: true,
  format: "esm",
  target: ["es2020"],
  loader: { ".txt": "text" },
  logLevel: "silent",
});
const { PAGE } = await import(pathToFileURL(path.join(tmp, "page.mjs")).href);

// ── 2. Synthetic run: 4 framed steps over 2.6s, pointer sweep + 2 clicks. ──
const START = 1700000000000;
const steps = [
  { ts_ms: START, action: "open", target: "https://example.test/", frame: "f1.png" },
  { ts_ms: START + 800, action: "click", target: "Sign in button", frame: "f2.png" },
  { ts_ms: START + 1600, action: "type", target: "user@example.test", frame: "f3.png" },
  { ts_ms: START + 2400, action: "close", target: "", frame: "f4.png" },
];
const pointer = [];
for (let ts = 0; ts <= 2400; ts += 150) {
  pointer.push({
    ts_ms: START + ts,
    t: "move",
    x: 40 + (ts / 2400) * 560,
    y: 60 + (ts / 2400) * 240,
    vw: 640,
    vh: 360,
  });
}
pointer.push({ ts_ms: START + 900, t: "down", x: 250, y: 150, vw: 640, vh: 360 });
pointer.push({ ts_ms: START + 1700, t: "down", x: 420, y: 220, vw: 640, vh: 360 });
pointer.sort((a, b) => a.ts_ms - b.ts_ms);
const run = {
  id: "r-e2e",
  name: "Export harness run",
  url: "https://example.test/",
  session_id: "s1",
  started_ms: START,
  ended_ms: START + 2600,
  steps,
  pointer_events: pointer,
  network: [],
  console_events: [],
};
const summary = {
  runs: [
    {
      id: run.id,
      name: run.name,
      url: run.url,
      started_ms: run.started_ms,
      ended_ms: run.ended_ms,
      step_count: steps.length,
      frame_count: 4,
      request_count: 0,
      error_count: 0,
    },
  ],
};

// ── 3. Parent page: prod sandbox attrs + the plugin-ui fetch bridge. ──
const parentHtml = `<!doctype html>
<meta charset="utf-8">
<title>export harness</title>
<script>
const RUN = ${JSON.stringify(run)};
const SUMMARY = ${JSON.stringify(summary)};
function framePng(label, color) {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 360;
  const g = c.getContext("2d");
  g.fillStyle = color; g.fillRect(0, 0, 640, 360);
  g.fillStyle = "#ffffff"; g.font = "700 64px sans-serif";
  g.fillText(label, 40, 200);
  return c.toDataURL("image/png").slice("data:image/png;base64,".length);
}
const FRAMES = {
  "f1.png": framePng("step one", "#4a5f9e"),
  "f2.png": framePng("step two", "#9e4a6b"),
  "f3.png": framePng("step three", "#4a9e6b"),
  "f4.png": framePng("step four", "#6b4a9e"),
};
function bodyFor(p) {
  if (p.startsWith("/api/plugin-ui/playwright-video/runs")) return SUMMARY;
  if (p.startsWith("/api/plugin-ui/playwright-video/run?")) return { run: RUN };
  if (p.startsWith("/api/plugin-ui/playwright-video/frame?")) {
    const m = /[?&]frame=([^&]+)/.exec(p);
    const b64 = m && FRAMES[decodeURIComponent(m[1])];
    return b64 ? { base64: b64 } : null;
  }
  return null;
}
window.addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.type !== "plugin-ui-fetch" || typeof m.requestId !== "number") return;
  const b = bodyFor(typeof m.path === "string" ? m.path : "");
  document.getElementById("pf").contentWindow.postMessage({
    type: "plugin-ui-fetch-result",
    requestId: m.requestId,
    status: b ? 200 : 404,
    body: JSON.stringify(b || { error: "not found" }),
  }, "*");
});
</script>
<iframe id="pf" src="/plugin" style="width:1280px;height:900px;border:0"
  sandbox="allow-scripts allow-forms allow-popups allow-downloads"></iframe>
`;

// ── 4. Serve both documents (iframe stays opaque-origin via sandbox). ──
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url === "/plugin") res.end(PAGE);
  else if (req.url === "/") res.end(parentHtml);
  else {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

// ── 5. Drive: open, wait for the player, export, capture the download. ──
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[page console.error] " + m.text());
  });
  await page.goto(base + "/");
  const fl = page.frameLocator("#pf");
  await fl.locator(".run").first().waitFor({ timeout: 15000 });
  await fl.locator("#export").waitFor({ state: "visible", timeout: 15000 });
  const dlPromise = page.waitForEvent("download", { timeout: 120000 });
  await fl.locator("#export").click();
  const download = await dlPromise;
  const suggested = download.suggestedFilename();
  const outPath = path.join(tmp, suggested);
  await download.saveAs(outPath);
  const stat = await fl.locator("#exportstat").textContent();
  if (!/Saved .*\.mp4/.test(stat || "")) fail("unexpected export status: " + stat);
  if (suggested !== "export-harness-run.mp4") fail("unexpected filename: " + suggested);
  const size = statSync(outPath).size;
  if (size < 10000) fail("mp4 suspiciously small: " + size + " bytes");
  // Optional proof artifacts: page screenshot + a copy of the encoded MP4.
  if (process.env.PWV_E2E_SHOT) {
    await page.screenshot({ path: process.env.PWV_E2E_SHOT });
  }
  if (process.env.PWV_E2E_KEEP) copyFileSync(outPath, process.env.PWV_E2E_KEEP);
  // ── 6. Validate: ffprobe metadata + full ffmpeg decode. ──
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", outPath],
      { encoding: "utf8" },
    ),
  );
  const v = (probe.streams || []).find((s) => s.codec_type === "video");
  if (!v) fail("no video stream");
  if (v.codec_name !== "h264") fail("codec is " + v.codec_name + ", want h264");
  if (v.width !== 640 || v.height !== 360) fail("bad dims " + v.width + "x" + v.height);
  if (!(probe.format.format_name || "").includes("mp4")) {
    fail("container is " + probe.format.format_name);
  }
  const dur = parseFloat(probe.format.duration);
  if (!(dur > 2.2 && dur < 3.2)) fail("duration " + dur + "s, want ~2.6s");
  const frames = parseInt(v.nb_frames, 10);
  if (!(frames >= 75 && frames <= 82)) fail("frame count " + frames + ", want ~79 @30fps");
  execFileSync("ffmpeg", ["-v", "error", "-i", outPath, "-f", "null", "-"], {
    encoding: "utf8",
  });

  console.log(
    "PASS: " + suggested + " — " + size + " bytes, h264 " + v.width + "x" + v.height +
      ", " + dur.toFixed(2) + "s, " + frames + " frames, clean decode. Status: " + stat,
  );
} finally {
  await browser.close();
  server.close();
}
