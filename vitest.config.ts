import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Mirror esbuild.js's `.txt` text loader (the vendored mp4-muxer build is
// imported as a string by src/page.ts).
export default defineConfig({
  plugins: [
    {
      name: "txt-as-text",
      enforce: "pre",
      load(id: string) {
        if (id.endsWith(".txt")) {
          return "export default " + JSON.stringify(readFileSync(id, "utf8")) + ";";
        }
      },
    },
  ],
});
