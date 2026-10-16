// Sandbox proof for rrweb DOM replay: record a tiny page with @rrweb/record
// 2.1.7, serve that run through the production plugin iframe sandbox
// (allow-scripts, NO allow-same-origin), and assert the replayer's nested
// frame shows the recorded text and that play advances to the mutation.
//
// Run: node test/dom-replay.e2e.mjs
// Needs: peckboard/web's playwright chromium.

import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const requirePlugin = createRequire(path.join(pluginRoot, "package.json"));

function firstExisting(cands) {
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

const webPkg = firstExisting([
  path.join(repoRoot, "web", "package.json"),
  path.resolve(pluginRoot, "..", "..", "peckboard", "web", "package.json"),
]);
const recordUmd = firstExisting([
  path.join(repoRoot, "src", "service", "vendor", "rrweb-record.umd.txt"),
  path.resolve(pluginRoot, "..", "..", "peckboard", "src", "service", "vendor", "rrweb-record.umd.txt"),
]);
if (!webPkg) fail("playwright package not found under peckboard/web");
if (!recordUmd) fail("vendored rrweb record bundle not found");

const requireWeb = createRequire(webPkg);
const esbuild = requirePlugin("esbuild");
const { chromium } = requireWeb("playwright");

const MARK_A = "peckboard-dom-marker-alpha";
const MARK_B = "peckboard-dom-marker-beta";

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}

const tmp = mkdtempSync(path.join(tmpdir(), "pwv-dom-"));
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

const browser = await chromium.launch({ headless: true });
let events;
{
  const ctx = await browser.newContext();
  const rec = await ctx.newPage();
  await rec.setContent(
    "<!doctype html><html><head><style>body{background:rgb(255,0,0)}</style></head><body><h1 id='m'>" + MARK_A +
      "</h1><img src='data:,' onerror=\"window.__pwned=1\"></body></html>",
  );
  await rec.addScriptTag({ path: recordUmd });
  events = await rec.evaluate(
    async (marks) => {
      const q = [];
      const recFn = window.rrwebRecord && window.rrwebRecord.record;
      if (!recFn) throw new Error("rrwebRecord.record missing");
      const stop = recFn({
        emit: function (e) { q.push(e); },
        maskAllInputs: true,
        recordCanvas: false,
        collectFonts: false,
        inlineImages: false,
        checkoutEveryNms: 60000,
        sampling: { mousemove: 50, scroll: 150 },
      });
      await new Promise(function (r) { setTimeout(r, 250); });
      document.getElementById("m").textContent = marks.b;
      await new Promise(function (r) { setTimeout(r, 500); });
      if (typeof stop === "function") stop();
      return q;
    },
    { b: MARK_B },
  );
  await ctx.close();
}

if (!Array.isArray(events) || events.length < 2) {
  fail("record() returned " + (events && events.length) + " events");
}
const blob = JSON.stringify(events);
if (!blob.includes(MARK_A) || !blob.includes(MARK_B)) {
  fail("recording is missing one of the marker strings");
}

const started = events[0].timestamp || Date.now();
const run = {
  id: "r-dom",
  name: "DOM harness",
  url: "https://example.test/",
  session_id: "s1",
  started_ms: started,
  ended_ms: started + 2000,
  has_dom: true,
  steps: [{ n: 0, ts_ms: started, action: "open", target: "page" }],
  network: [],
  console_events: [],
  pointer_events: [],
};
const summary = {
  runs: [
    {
      id: run.id,
      name: run.name,
      url: run.url,
      started_ms: run.started_ms,
      ended_ms: run.ended_ms,
      step_count: 1,
      frame_count: 0,
      request_count: 0,
      error_count: 0,
      has_dom: true,
    },
  ],
};
const domBody = {
  events,
  next_offset: blob.length,
  eof: true,
  truncated: false,
};

const parentHtml = `<!doctype html>
<meta charset="utf-8">
<title>dom harness</title>
<style>html,body{margin:0;height:100%}</style>
<script>
const RUN = ${JSON.stringify(run).replace(/</g, "\\u003c")};
const SUMMARY = ${JSON.stringify(summary).replace(/</g, "\\u003c")};
const DOM = ${JSON.stringify(domBody).replace(/</g, "\\u003c")};
function bodyFor(p) {
  if (p.startsWith("/api/plugin-ui/playwright-video/runs")) return SUMMARY;
  if (p.startsWith("/api/plugin-ui/playwright-video/run?")) return { run: RUN };
  if (p.startsWith("/api/plugin-ui/playwright-video/dom?")) return DOM;
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
<iframe id="pf" src="/plugin?run=r-dom" style="width:100%;height:100%;border:0"
  sandbox="allow-scripts allow-forms allow-popups allow-downloads"></iframe>
`;

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  const pathOnly = (req.url || "/").split("?")[0];
  if (pathOnly === "/plugin") res.end(PAGE);
  else if (pathOnly === "/") res.end(parentHtml);
  else {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

async function frameText(page, needle) {
  for (const f of page.frames()) {
    const hit = await f
      .locator("text=" + needle)
      .count()
      .catch(() => 0);
    if (hit > 0) return f;
  }
  return null;
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/");

const fl = page.frameLocator("#pf");
const nested = fl.frameLocator("iframe");
let alpha = false;
let note = "";
for (let i = 0; i < 40 && !alpha; i++) {
  note = await fl.locator("#noframe").textContent().catch(() => "");
  alpha = (await nested.locator("text=" + MARK_A).count().catch(() => 0)) > 0;
  if (!alpha) alpha = (await fl.locator("text=" + MARK_A).count().catch(() => 0)) > 0;
  if (!alpha) await page.waitForTimeout(250);
}
if (!alpha) {
  const urls = page.frames().map((f) => f.url()).join(" | ");
  fail(
    "marker alpha not visible. frames=" + urls +
      " noframe=" + JSON.stringify(note) +
      " console=" + errors.join(" || "),
  );
}

const cursorHidden = await fl.locator("#cursor").isHidden();
if (!cursorHidden) fail("#cursor is visible in DOM mode");

await fl.locator("#play").click();
let beta = false;
for (let i = 0; i < 40 && !beta; i++) {
  beta = (await nested.locator("text=" + MARK_B).count().catch(() => 0)) > 0;
  if (!beta) beta = (await fl.locator("text=" + MARK_B).count().catch(() => 0)) > 0;
  if (!beta) await page.waitForTimeout(200);
}
if (!beta) {
  note = await fl.locator("#noframe").textContent().catch(() => "");
  fail("play did not reveal marker beta. noframe=" + JSON.stringify(note) + " console=" + errors.join(" || "));
}

// Isolation: the recording carries an inline handler and page CSS. Neither
// may run in / leak into the player.
const replayFrame = page.frames().find((f) => f.parentFrame() && f.parentFrame().parentFrame());
if (!replayFrame) fail("replay frame not found");
const pwned = await replayFrame.evaluate(() => window.__pwned === 1);
if (pwned) fail("recorded onerror handler executed in the replay frame");
const playerBg = await fl.locator("body").evaluate((b) => getComputedStyle(b).backgroundColor);
if (playerBg === "rgb(255, 0, 0)") fail("recorded CSS leaked into the player");

console.log("PASS: nested replayer shows " + MARK_A + ", play advances to " + MARK_B + ", recording stays isolated");
await browser.close();
server.close();
