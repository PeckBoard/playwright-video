// FFI layer: the Peckboard core host functions this plugin calls, and the
// host_call marshaling helper. Host calls are kept LAZY (inside functions) so
// the pure modules load under vitest without an Extism runtime.

type HostFn = (offset: bigint) => bigint;

/// Call a host function and parse its JSON response, surfacing an
/// `{"error": ...}` envelope (or a trap) as a thrown Error.
export function hostCall(name: string, input: unknown): any {
  const f = (Host.getFunctions() as Record<string, HostFn>)[name];
  const mem = Memory.fromString(JSON.stringify(input));
  const out = f(mem.offset);
  const parsed = JSON.parse(Memory.find(out).readString());
  if (parsed && parsed.error !== undefined && parsed.error !== null) {
    throw new Error(String(parsed.error));
  }
  return parsed;
}

/// One recorded step of a browser test run (mirrors core's `RunStep`).
export interface RunStep {
  n: number;
  ts_ms: number;
  action: string;
  target?: string;
  detail?: unknown;
  frame?: string;
}

/// One captured network request+response (mirrors core's `NetEvent`).
/// Every string surface is masked by core before persisting.
export interface NetEvent {
  id: number;
  ts_ms: number;
  dur_ms?: number;
  method: string;
  url: string;
  resource_type: string;
  status?: number;
  failure?: string;
  req_headers?: Record<string, string>;
  req_body?: string;
  resp_headers?: Record<string, string>;
  resp_body?: string;
  resp_body_truncated?: boolean;
  size?: number;
}

/// One captured console line (mirrors core's `ConsoleEvent`).
export interface ConsoleEvent {
  ts_ms: number;
  level: string;
  text: string;
}

/// One recorded browser test run (mirrors core's `RunMeta`). The capture
/// fields are absent on runs recorded before network capture existed.
export interface RunMeta {
  id: string;
  name: string;
  url: string;
  session_id: string;
  project_id?: string;
  card_id?: string;
  started_ms: number;
  ended_ms?: number;
  steps: RunStep[];
  network?: NetEvent[];
  console_events?: ConsoleEvent[];
  network_truncated?: number;
  console_truncated?: number;
}

/// All recorded runs, newest first.
export function listRuns(): { runs: RunMeta[] } {
  return hostCall("peckboard_browser_runs", {});
}

/// One run's full meta.
export function getRun(runId: string): { run: RunMeta } {
  return hostCall("peckboard_browser_run", { run_id: runId });
}

/// One frame's PNG bytes as base64.
export function getFrame(runId: string, frame: string): { base64: string } {
  return hostCall("peckboard_browser_run_frame", { run_id: runId, frame });
}
