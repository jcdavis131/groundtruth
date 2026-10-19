// Pure scale and layout helpers for the desk multi-series chart: extents,
// "nice" ticks, dual-axis assignment by unit, normalise-to-100, date ticks,
// nearest-point lookup for the crosshair and CSV output. No DOM.

import type { Point, Series } from "@/lib/series/types";

/** What the chart draws: a Series plus how it was chosen and coloured. */
export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  unit: string;
  points: Point[];
}

export interface Extent {
  min: number;
  max: number;
}

/** Numeric extent of the non-null values; null when there are none. */
export function extent(points: Point[]): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  return min === Infinity ? null : { min, max };
}

/** Time extent across every series; null when nothing is drawn. */
export function timeExtent(series: ChartSeries[]): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p.t < min) min = p.t;
      if (p.t > max) max = p.t;
    }
  }
  return min === Infinity ? null : { min, max };
}

/** Round a raw step to 1, 2, 2.5 or 5 × 10^n (Heckbert's "nice numbers"). */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 4 ? 2.5 : f < 7 ? 5 : 10;
  return nice * 10 ** exp;
}

/**
 * About `count` evenly spaced round ticks covering [min, max]. The returned
 * domain is widened to the outer ticks so lines never touch the frame. A flat
 * series (min === max) gets a ±1 band, or ±10 % of the value when it is not 0.
 */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; domain: Extent } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], domain: { min: 0, max: 1 } };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Snap to the step's precision so 0.30000000000000004 prints as 0.3.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)));
  return { ticks, domain: { min: ticks[0], max: ticks[ticks.length - 1] } };
}

/** Linear map from a domain to a pixel range. Degenerate domains map to the range midpoint. */
export function scaleLinear(domain: Extent, range: [number, number]): (v: number) => number {
  const span = domain.max - domain.min;
  if (span === 0) return () => (range[0] + range[1]) / 2;
  return (v: number) => range[0] + ((v - domain.min) / span) * (range[1] - range[0]);
}

/**
 * Normalise a series so its first non-null value is `base` (100). Nulls stay
 * null; a series whose first value is 0 cannot be rebased and is returned as
 * all-null so the chart says so instead of dividing by zero.
 */
export function normalise(points: Point[], base = 100): Point[] {
  const first = points.find((p) => p.v != null && Number.isFinite(p.v))?.v;
  if (first == null || first === 0) return points.map((p) => ({ t: p.t, v: null }));
  return points.map((p) => ({ t: p.t, v: p.v == null ? null : (p.v / first) * base }));
}

export type AxisSide = "left" | "right";

export interface AxisPlan {
  /** Unit label per side; undefined when nothing is drawn on that side. */
  units: { left?: string; right?: string };
  /** Side per series id. */
  side: Record<string, AxisSide>;
  /** Units that had to share the left axis because more than two were present. */
  overflow: string[];
}

/**
 * Dual-axis plan: the first unit seen takes the left axis, the second the
 * right; any further units share the left axis and are reported in
 * `overflow` so the UI can say the scale is mixed. When normalised, every
 * series is dimensionless and shares one axis labelled "index (first = 100)".
 */
export function planAxes(series: ChartSeries[], normalised: boolean): AxisPlan {
  const side: Record<string, AxisSide> = {};
  if (normalised) {
    for (const s of series) side[s.id] = "left";
    return { units: { left: series.length ? "index (first = 100)" : undefined }, side, overflow: [] };
  }
  const units: string[] = [];
  const overflow: string[] = [];
  for (const s of series) {
    const u = s.unit || "value";
    if (!units.includes(u)) units.push(u);
    const idx = units.indexOf(u);
    side[s.id] = idx === 1 ? "right" : "left";
    if (idx > 1 && !overflow.includes(u)) overflow.push(u);
  }
  return { units: { left: units[0], right: units[1] }, side, overflow };
}

/** Extent of every series on a side, after optional normalisation. */
export function sideExtent(series: ChartSeries[], plan: AxisPlan, sideName: AxisSide, normalised: boolean): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    if (plan.side[s.id] !== sideName) continue;
    const e = extent(normalised ? normalise(s.points) : s.points);
    if (!e) continue;
    if (e.min < min) min = e.min;
    if (e.max > max) max = e.max;
  }
  return min === Infinity ? null : { min, max };
}

const DAY = 86_400_000;

export interface DateTick {
  t: number;
  label: string;
}

function utcParts(t: number): { y: number; m: number; d: number } {
  const d = new Date(t);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/**
 * Date ticks on calendar boundaries: years when the span is long, months in
 * the middle, days when short. Labels are compact ("2024", "Mar 2024", "12 Mar").
 */
export function dateTicks(min: number, max: number, count = 6): DateTick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const span = max - min;
  const out: DateTick[] = [];
  const a = utcParts(min);
  if (span >= 3 * 365 * DAY) {
    const years = Math.round(span / (365 * DAY));
    const step = Math.max(1, niceStep(years / count));
    for (let y = Math.ceil(a.y / step) * step; ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > max) break;
      if (t >= min) out.push({ t, label: String(y) });
    }
  } else if (span >= 60 * DAY) {
    const months = Math.round(span / (30 * DAY));
    const step = months / count <= 1 ? 1 : months / count <= 2 ? 2 : months / count <= 3 ? 3 : 6;
    for (let i = 0; ; i++) {
      const m0 = a.y * 12 + a.m + i;
      const m = m0 % 12;
      if (m % step !== 0) continue;
      const t = Date.UTC(Math.floor(m0 / 12), m, 1);
      if (t > max) break;
      if (t >= min) out.push({ t, label: m === 0 ? String(Math.floor(m0 / 12)) : `${MONTHS[m]} ${Math.floor(m0 / 12)}` });
    }
  } else {
    const days = Math.max(1, Math.round(span / DAY));
    const step = Math.max(1, Math.round(niceStep(days / count)));
    for (let t = Date.UTC(a.y, a.m, a.d); t <= max; t += step * DAY) {
      if (t < min) continue;
      const p = utcParts(t);
      out.push({ t, label: `${p.d} ${MONTHS[p.m]}` });
    }
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date for the crosshair readout and CSV; drops the time when it is midnight UTC. */
export function fmtDate(t: number): string {
  const iso = new Date(t).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ") + "Z";
}

/** Index of the point closest in time to `t` (binary search; points sorted ascending by t). -1 when empty. */
export function nearestIndex(points: Point[], t: number): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - t) <= Math.abs(points[lo].t - t)) return lo - 1;
  return lo;
}

/** Compact number for axis labels: 1.2k, 3.4M, 0.25. */
export function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, "");
  if (a === 0) return "0";
  return v.toFixed(2);
}

/** Every series as one CSV: `date` column then one column per series (label with unit), rows on the union of timestamps. */
export function seriesCsv(series: ChartSeries[]): string {
  const times = new Set<number>();
  for (const s of series) for (const p of s.points) times.add(p.t);
  const sorted = [...times].sort((a, b) => a - b);
  const byId = series.map((s) => new Map(s.points.map((p) => [p.t, p.v] as const)));
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["date", ...series.map((s) => q(s.unit ? `${s.label} (${s.unit})` : s.label))].join(",");
  const lines = sorted.map((t) => [fmtDate(t), ...byId.map((m) => (m.get(t) == null ? "" : String(m.get(t))))].join(","));
  return [head, ...lines].join("\n");
}

/** Palette for added series, in order; wraps after eight. Hues chosen to stay distinct on white and on the dark HUD. */
export const SERIES_COLORS = ["#0b6e5c", "#1d4ed8", "#b45309", "#be185d", "#4d7c0f", "#6d28d9", "#0e7490", "#7f1d1d"];

export function colorAt(i: number): string {
  return SERIES_COLORS[((i % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];
}

/** Wrap a stored Series as a ChartSeries with a palette colour. */
export function toChartSeries(s: Series, index: number, color?: string): ChartSeries {
  return { id: s.id, label: s.title, color: color ?? colorAt(index), unit: s.unit, points: [...s.points].sort((a, b) => a.t - b.t) };
}
