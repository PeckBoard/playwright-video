import { describe, expect, it } from "vitest";

import { queryParam, countErrors } from "../src/http";
import { manifestJson } from "../src/manifest";
import { PAGE } from "../src/page";
import type { RunMeta } from "../src/host";

/// Split the page into its inline <script> bodies (muxer, then the app).
function scriptBlocks(html: string): string[] {
  const out: string[] = [];
  let idx = 0;
  for (;;) {
    const start = html.indexOf("<script>", idx);
    if (start < 0) break;
    const end = html.indexOf("</" + "script>", start);
    if (end < start) throw new Error("unterminated <script>");
    out.push(html.slice(start + "<script>".length, end));
    idx = end + 1;
  }
  return out;
}

describe("player page", () => {
  it("embeds exactly two syntactically valid scripts (muxer + app)", () => {
    const blocks = scriptBlocks(PAGE);
    expect(blocks.length).toBe(2);
    for (const src of blocks) {
      // Parse-only: constructing the Function throws on any syntax error.
      expect(() => new Function(src)).not.toThrow();
    }
  });

  it("vendored muxer defines the Mp4Muxer global the app script uses", () => {
    const [muxer] = scriptBlocks(PAGE);
    // The vendored build must never contain a </script> terminator — it is
    // inlined into the page (scriptBlocks above would also mis-split).
    expect(muxer.toLowerCase()).not.toContain("</scr" + "ipt");
    const kinds = new Function(
      muxer + "; return [typeof Mp4Muxer, typeof Mp4Muxer.Muxer, typeof Mp4Muxer.ArrayBufferTarget];",
    )() as string[];
    expect(kinds).toEqual(["object", "function", "function"]);
  });

  it("wires the MP4 export UI", () => {
    expect(PAGE).toContain('<button id="export"');
    expect(PAGE).toContain("VideoEncoder.isConfigSupported");
    expect(PAGE).toContain("Mp4Muxer.ArrayBufferTarget");
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
    expect(m.sidebar_items[0].icon).toMatch(/^<svg /);
    expect(m.sidebar_items[0].icon).toContain('stroke="currentColor"');
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
