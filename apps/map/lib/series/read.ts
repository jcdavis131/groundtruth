// Read side of the series store: bounded queries, daily roll-ups computed on
// the way out (the store keeps sample cadence), CSV export and a listing that
// tolerates stray files (index.json) sitting next to the series files.

import { rollupDaily, type RollupMode } from "./collect";
import type { Point, Series, SeriesMeta, SeriesStore } from "./types";

export type ReadRollup = "daily-mean" | "daily-max" | "daily-last";
export const ROLLUPS: readonly ReadRollup[] = ["daily-mean", "daily-max", "daily-last"];

export const DEFAULT_LIMIT = 5000;
export const MAX_LIMIT = 50_000;

export interface ReadOptions {
  /** Epoch ms, inclusive. */
  from?: number;
  to?: number;
  /** Cap on points returned, newest kept; clamped to [1, MAX_LIMIT]. */
  limit?: number;
  rollup?: ReadRollup;
}

export interface ReadSeries extends Series {
  /** Roll-up applied, when one was. */
  rollup?: ReadRollup;
  /** Points before the limit was applied (after the time window). */
  available: number;
}

export function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Read one series with the window applied, optionally rolled up to one point
 * per UTC day, and the newest `limit` points kept. Null when unknown.
 */
export async function readSeries(store: SeriesStore, id: string, opts: ReadOptions = {}): Promise<ReadSeries | null> {
  // The window is applied before the roll-up so a partial day at the edge is a
  // partial-day roll-up, which is what "from" means to a caller.
  const s = await store.get(id, { from: opts.from, to: opts.to });
  if (!s) return null;
  let points: Point[] = s.points;
  if (opts.rollup) {
    const mode: RollupMode = opts.rollup === "daily-mean" ? "mean" : opts.rollup === "daily-max" ? "max" : "last";
    points = rollupDaily(points, mode);
  }
  const available = points.length;
  const limit = clampLimit(opts.limit);
  if (points.length > limit) points = points.slice(points.length - limit);
  return { ...s, points, rollup: opts.rollup, available };
}

/** True for a well-formed SeriesMeta; guards against non-series JSON in the store directory. */
export function isSeriesMeta(m: unknown): m is SeriesMeta {
  if (!m || typeof m !== "object" || Array.isArray(m)) return false;
  const x = m as Partial<SeriesMeta>;
  return typeof x.id === "string" && x.id.length > 0 && typeof x.title === "string" && typeof x.unit === "string" && typeof x.frequency === "string";
}

/** Metadata for every series under `prefix`, sorted by id, with malformed entries dropped. */
export async function listSeries(store: SeriesStore, prefix?: string): Promise<SeriesMeta[]> {
  const all = await store.list(prefix);
  return all.filter(isSeriesMeta).sort((a, b) => a.id.localeCompare(b.id));
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Long-format CSV: one row per point, `series_id,t_iso,value`; null values are empty cells. */
export function seriesToCsv(series: Series[]): string {
  const lines = ["series_id,t_iso,value"];
  for (const s of series) {
    for (const p of s.points) {
      lines.push(`${csvCell(s.id)},${new Date(p.t).toISOString()},${p.v == null ? "" : String(p.v)}`);
    }
  }
  return lines.join("\n") + "\n";
}
