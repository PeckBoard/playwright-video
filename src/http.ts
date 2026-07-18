// HTTP surfaces: the served Playwright Tests page (`http.request.before`) and
// the authenticated app-UI endpoints (`http.request.authed`) the page calls.

import { htmlResponse, jsonResponse } from "./verdict";
import { listRuns, getRun, getFrame } from "./host";
import { PAGE } from "./page";
import { errMsg } from "./lib";

const PAGE_PATH = "/plugin-api/v1/playwright-video";

/// Serve the replay page (the sidebar item opens this).
export function serveHttp(payload: any): string {
  const method = (payload && typeof payload.method === "string" ? payload.method : "").toUpperCase();
  const path = payload && typeof payload.path === "string" ? payload.path : "";
  if (method === "GET" && path === PAGE_PATH) {
    return htmlResponse(200, PAGE);
  }
  return htmlResponse(404, "<!doctype html><title>Not found</title><p>Not found.</p>");
}

// ── Authenticated app-UI endpoints (/api/plugin-ui/playwright-video/*) ──

export function serveAuthed(payload: any): string {
  const method = (payload && typeof payload.method === "string" ? payload.method : "").toUpperCase();
  const path = payload && typeof payload.path === "string" ? payload.path : "";
  const query = payload && typeof payload.query === "string" ? payload.query : "";

  try {
    if (method === "GET" && path === "/api/plugin-ui/playwright-video/runs") {
      return jsonResponse(200, summarizeRuns());
    }
    if (method === "GET" && path === "/api/plugin-ui/playwright-video/run") {
      const id = requireParam(query, "id");
      return jsonResponse(200, getRun(id));
    }
    if (method === "GET" && path === "/api/plugin-ui/playwright-video/frame") {
      const id = requireParam(query, "id");
      const frame = requireParam(query, "frame");
      return jsonResponse(200, getFrame(id, frame));
    }
  } catch (e) {
    return jsonResponse(400, { error: errMsg(e) });
  }
  return jsonResponse(404, { error: "not found" });
}

/// The run list, with steps reduced to counts (the player refetches the
/// full run on open) — keeps the list payload small for many runs.
export function summarizeRuns(): any {
  const { runs } = listRuns();
  return {
    runs: runs.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      session_id: r.session_id,
      project_id: r.project_id ?? null,
      card_id: r.card_id ?? null,
      started_ms: r.started_ms,
      ended_ms: r.ended_ms ?? null,
      step_count: r.steps.length,
      frame_count: r.steps.filter((s) => !!s.frame).length,
      request_count: (r.network ?? []).length,
      error_count: countErrors(r),
    })),
  };
}

/// Failed/4xx/5xx requests plus console errors — the run list's red badge.
export function countErrors(r: import("./host").RunMeta): number {
  const netErrs = (r.network ?? []).filter(
    (n) => !!n.failure || (n.status ?? 0) >= 400
  ).length;
  const conErrs = (r.console_events ?? []).filter((c) => c.level === "error").length;
  return netErrs + conErrs;
}
function requireParam(query: string, name: string): string {
  const v = queryParam(query, name);
  if (v === undefined || v.trim() === "") {
    throw new Error("`" + name + "` is required");
  }
  return v;
}

/// Extract and URL-decode `name`'s value from a `&`-separated query string.
export function queryParam(query: string, name: string): string | undefined {
  for (const pair of query.split("&")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const k = pair.slice(0, idx);
    if (k !== name) continue;
    const v = pair.slice(idx + 1);
    try {
      return decodeURIComponent(v.replace(/\+/g, "%20"));
    } catch (_e) {
      return v;
    }
  }
  return undefined;
}
