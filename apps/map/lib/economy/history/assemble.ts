// Puts the pieces together for the history route: trims every series to the
// requested window, computes the backfilled indices on the full history (so
// the first month of the window still has its 12-month base), collects
// provenance and caveats. Pure; the route does the fetching.

import type { Provenance } from "@/lib/provenance/types";
import type { Series } from "@/lib/series/types";
import { addMonths, monthEndOf, window } from "./align";
import { affordabilityHistory, momentumHistory } from "./indices";
import type { QcewHistory } from "./qcewHistory";

export interface HistoryInputs {
  zhvi: Series | null;
  zori: Series | null;
  qcew: QcewHistory | null;
  mortgage: Series | null;
}

export interface HistoryBundle {
  series: Series[];
  provenance: Provenance[];
  caveats: string[];
}

export interface AssembleOptions {
  /** Window length in years back from `now`. */
  years: number;
  now: number;
  /** Publication lag applied to quarterly inputs in the indices. */
  lagMonths?: number;
}

/** One provenance record per distinct (source, seriesId, kind, method). */
export function dedupeProvenance(series: Series[]): Provenance[] {
  const seen = new Map<string, Provenance>();
  for (const s of series) {
    const p = s.provenance;
    const key = [p.source.id, p.seriesId ?? "", p.kind, p.method ?? ""].join("|");
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

export function assembleHistory(inputs: HistoryInputs, opts: AssembleOptions): HistoryBundle {
  const caveats: string[] = [];
  const from = addMonths(monthEndOf(opts.now), -opts.years * 12);
  const out: Series[] = [];
  const { zhvi, zori, qcew, mortgage } = inputs;
  if (!zhvi) caveats.push("No Zillow ZHVI row for this area; momentum and affordability are not computed.");
  if (!zori) caveats.push("No Zillow ZORI row for this area (ZORI covers fewer areas than ZHVI and starts in 2015); rent term and price-to-rent are absent.");
  if (!mortgage) caveats.push("FRED MORTGAGE30US did not answer; payment and wage-share series are absent.");
  if (!qcew) caveats.push("BLS QCEW did not answer; jobs and wage terms are absent.");
  else if (qcew.missing.length) caveats.push(`BLS QCEW had no total row for ${qcew.missing.length} quarter(s): ${qcew.missing.join(", ")}.`);
  if (zhvi) out.push(zhvi);
  if (zori) out.push(zori);
  if (qcew) out.push(qcew.emp, qcew.avgWeeklyWage, qcew.estabs, qcew.empYoY, qcew.wageYoY, qcew.estabsYoY);
  if (mortgage) out.push(mortgage);
  if (zhvi) {
    out.push(momentumHistory(zhvi, zori, qcew?.empYoY, qcew?.wageYoY, { lagMonths: opts.lagMonths }));
    if (mortgage) {
      const a = affordabilityHistory(zhvi, mortgage, qcew?.avgWeeklyWage, zori, { lagMonths: opts.lagMonths });
      out.push(a.payment);
      if (a.wageShare) out.push(a.wageShare);
      if (a.priceToRent) out.push(a.priceToRent);
    }
  }
  caveats.push(
    "Momentum and affordability are labelled estimates computed from published values; quarterly QCEW terms are carried forward from the quarter's period end" +
      (opts.lagMonths ? ` shifted ${opts.lagMonths} months for publication lag` : " (no publication lag applied; pass lag=5 to mimic release timing)") +
      ".",
  );
  const series = out.map((s) => ({ ...s, points: window(s.points, from) }));
  return { series, provenance: dedupeProvenance(series), caveats };
}
