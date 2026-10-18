// The text alternatives to a chart: the data table every page renders under
// it, the CSV download, the full citations and the accessible description.
//
// The table holds every row of the spec, plotted or not. A row the chart
// could not plot (a null on a plotted encoding) is listed with "not
// published" in that cell (lib/brief/format.ts MISSING), never as 0 and never
// dropped. Citations are lib/provenance citation() for every record, full
// upstream URL included: the image prints a compact source line (frame.ts),
// and this is where a reader finds the exact file behind each number.
//
// Shapes mirror components/doc/FactTable.tsx (columns, rows of string cells,
// a caption) without importing it, so this module stays free of React and
// Next.js and runs in plain Node. The CSV follows lib/server/csv.ts (RFC 4180,
// `#` footer for provenance) but carries `as_of` from the spec instead of a
// wall-clock generated_at, so the same spec writes the same bytes.

import { num } from "@/lib/brief/format";
import { citation } from "@/lib/provenance/types";
import { csvComments, toCsv, type CsvRow } from "@/lib/server/csv";
import { formatValue, valueDigits } from "./scale";
import { byteCompare, toProvenance, type AxisSpec, type ChartSpec } from "./spec";

type Datum = ChartSpec["data"][number];

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Whether the chart can draw this row: every positional encoding is published. Size may be null (drawn as a dashed marker). */
export function isPlotted(spec: ChartSpec, d: Datum): boolean {
  switch (spec.kind) {
    case "bubble": {
      const b = d as Extract<ChartSpec, { kind: "bubble" }>["data"][number];
      return finite(b.x) && finite(b.y);
    }
    case "slope": {
      const s = d as Extract<ChartSpec, { kind: "slope" }>["data"][number];
      return finite(s.from) && finite(s.to);
    }
    case "bar":
      return finite((d as Extract<ChartSpec, { kind: "bar" }>["data"][number]).value);
    case "line":
      return (d as Extract<ChartSpec, { kind: "line" }>["data"][number]).series.some((p) => finite(p.v));
  }
}

/** Rows the chart cannot draw, by id. */
export function missingIds(spec: ChartSpec): string[] {
  return spec.data
    .filter((d) => !isPlotted(spec, d))
    .map((d) => d.id)
    .sort(byteCompare);
}

const fmt = (v: number | null | undefined, axis: Pick<AxisSpec, "format" | "digits">): string => formatValue(v, axis.format, valueDigits(axis.format, axis.digits));

/**
 * The <desc> and PNG alt text: a fixed template, numbers through
 * format.ts. It names the encodings, the plotted and missing counts and the
 * subject's values, and points to the table for the rest.
 */
export function describe(spec: ChartSpec): string {
  const total = spec.data.length;
  const plotted = total - missingIds(spec).length;
  const counts = `${num(plotted)} of ${num(total)} plotted; ${num(total - plotted)} not published.`;
  const subject = spec.subject === undefined ? undefined : spec.data.find((d) => d.id === spec.subject);
  let head: string;
  let subj = "";
  switch (spec.kind) {
    case "bubble": {
      head = `Bubble chart. Horizontal: ${spec.x.label}. Vertical: ${spec.y.label}. Bubble area: ${spec.size.label}; an outlined bubble is a negative value.`;
      const s = subject as (typeof spec.data)[number] | undefined;
      if (s) subj = ` ${s.fullLabel}: ${fmt(s.x, spec.x)} horizontal, ${fmt(s.y, spec.y)} vertical, ${fmt(s.size, spec.size)} bubble.`;
      break;
    }
    case "slope": {
      head = `Slope chart, ${spec.from} to ${spec.to}: ${spec.y.label}.`;
      const s = subject as (typeof spec.data)[number] | undefined;
      if (s) subj = ` ${s.fullLabel}: ${fmt(s.from, spec.y)} to ${fmt(s.to, spec.y)}.`;
      break;
    }
    case "bar": {
      head = `Bar chart: ${spec.value.label}.`;
      const s = subject as (typeof spec.data)[number] | undefined;
      if (s) subj = ` ${s.fullLabel}: ${fmt(s.value, spec.value)}.`;
      break;
    }
    case "line": {
      head = `Line chart: ${spec.y.label}.`;
      const s = subject as (typeof spec.data)[number] | undefined;
      const last = s ? [...s.series].reverse().find((p) => finite(p.v)) : undefined;
      if (s && last) subj = ` ${s.fullLabel}: ${fmt(last.v, spec.y)} in ${last.t}.`;
      break;
    }
  }
  return `${head} ${counts}${subj} Full data in the table below.`;
}

export interface TableColumn {
  key: string;
  label: string;
  align: "left" | "right";
}

export interface TableRow {
  key: string;
  cells: string[];
}

export interface ChartTable {
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** fullLabel of every row the chart could not plot. */
  missing: string[];
  /** citation() of every provenance record, de-duplicated, in key order. */
  citations: string[];
  csv: string;
}

interface Col {
  key: string;
  label: string;
  align: "left" | "right";
  /** Display text for the page table. */
  show: (d: Datum) => string;
  /** Raw value for the CSV: numbers unformatted, null as an empty cell. */
  raw: (d: Datum) => string | number | null;
}

function columnsFor(spec: ChartSpec): Col[] {
  const name: Col = { key: "name", label: "Name", align: "left", show: (d) => d.fullLabel, raw: (d) => d.fullLabel };
  const numeric = <D extends Datum>(key: string, label: string, axis: Pick<AxisSpec, "format" | "digits">, get: (d: D) => number | null): Col => ({
    key,
    label,
    align: "right",
    show: (d) => fmt(get(d as D), axis),
    raw: (d) => get(d as D),
  });
  switch (spec.kind) {
    case "bubble": {
      type D = (typeof spec.data)[number];
      return [name, numeric<D>("x", spec.x.label, spec.x, (d) => d.x), numeric<D>("y", spec.y.label, spec.y, (d) => d.y), numeric<D>("size", spec.size.label, spec.size, (d) => d.size)];
    }
    case "slope": {
      type D = (typeof spec.data)[number];
      return [name, numeric<D>("from", `${spec.y.label}, ${spec.from}`, spec.y, (d) => d.from), numeric<D>("to", `${spec.y.label}, ${spec.to}`, spec.y, (d) => d.to)];
    }
    case "bar": {
      type D = (typeof spec.data)[number];
      return [name, numeric<D>("value", spec.value.label, spec.value, (d) => d.value)];
    }
    case "line": {
      type D = (typeof spec.data)[number];
      const periods = [...new Set(spec.data.flatMap((d) => d.series.map((p) => p.t)))].sort(byteCompare);
      return [name, ...periods.map((t) => numeric<D>(t, t, spec.y, (d) => d.series.find((p) => p.t === t)?.v ?? null))];
    }
  }
}

/** Every record's citation, once each, in provenance-key order. */
export function citations(spec: ChartSpec): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of Object.keys(spec.provenance).sort(byteCompare)) {
    const c = citation(toProvenance(spec.provenance[key]));
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export function chartTable(spec: ChartSpec): ChartTable {
  const cols = columnsFor(spec);
  const data = [...spec.data].sort((a, b) => byteCompare(a.fullLabel, b.fullLabel) || byteCompare(a.id, b.id));
  const missingSet = new Set(missingIds(spec));
  const plotted = data.length - missingSet.size;
  const cites = citations(spec);
  const missing = data.filter((d) => missingSet.has(d.id)).map((d) => d.fullLabel);

  const csvRows: CsvRow[] = data.map((d) => {
    const row: CsvRow = { id: d.id };
    for (const c of cols) row[c.label] = c.raw(d);
    return row;
  });
  const footer = [`as_of: ${spec.asOf}`, ...cites.map((c) => `source: ${c}`)];
  if (missing.length) footer.push(`not published: ${missing.join("; ")}`);
  const csv = `${toCsv(csvRows, ["id", ...cols.map((c) => c.label)])}\r\n${csvComments(footer)}\r\n`;

  return {
    caption: `${spec.universe}. ${num(plotted)} of ${num(data.length)} with published figures.`,
    columns: cols.map((c) => ({ key: c.key, label: c.label, align: c.align })),
    rows: data.map((d) => ({ key: d.id, cells: cols.map((c) => c.show(d)) })),
    missing,
    citations: cites,
    csv,
  };
}
