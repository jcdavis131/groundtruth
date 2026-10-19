// ?perf=1: the frame-time measuring mode (writeups atlas-db MEASURE-FIRST).
// Off unless the URL carries perf=1. Everything perf-related checks perfMode()
// first and does nothing else when it is off.

export const PERF_VIEWS = ["austin", "texas", "flows"] as const;
export type PerfView = (typeof PERF_VIEWS)[number];

export interface PerfMode {
  on: boolean;
  /** The fixed test view (?view=austin|texas|flows), only while on. */
  view: PerfView | null;
}

export function isPerfView(v: unknown): v is PerfView {
  return typeof v === "string" && (PERF_VIEWS as readonly string[]).includes(v);
}

/** Read the mode from a query string ("?perf=1&view=austin"). */
export function parsePerf(search: string): PerfMode {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (q.get("perf") !== "1") return { on: false, view: null };
  const v = q.get("view");
  return { on: true, view: isPerfView(v) ? v : null };
}

const OFF: PerfMode = { on: false, view: null };
let cached: PerfMode | null = null;

/** The mode for this page load, read from the address bar once. Off on the server. */
export function perfMode(): PerfMode {
  if (cached) return cached;
  if (typeof window === "undefined") return OFF;
  cached = parsePerf(window.location.search);
  return cached;
}
