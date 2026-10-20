// Reads the committed companies snapshot. On disk it is "companies/2-compact"
// (written by scripts/companies-compact.mjs, which scripts/companies-data.mjs
// calls): companies as rows in `columns` order, facts as tuples
// [conceptKeyIndex, value, period, end, accn, conceptIndex] with a table of
// XBRL concept names, a null fact left out, and one bundle-level `pulled`
// (plus `pulledByCik` for any company pulled on another day).
// This expands it back into CompanyBundle, so nothing downstream changes.
// The older full format (an object per company, as the 25-company fixture is
// written) passes through as is. Keep in step with the encoder.

import type { CompanyBundle, CompanyRecord, ConceptKey, FactValue } from "./types";

export const COMPACT_FORMAT = "companies/2-compact";

type FactTuple = [number, number, string, string, string | null, number | null];

export interface CompactBundle {
  format: typeof COMPACT_FORMAT;
  source: string;
  pulled: string | null;
  counts: CompanyBundle["counts"];
  frameYears?: number[];
  /** Record fields in row order; the row's last cell is its fact tuples. */
  columns: string[];
  factKeys: ConceptKey[];
  factFields: string[];
  /** XBRL concept names a tuple's last cell indexes. */
  concepts: string[];
  /** Pull dates of companies pulled on a different day from the bundle's `pulled`. */
  pulledByCik?: Record<string, string | null>;
  companies: unknown[][];
}

/** Compact or full on-disk bundle -> CompanyBundle. Throws on a format it does not know rather than guess. */
export function decodeBundle(raw: unknown): CompanyBundle {
  const b = raw as Partial<CompactBundle> & { format?: unknown };
  if (b.format === undefined) return raw as CompanyBundle;
  if (b.format !== COMPACT_FORMAT) throw new Error(`companies bundle: unknown format ${String(b.format)}`);
  const c = b as CompactBundle;
  const n = c.columns.length;
  return {
    source: c.source,
    pulled: c.pulled,
    counts: c.counts,
    ...(c.frameYears ? { frameYears: c.frameYears } : {}),
    companies: c.companies.map((row) => {
      const rec: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) rec[c.columns[i]] = row[i];
      const facts = Object.fromEntries(c.factKeys.map((k) => [k, null])) as Record<ConceptKey, FactValue | null>;
      for (const [ki, value, period, end, accn, ci] of row[n] as FactTuple[]) {
        const f: FactValue = { value, period, end };
        if (accn != null) f.accn = accn;
        if (ci != null) f.concept = c.concepts[ci];
        facts[c.factKeys[ki]] = f;
      }
      rec.facts = facts;
      const cik = String(rec.cik);
      rec.pulled = c.pulledByCik && cik in c.pulledByCik ? c.pulledByCik[cik] : c.pulled;
      return rec as unknown as CompanyRecord;
    }),
  };
}
