// Receipt coverage: of the valued lines world_context emits for the recorded fixtures, how many carry a receipt,
// that is a publisher, the publisher's own URL for the record (upstreamRecordUrl) and when it was retrieved.
// scripts/receipt-coverage.mjs is the wrapper; map-ci prints its report on every pull request.
//
// What is counted, so the number can be recomputed by hand:
//   - A line is valued when its value is not null. A null line carries a note saying why and is listed apart.
//   - A line of kind "about-eye" is a claim about eye's own catalogue, which has no publisher record by the world/2
//     schema; it is not a world fact, so it is not in the denominator, and it is listed apart.
//   - A valued line is covered when publisher, upstreamRecordUrl (an https URL) and retrievedAt are all non-empty.
//     Covered means the three fields are there; it does not mean cite-check CONFIRMED the line (scripts/cite-check.mjs
//     does that).
// Reporting only: the exit code is 0 unless --min is given and the total share is below it (then 1); a file that
// cannot be read, or a bad flag, is 2. The bar for gating is 95 percent (RECEIPT_BAR); the total is below it today.
//
// Loads items with lib/cite/cli.ts loadItems, the loader cite-check uses. Relative imports only, so a plain-Node
// script can load it (scripts/cite-load.mjs registers the resolve hook).

import { readdirSync } from "node:fs";
import path from "node:path";
import { loadItems } from "../cite/cli";
import { WORLD_FIXTURES } from "../cite/worldItems";

/** The share at which the metric may start to gate. Below it, the report only reports. */
export const RECEIPT_BAR = 95;

/** The fields of a world_context item this reads (a WorldItem has these and more). */
export interface CoverageItem {
  fact: string;
  value: unknown;
  sourceId?: string;
  publisher?: unknown;
  upstreamRecordUrl?: unknown;
  retrievedAt?: unknown;
  kind?: unknown;
}

export interface Uncovered {
  sourceId: string;
  fact: string;
}

export interface FileCoverage {
  file: string;
  valued: number;
  covered: number;
  aboutEye: number;
  nulls: number;
  uncovered: Uncovered[];
}

const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** A valued line is covered when it names its publisher, the publisher's record URL and when it was retrieved. */
export function hasReceipt(it: CoverageItem): boolean {
  return text(it.publisher) && text(it.upstreamRecordUrl) && it.upstreamRecordUrl.startsWith("https://") && text(it.retrievedAt);
}

export function coverageOf(file: string, items: CoverageItem[]): FileCoverage {
  const out: FileCoverage = { file, valued: 0, covered: 0, aboutEye: 0, nulls: 0, uncovered: [] };
  for (const it of items) {
    if (it.kind === "about-eye") out.aboutEye++;
    else if (it.value === null || it.value === undefined) out.nulls++;
    else {
      out.valued++;
      if (hasReceipt(it)) out.covered++;
      else out.uncovered.push({ sourceId: text(it.sourceId) ? it.sourceId : "(no sourceId)", fact: it.fact });
    }
  }
  return out;
}

export function totalOf(rows: FileCoverage[]): FileCoverage {
  const t: FileCoverage = { file: "total", valued: 0, covered: 0, aboutEye: 0, nulls: 0, uncovered: [] };
  for (const r of rows) {
    t.valued += r.valued;
    t.covered += r.covered;
    t.aboutEye += r.aboutEye;
    t.nulls += r.nulls;
    t.uncovered.push(...r.uncovered);
  }
  return t;
}

/** Share in percent to one decimal, or "n/a" when nothing is valued. */
export function share(c: Pick<FileCoverage, "covered" | "valued">): string {
  return c.valued === 0 ? "n/a" : `${((100 * c.covered) / c.valued).toFixed(1)}%`;
}

export interface CoverageResult {
  code: number;
  text: string;
  rows: FileCoverage[];
  total: FileCoverage;
}

const USAGE = "usage: node scripts/receipt-coverage.mjs [--min <percent>] [--list] [input.json ...]\n";

export async function runReceiptCoverage(argv: string[]): Promise<CoverageResult> {
  const empty = totalOf([]);
  const fail = (msg: string): CoverageResult => ({ code: 2, text: `${msg}\n${USAGE}`, rows: [], total: empty });
  let min: number | null = null;
  let list = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") list = true;
    else if (a === "--min" || a.startsWith("--min=")) {
      const raw = a === "--min" ? argv[++i] : a.slice("--min=".length);
      const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) return fail(`--min needs a percent from 0 to 100, got ${raw === undefined ? "nothing" : `"${raw}"`}`);
      min = n;
    } else if (a.startsWith("--")) return fail(`unknown flag ${a}`);
    else files.push(a);
  }
  const inputs = files.length ? files : readdirSync(WORLD_FIXTURES).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(WORLD_FIXTURES, f));
  const rows: FileCoverage[] = [];
  for (const f of inputs) {
    try {
      rows.push(coverageOf(path.basename(f), (await loadItems(f)) as CoverageItem[]));
    } catch (err) {
      return fail(`${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const total = totalOf(rows);
  const w = Math.max(8, ...rows.map((r) => r.file.length));
  const cell = (c: FileCoverage) => `${c.covered}/${c.valued}`;
  const lines = [
    "receipt coverage: valued lines that carry publisher + upstreamRecordUrl + retrievedAt",
    "valued = value not null; about-eye lines and null-valued lines are not in the count and are listed apart",
    "",
    `${"fixture".padEnd(w)}  ${"covered/valued".padStart(14)}  ${"share".padStart(6)}  ${"about-eye".padStart(9)}  ${"null".padStart(4)}`,
    ...[...rows, total].map((r) => `${r.file.padEnd(w)}  ${cell(r).padStart(14)}  ${share(r).padStart(6)}  ${String(r.aboutEye).padStart(9)}  ${String(r.nulls).padStart(4)}`),
  ];
  const bySource = new Map<string, number>();
  for (const u of total.uncovered) bySource.set(u.sourceId, (bySource.get(u.sourceId) ?? 0) + 1);
  if (bySource.size) {
    lines.push("", `uncovered valued lines by source (${total.uncovered.length}):`);
    for (const [id, n] of [...bySource].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) lines.push(`  ${id.padEnd(22)} ${n}`);
  }
  if (list) {
    lines.push("", "uncovered valued lines (fixture | source | fact):");
    for (const r of rows) for (const u of r.uncovered) lines.push(`  ${r.file} | ${u.sourceId} | ${u.fact}`);
  }
  const pct = total.valued === 0 ? 0 : (100 * total.covered) / total.valued;
  let code = 0;
  lines.push("");
  if (min !== null && pct < min) {
    code = 1;
    lines.push(`gate: total ${share(total)} is below --min ${min}: exit 1`);
  } else if (min !== null) {
    lines.push(`gate: total ${share(total)} meets --min ${min}`);
  } else {
    lines.push(`bar ${RECEIPT_BAR}%: total ${share(total)} is ${pct >= RECEIPT_BAR ? "at or above" : "below"} it; reporting only, no --min given (exit 0)`);
  }
  return { code, text: lines.join("\n") + "\n", rows, total };
}
