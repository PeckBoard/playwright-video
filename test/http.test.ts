import { describe, expect, it } from "vitest";

import { queryParam } from "../src/http";
import { manifestJson } from "../src/manifest";

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
