// Calendar helpers and alignment rules for the history series. Everything is
// UTC and month-end based because Zillow stamps months on their last day.
//
// Alignment rules (also in docs/HISTORY.md):
//   - a month is identified by its month-end timestamp (Date.UTC(y, m, 0));
//   - a quarter is stamped on the last day of its last month (Q1 -> Mar 31);
//   - "carry forward" (asOfJoin) gives month m the latest observation whose
//     stamp, shifted by `lagMonths`, is <= m; observations older than
//     `maxStaleMonths` are not carried, so a suppressed or missing quarter
//     turns into null instead of a year-old number;
//   - percent changes over k months compare calendar months, not array
//     positions, so a gap in the data yields null rather than a wrong pair.

import type { Point, Series } from "@/lib/series/types";

/** Epoch ms of the last day of `month1` (1..12) in `year`, UTC. */
export function monthEnd(year: number, month1: number): number {
  return Date.UTC(year, month1, 0);
}

/** Snap any timestamp to the end of its UTC month. */
export function monthEndOf(t: number): number {
  const d = new Date(t);
  return monthEnd(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/** Months since year 0 for calendar arithmetic. */
export function monthIndex(t: number): number {
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Month-end timestamp for a month index. */
export function monthFromIndex(i: number): number {
  return monthEnd(Math.floor(i / 12), (i % 12) + 1);
}

export function addMonths(t: number, n: number): number {
  return monthFromIndex(monthIndex(t) + n);
}

/** Quarter stamp: last day of the quarter's last month. */
export function quarterEnd(year: number, qtr: number): number {
  return monthEnd(year, qtr * 3);
}

export function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** "YYYY-MM" in UTC. */
export function monthKey(t: number): string {
  return isoDate(t).slice(0, 7);
}

/** Parse "YYYY-MM-DD" (or "YYYY-MM", taken as the month end) to epoch ms UTC, or null. */
export function parseIsoDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (m[3] == null) return monthEnd(y, mo);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  return d >= 1 && d <= 31 && new Date(t).getUTCMonth() === mo - 1 ? t : null;
}

export interface AsOfOptions {
  /** Shift every observation later by this many months before joining (publication lag). */
  lagMonths?: number;
  /** Do not carry an observation older than this many months relative to the target. */
  maxStaleMonths?: number;
  /** Treat null observations as absent (look further back) instead of carrying the null. Default true. */
  skipNull?: boolean;
}

/**
 * As-of join: for each target month-end in `targets` (ascending), the value
 * of the latest point observed on or before it. Points are month-snapped
 * after the lag shift, so a weekly rate published on a Thursday counts for
 * its month.
 */
export function asOfJoin(points: Point[], targets: number[], opts: AsOfOptions = {}): Array<number | null> {
  const lag = opts.lagMonths ?? 0;
  const maxStale = opts.maxStaleMonths ?? Infinity;
  const skipNull = opts.skipNull ?? true;
  const obs = points
    .filter((p) => !skipNull || p.v != null)
    .map((p) => ({ t: addMonths(p.t, lag), v: p.v }))
    .sort((a, b) => a.t - b.t);
  const out: Array<number | null> = new Array(targets.length).fill(null);
  let j = 0;
  let last: { t: number; v: number | null } | null = null;
  for (let i = 0; i < targets.length; i++) {
    const target = monthEndOf(targets[i]);
    while (j < obs.length && obs[j].t <= target) {
      last = obs[j];
      j++;
    }
    if (!last) continue;
    if (monthIndex(target) - monthIndex(last.t) > maxStale) continue;
    out[i] = last.v;
  }
  return out;
}

/** Month key -> value for a monthly series (later points win on duplicate months). */
export function byMonth(series: Series): Map<number, number | null> {
  const m = new Map<number, number | null>();
  for (const p of series.points) m.set(monthIndex(p.t), p.v);
  return m;
}

/**
 * Percent change over `months` calendar months for each point of a monthly
 * series: (v[m] / v[m - months] - 1) * 100. Null when either side is missing
 * or the base is zero.
 */
export function pctChangeMonths(series: Series, months: number): Point[] {
  const idx = byMonth(series);
  return series.points.map((p) => {
    const base = idx.get(monthIndex(p.t) - months);
    if (p.v == null || base == null || base === 0) return { t: p.t, v: null };
    return { t: p.t, v: (p.v / base - 1) * 100 };
  });
}

/** Percent change over `lag` positions of a regularly spaced series (quarters), keyed by (year, qtr) index. */
export function pctChangeQuarters(points: Array<{ t: number; v: number | null }>, quarters: number): Point[] {
  const idx = new Map<number, number | null>();
  for (const p of points) idx.set(Math.floor(monthIndex(p.t) / 3), p.v);
  return points.map((p) => {
    const base = idx.get(Math.floor(monthIndex(p.t) / 3) - quarters);
    if (p.v == null || base == null || base === 0) return { t: p.t, v: null };
    return { t: p.t, v: (p.v / base - 1) * 100 };
  });
}

/** Points within [from, to] inclusive; either bound may be undefined. */
export function window(points: Point[], from?: number, to?: number): Point[] {
  return points.filter((p) => (from == null || p.t >= from) && (to == null || p.t <= to));
}
