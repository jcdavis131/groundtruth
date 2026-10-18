// Collector contract. A collector samples one live public feed, reduces the
// sample to aggregate numbers (counts, gauge readings, percent full: never a
// vessel, airframe or person identity) and hands back series points for the
// SeriesStore. The snapshot cron, the guarded API op and the tests all drive
// collectors through this one interface, with the network injected so a
// collector is testable against a fixture and never touches an upstream from
// a unit test.

import type { Point, SeriesMeta } from "@/lib/series/types";
import type { SourceId } from "@/lib/provenance/sources";

/** Minimal fetch options a collector may pass through. */
export interface FetchInit {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** The only network primitive a collector gets for HTTP. Throws on non-2xx. */
export type FetchJson = <T = unknown>(url: string, init?: FetchInit) => Promise<T>;

/**
 * Just enough of the WebSocket surface for a subscribe-listen-close sample.
 * The runtime passes the platform WebSocket (Node 22+ and browsers have one);
 * tests pass a scripted fake.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (ev: { data?: unknown }) => void): void;
}

export interface CollectorContext {
  /** Sample time, epoch ms. Every snapshot point is stamped with it. */
  now: number;
  fetchJson: FetchJson;
  /** Optional operator keys by env name (AISSTREAM_KEY ...). Absent keys are simply undefined. */
  keys: Record<string, string | undefined>;
  /** Aborted when the per-collector timeout fires; collectors should stop work. */
  signal?: AbortSignal;
  /** Opens a websocket for stream samples. Undefined when the runtime has none. */
  openSocket?: (url: string) => WebSocketLike;
  /** Gap between consecutive requests to one upstream, ms. Tests set 0. */
  politeDelayMs?: number;
  /** How long a stream sample listens before closing, ms. Tests set a few ms. */
  listenMs?: number;
  log?: (line: string) => void;
}

export interface CollectorOutput {
  meta: SeriesMeta;
  points: Point[];
}

/** Static description for `op=collectors` and the docs. */
export interface CollectorDescription {
  id: string;
  title: string;
  /** Intended sampling interval, free text ("3h"). */
  cadence: string;
  /** Prefix every series id from this collector starts with. */
  seriesPrefix: string;
  sources: SourceId[];
  /** Env keys that unlock more coverage; never required. */
  optionalKeys?: string[];
  /** What is counted and what is deliberately not stored. */
  note: string;
}

export interface Collector {
  id: string;
  title: string;
  cadence: string;
  /** Wall-clock budget; the runner aborts and records a failure past it. Default 30 s. */
  timeoutMs?: number;
  describe(): CollectorDescription;
  collect(ctx: CollectorContext): Promise<CollectorOutput[]>;
}

/** Resolve after `ms`, or reject at once when `signal` is already aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
