// Small pure helpers over Provenance lists: de-duplicate what several
// sections of a report pulled from the same release, turn a list into
// citation lines, and stamp times. Shared by the economy and water report
// builders and the route handlers; no React, no network.

import { citation, type Provenance } from "./types";

/** Identity of a provenance record for de-duplication: same source, series, period, kind and method. */
export function provenanceKey(p: Provenance): string {
  return [p.source.id, p.seriesId ?? "", p.period ?? "", p.kind, p.method ?? ""].join("|");
}

/** Keep the first record for each key; order of first appearance is preserved. */
export function dedupeProvenance(lists: Array<Provenance[] | undefined | null>): Provenance[] {
  const seen = new Map<string, Provenance>();
  for (const list of lists) for (const p of list ?? []) if (!seen.has(provenanceKey(p))) seen.set(provenanceKey(p), p);
  return [...seen.values()];
}

/** Unique citation lines in first-appearance order. */
export function citationsOf(list: Provenance[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    const c = citation(p);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** ISO 8601 for an epoch-ms `now` (the report builders take a number). */
export function iso(now: number): string {
  return new Date(now).toISOString();
}

/** "2026 Q1" (as QCEW files label it) -> "2026-Q1"; anything else passes through. */
export function quarterPeriod(period: string | null | undefined): string | undefined {
  if (!period) return undefined;
  const m = period.match(/^(\d{4})\s*Q([1-4])$/i);
  return m ? `${m[1]}-Q${m[2]}` : period;
}

/** "2026-07-31" (a Zillow month column) -> "2026-07"; a bare year or month passes through. */
export function monthPeriod(date: string | null | undefined): string | undefined {
  if (!date) return undefined;
  const m = date.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : date;
}
