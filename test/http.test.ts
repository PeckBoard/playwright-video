import { describe, expect, it } from "vitest";

import { queryParam, countErrors } from "../src/http";
import { manifestJson } from "../src/manifest";
import { PAGE } from "../src/page";
import type { RunMeta } from "../src/host";

describe("player page", () => {
  it("embeds a syntactically valid script", () => {
    const start = PAGE.indexOf("<script>");
    const end = PAGE.indexOf("</" + "script>");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const src = PAGE.slice(start + "<script>".length, end);
    // Parse-only: constructing the Function throws on any syntax error.
    expect(() => new Function(src)).not.toThrow();
  });
});

describe("queryParam", () => {
  it("extracts and decodes values", () => {
    expect(queryParam("id=abc&frame=0001.png", "frame")).toBe("0001.png");
    expect(queryParam("id=a%3Ab", "id")).toBe("a:b");
    expect(queryParam("id=x", "missing")).toBeUndefined();
  });
});

describe("manifest", () => {
  it("declares the sidebar entry, routes, and permissions", () => {
    const m = JSON.parse(manifestJson());
    expect(m.sidebar_items[0].id).toBe("playwright-tests");
    expect(m.sidebar_items[0].path).toBe("/plugin-api/v1/playwright-video");
    expect(m.hooks).toContain("http.request.authed");
    expect(m.ui_routes).toContain("GET /api/plugin-ui/playwright-video/frame");
    expect(m.permissions).toContain("browser_runs_read");
  });
});

describe("countErrors", () => {
  const base: RunMeta = {
    id: "r1",
    name: "t",
    url: "u",
    session_id: "s",
    started_ms: 0,
    steps: [],
  };

  it("counts failed/4xx requests and console errors", () => {
    const r: RunMeta = {
      ...base,
      network: [
        { id: 1, ts_ms: 0, method: "GET", url: "a", resource_type: "xhr", status: 200 },
        { id: 2, ts_ms: 0, method: "GET", url: "b", resource_type: "xhr", status: 404 },
        { id: 3, ts_ms: 0, method: "GET", url: "c", resource_type: "xhr", failure: "net::ERR" },
        { id: 4, ts_ms: 0, method: "GET", url: "d", resource_type: "xhr" },
      ],
      console_events: [
        { ts_ms: 0, level: "error", text: "boom" },
        { ts_ms: 0, level: "warning", text: "meh" },
      ],
    };
    expect(countErrors(r)).toBe(3);
  });

  it("treats capture-less legacy runs as error-free", () => {
    expect(countErrors(base)).toBe(0);
  });
});
