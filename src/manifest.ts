// The plugin manifest JSON body — identity, hooks, the sidebar entry, and the
// permissions the host functions require.

const DESCRIPTION =
  "Playwright test videos for Peckboard: LogRocket-style replay of recorded " +
  "browser test runs — network waterfall with masked request/response " +
  "detail, console panel, event timeline, cursor replay with click ripples, " +
  "time-scaled playback with inactivity skipping, and one-click MP4 export " +
  "of a run (WebCodecs H.264, encoded fully client-side). Served as a WASM " +
  "plugin.";
const VERSION = "0.4.0";
const REPOSITORY = "https://github.com/PeckBoard/playwright-video";

// Inline SVG (lucide "video") for the sidebar entry; rendered sandboxed.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>';

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
        icon: ICON,
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
