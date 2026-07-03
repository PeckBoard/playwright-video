// Entry + hook dispatch. Parses the `{ hook, payload }` envelope and routes
// each hook to its handler. The wasm export functions live in `index.ts`.

import { skip } from "./verdict";
import { serveHttp, serveAuthed } from "./http";

/// Dispatch a hook call to the right handler, returning a verdict JSON string.
export function dispatch(hook: string, payload: any): string {
  switch (hook) {
    case "http.request.before":
      return serveHttp(payload);
    case "http.request.authed":
      return serveAuthed(payload);
    default:
      return skip();
  }
}

/// Stringify a caught error to a message string.
export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}
