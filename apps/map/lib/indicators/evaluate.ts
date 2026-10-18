// Turn an indicator's series into a status. Pure: no fetches, no clocks
// beyond the optional `now` argument, so every rule is testable.

import type { Frequency, Point, Series } from "@/lib/series/types";
import type { Indicator, Threshold, ThresholdLevel } from "./types";

export type IndicatorStatus = "ok" | "watch" | "alert" | "no data";

export interface Evaluation {
  latest: number | null;
  /** ISO time of the latest non-null point. */
  latestAt: string | null;
  prev: number | null;
  prevAt: string | null;
  changeAbs: number | null;
  changePct: number | null;
  /** Year-over-year percent change when a point about 365 days earlier exists. */
  yoyPct: number | null;
  /** Year-over-year absolute change, same lookup. */
  yoyAbs: number | null;
  yoyAt: string | null;
  status: IndicatorStatus;
  triggered: Threshold[];
  /** Last SPARKLINE_POINTS non-null points, oldest first. */
  sparkline: Point[];
}

export const SPARKLINE_POINTS = 60;
const DAY = 86_400_000;

/** Orders statuses so lists and badges can sort worst-first. */
export function statusRank(s: IndicatorStatus): number {
  switch (s) {
    case "alert":
      return 3;
    case "watch":
      return 2;
    case "ok":
      return 1;
    default:
      return 0;
  }
}

/**
 * How far from exactly 365 days back a point may sit and still count as
 * "a year ago". Monthly data lands 365 or 366 days apart; quarterly data is
 * published on the quarter; annual series only have the previous year.
 */
export function yoyToleranceMs(freq: Frequency): number {
  switch (freq) {
    case "5min":
    case "hourly":
    case "daily":
    case "irregular":
      return 5 * DAY;
    case "weekly":
      return 10 * DAY;
    case "monthly":
      return 20 * DAY;
    case "quarterly":
      return 50 * DAY;
    case "annual":
      return 200 * DAY;
  }
}

/** The non-null point nearest to `target` within `toleranceMs`, or null. */
export function nearestPoint(points: Point[], target: number, toleranceMs: number): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const p of points) {
    if (p.v == null) continue;
    const d = Math.abs(p.t - target);
    if (d <= toleranceMs && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function compare(v: number, th: Threshold): boolean {
  switch (th.op) {
    case "<":
      return v < th.value;
    case "<=":
      return v <= th.value;
    case ">":
      return v > th.value;
    case ">=":
      return v >= th.value;
  }
}

function metricFor(th: Threshold, e: Pick<Evaluation, "latest" | "yoyPct" | "yoyAbs">): number | null {
  switch (th.on ?? "value") {
    case "value":
      return e.latest;
    case "yoyPct":
      return e.yoyPct;
    case "yoyAbs":
      return e.yoyAbs;
  }
}

/** Which thresholds fire for these metrics. Rules whose metric is missing are skipped, never assumed. */
export function triggeredThresholds(thresholds: Threshold[], e: Pick<Evaluation, "latest" | "yoyPct" | "yoyAbs">): Threshold[] {
  const out: Threshold[] = [];
  for (const th of thresholds) {
    const v = metricFor(th, e);
    if (v == null || !Number.isFinite(v)) continue;
    if (compare(v, th)) out.push(th);
  }
  return out;
}

function worst(levels: ThresholdLevel[]): IndicatorStatus {
  if (levels.includes("alert")) return "alert";
  if (levels.includes("watch")) return "watch";
  return "ok";
}

function pct(cur: number, base: number): number | null {
  return base === 0 ? null : ((cur - base) / Math.abs(base)) * 100;
}

/**
 * Evaluate an indicator against a series. Points are sorted by time and
 * nulls are ignored for "latest" and "previous"; a series with no numeric
 * point is "no data" and triggers nothing.
 */
export function evaluate(indicator: Pick<Indicator, "thresholds" | "cadence">, series: Pick<Series, "points">): Evaluation {
  const pts = [...series.points].filter((p) => p.v != null && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const empty: Evaluation = {
    latest: null,
    latestAt: null,
    prev: null,
    prevAt: null,
    changeAbs: null,
    changePct: null,
    yoyPct: null,
    yoyAbs: null,
    yoyAt: null,
    status: "no data",
    triggered: [],
    sparkline: [],
  };
  if (!pts.length) return empty;
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const latest = last.v as number;
  const ago = nearestPoint(pts.slice(0, -1), last.t - 365 * DAY, yoyToleranceMs(indicator.cadence));
  const partial = {
    latest,
    yoyPct: ago ? pct(latest, ago.v as number) : null,
    yoyAbs: ago ? latest - (ago.v as number) : null,
  };
  const triggered = triggeredThresholds(indicator.thresholds, partial);
  return {
    ...empty,
    ...partial,
    latestAt: new Date(last.t).toISOString(),
    prev: prev?.v ?? null,
    prevAt: prev ? new Date(prev.t).toISOString() : null,
    changeAbs: prev ? latest - (prev.v as number) : null,
    changePct: prev ? pct(latest, prev.v as number) : null,
    yoyAt: ago ? new Date(ago.t).toISOString() : null,
    status: worst(triggered.map((t) => t.level)),
    triggered,
    sparkline: pts.slice(-SPARKLINE_POINTS),
  };
}

/** Direction of the latest move, read with `invert` so the panel can colour it. */
export function moveQuality(changeAbs: number | null, invert: boolean | undefined): "better" | "worse" | "flat" | null {
  if (changeAbs == null) return null;
  if (changeAbs === 0) return "flat";
  const up = changeAbs > 0;
  // With invert, lower is worse, so a rise reads as better.
  return up === !!invert ? "better" : "worse";
}
