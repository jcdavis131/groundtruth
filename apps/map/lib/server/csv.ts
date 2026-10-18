// RFC 4180 writer for the `format=csv` side of the API. Pure and tiny so the
// flatteners in lib/economy/flatten.ts and lib/water/flatten.ts can be tested
// against exact bytes. The reader for upstream CSVs lives in lib/economy/csv.ts.
//
// Rules: CRLF between records, a header row, a cell is quoted only when it
// holds a comma, a quote, CR or LF, and quotes inside a quoted cell are
// doubled. null / undefined are empty cells (never "null", never 0); objects
// and arrays are JSON so nothing is silently lost.

export type CsvRow = Record<string, unknown>;

/** One CSV cell, quoted only when RFC 4180 requires it. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number") s = Number.isFinite(v) ? String(v) : "";
  else if (typeof v === "boolean") s = v ? "true" : "false";
  else if (v instanceof Date) s = Number.isNaN(v.getTime()) ? "" : v.toISOString();
  else s = JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Column order: the caller's list, else every key in first-seen order across the rows. */
export function csvColumns(rows: CsvRow[], columns?: string[]): string[] {
  if (columns && columns.length) return columns;
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

/**
 * Rows to an RFC 4180 document (header row first, CRLF line endings, no
 * trailing newline). A missing key is an empty cell.
 */
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  const cols = csvColumns(rows, columns);
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n");
}

/**
 * `#` comment lines for the tail of a CSV file (pandas: `comment="#"`).
 * Each line is a single record so a reader that does not strip comments still
 * sees one cell per line; embedded newlines are collapsed.
 */
export function csvComments(lines: string[]): string {
  return lines.map((l) => "# " + l.replace(/[\r\n]+/g, " ")).join("\r\n");
}
