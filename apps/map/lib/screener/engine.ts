// Pure evaluation of a screener query over GeoJSON features: filter, sort,
// page, then summarize. No network, no store, no Cesium, so the same code
// runs in the route (server-side over every county) and in tests.
//
// Missing values never match a numeric comparison and always sort last,
// whichever direction was asked; a gap in the upstream stays a gap.

import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { entityKindOf, featureGeo, fieldsFor, type EntityKind, type FieldDef, type FieldValue } from "./fields";
import { fieldsInQuery, isCondition, MAX_LIMIT, type Clause, type Condition, type Query, type Scalar, type SortKey } from "./query";

export interface ScreenRow {
  /** Feature id inside its layer ("county:48029", "port:7950"). */
  id: string;
  layer: LayerId;
  kind: EntityKind;
  name: string;
  /** [lon, lat] to fly to: the polygon anchor or the point. */
  geo: [number, number];
  values: Record<string, FieldValue>;
  /** Percentile rank (0..100) of each numeric value within the filtered set, when asked for. */
  pct?: Record<string, number | null>;
}

export interface FieldStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export interface ScreenResult {
  rows: ScreenRow[];
  /** Rows that matched before limit / offset. */
  total: number;
  /** The query as evaluated (limit clamped). */
  applied: Query;
  /** Fields the query filtered or sorted on. */
  fieldsUsed: string[];
  /** Per numeric field, over every matching row (not just the page). */
  stats: Record<string, FieldStats>;
}

export interface ScreenOptions {
  /** Registry to read; inferred from the first feature's `kind` when omitted. */
  kind?: EntityKind;
  /** Restrict `values` to these keys (default: every field of the kind). */
  columns?: string[];
  /** Attach percentile ranks per numeric field. */
  percentiles?: boolean;
}

const DEFAULT_LIMIT = 100;

// ---------------------------------------------------------------- predicates

function num(v: FieldValue): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function eq(a: FieldValue, b: Scalar): boolean {
  if (a == null) return false;
  if (typeof a === "number") return typeof b === "number" ? a === b : Number(b) === a && b.trim() !== "";
  return typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : String(a) === String(b);
}

/** Does one value satisfy one condition? Nulls fail everything except `!=`. */
export function test(v: FieldValue, c: Condition): boolean {
  const list = Array.isArray(c.value) ? c.value : [c.value];
  switch (c.op) {
    case "==":
      return eq(v, list[0]);
    case "!=":
      return v != null && !eq(v, list[0]);
    case "in":
      return list.some((x) => eq(v, x));
    case "contains":
      return typeof v === "string" && v.toLowerCase().includes(String(list[0]).toLowerCase());
    case "between": {
      const x = num(v);
      const lo = typeof list[0] === "number" ? list[0] : NaN;
      const hi = typeof list[1] === "number" ? list[1] : NaN;
      return x != null && Number.isFinite(lo) && Number.isFinite(hi) && x >= Math.min(lo, hi) && x <= Math.max(lo, hi);
    }
    default: {
      const x = num(v);
      const y = typeof list[0] === "number" ? list[0] : NaN;
      if (x == null || !Number.isFinite(y)) return false;
      if (c.op === ">") return x > y;
      if (c.op === ">=") return x >= y;
      if (c.op === "<") return x < y;
      return x <= y;
    }
  }
}

function evalClause(c: Clause, values: Record<string, FieldValue>): boolean {
  if (isCondition(c)) return test(values[c.field] ?? null, c);
  if (c.or) return c.or.length === 0 ? true : c.or.some((k) => evalClause(k, values));
  return (c.and ?? []).every((k) => evalClause(k, values));
}

/** True when every top-level clause holds (an empty where matches everything). */
export function matches(where: Clause[] | undefined, values: Record<string, FieldValue>): boolean {
  return (where ?? []).every((c) => evalClause(c, values));
}

// ---------------------------------------------------------------- ordering

/** Compare two values for a sort key; nulls last in both directions, strings case-insensitive. */
export function compareValues(a: FieldValue, b: FieldValue, dir: SortKey["dir"]): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  let r: number;
  if (typeof a === "number" && typeof b === "number") r = a - b;
  else r = String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  return dir === "desc" ? -r : r;
}

export function sortRows<T extends { values: Record<string, FieldValue>; id: string }>(rows: T[], sort: SortKey[] | undefined): T[] {
  if (!sort?.length) return rows;
  return [...rows].sort((x, y) => {
    for (const s of sort) {
      const r = compareValues(x.values[s.field] ?? null, y.values[s.field] ?? null, s.dir);
      if (r !== 0) return r;
    }
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------- statistics

/** Linear-interpolated quantile of a sorted array, q in 0..1. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** n, min, quartiles, max of the numbers present; null when nothing is present. */
export function summarize(values: FieldValue[]): FieldStats | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  return { n: xs.length, min: xs[0], p25: quantile(xs, 0.25), median: quantile(xs, 0.5), p75: quantile(xs, 0.75), max: xs[xs.length - 1] };
}

/**
 * Percentile rank of each value among the non-null values, 0..100, where the
 * smallest is 0 and the largest 100. Ties share the average of the ranks
 * they span (1-based), so [1, 2, 2, 3] -> [0, 50, 50, 100]. A lone value is 100.
 */
export function percentileRanks(values: FieldValue[]): Array<number | null> {
  const idx: number[] = [];
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) idx.push(i);
  });
  const out: Array<number | null> = values.map(() => null);
  const n = idx.length;
  if (n === 0) return out;
  idx.sort((a, b) => (values[a] as number) - (values[b] as number));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    const avgRank = (i + 1 + (j + 1)) / 2;
    const pct = n === 1 ? 100 : ((avgRank - 1) / (n - 1)) * 100;
    for (let k = i; k <= j; k++) out[idx[k]] = pct;
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------- screen

/** Read every registry field off one feature into a flat record. */
export function readValues(f: LayerFeature, fields: FieldDef[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const d of fields) {
    let v: FieldValue = null;
    try {
      v = d.get(f);
    } catch {
      // A malformed feature yields a gap, not a crash: the row is still screenable on its other fields.
      v = null;
    }
    out[d.key] = typeof v === "number" && !Number.isFinite(v) ? null : v;
  }
  return out;
}

/** One row per feature that has a position; features of another kind are skipped. */
export function toRows(features: LayerFeature[], kind: EntityKind, fields: FieldDef[]): ScreenRow[] {
  const rows: ScreenRow[] = [];
  for (const f of features) {
    const k = entityKindOf(f);
    if (k !== kind) continue;
    const geo = featureGeo(f);
    if (!geo) continue;
    rows.push({ id: f.properties.id, layer: f.properties.layer, kind, name: f.properties.name, geo, values: readValues(f, fields) });
  }
  return rows;
}

/**
 * Filter, sort and page features by a validated query. The query must have
 * passed validateQuery() against the same registry; unknown fields here just
 * read as null (which never matches).
 */
export function screen(features: LayerFeature[], query: Query, opts: ScreenOptions = {}): ScreenResult {
  const kind = opts.kind ?? (features.length ? entityKindOf(features[0]) : null);
  if (!kind) return { rows: [], total: 0, applied: query, fieldsUsed: fieldsInQuery(query), stats: {} };
  const fields = fieldsFor(kind);
  const all = toRows(features, kind, fields);
  const matched = all.filter((r) => matches(query.where, r.values));
  const sorted = sortRows(matched, query.sort);
  const limit = Math.max(0, Math.min(MAX_LIMIT, Math.floor(query.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const applied: Query = { ...query, limit, offset };
  const numeric = fields.filter((d) => d.kind !== "string");
  const stats: Record<string, FieldStats> = {};
  for (const d of numeric) {
    const s = summarize(matched.map((r) => r.values[d.key]));
    if (s) stats[d.key] = s;
  }
  let pct: Map<string, Record<string, number | null>> | null = null;
  if (opts.percentiles) {
    pct = new Map(sorted.map((r) => [r.id, {}]));
    for (const d of numeric) {
      const ranks = percentileRanks(sorted.map((r) => r.values[d.key]));
      sorted.forEach((r, i) => (pct!.get(r.id)![d.key] = ranks[i]));
    }
  }
  const keep = opts.columns;
  const page = sorted.slice(offset, offset + limit).map((r) => {
    const row: ScreenRow = keep ? { ...r, values: Object.fromEntries(keep.filter((k) => k in r.values).map((k) => [k, r.values[k]])) } : { ...r };
    if (pct) row.pct = pct.get(r.id);
    return row;
  });
  return { rows: page, total: matched.length, applied, fieldsUsed: fieldsInQuery(query), stats };
}

/** Top n features by one field (missing values excluded), as rows. */
export function rank(features: LayerFeature[], field: string, dir: SortKey["dir"] = "desc", n = 10, kind?: EntityKind): ScreenRow[] {
  const k = kind ?? (features.length ? entityKindOf(features[0]) : null);
  if (!k) return [];
  const rows = toRows(features, k, fieldsFor(k)).filter((r) => r.values[field] != null);
  return sortRows(rows, [{ field, dir }]).slice(0, Math.max(0, n));
}
