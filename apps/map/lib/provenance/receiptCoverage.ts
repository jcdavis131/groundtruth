// STUB for the red commit: the exported shape the tests compile against, with no behaviour yet. The next commit
// replaces it with the count (valued lines, and those with publisher + upstreamRecordUrl + retrievedAt) and the
// report. Relative imports only, so a plain-Node script can load it (scripts/cite-load.mjs registers the hook).

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

export function hasReceipt(it: CoverageItem): boolean {
  void it;
  return false;
}

export function coverageOf(file: string, items: CoverageItem[]): FileCoverage {
  void items;
  return { file, valued: 0, covered: 0, aboutEye: 0, nulls: 0, uncovered: [] };
}

export function totalOf(rows: FileCoverage[]): FileCoverage {
  void rows;
  return { file: "total", valued: 0, covered: 0, aboutEye: 0, nulls: 0, uncovered: [] };
}

export function share(c: Pick<FileCoverage, "covered" | "valued">): string {
  void c;
  return "n/a";
}

export interface CoverageResult {
  code: number;
  text: string;
  rows: FileCoverage[];
  total: FileCoverage;
}

export async function runReceiptCoverage(argv: string[]): Promise<CoverageResult> {
  void argv;
  return { code: 0, text: "", rows: [], total: totalOf([]) };
}
