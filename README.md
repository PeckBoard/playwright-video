# playwright-video

LogRocket-style replay for PeckBoard's browser tests, served as a WASM plugin.

PeckBoard core (>= 0.0.52) records every `browser_*` tool session as a test
run: each `browser_open` starts a run, every `browser_act` appends a
timestamped step with a server-side screenshot frame, and `browser_close`
finalizes it. Frames are captured out of the agent's token budget — they
never enter model context.

This plugin adds a **Playwright Tests** entry to the left rail (directly
below Sessions) that opens a full-page view:

- **Run list** — every recorded run with status, age, duration, step and
  frame counts; refreshes live while runs are recording.
- **Replay player** — time-scaled playback of the run's frames (inactivity
  gaps clamped, LogRocket-style), a seekable timeline with per-step ticks,
  an action event track (click/type/navigate/… chips), play/pause with
  0.5–4× speed, keyboard stepping, and the raw action payload per step.

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
