// Read-only SeriesStore over plain HTTP, for hosts whose filesystem is not
// the repository (Vercel, a container built before the last snapshot commit).
// Point it at the raw view of data/series on the branch the cron commits to:
//
//   GEV_SERIES_RAW_BASE=https://raw.githubusercontent.com/jcdavis131/gods-eye-view/series/data/series
//
// get() fetches `${base}/<fileNameFor(id)>`; list() fetches `${base}/index.json`,
// an array of SeriesMeta the snapshot script writes after every run. Both
// are cached in memory for a few minutes: raw.githubusercontent.com is
// itself CDN-cached for ~5 minutes, so hitting it more often gains nothing.
//
// layeredStore() combines this with the local file store so a checkout that
// is a few commits behind still serves the latest points: reads merge both,
// writes go to the primary only.

import { applyQuery, fileNameFor, mergePoints } from "./store";
import type { Point, Series, SeriesMeta, SeriesQuery, SeriesStore } from "./types";

export type RawFetch = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface RawStoreOptions {
  /** Cache TTL for fetched files, ms. Default 5 min. */
  ttlMs?: number;
  /** Injected for tests; default is the platform fetch with a timeout. */
  fetch?: RawFetch;
  timeoutMs?: number;
  /** Name for error messages. */
  name?: string;
}

const READ_ONLY = "series raw store is read-only; writes go to the file store";

function defaultRawFetch(timeoutMs: number): RawFetch {
  return async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json" } });
      return { status: res.status, json: () => res.json() };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Normalise the base: no trailing slash. */
export function normaliseBase(base: string): string {
  return base.replace(/\/+$/, "");
}

function isSeries(x: unknown): x is Series {
  return !!x && typeof x === "object" && !Array.isArray(x) && typeof (x as Series).id === "string" && Array.isArray((x as Series).points);
}

/** A read-only SeriesStore over `${base}/<file>.json` and `${base}/index.json`. */
export function rawStore(base: string, opts: RawStoreOptions = {}): SeriesStore {
  const root = normaliseBase(base);
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const doFetch = opts.fetch ?? defaultRawFetch(opts.timeoutMs ?? 15_000);
  const cache = new Map<string, { value: unknown; expires: number }>();
  const inflight = new Map<string, Promise<unknown>>();

  async function load(file: string): Promise<unknown> {
    const now = Date.now();
    const hit = cache.get(file);
    if (hit && hit.expires > now) return hit.value;
    let p = inflight.get(file);
    if (!p) {
      p = (async () => {
        const res = await doFetch(`${root}/${file}`);
        if (res.status === 404) return null;
        if (res.status < 200 || res.status >= 300) throw new Error(`${opts.name ?? "series raw store"}: ${file} ${res.status}`);
        return res.json();
      })().finally(() => inflight.delete(file));
      inflight.set(file, p);
    }
    try {
      const value = await p;
      cache.set(file, { value, expires: Date.now() + ttl });
      return value;
    } catch (err) {
      // Serve the last good copy while the origin is down.
      if (hit) return hit.value;
      throw err;
    }
  }

  return {
    async append() {
      throw new Error(READ_ONLY);
    },
    async get(id, q) {
      const raw = await load(fileNameFor(id));
      if (!isSeries(raw)) return null;
      return { ...raw, points: applyQuery(raw.points, q) };
    },
    async list(prefix) {
      const raw = await load("index.json");
      if (!Array.isArray(raw)) return [];
      return (raw as SeriesMeta[]).filter((m) => m && typeof m.id === "string" && (!prefix || m.id.startsWith(prefix))).sort((a, b) => a.id.localeCompare(b.id));
    },
    async remove() {
      throw new Error(READ_ONLY);
    },
  };
}

/**
 * Reads consult `primary` then `fallback` and merge what both know (later
 * points win by time, primary metadata wins); writes and removes go to
 * `primary` only. A fallback that fails to answer is treated as empty so a
 * flaky origin never breaks a read that the primary can serve.
 */
export function layeredStore(primary: SeriesStore, fallback: SeriesStore): SeriesStore {
  return {
    append: (meta, points) => primary.append(meta, points),
    async get(id: string, q?: SeriesQuery) {
      const [a, b] = await Promise.all([primary.get(id), fallback.get(id).catch(() => null)]);
      if (!a && !b) return null;
      const meta = a ?? b!;
      const points: Point[] = a && b ? mergePoints(b.points, a.points) : (a ?? b)!.points;
      return { ...meta, points: applyQuery(points, q) };
    },
    async list(prefix?: string) {
      const [a, b] = await Promise.all([primary.list(prefix), fallback.list(prefix).catch(() => [] as SeriesMeta[])]);
      const byId = new Map<string, SeriesMeta>();
      for (const m of b) byId.set(m.id, m);
      for (const m of a) byId.set(m.id, m);
      return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
    },
    remove: (id) => primary.remove(id),
  };
}
