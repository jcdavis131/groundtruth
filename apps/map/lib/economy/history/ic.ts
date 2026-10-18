// Cross-sectional information coefficient: does ranking counties by a signal
// at month t say anything about how their home values ranked over the next
// h months? Spearman rank correlation between the signal and the realised
// forward change, one number per month, plus a summary over months.
//
// This is a description of the past, not a forecast. It ignores transaction
// costs, taxes, the fact that a county is not a tradable asset, and Zillow's
// coverage (counties enter the file when Zillow has enough listings, so early
// years over-represent large metros). See docs/HISTORY.md.

import { source } from "@/lib/provenance/sources";
import { provenance } from "@/lib/provenance/types";
import type { Point, Series } from "@/lib/series/types";
import { byMonth, monthFromIndex, monthIndex, monthKey, parseIsoDate } from "./align";

/** Average ranks, 1-based; tied values share the mean of the positions they span. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const r = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[order[m].i] = r;
    k = j + 1;
  }
  return out;
}

/** Pearson correlation; null when n < 3 or either side has no variance. */
export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman rank correlation = Pearson correlation of average ranks (handles ties). */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length) throw new Error("spearman: length mismatch");
  return pearson(ranks(x), ranks(y));
}

export interface IcResult {
  /** Spearman rank correlation, or null when it is undefined. */
  rho: number | null;
  /** Cross-section size. */
  n: number;
  /** rho · sqrt((n − 2) / (1 − rho²)); approximately Student t with n − 2 df under independence. Null when undefined. */
  t: number | null;
}

/** t-statistic for a correlation coefficient. */
export function tStat(rho: number | null, n: number): number | null {
  if (rho == null || n < 3 || rho * rho >= 1) return null;
  return rho * Math.sqrt((n - 2) / (1 - rho * rho));
}

/** IC for one date: rank-correlate each unit's signal with its realised forward change. */
export function icCrossSection(rows: Array<{ signal: number; forward: number }>): IcResult {
  const ok = rows.filter((r) => Number.isFinite(r.signal) && Number.isFinite(r.forward));
  const rho = spearman(
    ok.map((r) => r.signal),
    ok.map((r) => r.forward),
  );
  return { rho, n: ok.length, t: tStat(rho, ok.length) };
}

/**
 * Realised change over the next h calendar months for every month of a
 * series: (v[m + h] / v[m] − 1) × 100, keyed by month index. Months without
 * both ends are absent.
 */
export function forwardChangePct(series: Series, h: number): Map<number, number> {
  const idx = byMonth(series);
  const out = new Map<number, number>();
  for (const [m, v] of idx) {
    const fwd = idx.get(m + h);
    if (v == null || v === 0 || fwd == null) continue;
    out.set(m, (fwd / v - 1) * 100);
  }
  return out;
}

export interface IcMonth extends IcResult {
  /** "YYYY-MM" of the signal date. */
  month: string;
}

export interface IcSummary {
  /** Months with a defined IC. */
  months: number;
  meanIc: number | null;
  /** Sample standard deviation of the monthly IC. */
  sdIc: number | null;
  /** meanIc / sdIc, the "IC information ratio". */
  icIr: number | null;
  /** Share of months with IC > 0. */
  positiveShare: number | null;
  /** Mean cross-section size. */
  meanN: number | null;
}

export interface IcPanelOptions {
  /** Skip months whose cross-section is smaller than this. Default 30. */
  minN?: number;
  /** Inclusive "YYYY-MM" bounds on the signal date. */
  from?: string;
  to?: string;
}

export interface IcPanel {
  h: number;
  byMonth: IcMonth[];
  summary: IcSummary;
}

function bounds(opts: IcPanelOptions): { lo: number; hi: number } {
  const lo = opts.from ? parseIsoDate(opts.from) : null;
  const hi = opts.to ? parseIsoDate(opts.to) : null;
  return { lo: lo == null ? -Infinity : monthIndex(lo), hi: hi == null ? Infinity : monthIndex(hi) };
}

/**
 * Rows for one month across units: (id, signal at m, forward change from m).
 * Units missing either value are left out.
 */
export function icRowsAt(signals: Map<string, Series>, prices: Map<string, Series>, h: number, month: string): Array<{ id: string; signal: number; forward: number }> {
  const t = parseIsoDate(month);
  if (t == null) return [];
  const m = monthIndex(t);
  const rows: Array<{ id: string; signal: number; forward: number }> = [];
  for (const [id, sig] of signals) {
    const price = prices.get(id);
    if (!price) continue;
    const s = byMonth(sig).get(m);
    if (s == null) continue;
    const pIdx = byMonth(price);
    const p0 = pIdx.get(m);
    const p1 = pIdx.get(m + h);
    if (p0 == null || p0 === 0 || p1 == null) continue;
    rows.push({ id, signal: s, forward: (p1 / p0 - 1) * 100 });
  }
  return rows;
}

export function summarize(byMonthRows: IcMonth[]): IcSummary {
  const ics = byMonthRows.map((r) => r.rho).filter((v): v is number => v != null);
  const n = ics.length;
  if (!n) return { months: 0, meanIc: null, sdIc: null, icIr: null, positiveShare: null, meanN: null };
  const mean = ics.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(ics.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const withRho = byMonthRows.filter((r) => r.rho != null);
  return {
    months: n,
    meanIc: mean,
    sdIc: sd,
    icIr: sd != null && sd > 0 ? mean / sd : null,
    positiveShare: ics.filter((v) => v > 0).length / n,
    meanN: withRho.reduce((a, r) => a + r.n, 0) / withRho.length,
  };
}

/**
 * IC for every month where at least `minN` units have both a signal and a
 * realised h-month forward change. Signals and prices are keyed by the same
 * unit id (a county FIPS).
 */
export function icPanel(signals: Map<string, Series>, prices: Map<string, Series>, h: number, opts: IcPanelOptions = {}): IcPanel {
  const minN = opts.minN ?? 30;
  const { lo, hi } = bounds(opts);
  // Pre-index once; the panel is ~3,000 units × ~300 months.
  const sigIdx = new Map<string, Map<number, number | null>>();
  const fwdIdx = new Map<string, Map<number, number>>();
  const months = new Set<number>();
  for (const [id, sig] of signals) {
    const price = prices.get(id);
    if (!price) continue;
    const si = byMonth(sig);
    sigIdx.set(id, si);
    fwdIdx.set(id, forwardChangePct(price, h));
    for (const m of si.keys()) if (m >= lo && m <= hi) months.add(m);
  }
  const byMonthRows: IcMonth[] = [];
  for (const m of [...months].sort((a, b) => a - b)) {
    const rows: Array<{ signal: number; forward: number }> = [];
    for (const [id, si] of sigIdx) {
      const s = si.get(m);
      const f = fwdIdx.get(id)?.get(m);
      if (s == null || f == null) continue;
      rows.push({ signal: s, forward: f });
    }
    if (rows.length < minN) continue;
    byMonthRows.push({ month: monthKey(monthFromIndex(m)), ...icCrossSection(rows) });
  }
  return { h, byMonth: byMonthRows, summary: summarize(byMonthRows) };
}

/** The monthly IC as a Series so the same chart code can draw it. */
export function icSeries(panel: IcPanel, signalId: string, retrievedAt?: string): Series {
  const points: Point[] = panel.byMonth.map((r) => ({ t: parseIsoDate(r.month) ?? 0, v: r.rho }));
  return {
    id: `ic:${signalId}:h${panel.h}`,
    title: `Information coefficient of ${signalId} for ${panel.h}-month ZHVI change`,
    unit: "Spearman rho",
    frequency: "monthly",
    geo: { kind: "us", id: "US" },
    tags: ["housing", "research"],
    points,
    provenance: provenance(source("zillow-zhvi"), {
      kind: "estimate",
      retrievedAt,
      method: `for each month t: Spearman rank correlation across counties between ${signalId} at t and ZHVI(t + ${panel.h} months) / ZHVI(t) − 1; t-stat = rho·sqrt((n−2)/(1−rho²))`,
      notes: ["descriptive, not a forecast; no transaction costs; Zillow county coverage grows over time (survivorship in early years)"],
    }),
  };
}
