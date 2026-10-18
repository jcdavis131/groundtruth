// Runs the collector registry against a SeriesStore, with the network
// injected, a wall-clock budget per collector and one collector's failure
// isolated from the rest. Also the daily roll-up maths the readers use.

import { COLLECTORS } from "./collectors";
import type { Collector, CollectorContext, CollectorOutput, FetchInit, FetchJson, WebSocketLike } from "./collectors/types";
import type { Point, SeriesStore } from "./types";

export const USER_AGENT = "embedding-atlas/0.1 snapshot collector (+https://github.com/jcdavis131/gods-eye-view)";

/** Series ids are ':'-namespaced lower-case tokens; upper-case is allowed for codes (LOCODE, IATA). */
export const SERIES_ID_RE = /^[a-z0-9][a-zA-Z0-9:_.\-]{2,120}$/;

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunOptions {
  store: SeriesStore;
  /** Collector ids to run; all when omitted. Unknown ids are reported as failed. */
  only?: string[];
  now?: number;
  keys?: Record<string, string | undefined>;
  logger?: (line: string) => void;
  /** Overrides for tests. */
  fetchJson?: FetchJson;
  openSocket?: (url: string) => WebSocketLike;
  collectors?: readonly Collector[];
  politeDelayMs?: number;
  listenMs?: number;
  /** Multiplies every collector's budget (a CI runner can afford more than a serverless function). */
  timeoutScale?: number;
  /** Collect but do not write. */
  dryRun?: boolean;
}

export interface RunReport {
  startedAt: string;
  durationMs: number;
  ran: string[];
  failed: Array<{ id: string; error: string }>;
  /** Series touched and points handed to the store (before merge dedupe). */
  seriesWritten: number;
  pointsWritten: number;
  /** Per-collector series counts, for the log line. */
  perCollector: Record<string, { series: number; points: number; ms: number }>;
  dryRun: boolean;
}

/** Combine an optional outer signal with a fresh timeout into one signal. */
function withTimeout(ms: number, outer?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${ms} ms`)), ms);
  const onOuter = () => ctrl.abort(outer?.reason);
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctrl.signal,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

/** fetch() as JSON with a timeout, a polite User-Agent and a readable error for non-2xx. */
export const defaultFetchJson: FetchJson = async <T>(url: string, init: FetchInit = {}): Promise<T> => {
  const { signal, clear } = withTimeout(init.timeoutMs ?? 20_000, init.signal);
  try {
    const res = await fetch(url, {
      signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      throw new Error(`${new URL(url).host} ${res.status}${body ? ": " + body : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clear();
  }
};

/** The platform WebSocket when the runtime has one (Node 22+, browsers), else undefined. */
export function defaultOpenSocket(): ((url: string) => WebSocketLike) | undefined {
  const g = globalThis as { WebSocket?: new (url: string) => unknown };
  if (typeof g.WebSocket !== "function") return undefined;
  const Ctor = g.WebSocket;
  // The platform class has the three members WebSocketLike needs; the cast is
  // only because its DOM typing carries overloads structural typing cannot match.
  return (url) => new Ctor(url) as WebSocketLike;
}

/** Drop outputs that would corrupt the store: bad ids, non-finite times, non-numeric values. */
export function validateOutputs(outputs: CollectorOutput[], warn?: (line: string) => void): CollectorOutput[] {
  const ok: CollectorOutput[] = [];
  for (const o of outputs) {
    if (!o?.meta || typeof o.meta.id !== "string" || !SERIES_ID_RE.test(o.meta.id)) {
      warn?.(`dropped output with bad series id ${JSON.stringify(o?.meta?.id)}`);
      continue;
    }
    const points = (o.points ?? []).filter((p) => Number.isFinite(p.t) && (p.v === null || (typeof p.v === "number" && Number.isFinite(p.v))));
    if (points.length !== (o.points ?? []).length) warn?.(`${o.meta.id}: dropped ${(o.points ?? []).length - points.length} malformed point(s)`);
    ok.push({ meta: o.meta, points });
  }
  return ok;
}

/**
 * Run collectors against the store. Each collector gets its own timeout and
 * its errors are caught and reported; the run as a whole only throws when
 * the store itself fails.
 */
export async function runCollectors(opts: RunOptions): Promise<RunReport> {
  const t0 = Date.now();
  const now = opts.now ?? t0;
  const log = opts.logger ?? (() => {});
  const registry = opts.collectors ?? COLLECTORS;
  const selected: Collector[] = [];
  const failed: RunReport["failed"] = [];
  if (opts.only && opts.only.length) {
    for (const id of opts.only) {
      const c = registry.find((x) => x.id === id);
      if (c) selected.push(c);
      else failed.push({ id, error: "unknown collector" });
    }
  } else selected.push(...registry);

  const report: RunReport = {
    startedAt: new Date(now).toISOString(),
    durationMs: 0,
    ran: [],
    failed,
    seriesWritten: 0,
    pointsWritten: 0,
    perCollector: {},
    dryRun: !!opts.dryRun,
  };
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const openSocket = opts.openSocket ?? defaultOpenSocket();
  const scale = opts.timeoutScale ?? 1;

  for (const c of selected) {
    const budget = Math.round((c.timeoutMs ?? DEFAULT_TIMEOUT_MS) * scale);
    const { signal, clear } = withTimeout(budget);
    const started = Date.now();
    const ctx: CollectorContext = {
      now,
      fetchJson: (url, init) => fetchJson(url, { ...init, signal: init?.signal ?? signal }),
      keys: opts.keys ?? {},
      signal,
      openSocket,
      politeDelayMs: opts.politeDelayMs,
      listenMs: opts.listenMs,
      log,
    };
    try {
      // The abort listener is registered before collect() runs so a collector
      // that resolves on abort still loses the race and is reported as failed.
      const aborted = new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "aborted"))), { once: true }),
      );
      const raw = await Promise.race([aborted, c.collect(ctx)]);
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
      const outputs = validateOutputs(raw, (line) => log(`${c.id}: ${line}`));
      let points = 0;
      if (!opts.dryRun) {
        for (const o of outputs) {
          await opts.store.append(o.meta, o.points);
        }
      }
      for (const o of outputs) points += o.points.length;
      report.ran.push(c.id);
      report.seriesWritten += outputs.length;
      report.pointsWritten += points;
      report.perCollector[c.id] = { series: outputs.length, points, ms: Date.now() - started };
      log(`${c.id}: ${outputs.length} series, ${points} points in ${Date.now() - started} ms${opts.dryRun ? " (dry run)" : ""}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ id: c.id, error });
      report.perCollector[c.id] = { series: 0, points: 0, ms: Date.now() - started };
      log(`${c.id}: FAILED ${error}`);
    } finally {
      clear();
    }
  }
  report.durationMs = Date.now() - t0;
  return report;
}

// ---- daily roll-ups (computed at read time; the store keeps sample cadence)

/** UTC calendar day of an epoch ms, "YYYY-MM-DD". */
export function dailyKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export type RollupMode = "mean" | "max" | "last";

/**
 * Collapse points to one per UTC day, stamped at that day's midnight. Nulls
 * are ignored; a day with only nulls yields a null point so gaps stay visible.
 */
export function rollupDaily(points: Point[], mode: RollupMode): Point[] {
  const days = new Map<string, { sum: number; n: number; max: number; last: number | null; lastT: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.t)) continue;
    const k = dailyKey(p.t);
    let d = days.get(k);
    if (!d) {
      d = { sum: 0, n: 0, max: -Infinity, last: null, lastT: -Infinity };
      days.set(k, d);
    }
    if (p.v == null || !Number.isFinite(p.v)) continue;
    d.sum += p.v;
    d.n++;
    if (p.v > d.max) d.max = p.v;
    if (p.t >= d.lastT) {
      d.lastT = p.t;
      d.last = p.v;
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, d]) => {
      const t = Date.parse(`${k}T00:00:00Z`);
      if (d.n === 0) return { t, v: null };
      const v = mode === "mean" ? d.sum / d.n : mode === "max" ? d.max : d.last;
      return { t, v };
    });
}
