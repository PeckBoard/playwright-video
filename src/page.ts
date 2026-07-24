// The Playwright Tests page: run list + LogRocket-style replay player with a
// network waterfall (masked request/response detail), console panel, event
// timeline, and time-scaled playback with inactivity skipping.
// Served as one self-contained HTML string into the sandboxed iframe; all
// data arrives through the parent-proxied /api/plugin-ui/* fetch bridge.
// DOM is built with textContent only — run names/urls/bodies are untrusted.
// NOTE: SHELL/APP below are TS template literals — the embedded JS must avoid
// backticks, dollar-brace, and backslash escapes. The vendored mp4-muxer build
// (which uses all three freely) is injected between them as its own <script>
// tag; the tests verify it contains no </script> terminator.

import MUXER_JS from "./vendor/mp4-muxer.txt";

const SHELL: string = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Playwright Tests</title>
<style>
  :root {
    --bg: #f6f4fb; --panel: #ffffff; --panel2: #f3f0fa; --line: #e7e3f2;
    --text: #23263a; --dim: #71778e; --accent: #6c5ce7; --accent-soft: #efeaff;
    --ok: #1fa971; --err: #e5484d; --warn: #b45309; --live: #d97706;
    --stage: #ece8f6;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; grid-template-columns: 270px minmax(0, 1fr) 300px;
    grid-template-rows: minmax(0, 1fr);
    background: var(--bg); color: var(--text);
    font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 4px 10px; cursor: pointer; font: inherit; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
  input[type="text"] { background: var(--panel); border: 1px solid var(--line); border-radius: 7px; padding: 4px 9px; font: inherit; color: var(--text); outline: none; min-width: 0; }
  input[type="text"]:focus { border-color: var(--accent); }

  /* ── left: run list ── */
  #runs { border-right: 1px solid var(--line); overflow-y: auto; background: var(--panel); }
  #runs h1 { font-size: 12px; margin: 0; padding: 14px 14px 8px; color: var(--dim); font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
  .run { padding: 10px 14px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .run:hover { background: var(--panel2); }
  .run.active { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
  .run-name { font-weight: 600; display: flex; align-items: center; gap: 7px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none; }
  .dot.live { background: var(--live); animation: pulse 1.6s infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .run-url, .run-meta { color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .run-meta .err { color: var(--err); }
  #empty { padding: 24px 14px; color: var(--dim); }

  /* ── center column ── */
  #main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  #stage { flex: 1 1 42%; min-height: 120px; display: flex; align-items: center; justify-content: center; background: var(--stage); position: relative; overflow: hidden; }
  #frame { max-width: 96%; max-height: 94%; object-fit: contain; border-radius: 6px; box-shadow: 0 4px 24px rgba(60,40,120,.18); background: #fff; }
  #noframe { color: var(--dim); }
  #overlay { position: absolute; left: 12px; bottom: 12px; max-width: 72%; background: rgba(255,255,255,.92); border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px; font-size: 12px; box-shadow: 0 2px 10px rgba(60,40,120,.10); }
  #overlay .act { color: var(--accent); font-weight: 700; }
  #cursor { position: absolute; z-index: 4; pointer-events: none; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: rgba(108,92,231,.85); border: 2px solid #fff; box-shadow: 0 1px 6px rgba(60,40,120,.45); }
  #ripple { position: absolute; z-index: 3; pointer-events: none; border-radius: 50%; border: 2px solid var(--accent); transform: translate(-50%, -50%); }

  /* ── dock (network / console) ── */
  #dock { flex: 1 1 34%; min-height: 150px; display: flex; flex-direction: column; border-top: 1px solid var(--line); background: var(--panel); position: relative; }
  #dockbar { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  #dockbar .tab { border: none; background: none; padding: 4px 8px; font-weight: 600; color: var(--dim); border-radius: 6px; }
  #dockbar .tab.on { color: var(--accent); background: var(--accent-soft); }
  #dockbar .badge { display: inline-block; min-width: 16px; text-align: center; background: var(--err); color: #fff; border-radius: 8px; font-size: 10px; padding: 0 4px; margin-left: 4px; }
  #netfilter { flex: 1; max-width: 260px; }
  .chip { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 2px 10px; font-size: 11px; color: var(--dim); }
  .chip.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
  #dockbody { flex: 1; overflow-y: auto; min-height: 0; }
  table#nettbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
  #nettbl th { position: sticky; top: 0; background: var(--panel2); color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); z-index: 1; }
  #nettbl td { padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #nettbl col.c-st { width: 64px; } #nettbl col.c-m { width: 58px; } #nettbl col.c-n { width: 38%; } #nettbl col.c-t { width: 74px; } #nettbl col.c-w { width: auto; }
  #nettbl .tcol { text-align: right; }
  #nettbl td.tcol { color: var(--dim); font-variant-numeric: tabular-nums; }
  .nrow { cursor: pointer; }
  .nrow:hover td { background: var(--panel2); }
  .nrow.sel td { background: var(--accent-soft); }
  .nrow.future { opacity: .38; }
  .nrow.now td { background: var(--accent-soft); }
  .st-ok { color: var(--ok); font-weight: 600; } .st-err { color: var(--err); font-weight: 700; } .st-pend { color: var(--dim); }
  .wf { position: relative; height: 12px; background: transparent; }
  .wf .bar { position: absolute; top: 1px; height: 10px; border-radius: 3px; background: #34c98e; min-width: 3px; }
  .wf .bar.err { background: var(--err); }
  .wf .bar.pend { background: #b9b3d6; }
  #netempty, #conempty { padding: 22px 14px; color: var(--dim); }
  #conlist .crow { display: flex; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--line); font-size: 12px; cursor: pointer; align-items: baseline; }
  #conlist .crow:hover { background: var(--panel2); }
  #conlist .crow.now { background: var(--accent-soft); }
  #conlist .crow.future { opacity: .38; }
  .lvl { flex: none; width: 44px; text-align: center; border-radius: 6px; font-size: 10px; font-weight: 700; padding: 1px 0; background: var(--panel2); color: var(--dim); text-transform: uppercase; }
  .lvl.error { background: #fde8e8; color: var(--err); }
  .lvl.warning { background: #fdf1e2; color: var(--warn); }
  .ctext { white-space: pre-wrap; word-break: break-word; }
  .crow.error .ctext { color: var(--err); }
  .cts { flex: none; color: var(--dim); font-size: 11px; width: 56px; }

  /* ── request drawer ── */
  #drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 58%; min-width: 300px; background: var(--panel); border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgba(60,40,120,.12); display: flex; flex-direction: column; z-index: 5; }
  #drawer header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
  #drawer header .m { font-weight: 700; color: var(--accent); }
  #drawer header .u { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dim); font-size: 12px; direction: rtl; text-align: left; }
  #drawerbody { flex: 1; overflow-y: auto; padding: 10px 12px; }
  #drawerbody h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 14px 0 5px; }
  #drawerbody h3:first-child { margin-top: 0; }
  #drawerbody dl { margin: 0; display: grid; grid-template-columns: 130px 1fr; gap: 2px 10px; font-size: 12px; }
  #drawerbody dt { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #drawerbody dd { margin: 0; word-break: break-all; }
  #drawerbody pre { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 11.5px; white-space: pre-wrap; word-break: break-word; margin: 0; max-height: 300px; overflow: auto; }
  .trunc { color: var(--warn); font-size: 11px; margin-top: 3px; }

  /* ── player bar ── */
  #player { border-top: 1px solid var(--line); background: var(--panel); padding: 8px 14px 10px; }
  #scrub { position: relative; height: 26px; cursor: pointer; }
  #scrub .rail { position: absolute; left: 0; right: 0; top: 12px; height: 5px; background: var(--panel2); border-radius: 3px; }
  #scrub .fill { position: absolute; left: 0; top: 12px; height: 5px; background: var(--accent); border-radius: 3px; }
  #scrub .knob { position: absolute; top: 8px; width: 13px; height: 13px; border-radius: 50%; background: var(--accent); box-shadow: 0 1px 4px rgba(60,40,120,.4); margin-left: -6px; }
  #scrub .tick { position: absolute; top: 4px; width: 2px; height: 6px; border-radius: 1px; background: #b6aee6; }
  #scrub .tick.err { background: var(--err); height: 8px; top: 2px; }
  #bar { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  #pos { background: var(--accent-soft); color: var(--accent); font-weight: 600; border-radius: 7px; padding: 3px 9px; font-variant-numeric: tabular-nums; }
  .spd { padding: 3px 8px; border: none; background: none; color: var(--dim); border-radius: 6px; }
  .spd.on { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  #skip { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); cursor: pointer; user-select: none; margin-left: auto; font-weight: 600; }
  #skip.off { color: var(--dim); font-weight: 400; }
  #skip .box { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--accent); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
  #skip.off .box { border-color: var(--dim); color: transparent; }
  #exportstat { color: var(--dim); font-size: 12px; }
  #exportstat.err { color: var(--err); }

  /* ── right sidebar ── */
  #side { border-left: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  #sidetabs { display: flex; gap: 6px; padding: 10px 12px 8px; border-bottom: 1px solid var(--line); }
  #sidetabs .tab { border: none; background: none; padding: 5px 9px; font-weight: 600; color: var(--dim); border-radius: 7px; }
  #sidetabs .tab.on { color: var(--accent); background: var(--accent-soft); }
  #sidebody { flex: 1; overflow-y: auto; min-height: 0; }
  .ev { display: flex; gap: 9px; padding: 7px 12px; border-bottom: 1px solid var(--line); cursor: pointer; align-items: baseline; }
  .ev:hover { background: var(--panel2); }
  .ev.now { background: var(--accent-soft); }
  .ev.future { opacity: .42; }
  .ev .ico { flex: none; width: 34px; text-align: center; font-size: 9.5px; font-weight: 800; letter-spacing: .04em; color: var(--accent); background: var(--accent-soft); border-radius: 6px; padding: 2px 0; }
  .ev.rage .ico { color: #fff; background: var(--err); }
  .ev .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ev .lbl .sub { color: var(--dim); font-size: 11.5px; display: block; overflow: hidden; text-overflow: ellipsis; }
  .ev .ets { flex: none; color: var(--dim); font-size: 11px; }
  #details { padding: 12px 14px; }
  #details dl { margin: 0; display: grid; grid-template-columns: 108px 1fr; gap: 5px 10px; font-size: 12.5px; }
  #details dt { color: var(--dim); }
  #details dd { margin: 0; word-break: break-word; }
  #sideempty { padding: 22px 14px; color: var(--dim); }

  /* ── mobile (iframe ≤760px wide, e.g. phones): stack the three columns ── */
  @media (max-width: 760px) {
    html, body { height: auto; }
    body { display: flex; flex-direction: column; min-height: 100dvh; }
    #runs { flex: none; border-right: none; border-bottom: 1px solid var(--line); max-height: 32vh; overflow-y: auto; }
    #main { flex: none; }
    /* controls directly under the video: stage → player → dock */
    #stage { order: 0; flex: none; height: 56vw; min-height: 170px; max-height: 42vh; }
    #player { order: 1; border-top: 1px solid var(--line); }
    #dock { order: 2; flex: none; }
    #dockbody { max-height: 45vh; }
    #drawer { width: 100%; min-width: 0; }
    #netfilter { max-width: none; }
    #nettbl { table-layout: auto; }
    #nettbl th:nth-child(5), #nettbl td:nth-child(5), #nettbl col.c-w { display: none; }
    #nettbl th, #nettbl td { padding: 4px 6px; }
    #side { flex: none; border-left: none; border-top: 1px solid var(--line); }
    #sidebody { max-height: 50vh; }
    #overlay { max-width: calc(100% - 24px); }
  }
</style>
</head>
<body>
<div id="runs"><h1>Playwright Tests</h1><div id="runlist"></div><div id="empty" hidden>No recorded runs yet. Runs record automatically when an agent uses the browser_* tools.</div></div>

<div id="main">
  <div id="stage">
    <img id="frame" alt="" hidden />
    <div id="noframe">Select a test run to replay it.</div>
    <div id="overlay" hidden><span class="act"></span> <span class="tgt"></span></div>
    <div id="cursor" hidden></div>
    <div id="ripple" hidden></div>
  </div>
  <div id="dock" hidden>
    <div id="dockbar">
      <button class="tab on" id="tab-net">Network</button>
      <button class="tab" id="tab-con">Console<span class="badge" id="conbadge" hidden></span></button>
      <span id="netctl" style="display:flex;gap:6px;align-items:center;flex:1;flex-wrap:wrap;">
        <input type="text" id="netfilter" placeholder="Filter requests" />
        <span id="netchips"></span>
      </span>
      <span id="conctl" style="display:none;gap:6px;align-items:center;flex:1;flex-wrap:wrap;">
        <span id="conchips"></span>
      </span>
    </div>
    <div id="dockbody">
      <table id="nettbl">
        <colgroup><col class="c-st"/><col class="c-m"/><col class="c-n"/><col class="c-t"/><col class="c-w"/></colgroup>
        <thead><tr><th>Status</th><th>Method</th><th>Request</th><th class="tcol">Time</th><th id="wfhead">Waterfall</th></tr></thead>
        <tbody id="netrows"></tbody>
      </table>
      <div id="netempty" hidden></div>
      <div id="conlist" style="display:none"></div>
      <div id="conempty" hidden>No console output captured.</div>
    </div>
    <div id="drawer" hidden>
      <header><span class="m"></span><span class="u"></span><button id="dclose">✕</button></header>
      <div id="drawerbody"></div>
    </div>
  </div>
  <div id="player" hidden>
    <div id="scrub"><div class="rail"></div><div class="fill"></div><div class="knob"></div></div>
    <div id="bar">
      <span id="pos">0:00.0 / 0:00.0</span>
      <button id="restart" title="Restart">⏮</button>
      <button id="play">▶ Play</button>
      <span id="speeds"></span>
      <span id="skip"><span class="box">✓</span>Skipping inactivity</span>
      <button id="export" title="Export this run as an MP4 video">⬇ MP4</button>
      <span id="exportstat" hidden></span>
    </div>
  </div>
</div>

<div id="side">
  <div id="sidetabs">
    <button class="tab on" id="tab-events">Event timeline</button>
    <button class="tab" id="tab-details">Session details</button>
  </div>
  <div id="sidebody">
    <div id="events"></div>
    <div id="details" style="display:none"></div>
    <div id="sideempty">No run selected.</div>
  </div>
</div>

`;

const APP: string = `<script>
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
  function apiFetch(path) {
    return new Promise(function (resolve) {
      var requestId = ++_seq;
      _pending[requestId] = resolve;
      window.parent.postMessage(
        { type: "plugin-ui-fetch", requestId: requestId, method: "GET", path: path },
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

  // ── tiny DOM + format helpers ──
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function byId(id) { return document.getElementById(id); }
  function fmtWhen(ms) {
    var d = Date.now() - ms;
    if (d < 60e3) return "just now";
    if (d < 3600e3) return Math.round(d / 60e3) + "m ago";
    if (d < 86400e3) return Math.round(d / 3600e3) + "h ago";
    return new Date(ms).toLocaleString();
  }
  function fmtDur(ms) {
    if (ms < 1000) return Math.round(ms) + "ms";
    var s = ms / 1000;
    return s < 60 ? s.toFixed(1) + "s" : Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
  }
  function fmtClock(ms) {
    if (ms < 0 || !isFinite(ms)) ms = 0;
    var t = Math.floor(ms / 100) / 10;
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    var ss = s.toFixed(1);
    if (s < 10) ss = "0" + ss;
    return m + ":" + ss;
  }
  function fmtBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function shortUrl(u) {
    var q = u.indexOf("?");
    var base = q >= 0 ? u.slice(0, q) : u;
    var i = base.indexOf("://");
    var rest = i >= 0 ? base.slice(i + 3) : base;
    var slash = rest.indexOf("/");
    var path = slash >= 0 ? rest.slice(slash) : "/";
    if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
    var seg = path.split("/");
    var tail = seg[seg.length - 1] || (slash >= 0 ? rest.slice(0, slash) : rest);
    return tail + (q >= 0 ? u.slice(q, q + 24) : "");
  }
  function prettyBody(s) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch (_e) { return s; }
  }

  // ── network type buckets ──
  var TYPE_CHIPS = ["All", "XHR", "Doc", "JS", "CSS", "Img", "Font", "Media", "Other"];
  function bucketOf(rt) {
    if (rt === "xhr" || rt === "fetch" || rt === "eventsource" || rt === "websocket") return "XHR";
    if (rt === "document") return "Doc";
    if (rt === "script") return "JS";
    if (rt === "stylesheet") return "CSS";
    if (rt === "image") return "Img";
    if (rt === "font") return "Font";
    if (rt === "media") return "Media";
    return "Other";
  }
  var LEVEL_CHIPS = ["All", "Log", "Info", "Warning", "Error", "Debug"];
  function levelBucket(lvl) {
    if (lvl === "warn" || lvl === "warning") return "Warning";
    if (lvl === "error") return "Error";
    if (lvl === "info") return "Info";
    if (lvl === "debug" || lvl === "trace") return "Debug";
    return "Log";
  }

  // ── state ──
  var run = null;
  var activeRunId = null;
  var frames = {};           // frame name -> data URL
  var netFin = [];           // per network event: finish ts (or start)
  var netRowEls = [];        // <tr> per network event (run order)
  var conRowEls = [];
  var evRowEls = [];         // event-timeline rows (aligned with run.steps)
  var playing = false;
  var speed = 1;
  var skipping = true;
  var vt = 0;                // virtual playhead ms
  var vspan = 1;
  var realPts = [0];         // activity timestamps (relative to start)
  var virtPts = [0];         // compressed prefix at each activity point
  var span = 1;              // real span ms
  var rafId = null;
  var lastTick = 0;
  var typeFilter = "All";
  var textFilter = "";
  var levelFilter = "All";
  var drawerIdx = -1;
  var liveTimer = null;
  var GAP_CAP = 4000;

  // ── time map: real ↔ virtual with inactivity compression ──
  function buildTimeMap() {
    var pts = [0];
    var i;
    if (run) {
      for (i = 0; i < run.steps.length; i++) pts.push(run.steps[i].ts_ms - run.started_ms);
      var net = run.network || [];
      for (i = 0; i < net.length; i++) {
        pts.push(net[i].ts_ms - run.started_ms);
        pts.push(netFin[i] - run.started_ms);
      }
      var con = run.console_events || [];
      for (i = 0; i < con.length; i++) pts.push(con[i].ts_ms - run.started_ms);
      var ptr = run.pointer_events || [];
      for (i = 0; i < ptr.length; i += 4) pts.push(ptr[i].ts_ms - run.started_ms);
      if (run.ended_ms) pts.push(run.ended_ms - run.started_ms);
    }
    pts = pts.filter(function (p) { return isFinite(p) && p >= 0; });
    pts.sort(function (a, b) { return a - b; });
    var uniq = [];
    for (i = 0; i < pts.length; i++) {
      if (!uniq.length || pts[i] > uniq[uniq.length - 1]) uniq.push(pts[i]);
    }
    if (uniq.length < 2) uniq.push((uniq[0] || 0) + 1);
    realPts = uniq;
    virtPts = [0];
    for (i = 1; i < uniq.length; i++) {
      var gap = uniq[i] - uniq[i - 1];
      virtPts.push(virtPts[i - 1] + (skipping ? Math.min(gap, GAP_CAP) : gap));
    }
    span = uniq[uniq.length - 1];
    vspan = Math.max(1, virtPts[virtPts.length - 1]);
  }
  function virtualOf(t) {
    if (t <= realPts[0]) return 0;
    for (var i = 1; i < realPts.length; i++) {
      if (t <= realPts[i]) {
        var g = realPts[i] - realPts[i - 1];
        var vg = virtPts[i] - virtPts[i - 1];
        return virtPts[i - 1] + (g ? (t - realPts[i - 1]) / g * vg : 0);
      }
    }
    return vspan;
  }
  function realOf(v) {
    if (v <= 0) return 0;
    for (var i = 1; i < virtPts.length; i++) {
      if (v <= virtPts[i]) {
        var vg = virtPts[i] - virtPts[i - 1];
        var g = realPts[i] - realPts[i - 1];
        return realPts[i - 1] + (vg ? (v - virtPts[i - 1]) / vg * g : 0);
      }
    }
    return span;
  }

  // ── run list ──
  var runlist = byId("runlist");
  function loadRuns() {
    getJson("/api/plugin-ui/playwright-video/runs").then(function (v) {
      clear(runlist);
      var runs = v.runs || [];
      byId("empty").hidden = runs.length > 0;
      runs.forEach(function (r) {
        var row = el("div", "run" + (r.id === activeRunId ? " active" : ""));
        row.dataset.id = r.id;
        var name = el("div", "run-name");
        name.appendChild(el("span", "dot" + (r.ended_ms ? "" : " live")));
        name.appendChild(el("span", null, r.name || "test run"));
        row.appendChild(name);
        row.appendChild(el("div", "run-url", r.url || ""));
        var dur = r.ended_ms ? fmtDur(r.ended_ms - r.started_ms) : "running";
        var meta = el("div", "run-meta");
        meta.appendChild(el("span", null,
          fmtWhen(r.started_ms) + " · " + dur + " · " + r.step_count + " steps · " +
          (r.request_count || 0) + " reqs"));
        if (r.error_count) meta.appendChild(el("span", "err", " · " + r.error_count + " errors"));
        row.appendChild(meta);
        row.addEventListener("click", function () { openRun(r.id); });
        runlist.appendChild(row);
      });
      // Land in content, not an empty player: auto-open the newest run.
      if (!activeRunId && runs.length) openRun(runs[0].id);
    }).catch(function () { /* transient; next refresh retries */ });
  }
  loadRuns();
  // The parent fetch bridge may not be listening yet on the very first
  // call — retry quickly before settling into the slow refresh.
  setTimeout(loadRuns, 800);
  setTimeout(loadRuns, 2500);
  setInterval(loadRuns, 15000);

  // ── open a run ──
  function openRun(id) {
    activeRunId = id;
    pause();
    Array.prototype.forEach.call(runlist.children, function (row) {
      row.className = "run" + (row.dataset.id === id ? " active" : "");
    });
    getJson("/api/plugin-ui/playwright-video/run?id=" + encodeURIComponent(id)).then(function (v) {
      adoptRun(v.run, true);
      if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
      if (!v.run.ended_ms) {
        liveTimer = setInterval(refreshLive, 5000);
      }
    }).catch(function (e) {
      byId("noframe").hidden = false;
      byId("noframe").textContent = "Failed to load run: " + e.message;
    });
  }
  function refreshLive() {
    if (!activeRunId) return;
    getJson("/api/plugin-ui/playwright-video/run?id=" + encodeURIComponent(activeRunId)).then(function (v) {
      if (!run || v.run.id !== run.id) return;
      var grew = v.run.steps.length !== run.steps.length ||
        (v.run.network || []).length !== (run.network || []).length ||
        (v.run.console_events || []).length !== (run.console_events || []).length ||
        !!v.run.ended_ms !== !!run.ended_ms;
      if (!grew) return;
      var keepVt = vt, keepPlaying = playing;
      adoptRun(v.run, false);
      vt = Math.min(keepVt, vspan);
      if (keepPlaying) play(); else render();
      if (v.run.ended_ms && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    }).catch(function () { /* transient */ });
  }
  function adoptRun(r, reset) {
    run = r;
    if (reset) { frames = {}; vt = 0; drawerIdx = -1; byId("drawer").hidden = true; }
    netFin = (run.network || []).map(function (ne) {
      return ne.ts_ms + (ne.dur_ms != null ? ne.dur_ms : 0);
    });
    buildTimeMap();
    byId("dock").hidden = false;
    byId("player").hidden = false;
    byId("noframe").hidden = true;
    byId("sideempty").style.display = "none";
    rebuildScrub();
    rebuildNet();
    rebuildConsole();
    rebuildEvents();
    rebuildDetails();
    render();
  }

  // ── scrubber ──
  var scrub = byId("scrub");
  function rebuildScrub() {
    Array.prototype.slice.call(scrub.querySelectorAll(".tick")).forEach(function (t) { t.remove(); });
    var i;
    for (i = 0; i < run.steps.length; i++) {
      var tick = el("div", "tick");
      tick.style.left = (virtualOf(run.steps[i].ts_ms - run.started_ms) / vspan * 100).toFixed(2) + "%";
      scrub.appendChild(tick);
    }
    var net = run.network || [];
    for (i = 0; i < net.length; i++) {
      if (isNetErr(net[i])) {
        var m = el("div", "tick err");
        m.style.left = (virtualOf(net[i].ts_ms - run.started_ms) / vspan * 100).toFixed(2) + "%";
        scrub.appendChild(m);
      }
    }
    var con = run.console_events || [];
    for (i = 0; i < con.length; i++) {
      if (levelBucket(con[i].level) === "Error") {
        var c = el("div", "tick err");
        c.style.left = (virtualOf(con[i].ts_ms - run.started_ms) / vspan * 100).toFixed(2) + "%";
        scrub.appendChild(c);
      }
    }
  }
  scrub.addEventListener("mousedown", function (e) {
    if (!run) return;
    pause();
    scrubTo(e);
    function move(ev) { scrubTo(ev); }
    function up() { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  function scrubTo(e) {
    var rect = scrub.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    vt = f * vspan;
    render();
  }

  // ── network dock ──
  function isNetErr(ne) { return !!ne.failure || (ne.status != null && ne.status >= 400); }
  function rebuildNet() {
    var tbody = byId("netrows");
    clear(tbody);
    netRowEls = [];
    var net = run.network || [];
    byId("netempty").hidden = net.length > 0;
    byId("netempty").textContent = net.length ? "" :
      (run.ended_ms && !net.length
        ? "No network captured for this run. Runs recorded by an older PeckBoard core have no traffic data."
        : "No requests yet.");
    net.forEach(function (ne, i) {
      var tr = el("tr", "nrow");
      var st;
      if (ne.failure) st = el("td", "st-err", "failed");
      else if (ne.status == null) st = el("td", "st-pend", "…");
      else st = el("td", ne.status >= 400 ? "st-err" : "st-ok", String(ne.status));
      tr.appendChild(st);
      tr.appendChild(el("td", null, ne.method));
      var name = el("td", null, shortUrl(ne.url));
      name.title = ne.method + " " + ne.url;
      tr.appendChild(name);
      var tm = el("td", "tcol", ne.dur_ms != null ? fmtDur(ne.dur_ms) : "…");
      tm.title = ne.dur_ms != null ? ne.dur_ms + " ms" : "pending";
      tr.appendChild(tm);
      var wf = el("td", "wf");
      var bar = el("div", "bar" + (isNetErr(ne) ? " err" : (ne.status == null ? " pend" : "")));
      var v0 = virtualOf(ne.ts_ms - run.started_ms) / vspan * 100;
      var v1 = virtualOf(netFin[i] - run.started_ms) / vspan * 100;
      bar.style.left = v0.toFixed(2) + "%";
      bar.style.width = Math.max(0.4, v1 - v0).toFixed(2) + "%";
      bar.title = (ne.dur_ms != null ? fmtDur(ne.dur_ms) : "pending") + (ne.size != null ? " · " + fmtBytes(ne.size) : "");
      wf.appendChild(bar);
      tr.appendChild(wf);
      tr.addEventListener("click", function () { openDrawer(i); });
      tbody.appendChild(tr);
      netRowEls.push(tr);
    });
    applyNetFilters();
  }
  function applyNetFilters() {
    var net = run ? (run.network || []) : [];
    var q = textFilter.toLowerCase();
    net.forEach(function (ne, i) {
      var okType = typeFilter === "All" || bucketOf(ne.resource_type) === typeFilter;
      var hay = (ne.method + " " + ne.url + " " + (ne.status || "") + " " + ne.resource_type).toLowerCase();
      var okText = !q || hay.indexOf(q) >= 0;
      netRowEls[i].style.display = okType && okText ? "" : "none";
    });
  }
  var chipsBox = byId("netchips");
  TYPE_CHIPS.forEach(function (t) {
    var c = el("button", "chip" + (t === "All" ? " on" : ""), t);
    c.addEventListener("click", function () {
      typeFilter = t;
      Array.prototype.forEach.call(chipsBox.children, function (x) { x.className = "chip" + (x.textContent === t ? " on" : ""); });
      applyNetFilters();
    });
    chipsBox.appendChild(c);
  });
  byId("netfilter").addEventListener("input", function () {
    textFilter = this.value.trim();
    applyNetFilters();
  });

  // request drawer
  function openDrawer(i) {
    drawerIdx = i;
    var ne = run.network[i];
    var d = byId("drawer");
    d.hidden = false;
    d.querySelector(".m").textContent = ne.method;
    d.querySelector(".u").textContent = ne.url;
    var b = byId("drawerbody");
    clear(b);
    b.appendChild(el("h3", null, "General"));
    var dl = el("dl");
    function row(k, v) {
      if (v == null || v === "") return;
      dl.appendChild(el("dt", null, k));
      dl.appendChild(el("dd", null, String(v)));
    }
    row("URL", ne.url);
    row("Status", ne.failure ? "failed — " + ne.failure : (ne.status != null ? ne.status : "pending"));
    row("Type", ne.resource_type);
    row("Started", "+" + fmtClock(ne.ts_ms - run.started_ms));
    row("Duration", ne.dur_ms != null ? fmtDur(ne.dur_ms) : null);
    row("Size", ne.size != null ? fmtBytes(ne.size) : null);
    b.appendChild(dl);
    function headerBlock(title, hs) {
      var keys = hs ? Object.keys(hs) : [];
      if (!keys.length) return;
      b.appendChild(el("h3", null, title));
      var hdl = el("dl");
      keys.sort().forEach(function (k) {
        hdl.appendChild(el("dt", null, k));
        hdl.appendChild(el("dd", null, hs[k]));
      });
      b.appendChild(hdl);
    }
    headerBlock("Request headers", ne.req_headers);
    if (ne.req_body) {
      b.appendChild(el("h3", null, "Request body"));
      b.appendChild(el("pre", null, prettyBody(ne.req_body)));
    }
    headerBlock("Response headers", ne.resp_headers);
    if (ne.resp_body) {
      b.appendChild(el("h3", null, "Response body"));
      b.appendChild(el("pre", null, prettyBody(ne.resp_body)));
      if (ne.resp_body_truncated) b.appendChild(el("div", "trunc", "Body truncated for storage."));
    }
    b.appendChild(el("h3", null, "Privacy"));
    b.appendChild(el("div", null, "Sensitive headers, parameters, and body fields are masked before anything is stored."));
    netRowEls.forEach(function (r, j) { r.className = r.className.replace(" sel", "") + (j === i ? " sel" : ""); });
  }
  byId("dclose").addEventListener("click", closeDrawer);
  function closeDrawer() {
    byId("drawer").hidden = true;
    drawerIdx = -1;
    netRowEls.forEach(function (r) { r.className = r.className.replace(" sel", ""); });
  }

  // ── console dock ──
  function rebuildConsole() {
    var list = byId("conlist");
    clear(list);
    conRowEls = [];
    var con = run.console_events || [];
    var errs = 0;
    con.forEach(function (ce) {
      var row = el("div", "crow " + levelBucket(ce.level).toLowerCase());
      row.appendChild(el("span", "cts", "+" + fmtClock(ce.ts_ms - run.started_ms)));
      row.appendChild(el("span", "lvl " + ce.level, levelBucket(ce.level)));
      row.appendChild(el("span", "ctext", ce.text));
      if (levelBucket(ce.level) === "Error") errs++;
      row.addEventListener("click", function () { pause(); vt = virtualOf(ce.ts_ms - run.started_ms); render(); });
      list.appendChild(row);
      conRowEls.push(row);
    });
    byId("conempty").hidden = con.length > 0;
    var badge = byId("conbadge");
    badge.hidden = errs === 0;
    badge.textContent = String(errs);
    applyConFilters();
  }
  function applyConFilters() {
    var con = run ? (run.console_events || []) : [];
    con.forEach(function (ce, i) {
      var ok = levelFilter === "All" || levelBucket(ce.level) === levelFilter;
      conRowEls[i].style.display = ok ? "flex" : "none";
    });
  }
  var conChips = byId("conchips");
  LEVEL_CHIPS.forEach(function (t) {
    var c = el("button", "chip" + (t === "All" ? " on" : ""), t);
    c.addEventListener("click", function () {
      levelFilter = t;
      Array.prototype.forEach.call(conChips.children, function (x) { x.className = "chip" + (x.textContent === t ? " on" : ""); });
      applyConFilters();
    });
    conChips.appendChild(c);
  });

  // dock tabs
  function setDockTab(net) {
    byId("tab-net").className = "tab" + (net ? " on" : "");
    byId("tab-con").className = "tab" + (net ? "" : " on");
    byId("nettbl").style.display = net ? "" : "none";
    byId("netempty").hidden = true;
    byId("conlist").style.display = net ? "none" : "";
    byId("conempty").hidden = true;
    byId("netctl").style.display = net ? "flex" : "none";
    byId("conctl").style.display = net ? "none" : "flex";
    if (run) {
      if (net) byId("netempty").hidden = (run.network || []).length > 0;
      else byId("conempty").hidden = (run.console_events || []).length > 0;
    }
    if (!net) closeDrawer();
  }
  byId("tab-net").addEventListener("click", function () { setDockTab(true); });
  byId("tab-con").addEventListener("click", function () { setDockTab(false); });

  // ── event timeline + session details ──
  function stepIco(a) {
    if (a === "open") return "OPN";
    if (a === "navigate" || a === "back" || a === "forward") return "NAV";
    if (a === "click") return "CLK";
    if (a === "type" || a === "fill") return "TYP";
    if (a === "press_key") return "KEY";
    if (a === "select") return "SEL";
    if (a === "screenshot") return "SHT";
    if (a === "upload") return "UPL";
    if (a === "dialog") return "DLG";
    if (a.indexOf("scroll") === 0) return "SCR";
    if (a.indexOf("wait") === 0) return "WAI";
    return "ACT";
  }
  function stepLabel(s) {
    var d = s.detail || {};
    if (s.action === "open" || s.action === "navigate") return "Navigated to " + (d.url || d.text || "");
    if (s.action === "click") return "Click on " + (s.target || "page");
    if (s.action === "type" || s.action === "fill") return "Entered text in " + (s.target || "field");
    if (s.action === "press_key") return "Pressed " + (d.text || "key");
    if (s.action === "select") return "Selected option in " + (s.target || "field");
    if (s.action === "screenshot") return "Screenshot";
    if (s.action === "upload") return "Uploaded file to " + (s.target || "input");
    if (s.action === "dialog") return (d.accept === false ? "Dismissed dialog" : "Accepted dialog");
    if (s.action === "back") return "Navigated back";
    if (s.action === "forward") return "Navigated forward";
    if (s.action === "scroll_top") return "Scrolled to top";
    if (s.action === "scroll_bottom") return "Scrolled to bottom";
    if (s.action === "wait_selector") return "Waited for " + (d.text || "selector");
    if (s.action === "wait_ms") return "Waited";
    return s.action;
  }
  function rageSpans() {
    // ≥3 clicks on the same target within 1.2s of each other → rage.
    var out = {};
    var steps = run.steps;
    var i = 0;
    while (i < steps.length) {
      if (steps[i].action !== "click" || !steps[i].target) { i++; continue; }
      var j = i;
      while (
        j + 1 < steps.length &&
        steps[j + 1].action === "click" &&
        steps[j + 1].target === steps[i].target &&
        steps[j + 1].ts_ms - steps[j].ts_ms <= 1200
      ) j++;
      if (j - i + 1 >= 3) out[i] = j - i + 1;
      i = j + 1;
    }
    return out;
  }
  function rebuildEvents() {
    var box = byId("events");
    clear(box);
    evRowEls = [];
    var rage = rageSpans();
    run.steps.forEach(function (s, i) {
      var row = el("div", "ev" + (rage[i] ? " rage" : ""));
      row.appendChild(el("span", "ico", rage[i] ? "RAGE" : stepIco(s.action)));
      var lbl = el("span", "lbl");
      lbl.appendChild(document.createTextNode(rage[i] ? "Rage click ×" + rage[i] + " on " + s.target : stepLabel(s)));
      var d = s.detail || {};
      var sub = null;
      if ((s.action === "type" || s.action === "fill") && d.text) sub = String(d.text);
      if (s.action === "click" && s.target) sub = "ref " + s.target;
      if (sub) lbl.appendChild(el("span", "sub", sub));
      row.appendChild(lbl);
      row.appendChild(el("span", "ets", "+" + fmtClock(s.ts_ms - run.started_ms)));
      row.addEventListener("click", function () { pause(); vt = virtualOf(s.ts_ms - run.started_ms); render(); });
      box.appendChild(row);
      evRowEls.push(row);
    });
  }
  function rebuildDetails() {
    var box = byId("details");
    clear(box);
    var dl = el("dl");
    function row(k, v) {
      if (v == null || v === "") return;
      dl.appendChild(el("dt", null, k));
      dl.appendChild(el("dd", null, String(v)));
    }
    var net = run.network || [];
    var failed = net.filter(isNetErr).length;
    var errs = (run.console_events || []).filter(function (c) { return levelBucket(c.level) === "Error"; }).length;
    row("URL", run.url);
    row("Started", new Date(run.started_ms).toLocaleString());
    row("Duration", run.ended_ms ? fmtDur(run.ended_ms - run.started_ms) : "still running");
    row("Steps", run.steps.length);
    row("Frames", run.steps.filter(function (s) { return !!s.frame; }).length);
    row("Pointer samples", (run.pointer_events || []).length || null);
    row("Requests", net.length + (run.network_truncated ? " (+" + run.network_truncated + " dropped)" : ""));
    row("Failed requests", failed || null);
    row("Console errors", errs || null);
    row("Session", run.session_id);
    row("Project", run.project_id);
    row("Card", run.card_id);
    row("Run id", run.id);
    box.appendChild(dl);
  }
  function setSideTab(events) {
    byId("tab-events").className = "tab" + (events ? " on" : "");
    byId("tab-details").className = "tab" + (events ? "" : " on");
    byId("events").style.display = events ? "" : "none";
    byId("details").style.display = events ? "none" : "";
  }
  byId("tab-events").addEventListener("click", function () { setSideTab(true); });
  byId("tab-details").addEventListener("click", function () { setSideTab(false); });

  // ── frames ──
  function frameStepFor(t) {
    var best = -1;
    for (var i = 0; i < run.steps.length; i++) {
      if (run.steps[i].ts_ms - run.started_ms <= t && run.steps[i].frame) best = i;
    }
    return best;
  }
  function fetchFrame(name, cb) {
    if (frames[name]) { if (cb) cb(); return; }
    frames[name] = "pending";
    getJson("/api/plugin-ui/playwright-video/frame?id=" + encodeURIComponent(run.id) + "&frame=" + encodeURIComponent(name))
      .then(function (v) {
        frames[name] = "data:image/png;base64," + v.base64;
        if (cb) cb();
      })
      .catch(function () { delete frames[name]; });
  }
  function showFrame(t) {
    var img = byId("frame");
    var fi = frameStepFor(t);
    if (fi < 0) { img.hidden = true; return; }
    var name = run.steps[fi].frame;
    if (frames[name] && frames[name] !== "pending") {
      if (img.dataset.cur !== name) { img.src = frames[name]; img.dataset.cur = name; }
      img.hidden = false;
    } else {
      // Re-render (not just re-show) once the frame arrives: the cursor
      // overlay maps onto the frame's displayed rect, which only exists
      // after the image is loaded.
      fetchFrame(name, function () { render(); });
    }
    // Prefetch the next few frames.
    var seen = 0;
    for (var j = fi + 1; j < run.steps.length && seen < 3; j++) {
      if (run.steps[j].frame) { fetchFrame(run.steps[j].frame, null); seen++; }
    }
  }

  // ── cursor replay ──
  // Cursor position + click ripple at real time t, in frame-normalized 0..1
  // coords. Shared by the DOM overlay and the MP4 export canvas renderer.
  function cursorState(r, t) {
    var ptr = r.pointer_events || [];
    var lo = 0, hi = ptr.length - 1, i = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (ptr[mid].ts_ms - r.started_ms <= t) { i = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (i < 0) return null;
    var p = ptr[i];
    var vw = p.vw || 0, vh = p.vh || 0;
    if (!vw || !vh) return null;
    var fx = p.x / vw, fy = p.y / vh;
    // Ease toward the next sample when it is close in time.
    var n = ptr[i + 1];
    if (n && n.vw && n.vh) {
      var pt = p.ts_ms - r.started_ms;
      var nt = n.ts_ms - r.started_ms;
      var gap = nt - pt;
      if (gap > 0 && gap < 1500) {
        var f = Math.max(0, Math.min(1, (t - pt) / gap));
        fx += (n.x / n.vw - fx) * f;
        fy += (n.y / n.vh - fy) * f;
      }
    }
    // Click ripple: latest mousedown within the last 450ms of t.
    var down = null;
    for (var j = i; j >= 0 && ptr[j].ts_ms - r.started_ms >= t - 450; j--) {
      if (ptr[j].t === "down") {
        var d = ptr[j];
        if (d.vw && d.vh) {
          down = { fx: d.x / d.vw, fy: d.y / d.vh, age: (t - (d.ts_ms - r.started_ms)) / 450 };
        }
        break;
      }
    }
    return { fx: fx, fy: fy, down: down };
  }
  function frameRect() {
    // The frame uses object-fit: contain — find the actual displayed image
    // box inside the element so page coords map onto real pixels.
    var img = byId("frame");
    if (img.hidden || !img.naturalWidth || !img.naturalHeight) return null;
    var stage = byId("stage").getBoundingClientRect();
    var box = img.getBoundingClientRect();
    var scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    var w = img.naturalWidth * scale;
    var h = img.naturalHeight * scale;
    return {
      left: box.left - stage.left + (box.width - w) / 2,
      top: box.top - stage.top + (box.height - h) / 2,
      w: w, h: h
    };
  }
  function drawCursor(t) {
    var cur = byId("cursor");
    var rip = byId("ripple");
    var st = run ? cursorState(run, t) : null;
    var rect = st ? frameRect() : null;
    if (!rect) { cur.hidden = true; rip.hidden = true; return; }
    cur.hidden = false;
    cur.style.left = (rect.left + st.fx * rect.w).toFixed(1) + "px";
    cur.style.top = (rect.top + st.fy * rect.h).toFixed(1) + "px";
    if (st.down) {
      var size = 10 + 26 * st.down.age;
      rip.hidden = false;
      rip.style.left = (rect.left + st.down.fx * rect.w).toFixed(1) + "px";
      rip.style.top = (rect.top + st.down.fy * rect.h).toFixed(1) + "px";
      rip.style.width = size.toFixed(1) + "px";
      rip.style.height = size.toFixed(1) + "px";
      rip.style.opacity = String(Math.max(0, 1 - st.down.age));
    } else {
      rip.hidden = true;
    }
  }
  // Image decode is async even for data URLs — the displayed rect (and so
  // the cursor overlay) is only computable after load.
  byId("frame").addEventListener("load", function () { if (run) render(); });
  // ── render loop ──
  function activeStepFor(t) {
    var best = -1;
    for (var i = 0; i < run.steps.length; i++) {
      if (run.steps[i].ts_ms - run.started_ms <= t) best = i;
    }
    return best;
  }
  function render() {
    if (!run) return;
    vt = Math.max(0, Math.min(vt, vspan));
    var t = realOf(vt);
    showFrame(t);
    drawCursor(t);
    // overlay
    var si = activeStepFor(t);
    var ov = byId("overlay");
    if (si >= 0) {
      ov.hidden = false;
      ov.querySelector(".act").textContent = run.steps[si].action;
      ov.querySelector(".tgt").textContent = run.steps[si].target || "";
    } else { ov.hidden = true; }
    // scrubber + clock
    var f = vt / vspan * 100;
    scrub.querySelector(".fill").style.width = f.toFixed(2) + "%";
    scrub.querySelector(".knob").style.left = f.toFixed(2) + "%";
    byId("pos").textContent = fmtClock(vt) + " / " + fmtClock(vspan);
    // net rows
    var net = run.network || [];
    for (var i = 0; i < net.length; i++) {
      var start = net[i].ts_ms - run.started_ms;
      var end = netFin[i] - run.started_ms;
      var cls = "nrow";
      if (start > t) cls += " future";
      else if (end >= t) cls += " now";
      if (i === drawerIdx) cls += " sel";
      if (netRowEls[i].className !== cls) netRowEls[i].className = cls;
    }
    // console rows
    var con = run.console_events || [];
    for (var c = 0; c < con.length; c++) {
      var base = "crow " + levelBucket(con[c].level).toLowerCase();
      var ct = con[c].ts_ms - run.started_ms;
      if (ct > t) base += " future";
      else if (t - ct < 900) base += " now";
      if (conRowEls[c].className !== base) conRowEls[c].className = base;
    }
    // event rows
    for (var e = 0; e < evRowEls.length; e++) {
      var was = evRowEls[e].className;
      var isRage = was.indexOf("rage") >= 0;
      var cls2 = "ev" + (isRage ? " rage" : "");
      var et = run.steps[e].ts_ms - run.started_ms;
      if (et > t) cls2 += " future";
      else if (e === si) cls2 += " now";
      if (was !== cls2) {
        evRowEls[e].className = cls2;
        if (e === si && playing) evRowEls[e].scrollIntoView({ block: "nearest" });
      }
    }
  }

  function tick(ts) {
    rafId = null;
    if (!playing) return;
    if (!lastTick) lastTick = ts;
    vt += (ts - lastTick) * speed;
    lastTick = ts;
    if (vt >= vspan) { vt = vspan; render(); pause(); return; }
    render();
    rafId = requestAnimationFrame(tick);
  }
  function play() {
    if (!run) return;
    if (vt >= vspan) vt = 0;
    playing = true;
    lastTick = 0;
    byId("play").textContent = "⏸ Pause";
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    lastTick = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    byId("play").textContent = "▶ Play";
  }
  byId("play").addEventListener("click", function () { playing ? pause() : play(); });
  byId("restart").addEventListener("click", function () { vt = 0; render(); });

  // speeds
  var speedsBox = byId("speeds");
  [0.5, 1, 2, 4, 8].forEach(function (s) {
    var b = el("button", "spd" + (s === 1 ? " on" : ""), s + "×");
    b.addEventListener("click", function () {
      speed = s;
      Array.prototype.forEach.call(speedsBox.children, function (x) { x.className = "spd" + (x === b ? " on" : ""); });
    });
    speedsBox.appendChild(b);
  });

  // skipping inactivity
  byId("skip").addEventListener("click", function () {
    skipping = !skipping;
    this.className = skipping ? "" : "off";
    if (!run) return;
    var t = realOf(vt);
    buildTimeMap();
    vt = virtualOf(t);
    rebuildScrub();
    rebuildNet();
    render();
  });

  // ── MP4 export: canvas-render the virtual timeline, H.264-encode each
  // frame via WebCodecs, mux with the vendored mp4-muxer build, download
  // as <run-name>.mp4. Runs off a snapshot of the run + time map, so live
  // refreshes and toggles can't shift the timeline mid-export.
  var exporting = false;
  var exportCancel = false;
  var EXPORT_FPS = 30;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function setExportStat(msg, isErr) {
    var s = byId("exportstat");
    s.hidden = !msg;
    s.textContent = msg || "";
    s.className = isErr ? "err" : "";
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error("frame decode failed")); };
      im.src = src;
    });
  }
  function fetchFrameData(r, name) {
    if (frames[name] && frames[name] !== "pending") return Promise.resolve(frames[name]);
    return getJson("/api/plugin-ui/playwright-video/frame?id=" + encodeURIComponent(r.id) + "&frame=" + encodeURIComponent(name))
      .then(function (v) {
        frames[name] = "data:image/png;base64," + v.base64;
        return frames[name];
      });
  }
  function pickCodec(W, H) {
    // Highest profile first; resolves null when H.264 encoding is missing.
    var codecs = ["avc1.640028", "avc1.64001f", "avc1.4d0028", "avc1.42e01f"];
    var idx = 0;
    function tryNext() {
      if (idx >= codecs.length) return Promise.resolve(null);
      var cfg = {
        codec: codecs[idx++], width: W, height: H,
        bitrate: 5000000, framerate: EXPORT_FPS, avc: { format: "avc" }
      };
      return VideoEncoder.isConfigSupported(cfg).then(function (sup) {
        return sup.supported ? cfg : tryNext();
      }, tryNext);
    }
    return tryNext();
  }
  // One canvas frame at real time t: letterboxed screenshot, cursor dot,
  // click ripple, and the action caption (mirrors the stage overlay).
  function drawExportFrame(ctx, W, H, img, r, t) {
    ctx.fillStyle = "#ece8f6";
    ctx.fillRect(0, 0, W, H);
    var s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    var dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    var k = Math.max(1, dw / 900);
    var st = cursorState(r, t);
    if (st) {
      if (st.down) {
        ctx.beginPath();
        ctx.arc(dx + st.down.fx * dw, dy + st.down.fy * dh, (5 + 13 * st.down.age) * k, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(108,92,231," + Math.max(0, 1 - st.down.age).toFixed(2) + ")";
        ctx.lineWidth = 2 * k;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(dx + st.fx * dw, dy + st.fy * dh, 7 * k, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(108,92,231,.85)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * k;
      ctx.stroke();
    }
    var si = -1;
    for (var i = 0; i < r.steps.length; i++) {
      if (r.steps[i].ts_ms - r.started_ms <= t) si = i;
    }
    if (si >= 0) {
      var act = r.steps[si].action || "";
      var tgt = r.steps[si].target || "";
      if (tgt.length > 90) tgt = tgt.slice(0, 87) + "...";
      var fs = Math.round(13 * k);
      var bold = "600 " + fs + "px sans-serif";
      var norm = fs + "px sans-serif";
      ctx.font = bold;
      var aw = ctx.measureText(act).width;
      ctx.font = norm;
      var tw = tgt ? ctx.measureText(" " + tgt).width : 0;
      var pad = 10 * k;
      var bw = Math.min(aw + tw + pad * 2, W * 0.72);
      var bh = fs + pad * 1.3;
      var bx = 12 * k, by = H - 12 * k - bh;
      ctx.fillStyle = "rgba(255,255,255,.92)";
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 8 * k);
        ctx.fill();
      } else {
        ctx.fillRect(bx, by, bw, bh);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.clip();
      var ty = by + bh / 2 + fs * 0.35;
      ctx.font = bold;
      ctx.fillStyle = "#6c5ce7";
      ctx.fillText(act, bx + pad, ty);
      if (tgt) {
        ctx.font = norm;
        ctx.fillStyle = "#23263a";
        ctx.fillText(" " + tgt, bx + pad + aw, ty);
      }
      ctx.restore();
    }
  }
  async function runExport() {
    var r = run;
    var rp = realPts.slice(), vp = virtPts.slice(), vs = vspan;
    function realOfX(v) {
      if (v <= 0) return 0;
      for (var i = 1; i < vp.length; i++) {
        if (v <= vp[i]) {
          var vg = vp[i] - vp[i - 1];
          var g = rp[i] - rp[i - 1];
          return rp[i - 1] + (vg ? (v - vp[i - 1]) / vg * g : 0);
        }
      }
      return rp[rp.length - 1];
    }
    var frameSteps = [];
    for (var i = 0; i < r.steps.length; i++) {
      if (r.steps[i].frame) frameSteps.push({ t: r.steps[i].ts_ms - r.started_ms, name: r.steps[i].frame });
    }
    if (!frameSteps.length) { setExportStat("No frames recorded — nothing to export.", true); return; }
    // Fetch every frame up front into a local map: openRun() resets the
    // shared cache, which must not yank frames out from under the encoder.
    var frameData = {};
    for (i = 0; i < frameSteps.length; i++) {
      if (exportCancel) { setExportStat("Export canceled."); return; }
      setExportStat("Fetching frames " + (i + 1) + "/" + frameSteps.length);
      frameData[frameSteps[i].name] = await fetchFrameData(r, frameSteps[i].name);
    }
    var first = await loadImage(frameData[frameSteps[0].name]);
    var scale = Math.min(1, 1920 / first.naturalWidth, 1080 / first.naturalHeight);
    var W = Math.round(first.naturalWidth * scale / 2) * 2;
    var H = Math.round(first.naturalHeight * scale / 2) * 2;
    var cfg = await pickCodec(W, H);
    if (!cfg) { setExportStat("This browser has no H.264 encoder (WebCodecs) — try Chrome or Edge.", true); return; }
    var target = new Mp4Muxer.ArrayBufferTarget();
    var muxer = new Mp4Muxer.Muxer({
      target: target,
      video: { codec: "avc", width: W, height: H, frameRate: EXPORT_FPS },
      fastStart: "in-memory"
    });
    var encErr = null;
    var enc = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { encErr = e; }
    });
    try {
      enc.configure(cfg);
      var canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext("2d");
      var stepMs = 1000 / EXPORT_FPS;
      var total = Math.max(1, Math.ceil(vs / stepMs));
      var img = first, curName = frameSteps[0].name;
      for (i = 0; i <= total; i++) {
        if (exportCancel) { setExportStat("Export canceled."); return; }
        if (encErr) throw encErr;
        var v = Math.min(vs, i * stepMs);
        var t = realOfX(v);
        var want = null;
        for (var f = 0; f < frameSteps.length; f++) {
          if (frameSteps[f].t <= t) want = frameSteps[f].name;
        }
        if (want && want !== curName) {
          img = await loadImage(frameData[want]);
          curName = want;
        }
        if (want) {
          drawExportFrame(ctx, W, H, img, r, t);
        } else {
          ctx.fillStyle = "#ece8f6";
          ctx.fillRect(0, 0, W, H);
        }
        var vf = new VideoFrame(canvas, { timestamp: Math.round(v * 1000), duration: Math.round(1000000 / EXPORT_FPS) });
        enc.encode(vf, { keyFrame: i % 90 === 0 });
        vf.close();
        while (enc.encodeQueueSize > 4) { await sleep(4); }
        if (i % 10 === 0) {
          setExportStat("Rendering " + Math.round(i / total * 100) + "% (" + i + "/" + total + " frames)");
          await sleep(0);
        }
      }
      await enc.flush();
      muxer.finalize();
      var blob = new Blob([target.buffer], { type: "video/mp4" });
      var slug = (r.name || "test-run").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "test-run";
      var a = document.createElement("a");
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = slug + ".mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      setExportStat("Saved " + a.download + " (" + fmtBytes(blob.size) + ")");
    } finally {
      try { if (enc.state !== "closed") enc.close(); } catch (_e) { /* already closed */ }
    }
  }
  byId("export").addEventListener("click", function () {
    if (!run) return;
    if (exporting) { exportCancel = true; return; }
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof Mp4Muxer === "undefined") {
      setExportStat("MP4 export needs WebCodecs — try Chrome, Edge, or a recent Safari/Firefox.", true);
      return;
    }
    pause();
    exporting = true;
    exportCancel = false;
    var btn = this;
    btn.textContent = "✕ Cancel";
    runExport().catch(function (e) {
      setExportStat("Export failed: " + (e && e.message ? e.message : String(e)), true);
    }).then(function () {
      exporting = false;
      exportCancel = false;
      btn.textContent = "⬇ MP4";
    });
  });
  // keyboard
  document.addEventListener("keydown", function (e) {
    if (!run) return;
    if (e.key === "Escape") { closeDrawer(); return; }
    if (e.target && e.target.tagName === "INPUT") return;
    var t = realOf(vt);
    var si = activeStepFor(t);
    if (e.key === "ArrowLeft") {
      pause();
      var p = si > 0 ? si - 1 : 0;
      vt = virtualOf(run.steps[p].ts_ms - run.started_ms);
      render();
    } else if (e.key === "ArrowRight") {
      pause();
      var nx = Math.min(si + 1, run.steps.length - 1);
      if (nx >= 0) { vt = virtualOf(run.steps[nx].ts_ms - run.started_ms); render(); }
    } else if (e.key === " ") {
      e.preventDefault();
      playing ? pause() : play();
    }
  });
})();
</script>
</body>
</html>`;

// The served page: shell, vendored muxer in its own script tag, then the app.
export const PAGE: string = SHELL + "<script>" + MUXER_JS + "</script>" + APP;