# playwright-video

LogRocket-style replay for PeckBoard's browser tests, served as a WASM plugin.

PeckBoard core (>= 0.0.53) records every `browser_*` tool session as a test
run: each `browser_open` starts a run, every `browser_act` appends a
timestamped step with a server-side screenshot frame, and `browser_close`
finalizes it. Frames are captured out of the agent's token budget — they
never enter model context.

Cores with the capture sidecar additionally record, per run:

- **Network traffic** — every request/response with method, URL, status,
  timing, headers, and JSON/text bodies.
- **Console output** — console lines and uncaught page errors.
- **Pointer activity** — throttled mousemove plus mousedown positions
  (Playwright's high-level click/hover drive the real mouse, so agent
  actions are included).

All captured strings are masked by core (`service/redact.rs`) **before they
are persisted**: sensitive headers (authorization, cookies, API keys),
sensitive JSON/form/query keys (passwords, tokens, secrets), and
secret-shaped values in free text (Bearer/Basic credentials, JWTs,
Luhn-valid card numbers) never reach disk — and therefore never reach this
plugin.

This plugin adds a **Playwright Tests** entry to the left rail (directly
below Sessions) that opens a full-page replay view:

- **Run list** — every recorded run with status, age, duration, step,
  request, and error counts; refreshes live while runs are recording.
- **Replay player** — continuous time-scaled playback with a *Skipping
  inactivity* toggle (gaps compressed LogRocket-style), 0.5–8× speeds, a
  scrubber with step ticks and error markers, and keyboard stepping.
- **Cursor replay** — a cursor dot travels over the frame along the
  recorded pointer path, with an expanding ripple on each click.
- **Network panel** — waterfall table (status, method, request, timing bar
  on the shared time axis) with a text filter and type chips
  (XHR/Doc/JS/CSS/Img/Font/…); rows light up as playback passes them; a
  detail drawer shows masked headers and pretty-printed masked bodies.
- **Console panel** — level-filtered console/pageerror entries with an
  error badge, click-to-seek.
- **Event timeline** — human-readable step list (navigation, clicks, typed
  text, rage-click detection) with click-to-seek, plus a **Session
  details** tab (session/project/card, duration, counts).

Runs recorded by older cores (no capture) still replay — the network and
console panels show an explanatory empty state.

## Architecture

- Core host functions (gated by the `browser_runs_read` permission):
  `peckboard_browser_runs`, `peckboard_browser_run`,
  `peckboard_browser_run_frame`.
- The page is a sandboxed iframe; data flows through the parent-proxied
  `/api/plugin-ui/playwright-video/*` endpoints this plugin serves via the
  `http.request.authed` hook.

## Build

```bash
npm install
npm test
npm run build   # dist/plugin.wasm
```

Release asset must be named `playwright-video.wasm`.
