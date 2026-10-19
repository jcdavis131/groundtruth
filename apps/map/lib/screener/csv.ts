// Screener rows as CSV: one header line with units, one row per entity,
// then provenance as `#` comment lines so the file says where every column
// came from (same quoting as lib/explore/export.ts).

import type { Provenance } from "@/lib/provenance/types";
import { citation } from "@/lib/provenance/types";
import type { FieldMeta } from "./fields";
import type { ScreenRow } from "./engine";

export interface CsvOptions {
  /** Fields to write, in order; defaults to every key present in the first row. */
  columns?: string[];
  /** Also write `<key>.pct` columns when rows carry percentile ranks. */
  percentiles?: boolean;
  /** ISO time of retrieval for the footer; defaults to now. */
  retrievedAt?: string;
  /** Query text echoed in the footer. */
  query?: string;
}

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Column header with unit and an estimate tag: `home.latest (USD)`, `momentum (index, estimate)`. */
export function csvHeader(key: string, meta: FieldMeta | undefined): string {
  if (!meta) return key;
  const parts: string[] = [];
  if (meta.unit) parts.push(meta.unit);
  if (meta.kind === "estimate") parts.push("estimate");
  return parts.length ? `${key} (${parts.join(", ")})` : key;
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  return v == null ? "" : String(v);
}

/** Rows -> CSV text with provenance footer. Never throws on an empty set: header and footer still print. */
export function screenCsv(rows: ScreenRow[], fields: FieldMeta[], provenance: Provenance[], opts: CsvOptions = {}): string {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const columns = opts.columns ?? (rows.length ? Object.keys(rows[0].values) : fields.map((f) => f.key));
  const header = ["id", "kind", "name", "lon", "lat", ...columns.map((k) => csvHeader(k, byKey.get(k)))];
  if (opts.percentiles) header.push(...columns.filter((k) => byKey.get(k)?.kind !== "string").map((k) => `${k}.pct (percentile 0-100)`));
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const cells: string[] = [r.id, r.kind, r.name, fmt(r.geo[0]), fmt(r.geo[1]), ...columns.map((k) => fmt(r.values[k]))];
    if (opts.percentiles) cells.push(...columns.filter((k) => byKey.get(k)?.kind !== "string").map((k) => fmt(r.pct?.[k])));
    lines.push(cells.map(csvCell).join(","));
  }
  const retrieved = opts.retrievedAt ?? new Date().toISOString();
  lines.push(`# Embedding Atlas screener export, ${rows.length} rows, retrieved ${retrieved}`);
  if (opts.query) lines.push(`# query: ${opts.query.replace(/[\r\n]+/g, " ")}`);
  const seen = new Set<string>();
  for (const p of provenance) {
    const line = citation(p, retrieved);
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(`# source: ${line}`);
  }
  const estimates = columns.map((k) => byKey.get(k)).filter((m): m is FieldMeta => !!m && m.kind === "estimate");
  for (const m of estimates) lines.push(`# estimate ${m.key}: ${m.method ?? "computed from published values"}`);
  lines.push("# Empty cells are values the upstream did not publish; nothing is imputed.");
  return lines.join("\n");
}
