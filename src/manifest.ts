// The plugin manifest JSON body — identity, hooks, the sidebar entry, and the
// permissions the host functions require.

const DESCRIPTION =
  "Playwright test videos for Peckboard: LogRocket-style replay of recorded " +
  "browser test runs — network waterfall with masked request/response " +
  "detail, console panel, event timeline, cursor replay with click ripples, " +
  "and time-scaled playback with inactivity skipping. Served as a WASM plugin.";
const VERSION = "0.3.0";
const REPOSITORY = "https://github.com/PeckBoard/playwright-video";

/// Build the manifest JSON string. `index.ts`'s `manifest()` export wraps this.
export function manifestJson(): string {
  const manifest = {
    description: DESCRIPTION,
    version: VERSION,
    repository: REPOSITORY,

    hooks: ["http.request.before", "http.request.authed"],

    // Global left-rail entry (rendered directly below Sessions since core
    // 0.0.52): opens the full-page run list + replay player.
    sidebar_items: [
      {
        id: "playwright-tests",
        label: "Playwright Tests",
        path: "/plugin-api/v1/playwright-video",
      },
    ],

    http_routes: ["GET /plugin-api/v1/playwright-video"],

    // Authenticated app-UI endpoints (behind core's require_auth, served under
    // the logged-in user's authority). The page calls these.
    ui_routes: [
      "GET /api/plugin-ui/playwright-video/runs",
      "GET /api/plugin-ui/playwright-video/run",
      "GET /api/plugin-ui/playwright-video/frame",
    ],

    permissions: [
      "contribute_sidebar",
      "browser_runs_read", // the recorded runs + frames (core host fns)
      "user_authority", // serve authenticated UI endpoints
    ],
  };
  return JSON.stringify(manifest);
}
