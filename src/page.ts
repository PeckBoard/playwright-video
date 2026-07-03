// The Playwright Tests page: run list + LogRocket-style replay player.
// Served as one self-contained HTML string into the sandboxed iframe; all
// data arrives through the parent-proxied /api/plugin-ui/* fetch bridge.
// DOM is built with textContent only — run names/urls are untrusted.

export const PAGE: string = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Playwright Tests</title>
<style>
  :root {
    --bg: #101319; --panel: #171c26; --panel2: #1e2532; --line: #2a3345;
    --text: #dbe2ee; --dim: #8b97ab; --accent: #4f8ff7; --ok: #3fb96f;
    --live: #e0a832;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; background: var(--bg); color: var(--text);
    font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  #runs {
    width: 300px; min-width: 300px; border-right: 1px solid var(--line);
    overflow-y: auto; background: var(--panel);
  }
  #runs h1 { font-size: 13px; margin: 0; padding: 12px 14px 6px; color: var(--dim); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .run { padding: 10px 14px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .run:hover { background: var(--panel2); }
  .run.active { background: var(--panel2); box-shadow: inset 2px 0 0 var(--accent); }
  .run-name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none; }
  .dot.live { background: var(--live); }
  .run-url, .run-meta { color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #empty { padding: 24px 14px; color: var(--dim); }
  #player { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #stage {
    flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
    background: #06080c; position: relative;
  }
  #frame { max-width: 100%; max-height: 100%; object-fit: contain; }
  #noframe { color: var(--dim); }
  #overlay {
    position: absolute; left: 12px; bottom: 12px; max-width: 70%;
    background: rgba(16,19,25,.88); border: 1px solid var(--line);
    border-radius: 6px; padding: 6px 10px; font-size: 12px;
  }
  #overlay .act { color: var(--accent); font-weight: 600; }
  #controls { border-top: 1px solid var(--line); background: var(--panel); padding: 10px 14px; }
  #bar { display: flex; align-items: center; gap: 10px; }
  button { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 5px; padding: 4px 10px; cursor: pointer; font: inherit; }
  button:hover { border-color: var(--accent); }
  select { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 5px; padding: 3px 6px; font: inherit; }
  #pos { color: var(--dim); min-width: 130px; }
  #timeline { position: relative; height: 26px; margin: 10px 0 4px; cursor: pointer; }
  #timeline .rail { position: absolute; left: 0; right: 0; top: 11px; height: 4px; background: var(--panel2); border-radius: 2px; }
  #timeline .fill { position: absolute; left: 0; top: 11px; height: 4px; background: var(--accent); border-radius: 2px; }
  #timeline .tick { position: absolute; top: 7px; width: 3px; height: 12px; border-radius: 1px; background: var(--dim); }
  #timeline .tick.done { background: var(--accent); }
  #timeline .tick.frame { background: var(--ok); }
  #timeline .tick.done.frame { background: var(--accent); }
  #events { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
  .chip { flex: none; border: 1px solid var(--line); background: var(--panel2); border-radius: 10px; padding: 2px 9px; font-size: 11px; color: var(--dim); cursor: pointer; }
  .chip.active { color: var(--text); border-color: var(--accent); }
  #detail { color: var(--dim); font-size: 12px; margin-top: 6px; min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
<div id="runs"><h1>Playwright Tests</h1><div id="runlist"></div><div id="empty" hidden>No recorded runs yet. Runs record automatically when an agent uses the browser_* tools.</div></div>
<div id="player">
  <div id="stage">
    <img id="frame" alt="" hidden />
    <div id="noframe">Select a test run to replay it.</div>
    <div id="overlay" hidden><span class="act"></span> <span class="tgt"></span></div>
  </div>
  <div id="controls" hidden>
    <div id="timeline"><div class="rail"></div><div class="fill"></div></div>
    <div id="bar">
      <button id="play">▶ Play</button>
      <button id="prev">⏮</button>
      <button id="next">⏭</button>
      <select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
      <span id="pos"></span>
    </div>
    <div id="events"></div>
    <div id="detail"></div>
  </div>
</div>
<script>
(function () {
  "use strict";

  // ── Parent-proxied fetch bridge (sandboxed iframe, no same-origin). ──
  var _pending = {};
  var _seq = 0;
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (m && m.type === "plugin-ui-fetch-result" && _pending[m.requestId]) {
      _pending[m.requestId]({ status: m.status, body: m.body });
      delete _pending[m.requestId];
    }
  });
  function apiFetch(path, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var requestId = ++_seq;
      _pending[requestId] = resolve;
      window.parent.postMessage(
        { type: "plugin-ui-fetch", requestId: requestId, method: opts.method || "GET", path: path, body: opts.body },
        "*"
      );
    });
  }
  function getJson(path) {
    return apiFetch(path).then(function (r) {
      var v = {};
      try { v = JSON.parse(r.body || "{}"); } catch (_e) { /* leave {} */ }
      if (r.status >= 400) { throw new Error(v.error || ("HTTP " + r.status)); }
      return v;
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function fmtWhen(ms) {
    var d = Date.now() - ms;
    if (d < 60e3) return "just now";
    if (d < 3600e3) return Math.round(d / 60e3) + "m ago";
    if (d < 86400e3) return Math.round(d / 3600e3) + "h ago";
    return new Date(ms).toLocaleString();
  }
  function fmtDur(ms) {
    if (ms < 1000) return ms + "ms";
    var s = ms / 1000;
    return s < 60 ? s.toFixed(1) + "s" : Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
  }

  // ── run list ──
  var runlist = document.getElementById("runlist");
  var emptyEl = document.getElementById("empty");
  var activeRunId = null;

  function loadRuns() {
    getJson("/api/plugin-ui/playwright-video/runs").then(function (v) {
      clear(runlist);
      var runs = v.runs || [];
      emptyEl.hidden = runs.length > 0;
      runs.forEach(function (r) {
        var row = el("div", "run");
        row.dataset.id = r.id;
        if (r.id === activeRunId) row.className = "run active";
        var name = el("div", "run-name");
        name.appendChild(el("span", "dot" + (r.ended_ms ? "" : " live")));
        name.appendChild(el("span", null, r.name || "test run"));
        row.appendChild(name);
        row.appendChild(el("div", "run-url", r.url || ""));
        var dur = r.ended_ms ? fmtDur(r.ended_ms - r.started_ms) : "running";
        row.appendChild(el("div", "run-meta", fmtWhen(r.started_ms) + " · " + dur + " · " + r.step_count + " steps · " + r.frame_count + " frames"));
        row.addEventListener("click", function () { openRun(r.id); });
        runlist.appendChild(row);
      });
    }).catch(function () { /* transient; next refresh retries */ });
  }
  loadRuns();
  setInterval(loadRuns, 15000);

  // ── player ──
  var frameImg = document.getElementById("frame");
  var noframe = document.getElementById("noframe");
  var overlay = document.getElementById("overlay");
  var controls = document.getElementById("controls");
  var playBtn = document.getElementById("play");
  var speedSel = document.getElementById("speed");
  var posEl = document.getElementById("pos");
  var timeline = document.getElementById("timeline");
  var fillEl = timeline.querySelector(".fill");
  var eventsEl = document.getElementById("events");
  var detailEl = document.getElementById("detail");

  var run = null;          // full RunMeta
  var cur = 0;             // current step index
  var playing = false;
  var timer = null;
  var frames = {};         // frame name -> data URL (cache)

  function openRun(id) {
    activeRunId = id;
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    Array.prototype.forEach.call(runlist.children, function (row) {
      row.className = "run" + (row.dataset.id === id ? " active" : "");
    });
    getJson("/api/plugin-ui/playwright-video/run?id=" + encodeURIComponent(id)).then(function (v) {
      run = v.run;
      frames = {};
      cur = 0;
      controls.hidden = false;
      noframe.hidden = true;
      buildTimeline();
      seek(0);
      updatePlayBtn();
    }).catch(function (e) {
      noframe.hidden = false;
      noframe.textContent = "Failed to load run: " + e.message;
    });
  }

  function spanMs() {
    if (!run || run.steps.length === 0) return 1;
    var last = run.steps[run.steps.length - 1].ts_ms;
    return Math.max(1, last - run.started_ms);
  }

  function buildTimeline() {
    Array.prototype.slice.call(timeline.querySelectorAll(".tick")).forEach(function (t) { t.remove(); });
    clear(eventsEl);
    run.steps.forEach(function (s, i) {
      var tick = el("div", "tick" + (s.frame ? " frame" : ""));
      tick.style.left = "calc(" + (((s.ts_ms - run.started_ms) / spanMs()) * 100).toFixed(2) + "% - 1px)";
      timeline.appendChild(tick);
      var chip = el("button", "chip", s.action + (s.target ? " " + s.target : ""));
      chip.addEventListener("click", function () { pause(); seek(i); });
      eventsEl.appendChild(chip);
    });
  }

  // Latest step index at or before i that has a frame.
  function frameStepFor(i) {
    for (var j = i; j >= 0; j--) { if (run.steps[j].frame) return j; }
    return -1;
  }

  function showFrame(name) {
    if (frames[name]) {
      frameImg.src = frames[name];
      frameImg.hidden = false;
      return;
    }
    getJson("/api/plugin-ui/playwright-video/frame?id=" + encodeURIComponent(run.id) + "&frame=" + encodeURIComponent(name))
      .then(function (v) {
        frames[name] = "data:image/png;base64," + v.base64;
        frameImg.src = frames[name];
        frameImg.hidden = false;
      })
      .catch(function () { /* keep last frame */ });
  }

  function prefetch(i) {
    for (var j = i + 1; j <= Math.min(i + 3, run.steps.length - 1); j++) {
      var f = run.steps[j].frame;
      if (f && !frames[f]) {
        (function (name) {
          getJson("/api/plugin-ui/playwright-video/frame?id=" + encodeURIComponent(run.id) + "&frame=" + encodeURIComponent(name))
            .then(function (v) { frames[name] = "data:image/png;base64," + v.base64; })
            .catch(function () { /* prefetch is best-effort */ });
        })(f);
      }
    }
  }

  function seek(i) {
    if (!run || run.steps.length === 0) return;
    cur = Math.max(0, Math.min(i, run.steps.length - 1));
    var s = run.steps[cur];
    var fi = frameStepFor(cur);
    if (fi >= 0) { showFrame(run.steps[fi].frame); } else { frameImg.hidden = true; }
    prefetch(cur);
    overlay.hidden = false;
    overlay.querySelector(".act").textContent = s.action;
    overlay.querySelector(".tgt").textContent = s.target || "";
    fillEl.style.width = (((s.ts_ms - run.started_ms) / spanMs()) * 100).toFixed(2) + "%";
    Array.prototype.forEach.call(timeline.querySelectorAll(".tick"), function (t, j) {
      t.className = t.className.replace(" done", "") + (j <= cur ? " done" : "");
    });
    Array.prototype.forEach.call(eventsEl.children, function (c, j) {
      c.className = "chip" + (j === cur ? " active" : "");
      if (j === cur) c.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    posEl.textContent = "step " + (cur + 1) + "/" + run.steps.length + " · +" + fmtDur(s.ts_ms - run.started_ms);
    detailEl.textContent = s.detail ? JSON.stringify(s.detail) : "";
  }

  function stepDelay(i) {
    // Real spacing, LogRocket-style, with inactivity skipped: clamp each
    // gap to [250ms, 4s] before applying speed.
    var speed = parseFloat(speedSel.value) || 1;
    if (i + 1 >= run.steps.length) return 0;
    var gap = run.steps[i + 1].ts_ms - run.steps[i].ts_ms;
    return Math.max(250, Math.min(gap, 4000)) / speed;
  }

  function tick() {
    if (!playing) return;
    if (cur + 1 >= run.steps.length) { pause(); return; }
    seek(cur + 1);
    timer = setTimeout(tick, stepDelay(cur));
  }

  function play() {
    if (!run || run.steps.length === 0) return;
    if (cur + 1 >= run.steps.length) cur = -1;
    playing = true;
    updatePlayBtn();
    seek(cur + 1 <= 0 ? 0 : cur);
    timer = setTimeout(tick, stepDelay(cur));
  }
  function pause() {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    updatePlayBtn();
  }
  function updatePlayBtn() { playBtn.textContent = playing ? "⏸ Pause" : "▶ Play"; }

  playBtn.addEventListener("click", function () { playing ? pause() : play(); });
  document.getElementById("prev").addEventListener("click", function () { pause(); seek(cur - 1); });
  document.getElementById("next").addEventListener("click", function () { pause(); seek(cur + 1); });
  timeline.addEventListener("click", function (e) {
    if (!run) return;
    var rect = timeline.getBoundingClientRect();
    var t = run.started_ms + ((e.clientX - rect.left) / rect.width) * spanMs();
    var best = 0;
    run.steps.forEach(function (s, i) { if (s.ts_ms <= t) best = i; });
    pause();
    seek(best);
  });
  document.addEventListener("keydown", function (e) {
    if (!run) return;
    if (e.key === "ArrowLeft") { pause(); seek(cur - 1); }
    else if (e.key === "ArrowRight") { pause(); seek(cur + 1); }
    else if (e.key === " ") { e.preventDefault(); playing ? pause() : play(); }
  });
})();
</script>
</body>
</html>`;
