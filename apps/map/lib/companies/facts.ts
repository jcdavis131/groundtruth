// Selecting numbers from XBRL company facts. A companyfacts file lists every
// value a filer ever tagged for a concept, across forms and restatements; the
// rules here pick one annual value per fiscal year and the latest of those:
//
//   1. annual reports only: fp "FY" on a 10-K / 10-K/A / 20-F / 40-F
//   2. flows (income statement) must span a year: 350..380 days between
//      start and end, so a 10-K's quarterly comparatives are not mistaken
//      for the year
//   3. one value per period end: the latest `filed` wins, so a restated
//      figure replaces the original
//   4. the frame the SEC assigned ("CY2024", "CY2024Q4I") is the period
//      label when present, else "FY<fy>"
//
// Ratios computed from two facts are estimates and say so with a formula.
// Pure: no network.

import type { Point, Series } from "@/lib/series/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { cikId, companyFactsUrl, factPoints } from "./edgar";
import type { CompanyFactsFile, ConceptKey, ConceptSpec, DerivedRatio, FactPoint, FactValue } from "./types";

/** The concepts the snapshot and the dossier carry, with the fallbacks filers commonly use instead. */
export const CONCEPTS: ConceptSpec[] = [
  { key: "Revenues", taxonomy: "us-gaap", concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], unit: "USD", instant: false, label: "Revenue" },
  { key: "NetIncomeLoss", taxonomy: "us-gaap", concepts: ["NetIncomeLoss", "ProfitLoss"], unit: "USD", instant: false, label: "Net income" },
  { key: "OperatingIncomeLoss", taxonomy: "us-gaap", concepts: ["OperatingIncomeLoss"], unit: "USD", instant: false, label: "Operating income" },
  { key: "Assets", taxonomy: "us-gaap", concepts: ["Assets"], unit: "USD", instant: true, label: "Total assets" },
  { key: "StockholdersEquity", taxonomy: "us-gaap", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "USD", instant: true, label: "Shareholders' equity" },
  { key: "CashAndCashEquivalentsAtCarryingValue", taxonomy: "us-gaap", concepts: ["CashAndCashEquivalentsAtCarryingValue"], unit: "USD", instant: true, label: "Cash" },
  { key: "LongTermDebt", taxonomy: "us-gaap", concepts: ["LongTermDebt", "LongTermDebtNoncurrent"], unit: "USD", instant: true, label: "Long-term debt" },
  { key: "EntityNumberOfEmployees", taxonomy: "dei", concepts: ["EntityNumberOfEmployees"], unit: "pure", instant: true, label: "Employees", optional: true },
];

export const CONCEPT_BY_KEY: Record<ConceptKey, ConceptSpec> = Object.fromEntries(CONCEPTS.map((c) => [c.key, c])) as Record<ConceptKey, ConceptSpec>;

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "10-KT", "20-F", "20-F/A", "40-F", "40-F/A"]);
const DAY = 86_400_000;

function days(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return (tb - ta) / DAY;
}

/** Is this point an annual figure from an annual report (rules 1 and 2)? */
export function isAnnual(p: FactPoint, instant: boolean): boolean {
  if (!ANNUAL_FORMS.has(String(p.form ?? ""))) return false;
  if (p.fp !== "FY") return false;
  if (instant) return true;
  if (!p.start) return false;
  const d = days(p.start, p.end);
  return d != null && d >= 350 && d <= 380;
}

/** Annual values, one per period end, oldest first; restatements resolved by latest `filed` (rule 3). */
export function annualSeries(points: FactPoint[], instant: boolean, concept?: string): FactValue[] {
  const byEnd = new Map<string, FactPoint>();
  for (const p of points) {
    if (!isAnnual(p, instant)) continue;
    const cur = byEnd.get(p.end);
    if (!cur || String(p.filed ?? "") > String(cur.filed ?? "") || (String(p.filed ?? "") === String(cur.filed ?? "") && !cur.frame && !!p.frame)) byEnd.set(p.end, p);
  }
  return [...byEnd.values()]
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
    .map((p) => ({ value: p.val, period: p.frame ?? (p.fy != null ? `FY${p.fy}` : p.end.slice(0, 4)), end: p.end, accn: p.accn, filed: p.filed, form: p.form, concept }));
}

/** The most recent annual value (rule 4 for the label), or null when the filer never tagged the concept on an annual report. */
export function pickLatestAnnual(points: FactPoint[], instant: boolean, concept?: string): FactValue | null {
  const s = annualSeries(points, instant, concept);
  return s.length ? s[s.length - 1] : null;
}

/** For one spec, the fallback concept whose latest annual value is most recent (ties go to the primary). */
export function seriesForSpec(j: CompanyFactsFile, spec: ConceptSpec): { concept: string; series: FactValue[] } | null {
  let best: { concept: string; series: FactValue[] } | null = null;
  for (const concept of spec.concepts) {
    const s = annualSeries(factPoints(j, spec.taxonomy, concept, spec.unit), spec.instant, concept);
    if (!s.length) continue;
    if (!best || s[s.length - 1].end > best.series[best.series.length - 1].end) best = { concept, series: s };
  }
  return best;
}

/** Latest annual value per concept key; null where the filer reports nothing usable. */
export function latestFacts(j: CompanyFactsFile): Record<ConceptKey, FactValue | null> {
  const out = {} as Record<ConceptKey, FactValue | null>;
  for (const spec of CONCEPTS) {
    const s = seriesForSpec(j, spec);
    out[spec.key] = s ? s.series[s.series.length - 1] : null;
  }
  return out;
}

/** Up to `maxYears` annual values per concept as lib/series Series with "published" provenance. */
export function factSeries(j: CompanyFactsFile, opts: { retrievedAt?: string; maxYears?: number; geo?: Series["geo"] } = {}): Series[] {
  const cik = cikId(j.cik);
  const max = opts.maxYears ?? 12;
  const out: Series[] = [];
  for (const spec of CONCEPTS) {
    const s = seriesForSpec(j, spec);
    if (!s) continue;
    const vals = s.series.slice(-max);
    const last = vals[vals.length - 1];
    const points: Point[] = vals.map((v) => ({ t: Date.parse(v.end), v: v.value })).filter((p) => Number.isFinite(p.t));
    out.push({
      id: `edgar:${cik}:${spec.key}`,
      title: `${j.entityName} · ${spec.label}`,
      unit: spec.unit === "USD" ? "USD" : "count",
      frequency: "annual",
      geo: opts.geo,
      tags: ["companies", "edgar", spec.taxonomy, spec.key],
      provenance: provenance(source("sec-edgar"), {
        kind: "published",
        seriesId: `${cik}:${s.concept}`,
        upstreamUrl: companyFactsUrl(j.cik),
        period: last?.period,
        releasedAt: last?.filed,
        retrievedAt: opts.retrievedAt,
        notes: s.concept !== spec.concepts[0] ? [`filer tags ${s.concept} rather than ${spec.concepts[0]}`] : undefined,
      }),
      points,
    });
  }
  return out;
}

export const RATIO_FORMULA: Record<DerivedRatio["key"], string> = {
  netMargin: "NetIncomeLoss / Revenues × 100, same fiscal year",
  operatingMargin: "OperatingIncomeLoss / Revenues × 100, same fiscal year",
  returnOnEquity: "NetIncomeLoss / StockholdersEquity (year-end) × 100",
  debtToEquity: "LongTermDebt / StockholdersEquity, both at year-end",
};

/**
 * Ratios from the latest facts. A ratio is only produced when both inputs
 * describe the same fiscal year (same period end year) and the denominator
 * is positive, so a loss-making equity or mismatched years never yield a
 * number that looks meaningful.
 */
export function derivedRatios(f: Partial<Record<ConceptKey, FactValue | null>>): DerivedRatio[] {
  const out: DerivedRatio[] = [];
  const sameYear = (a: FactValue | null | undefined, b: FactValue | null | undefined) => !!a && !!b && a.end.slice(0, 4) === b.end.slice(0, 4);
  const pct = (n: number, d: number) => Math.round((n / d) * 1000) / 10;
  const rev = f.Revenues;
  const ni = f.NetIncomeLoss;
  const op = f.OperatingIncomeLoss;
  const eq = f.StockholdersEquity;
  const debt = f.LongTermDebt;
  if (rev && ni && sameYear(rev, ni) && rev.value > 0) out.push({ key: "netMargin", label: "Net margin", value: pct(ni.value, rev.value), unit: "%", period: ni.period, formula: RATIO_FORMULA.netMargin });
  if (rev && op && sameYear(rev, op) && rev.value > 0) out.push({ key: "operatingMargin", label: "Operating margin", value: pct(op.value, rev.value), unit: "%", period: op.period, formula: RATIO_FORMULA.operatingMargin });
  if (ni && eq && sameYear(ni, eq) && eq.value > 0) out.push({ key: "returnOnEquity", label: "Return on equity", value: pct(ni.value, eq.value), unit: "%", period: ni.period, formula: RATIO_FORMULA.returnOnEquity });
  if (debt && eq && sameYear(debt, eq) && eq.value > 0) out.push({ key: "debtToEquity", label: "Debt to equity", value: Math.round((debt.value / eq.value) * 100) / 100, unit: "x", period: debt.period, formula: RATIO_FORMULA.debtToEquity });
  return out;
}

/** Compact money for labels: 391.0B, 12.3M. Negative values keep their sign. */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
