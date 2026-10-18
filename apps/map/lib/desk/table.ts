// Pure helpers behind the desk-mode data table: flattening layer features
// into rows, deriving typed columns, sorting, windowing and CSV / TSV output.
// No React, no Cesium, no DOM, so every branch is unit-testable.

import type { LayerFeature, LayerId } from "@/lib/layers/types";
import type { AreaExtra, CrossingExtra, PortExtra } from "@/lib/economy/features";

/** A cell: numbers stay numbers so sorting and CSV keep their precision. */
export type Cell = string | number | boolean | null;

export interface Row {
  /** Stable key: `<layer>:<id>`. */
  key: string;
  layer: LayerId;
  id: string;
  cells: Record<string, Cell>;
}

export interface Column {
  key: string;
  label: string;
  /** Unit shown in the header and appended to the CSV header ("USD", "%", "jobs"). */
  unit?: string;
  kind: "number" | "string" | "boolean";
  /** Header-only hint for narrow columns. */
  width?: number;
}

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

/** Layers the desk table shows by default: the economy stack. */
export const ECONOMY_LAYERS: LayerId[] = ["trade", "commerce", "realestate", "companies", "banks", "spending"];

/** Column metadata for the fields the flattener knows about; anything else gets a label from its key. */
const KNOWN: Record<string, { label: string; unit?: string }> = {
  layer: { label: "Layer" },
  id: { label: "Id" },
  name: { label: "Name" },
  kind: { label: "Kind" },
  lon: { label: "Lon", unit: "°" },
  lat: { label: "Lat", unit: "°" },
  source: { label: "Source" },
  observedAt: { label: "Observed" },
  geoid: { label: "GEOID" },
  level: { label: "Level" },
  state: { label: "State" },
  metro: { label: "Metro" },
  zhvi: { label: "Home value", unit: "USD" },
  zhviAsOf: { label: "ZHVI as of" },
  zhvi1y: { label: "Home 1-yr", unit: "%" },
  zhvi5y: { label: "Home 5-yr", unit: "%" },
  zori: { label: "Rent", unit: "USD/mo" },
  zori1y: { label: "Rent 1-yr", unit: "%" },
  priceToRent: { label: "Price/rent", unit: "×" },
  qcewPeriod: { label: "QCEW period" },
  jobs: { label: "Jobs" },
  employers: { label: "Employers" },
  weeklyWage: { label: "Avg weekly wage", unit: "USD" },
  jobs1y: { label: "Jobs 1-yr", unit: "%" },
  wage1y: { label: "Wage 1-yr", unit: "%" },
  suppressed: { label: "Suppressed" },
  country: { label: "Country" },
  harbourSize: { label: "Harbour size" },
  locode: { label: "LOCODE" },
  btsYear: { label: "BTS year" },
  teu: { label: "Containers", unit: "TEU" },
  teuRank: { label: "TEU rank" },
  tons: { label: "Tonnage", unit: "t" },
  tonsRank: { label: "Tonnage rank" },
  border: { label: "Border" },
  asOf: { label: "As of" },
  trucks: { label: "Trucks", unit: "/mo" },
  trucks1y: { label: "Trucks 1-yr", unit: "%" },
};

function labelFor(key: string): string {
  const k = KNOWN[key];
  if (k) return k.label;
  // "avg_weekly_wage" / "avgWeeklyWage" -> "avg weekly wage"
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Numbers pass through; numeric strings become numbers so the column sorts as numbers. */
function cell(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
    return s;
  }
  return String(v);
}

function isArea(x: unknown): x is AreaExtra {
  return !!x && typeof x === "object" && "geoid" in x && "level" in x;
}
function isPort(x: unknown): x is PortExtra {
  return !!x && typeof x === "object" && "wpi" in x;
}
function isCrossing(x: unknown): x is CrossingExtra {
  return !!x && typeof x === "object" && "measures" in x && "border" in x;
}

/**
 * One flat row per feature. Base props first, then the typed extras the
 * economy layers carry (areas, ports, crossings), then the free-form
 * `details` the info panel shows. Never invents a value: a missing join is null.
 */
export function featureRow(f: LayerFeature): Row {
  const p = f.properties;
  const cells: Record<string, Cell> = {
    layer: p.layer,
    id: p.id,
    name: p.name,
    kind: p.kind ?? null,
  };
  const anchor = p.anchor ?? (f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : undefined);
  cells.lon = anchor ? Math.round(anchor[0] * 1e4) / 1e4 : null;
  cells.lat = anchor ? Math.round(anchor[1] * 1e4) / 1e4 : null;
  cells.source = p.source;
  if (p.observedAt != null) cells.observedAt = new Date(p.observedAt).toISOString();

  const x = p.extra;
  if (isArea(x)) {
    cells.geoid = x.geoid;
    cells.level = x.level;
    cells.state = x.stusab ?? x.stateName ?? null;
    cells.metro = x.metro ?? null;
    cells.zhvi = x.home ? Math.round(x.home.latest) : null;
    cells.zhviAsOf = x.home?.asOf ?? null;
    cells.zhvi1y = x.home?.yoyPct ?? null;
    cells.zhvi5y = x.home?.y5Pct ?? null;
    cells.zori = x.rent ? Math.round(x.rent.latest) : null;
    cells.zori1y = x.rent?.yoyPct ?? null;
    cells.priceToRent = x.home && x.rent && x.rent.latest > 0 ? Math.round((x.home.latest / (x.rent.latest * 12)) * 100) / 100 : null;
    cells.qcewPeriod = x.jobs?.period ?? null;
    cells.jobs = x.jobs?.emp ?? null;
    cells.employers = x.jobs?.estabs ?? null;
    cells.weeklyWage = x.jobs?.avgWeeklyWage ?? null;
    cells.jobs1y = x.jobs?.yoy.emp ?? null;
    cells.wage1y = x.jobs?.yoy.avgWeeklyWage ?? null;
    cells.suppressed = x.jobs ? x.jobs.suppressed : null;
  } else if (isPort(x)) {
    cells.country = x.wpi.country;
    cells.harbourSize = x.wpi.size ?? null;
    cells.locode = x.wpi.locode ?? null;
    cells.btsYear = x.stats?.year ?? null;
    cells.teu = x.stats?.container?.total ?? null;
    cells.teuRank = x.stats?.container?.ranking ?? null;
    cells.tons = x.stats?.tonnage?.total ?? null;
    cells.tonsRank = x.stats?.tonnage?.ranking ?? null;
  } else if (isCrossing(x)) {
    cells.state = x.state;
    cells.border = x.border;
    cells.asOf = x.asOf;
    const trucks = x.measures["Trucks"] ?? x.measures["trucks"];
    cells.trucks = trucks?.latest ?? null;
    cells.trucks1y = trucks?.yoyPct ?? null;
  }
  if (p.details) {
    for (const [k, v] of Object.entries(p.details)) {
      if (k in cells) continue;
      cells[k] = cell(v);
    }
  }
  return { key: `${p.layer}:${p.id}`, layer: p.layer, id: p.id, cells };
}

/** Rows for a list of features, in order. The outline of the box a land layer loaded is map furniture, not a row. */
export function featureRows(features: Iterable<LayerFeature>): Row[] {
  const out: Row[] = [];
  for (const f of features) if (f.properties.kind !== "loaded-box") out.push(featureRow(f));
  return out;
}

/**
 * Columns present in a set of rows, in first-seen order, typed by the values
 * they hold. A column with any number and no strings is numeric; entirely
 * empty columns are dropped so a sparse join does not widen the table.
 */
export function columnsFor(rows: Row[]): Column[] {
  const order: string[] = [];
  const seen = new Map<string, { num: number; str: number; bool: number }>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.cells)) {
      let s = seen.get(k);
      if (!s) {
        s = { num: 0, str: 0, bool: 0 };
        seen.set(k, s);
        order.push(k);
      }
      if (v == null) continue;
      if (typeof v === "number") s.num++;
      else if (typeof v === "boolean") s.bool++;
      else s.str++;
    }
  }
  const out: Column[] = [];
  for (const k of order) {
    const s = seen.get(k)!;
    if (s.num + s.str + s.bool === 0) continue;
    const kind: Column["kind"] = s.str > 0 ? "string" : s.num > 0 ? "number" : "boolean";
    out.push({ key: k, label: labelFor(k), unit: KNOWN[k]?.unit, kind });
  }
  return out;
}

function compare(a: Cell, b: Cell, kind: Column["kind"]): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls always sink to the bottom
  if (b == null) return -1;
  if (kind === "number" && typeof a === "number" && typeof b === "number") return a - b;
  if (kind === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Stable sort by one column. Nulls sink regardless of direction. */
export function sortRows(rows: Row[], sort: SortState | null, columns: Column[]): Row[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((p, q) => {
      const a = p.r.cells[col.key] ?? null;
      const b = q.r.cells[col.key] ?? null;
      if (a == null || b == null) return compare(a, b, col.kind) || p.i - q.i;
      return compare(a, b, col.kind) * dir || p.i - q.i;
    })
    .map((p) => p.r);
}

/** Next sort state when a header is clicked: asc → desc → off. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** Case-insensitive substring filter over every cell. */
export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => Object.values(r.cells).some((v) => v != null && String(v).toLowerCase().includes(q)));
}

export interface Window {
  /** First row index rendered (inclusive) and last (exclusive). */
  start: number;
  end: number;
  /** Spacer heights so the scrollbar reflects the whole list. */
  padTop: number;
  padBottom: number;
}

/**
 * Which rows to render for a scroll position. Simple fixed-height windowing:
 * `overscan` rows are drawn above and below the viewport so fast scrolling
 * shows content instead of blank space.
 */
export function windowRows(total: number, scrollTop: number, rowHeight: number, viewportHeight: number, overscan = 6): Window {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (total - end) * rowHeight };
}

/** CSV cell quoting per RFC 4180. */
export function csvCell(v: Cell): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** TSV cell: tabs and newlines collapse to spaces so Excel keeps one row per row. */
export function tsvCell(v: Cell): string {
  if (v == null) return "";
  return String(v).replace(/[\t\r\n]+/g, " ");
}

function header(c: Column): string {
  return c.unit ? `${c.label} (${c.unit})` : c.label;
}

/** Rows as CSV, header first, units in parentheses. */
export function toCsv(columns: Column[], rows: Row[]): string {
  const lines = [columns.map((c) => csvCell(header(c))).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r.cells[c.key] ?? null)).join(","));
  return lines.join("\n");
}

/** Rows as TSV for pasting into a spreadsheet. */
export function toTsv(columns: Column[], rows: Row[]): string {
  const lines = [columns.map((c) => tsvCell(header(c))).join("\t")];
  for (const r of rows) lines.push(columns.map((c) => tsvCell(r.cells[c.key] ?? null)).join("\t"));
  return lines.join("\n");
}

/** Display formatting for a cell: thousands separators, fixed decimals for small magnitudes. */
export function fmtCell(v: Cell, kind: Column["kind"]): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (kind === "number" && typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return Math.abs(v) >= 100 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(v);
}
