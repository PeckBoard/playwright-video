// E2E proof for playback follow-scroll behavior: build the real served page,
// frame it under the production sandbox attributes with a stubbed parent
// fetch bridge serving a long synthetic run (60 steps, so the event list
// overflows), then play it in a real chromium twice:
//
//  - mobile viewport (390px, stacked layout): NO forced scrolling — the
//    document and the event pane must stay put so the stage stays on screen;
//  - desktop viewport (1440px): the follow-scroll must still track the
//    active event row inside #sidebody.
//
// Run: node test/scroll.e2e.mjs
// Needs: peckboard/web's playwright chromium (npm run e2e:install there).

import { mkdtempSync } from "node:fs";
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
const tmp = mkdtempSync(path.join(tmpdir(), "pwv-scroll-"));
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

// ── 2. Synthetic run: 60 steps 100ms apart so the event list overflows. ──
const START = 1700000000000;
const steps = [];
for (let i = 0; i < 60; i++) {
  steps.push({
    ts_ms: START + i * 100,
    action: i % 3 === 0 ? "click" : "type",
    target: "step " + (i + 1) + " target",
    frame: "f1.png",
  });
}
const run = {
  id: "r-scroll",
  name: "Scroll harness run",
  url: "https://example.test/",
  session_id: "s1",
  started_ms: START,
  ended_ms: START + 60 * 100 + 200,
  steps,
  pointer_events: [],
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
      frame_count: 1,
      request_count: 0,
      error_count: 0,
    },
  ],
};

// ── 3. Parent page: prod sandbox attrs + the plugin-ui fetch bridge. ──
const parentHtml = `<!doctype html>
<meta charset="utf-8">
<title>scroll harness</title>
<style>html,body{margin:0;height:100%}</style>
<script>
const RUN = ${JSON.stringify(run)};
const SUMMARY = ${JSON.stringify(summary)};
function framePng() {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 360;
  const g = c.getContext("2d");
  g.fillStyle = "#4a5f9e"; g.fillRect(0, 0, 640, 360);
  g.fillStyle = "#ffffff"; g.font = "700 64px sans-serif";
  g.fillText("stage", 40, 200);
  return c.toDataURL("image/png").slice("data:image/png;base64,".length);
}
const FRAMES = { "f1.png": framePng() };
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
<iframe id="pf" src="/plugin" style="width:100%;height:100%;border:0"
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

/** Open the harness at a viewport, start playback, and return helpers. */
async function startPlayback(browser, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[page console.error] " + m.text());
  });
  await page.goto(base + "/");
  const fl = page.frameLocator("#pf");
  await fl.locator(".run").first().waitFor({ timeout: 15000 });
  await fl.locator("#frame").waitFor({ state: "visible", timeout: 15000 });
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) fail("plugin iframe frame not found");
  await fl.locator("#play").click();
  return { ctx, page, fl, frame };
}

/** Wait until playback auto-pauses at the end of the run. */
async function waitForEnd(fl) {
  const play = fl.locator("#play");
  const deadline = Date.now() + 25000;
  for (;;) {
    const label = await play.textContent();
    if ((label || "").indexOf("Play") >= 0) return;
    if (Date.now() > deadline) fail("playback never reached the end");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const scrollState = () => ({
  docTop: document.scrollingElement.scrollTop,
  docScrollable:
    document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 50,
  sideTop: document.getElementById("sidebody").scrollTop,
  sideScrollable: (() => {
    const s = document.getElementById("sidebody");
    return s.scrollHeight > s.clientHeight + 50;
  })(),
  stage: (() => {
    const r = document.getElementById("stage").getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, viewH: window.innerHeight };
  })(),
});

const browser = await chromium.launch();
try {
  // ── 5. Mobile (390px, stacked): nothing may scroll; stage stays visible. ──
  {
    const { ctx, page, fl, frame } = await startPlayback(browser, { width: 390, height: 844 });
    for (const at of [1500, 3000]) {
      await page.waitForTimeout(at === 1500 ? 1500 : 1500);
      const s = await frame.evaluate(scrollState);
      if (!s.docScrollable) fail("mobile: document not scrollable — test is vacuous");
      if (s.docTop !== 0) fail("mobile: document scrolled to " + s.docTop + " during playback");
      if (s.sideTop !== 0) fail("mobile: event pane scrolled to " + s.sideTop + " during playback");
      if (s.stage.top < 0 || s.stage.bottom > s.stage.viewH) {
        fail("mobile: stage off-screen (top " + s.stage.top + ", bottom " + s.stage.bottom + ")");
      }
      if (at === 3000) await page.screenshot({ path: path.join(pluginRoot, "test-results-scroll-mobile.png") });
    }
    await waitForEnd(fl);
    const end = await frame.evaluate(scrollState);
    if (end.docTop !== 0 || end.sideTop !== 0) {
      fail("mobile: scrolled by end (doc " + end.docTop + ", side " + end.sideTop + ")");
    }
    await ctx.close();
    console.log("mobile: no forced scroll, stage stayed visible");
  }

  // ── 6. Desktop (1440px): follow-scroll still tracks inside #sidebody. ──
  {
    const { ctx, page, fl, frame } = await startPlayback(browser, { width: 1440, height: 900 });
    await waitForEnd(fl);
    const end = await frame.evaluate(scrollState);
    if (!end.sideScrollable) fail("desktop: event pane not scrollable — test is vacuous");
    if (!(end.sideTop > 0)) fail("desktop: follow-scroll did not move the event pane");
    if (end.docTop !== 0) fail("desktop: document scrolled to " + end.docTop);
    await page.screenshot({ path: path.join(pluginRoot, "test-results-scroll-desktop.png") });
    await ctx.close();
    console.log("desktop: follow-scroll active (sidebody scrollTop " + end.sideTop + ")");
  }

  console.log("PASS: mobile playback leaves the viewport alone; desktop still follows the active event");
} finally {
  await browser.close();
  server.close();
}
