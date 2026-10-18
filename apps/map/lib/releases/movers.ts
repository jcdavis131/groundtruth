// "What changed since the last release": the biggest movers in each table the
// app relays, as arithmetic over published values. Pure functions over the
// parsed tables from lib/economy/sources.ts; no network, no store, no Cesium.
//
// Every row carries the two published values it was computed from. The
// difference and percent are ours (simple subtraction / division) and the
// provenance says so in `method`; the values themselves stay "published".
// Rows with a missing or zero `before` cannot have a percent and are left
// out of the ranked lists but counted in `skipped`.

import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { CrossingRow, HomeValue, JobsRow, PortStats } from "@/lib/economy/features";

export type MoverTable = "zillow" | "qcew" | "border" | "ports";
export const MOVER_TABLES: MoverTable[] = ["zillow", "qcew", "border", "ports"];

export interface MoverRow {
  /** County GEOID, BTS port code, or BTS port id. */
  id: string;
  name: string;
  before: number | null;
  after: number | null;
  changeAbs: number | null;
  changePct: number | null;
  /** Period of `after` ("2026-07", "2026 Q1", "2025"). */
  period: string;
  /** Period of `before`, when it is a different period. */
  previousPeriod?: string;
  /** Anchor for a fly-to when the table knows one. */
  lon?: number;
  lat?: number;
}

export interface MoversResult {
  table: MoverTable;
  /** Which field was ranked ("zhvi", "emp", "avgWeeklyWage", "Trucks", "container"). */
  metric: string;
  unit: string;
  period: string;
  previousPeriod: string | null;
  /** Rows ranked by changePct descending / ascending, ties broken by id. */
  up: MoverRow[];
  down: MoverRow[];
  /** Rows that had both values and a non-zero `before`. */
  compared: number;
  /** Rows dropped for a missing value, zero denominator or non-consecutive periods. */
  skipped: number;
  /** Zillow only: counties whose year-over-year sign changed between the two months. */
  signFlips?: { toPositive: number; toNegative: number };
  provenance: Provenance;
}

export interface MoverOptions {
  /** Rows per direction. */
  n?: number;
  /** Ignore rows whose `before` is below this (small denominators make silly percents). */
  minBefore?: number;
  /** Retrieval time stamped on the provenance; defaults to now. */
  retrievedAt?: string;
}

const clampN = (n: number | undefined) => Math.max(1, Math.min(200, Math.floor(n ?? 20)));

/** Rank rows by percent change; ties are broken by id so output is stable. */
export function rank(rows: MoverRow[], n: number): { up: MoverRow[]; down: MoverRow[] } {
  const ok = rows.filter((r) => r.changePct != null && Number.isFinite(r.changePct));
  const byPct = (dir: 1 | -1) => (a: MoverRow, b: MoverRow) => {
    const d = ((b.changePct ?? 0) - (a.changePct ?? 0)) * dir;
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const up = [...ok].sort(byPct(1)).slice(0, n);
  const down = [...ok].sort(byPct(-1)).slice(0, n);
  return { up, down };
}

function pct(before: number | null, after: number | null, minBefore: number): number | null {
  if (before == null || after == null || before === 0 || Math.abs(before) < minBefore) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

function row(id: string, name: string, before: number | null, after: number | null, period: string, previousPeriod: string | undefined, minBefore: number, pos?: { lon: number; lat: number }): MoverRow {
  const changePct = pct(before, after, minBefore);
  return {
    id,
    name,
    before,
    after,
    changeAbs: before != null && after != null ? after - before : null,
    changePct,
    period,
    previousPeriod,
    lon: pos?.lon,
    lat: pos?.lat,
  };
}

/** "2026-07-31" -> "2026-07"; "2026-07" unchanged. */
function ym(s: string): string {
  return s.slice(0, 7);
}

/** The month key one before `ym` ("2026-01" -> "2025-12"). */
export function prevMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

// ---------------------------------------------------------------- Zillow

/**
 * Latest month vs the month before, per region, from the 25-month `monthly`
 * series each Zillow row keeps. Also counts regions whose year-over-year sign
 * flipped between those two months (computed from the same series, 12 months
 * back from each).
 */
export function zillowMovers(table: { kind: string; asOf: string; rows: Iterable<HomeValue> }, opts: MoverOptions = {}): MoversResult {
  const n = clampN(opts.n);
  const minBefore = opts.minBefore ?? 0;
  const rows: MoverRow[] = [];
  let skipped = 0;
  let toPositive = 0;
  let toNegative = 0;
  const period = ym(table.asOf);
  const previousPeriod = prevMonth(period);
  for (const h of table.rows) {
    const m = h.monthly;
    const last = m[m.length - 1];
    const prev = m[m.length - 2];
    // Both months must be the file's newest two columns; a region that stops
    // reporting early is not compared against an older month.
    if (!last || !prev || ym(last[0]) !== period || ym(prev[0]) !== previousPeriod) {
      skipped++;
      continue;
    }
    const r = row(h.id, h.state ? `${h.name}, ${h.state}` : h.name, prev[1], last[1], period, previousPeriod, minBefore);
    if (r.changePct == null) {
      skipped++;
      continue;
    }
    rows.push(r);
    const yoyNow = findBack(m, m.length - 1, 12);
    const yoyPrev = findBack(m, m.length - 2, 12);
    if (yoyNow != null && yoyPrev != null) {
      const sNow = Math.sign(last[1] - yoyNow);
      const sPrev = Math.sign(prev[1] - yoyPrev);
      // A flip is a strict sign change; leaving or reaching exactly zero is not one.
      if (sPrev < 0 && sNow > 0) toPositive++;
      else if (sPrev > 0 && sNow < 0) toNegative++;
    }
  }
  const { up, down } = rank(rows, n);
  const sourceId = table.kind.startsWith("zori") ? "zillow-zori" : "zillow-zhvi";
  return {
    table: "zillow",
    metric: table.kind,
    unit: sourceId === "zillow-zori" ? "USD per month" : "USD",
    period,
    previousPeriod,
    up,
    down,
    compared: rows.length,
    skipped,
    signFlips: { toPositive, toNegative },
    provenance: provenance(source(sourceId), {
      kind: "published",
      seriesId: table.kind,
      period,
      retrievedAt: opts.retrievedAt,
      method: "before and after are Zillow's published month columns; changeAbs = after - before; changePct = (after - before) / |before| * 100; sign flips compare (month - same month a year earlier) for the two newest months",
    }),
  };
}

/** Value `back` months before index `i` in a [month, value] series, matched by month key, else null. */
function findBack(m: Array<[string, number]>, i: number, back: number): number | null {
  const want = shift(ym(m[i][0]), -back);
  for (let k = i - 1; k >= 0; k--) {
    const key = ym(m[k][0]);
    if (key === want) return m[k][1];
    if (key < want) break;
  }
  return null;
}

function shift(key: string, delta: number): string {
  const [y, mo] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
}

// ---------------------------------------------------------------- BLS QCEW

export type QcewMetric = "emp" | "avgWeeklyWage" | "wages" | "estabs";
export const QCEW_METRICS: QcewMetric[] = ["emp", "avgWeeklyWage", "wages", "estabs"];
const QCEW_UNIT: Record<QcewMetric, string> = { emp: "jobs (third month of quarter)", avgWeeklyWage: "USD per week", wages: "USD per quarter", estabs: "establishments" };

/**
 * Counties ranked by BLS's own over-the-year percent change for a metric.
 * The prior-year level is not in the newest file, so `before` stays null
 * rather than being reconstructed; `changePct` is the published field.
 */
export function qcewMovers(table: { period: string; counties: Iterable<JobsRow> }, names: Map<string, string> | undefined, metric: QcewMetric, opts: MoverOptions = {}): MoversResult {
  const n = clampN(opts.n);
  const minAfter = opts.minBefore ?? 0;
  const rows: MoverRow[] = [];
  let skipped = 0;
  const prevPeriod = prevQuarterYear(table.period);
  for (const j of table.counties) {
    const after = j[metric];
    const yoy = j.yoy[metric];
    if (j.suppressed || after == null || yoy == null || after < minAfter) {
      skipped++;
      continue;
    }
    rows.push({
      id: j.area,
      name: names?.get(j.area) ?? j.area,
      before: null,
      after,
      changeAbs: null,
      changePct: yoy,
      period: table.period,
      previousPeriod: prevPeriod,
    });
  }
  const { up, down } = rank(rows, n);
  return {
    table: "qcew",
    metric,
    unit: QCEW_UNIT[metric],
    period: table.period,
    previousPeriod: prevPeriod,
    up,
    down,
    compared: rows.length,
    skipped,
    provenance: provenance(source("bls-qcew"), {
      kind: "published",
      seriesId: `oty_${metric}_pct_chg`,
      period: table.period,
      retrievedAt: opts.retrievedAt,
      method: "changePct is BLS's published over-the-year percent change for the metric; the year-earlier level is not in the newest file, so before and changeAbs are null. Suppressed cells (disclosure code N) are skipped.",
      notes: ["Small counties move a lot in percent terms; use minBefore to ignore them."],
    }),
  };
}

/** "2026 Q1" -> "2025 Q1". */
export function prevQuarterYear(period: string): string {
  const m = period.match(/^(\d{4})\s*Q([1-4])$/);
  return m ? `${Number(m[1]) - 1} Q${m[2]}` : period;
}

// ---------------------------------------------------------------- BTS border

/** Latest month vs the month before, per port, for one BTS measure (Trucks by default). */
export function borderMovers(data: { asOf: string; rows: Iterable<CrossingRow> }, measure = "Trucks", opts: MoverOptions = {}): MoversResult {
  const n = clampN(opts.n);
  const minBefore = opts.minBefore ?? 0;
  const rows: MoverRow[] = [];
  let skipped = 0;
  const period = ym(data.asOf);
  const previousPeriod = prevMonth(period);
  for (const c of data.rows) {
    const m = c.measures[measure];
    const s = m?.series ?? [];
    const last = s[s.length - 1];
    const prev = s[s.length - 2];
    if (!last || !prev || last[0] !== period || prev[0] !== previousPeriod) {
      skipped++;
      continue;
    }
    const r = row(c.code, `${c.name}, ${c.state}`, prev[1], last[1], period, previousPeriod, minBefore, { lon: c.lon, lat: c.lat });
    if (r.changePct == null) {
      skipped++;
      continue;
    }
    rows.push(r);
  }
  const { up, down } = rank(rows, n);
  return {
    table: "border",
    metric: measure,
    unit: "crossings per month",
    period,
    previousPeriod,
    up,
    down,
    compared: rows.length,
    skipped,
    provenance: provenance(source("bts-border"), {
      kind: "published",
      seriesId: measure,
      period,
      retrievedAt: opts.retrievedAt,
      method: "before and after are BTS monthly counts for the port and measure; changeAbs = after - before; changePct = (after - before) / before * 100. Ports whose newest month is not the table's newest month are skipped.",
    }),
  };
}

// ---------------------------------------------------------------- BTS ports

export type PortMetric = "container" | "tonnage" | "dryBulk";
export const PORT_METRICS: PortMetric[] = ["container", "tonnage", "dryBulk"];
const PORT_UNIT: Record<PortMetric, string> = { container: "TEU", tonnage: "short tons", dryBulk: "short tons" };

/** Latest reporting year vs the year before, per port, for a volume statistic. */
export function portMovers(data: { year: number; ports: Iterable<{ stats: PortStats; lon?: number; lat?: number }> }, metric: PortMetric = "container", opts: MoverOptions = {}): MoversResult {
  const n = clampN(opts.n);
  const minBefore = opts.minBefore ?? 0;
  const rows: MoverRow[] = [];
  let skipped = 0;
  const period = String(data.year);
  const previousPeriod = String(data.year - 1);
  for (const p of data.ports) {
    const s = p.stats[metric]?.series ?? [];
    const last = s.find((x) => x[0] === data.year);
    const prev = s.find((x) => x[0] === data.year - 1);
    if (!last || !prev) {
      skipped++;
      continue;
    }
    const r = row(p.stats.portId, p.stats.name, prev[1], last[1], period, previousPeriod, minBefore, p.lon != null && p.lat != null ? { lon: p.lon, lat: p.lat } : undefined);
    if (r.changePct == null) {
      skipped++;
      continue;
    }
    rows.push(r);
  }
  const { up, down } = rank(rows, n);
  return {
    table: "ports",
    metric,
    unit: PORT_UNIT[metric],
    period,
    previousPeriod,
    up,
    down,
    compared: rows.length,
    skipped,
    provenance: provenance(source("bts-ports"), {
      kind: "published",
      seriesId: metric,
      period,
      retrievedAt: opts.retrievedAt,
      method: "before and after are BTS annual TOTAL volumes for the port; changeAbs = after - before; changePct = (after - before) / before * 100. Ports without both years are skipped.",
    }),
  };
}

// ---------------------------------------------------------------- CSV

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Movers as CSV: one row per mover, `direction` up or down, provenance in a trailing comment line. */
export function moversCsv(r: MoversResult): string {
  const lines = ["direction,rank,id,name,before,after,change_abs,change_pct,period,previous_period,lon,lat"];
  const push = (dir: "up" | "down", rows: MoverRow[]) =>
    rows.forEach((m, i) => lines.push([dir, i + 1, m.id, m.name, m.before ?? "", m.after ?? "", m.changeAbs ?? "", m.changePct?.toFixed(3) ?? "", m.period, m.previousPeriod ?? "", m.lon ?? "", m.lat ?? ""].map(csvCell).join(",")));
  push("up", r.up);
  push("down", r.down);
  lines.push(`# ${r.table} ${r.metric} (${r.unit}); ${r.provenance.source.publisher}, ${r.provenance.source.name}; ${r.provenance.method ?? ""}`);
  return lines.join("\n");
}
