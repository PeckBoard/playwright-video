// Visual harness: records a realistic demo app with @rrweb/record (real
// mouse, typing, scroll, fetches, console), then serves the plugin page
// inside the production sandbox with that run — plus an old screenshot-only
// run — so the player UI can be eyeballed or screenshotted.
//
// Run: node test/visual-harness.mjs [--port N] [--shots DIR]
//   --port   keep serving on N (default: random, exit after --shots)
//   --shots  write screenshots of the key states into DIR, then exit

import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const requirePlugin = createRequire(path.join(pluginRoot, "package.json"));
const args = process.argv.slice(2);
const argVal = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(argVal("--port") || 0);
const SHOTS = argVal("--shots");

function firstExisting(cands) {
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}
const webPkg = firstExisting([path.join(repoRoot, "web", "package.json")]);
const recordUmd = firstExisting([
  path.join(repoRoot, "src", "service", "vendor", "rrweb-record.umd.txt"),
]);
if (!webPkg || !recordUmd) {
  console.error("FAIL: needs peckboard/web playwright and the vendored rrweb record bundle");
  process.exit(1);
}
const { chromium } = createRequire(webPkg)("playwright");
const esbuild = requirePlugin("esbuild");

const tmp = mkdtempSync(path.join(tmpdir(), "pwv-vis-"));
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

// ── the app under test ──
const DEMO = `<!doctype html><html><head><meta charset="utf-8"><title>Acme Store</title>
<style>
:root { --brand: #0f766e; --ink: #0f172a; --muted: #64748b; --card: #fff; --bg: #f1f5f9; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
header { position: fixed; top: 0; left: 0; right: 0; height: 56px; background: var(--brand); color: #fff;
  display: flex; align-items: center; gap: 24px; padding: 0 28px; z-index: 5; box-shadow: 0 2px 8px #0002; }
header b { font-size: 18px; } header a { color: #d1fae5; text-decoration: none; }
main { max-width: 980px; margin: 0 auto; padding: 84px 24px 40px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.card { background: var(--card); border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px #0001; }
.card .ph { height: 90px; border-radius: 8px; background: linear-gradient(135deg, #99f6e4, #0f766e); margin-bottom: 10px; }
.card button, form button { background: var(--brand); color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; font: inherit; }
.card button:hover { filter: brightness(1.1); }
form { margin-top: 28px; display: grid; gap: 10px; max-width: 420px; }
input { padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
#cart { margin-top: 18px; } #cart li { padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
#toast { position: fixed; right: 24px; bottom: 24px; background: var(--ink); color: #fff; padding: 12px 18px;
  border-radius: 10px; opacity: 0; transform: translateY(10px); transition: all .3s; }
#toast.show { opacity: 1; transform: none; }
.long p { color: var(--muted); }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
</style></head><body>
<header><b>Acme Store</b><a href="#">Shop</a><a href="#">Deals</a><a href="#">Account</a></header>
<main>
  <h1>Spring collection</h1>
  <div class="grid">
    <div class="card"><div class="ph"></div><b>Trail Runner</b><p>$129</p><button id="add1">Add to cart</button></div>
    <div class="card"><div class="ph"></div><b>Rain Shell</b><p>$189</p><button id="add2">Add to cart</button></div>
    <div class="card"><div class="ph"></div><b>Day Pack</b><p>$79</p><button id="add3">Add to cart</button></div>
  </div>
  <ul id="cart"></ul>
  <form id="f" onsubmit="return false">
    <h2>Checkout</h2>
    <input id="name" placeholder="Full name">
    <input id="email" placeholder="Email">
    <button id="pay">Place order</button>
  </form>
  <div class="long">${Array.from({ length: 14 }, (_, i) => `<h3>Section ${i + 1}</h3><p>Free shipping on orders over $50. Returns within 30 days. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join("")}</div>
</main>
<div id="toast"></div>
<script>
function toast(t){var e=document.getElementById('toast');e.textContent=t;e.className='show';setTimeout(function(){e.className=''},1400)}
['add1','add2','add3'].forEach(function(id){document.getElementById(id).onclick=function(){
  var li=document.createElement('li');li.textContent=this.parentNode.querySelector('b').textContent+' added';
  document.getElementById('cart').appendChild(li);fetch('/api/cart',{method:'POST',body:'{"sku":"'+id+'"}'});
  console.log('cart add', id);toast('Added to cart');}});
document.getElementById('pay').onclick=function(){fetch('/api/order',{method:'POST'}).then(function(r){
  if(!r.ok){console.error('order failed', r.status);toast('Payment failed — try again');}});};
</script></body></html>`;

const appServer = http.createServer((req, res) => {
  if (req.url.startsWith("/api/cart")) {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    }, 120);
    return;
  }
  if (req.url.startsWith("/api/order")) {
    setTimeout(() => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"card declined"}');
    }, 300);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(DEMO);
});
await new Promise((r) => appServer.listen(0, "127.0.0.1", r));
const appUrl = "http://127.0.0.1:" + appServer.address().port + "/";

// ── record ──
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const rec = await ctx.newPage();
await rec.addInitScript({ path: recordUmd });
await rec.addInitScript(() => {
  window.__q = [];
  window.rrwebRecord.record({
    emit: (e) => window.__q.push(e),
    maskAllInputs: true,
    recordCanvas: false,
    slimDOMOptions: { script: true, comment: true, headMetaHttpEquiv: true },
    sampling: { mousemove: 50, scroll: 150 },
  });
});
const t0 = Date.now();
const steps = [];
const network = [];
const consoleEvents = [];
const pointer = [];
const reqStart = new Map();
rec.on("request", (r) => reqStart.set(r, Date.now()));
rec.on("requestfinished", async (r) => {
  const resp = await r.response();
  network.push({
    id: network.length + 1,
    ts_ms: reqStart.get(r) || Date.now(),
    dur_ms: Date.now() - (reqStart.get(r) || Date.now()),
    method: r.method(),
    url: r.url(),
    resource_type: r.resourceType(),
    status: resp ? resp.status() : null,
    size: resp ? Number(resp.headers()["content-length"] || 0) || null : null,
    req_headers: { accept: "*/*" },
    resp_headers: resp ? resp.headers() : {},
    req_body: r.postData() || undefined,
    resp_body: resp ? await resp.text().catch(() => undefined) : undefined,
  });
});
rec.on("console", (m) =>
  consoleEvents.push({ ts_ms: Date.now(), level: m.type() === "warning" ? "warning" : m.type(), text: m.text() }),
);
const step = (action, target, detail) => steps.push({ n: steps.length, ts_ms: Date.now(), action, target, detail });
async function move(x, y) {
  await rec.mouse.move(x, y, { steps: 18 });
  pointer.push({ ts_ms: Date.now(), t: "move", x, y, vw: 1280, vh: 720 });
}
step("open", "page", { url: appUrl });
await rec.goto(appUrl);
await rec.waitForTimeout(700);
await move(420, 300);
for (const id of ["#add1", "#add3"]) {
  const b = await rec.locator(id).boundingBox();
  await move(b.x + b.width / 2, b.y + b.height / 2);
  step("click", id);
  await rec.locator(id).click();
  await rec.waitForTimeout(900);
}
// An agent "thinking" gap: no activity, should be skipped.
await rec.waitForTimeout(6000);
const nm = await rec.locator("#name").boundingBox();
await move(nm.x + 40, nm.y + nm.height / 2);
step("click", "#name");
await rec.locator("#name").click();
step("type", "#name", { text: "Ada Lovelace" });
await rec.keyboard.type("Ada Lovelace", { delay: 45 });
await rec.locator("#email").click();
step("type", "#email", { text: "ada@example.com" });
await rec.keyboard.type("ada@example.com", { delay: 45 });
const pay = await rec.locator("#pay").boundingBox();
await move(pay.x + pay.width / 2, pay.y + pay.height / 2);
step("click", "#pay");
await rec.locator("#pay").click();
await rec.waitForTimeout(1500);
step("scroll_bottom", "page");
for (let i = 0; i < 8; i++) {
  await rec.mouse.wheel(0, 260);
  await rec.waitForTimeout(120);
}
await rec.waitForTimeout(1200);
const events = await rec.evaluate(() => window.__q);
const t1 = Date.now();
await ctx.close();

const domStart = events[0].timestamp;
const run = {
  id: "r-dom",
  name: "Checkout — card declined",
  url: appUrl,
  session_id: "sess-7f3a",
  project_id: "proj-store",
  started_ms: Math.min(t0, domStart),
  ended_ms: t1,
  has_dom: true,
  steps,
  network: network.sort((a, b) => a.ts_ms - b.ts_ms),
  console_events: consoleEvents,
  pointer_events: pointer,
};
const lines = events.map((e) => JSON.stringify(e));
const CHUNK = 64 * 1024;
const chunks = [];
{
  let cur = [];
  let bytes = 0;
  let off = 0;
  for (const l of lines) {
    cur.push(JSON.parse(l));
    bytes += l.length + 1;
    off += l.length + 1;
    if (bytes >= CHUNK) {
      chunks.push({ events: cur, next_offset: off, eof: false, truncated: false });
      cur = [];
      bytes = 0;
    }
  }
  chunks.push({ events: cur, next_offset: off, eof: true, truncated: false });
}
const domByOffset = {};
let prev = 0;
for (const c of chunks) {
  domByOffset[prev] = c;
  prev = c.next_offset;
}
const summary = (r, extra) => ({
  id: r.id,
  name: r.name,
  url: r.url,
  started_ms: r.started_ms,
  ended_ms: r.ended_ms,
  step_count: r.steps.length,
  frame_count: 0,
  request_count: r.network.length,
  error_count:
    r.network.filter((n) => n.status >= 400).length +
    r.console_events.filter((c) => c.level === "error").length,
  ...extra,
});
const oldRun = {
  id: "r-old",
  name: "Legacy screenshot run",
  url: "https://example.com/",
  session_id: "sess-old",
  started_ms: t0 - 86400e3,
  ended_ms: t0 - 86400e3 + 9000,
  steps: [{ n: 0, ts_ms: t0 - 86400e3, action: "open", target: "page", detail: { url: "https://example.com/" } }],
  network: [],
  console_events: [],
};
const live = {
  id: "r-live",
  name: "Search flow (recording)",
  url: "https://shop.example/search",
  session_id: "sess-live",
  started_ms: Date.now() - 40e3,
  steps: [],
  network: [],
  console_events: [],
};
const SUMMARY = {
  runs: [summary(live, { ended_ms: null }), summary(run, { has_dom: true }), summary(oldRun)],
};
const RUNS = { "r-dom": run, "r-old": oldRun, "r-live": live };

const parentHtml = (q, w) => `<!doctype html><meta charset="utf-8"><title>pwv harness</title>
<style>html,body{margin:0;height:100%;background:#0b0b10}</style>
<script>
const RUNS = ${JSON.stringify(RUNS).replace(/</g, "\\u003c")};
const SUMMARY = ${JSON.stringify(SUMMARY).replace(/</g, "\\u003c")};
const DOM = ${JSON.stringify(domByOffset).replace(/</g, "\\u003c")};
function bodyFor(p) {
  const u = new URL(p, "http://x");
  if (u.pathname.endsWith("/runs")) return SUMMARY;
  if (u.pathname.endsWith("/run")) return RUNS[u.searchParams.get("id")] ? { run: RUNS[u.searchParams.get("id")] } : null;
  if (u.pathname.endsWith("/dom")) return DOM[u.searchParams.get("offset") || "0"] || { events: [], next_offset: 0, eof: true, truncated: false };
  return null;
}
window.addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.type !== "plugin-ui-fetch") return;
  const b = bodyFor(m.path || "");
  document.getElementById("pf").contentWindow.postMessage({
    type: "plugin-ui-fetch-result", requestId: m.requestId,
    status: b ? 200 : 404, body: JSON.stringify(b || { error: "not found" }),
  }, "*");
});
</script>
<iframe id="pf" src="/plugin${q}" style="width:${w ? w + "px" : "100%"};height:100%;border:0"
  sandbox="allow-scripts allow-forms allow-popups allow-downloads"></iframe>`;

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  const u = new URL(req.url || "/", "http://x");
  if (u.pathname === "/plugin") res.end(PAGE);
  else if (u.pathname === "/") {
    const q = new URLSearchParams();
    if (u.searchParams.get("run")) q.set("run", u.searchParams.get("run"));
    if (u.searchParams.get("theme")) q.set("theme", u.searchParams.get("theme"));
    res.end(parentHtml(q.toString() ? "?" + q : "", Number(u.searchParams.get("w")) || 0));
  } else {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
console.log("harness: " + base + "/?run=r-dom   (events=" + events.length + ", app=" + appUrl + ")");

if (SHOTS) {
  mkdirSync(SHOTS, { recursive: true });
  const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await vctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const theme of ["light", "dark"]) {
    await page.goto(base + "/?run=r-dom&theme=" + theme);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS, "dom-start-" + theme + ".png") });
    const fl = page.frameLocator("#pf");
    await fl.locator("#play").click();
    await page.waitForTimeout(4500);
    await page.screenshot({ path: path.join(SHOTS, "dom-playing-" + theme + ".png") });
  }
  await page.goto(base + "/?run=r-old");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "old-run.png") });
  await page.goto(base + "/");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, "empty.png") });
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(base + "/?run=r-dom");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, "mobile.png"), fullPage: true });
  console.log("errors: " + (errors.length ? errors.join(" || ") : "none"));
  await browser.close();
  server.close();
  appServer.close();
} else {
  console.log("serving; Ctrl-C to stop");
}
