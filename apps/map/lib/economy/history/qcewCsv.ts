// Parser for one BLS QCEW open-data area slice
// (https://data.bls.gov/cew/data/api/<year>/<qtr>/area/<code>.csv): every
// industry × ownership row for one area and period. We keep the one row the
// history needs, the industry 10 total for one ownership (own_code 0, all
// covered employment, unless asked for another).
//
// Quarterly header (cells quoted as BLS writes them):
//   area_fips,own_code,industry_code,agglvl_code,size_code,year,qtr,disclosure_code,
//   qtrly_estabs,month1_emplvl,month2_emplvl,month3_emplvl,total_qtrly_wages,
//   taxable_qtrly_wages,qtrly_contributions,avg_wkly_wage,lq_*...,oty_*...
// Annual slices (<year>/a/) carry qtr "A" and their own columns:
//   ...,disclosure_code,annual_avg_estabs,annual_avg_emplvl,total_annual_wages,
//   taxable_annual_wages,annual_contributions,annual_avg_wkly_wage,avg_annual_pay,lq_*...,oty_*...
// Both read from the live files (2019/a and 2025/4 area/C1242) on 2026-10-01.

import { cellNum, parseCsv } from "@/lib/economy/csv";
import { isWithheld } from "@/lib/economy/qcewDisclosure";

/** A QCEW period within a year: quarter 1-4, or "a" for the annual-average slice (/<year>/a/). */
export type QcewQtr = number | "a";

export interface QcewTotalRow {
  area: string;
  year: number;
  /** Quarter 1-4, or "a" for an annual-average row. */
  qtr: QcewQtr;
  /** Establishments: count in the quarter, or the annual average. */
  estabs: number | null;
  /** Employment: third-month level for a quarter, annual average level for "a". */
  emp: number | null;
  /** Total wages for the period (quarter or year), dollars. */
  wages: number | null;
  avgWeeklyWage: number | null;
  /** Average annual pay, dollars. Null on quarterly rows: BLS publishes it only in the annual slices. */
  avgAnnualPay: number | null;
  /** BLS's own over-the-year percent changes, kept for cross-checks. */
  otyEmpPct: number | null;
  otyAvgWeeklyWagePct: number | null;
  otyEstabsPct: number | null;
  /** Any non-blank disclosure code (N, or the undocumented "-" that carries zeros): every value above is null. */
  suppressed: boolean;
}

/** Column names for the fields above, which differ between quarterly and annual slices. */
export interface QcewColumns {
  estabs: string;
  emp: string;
  wages: string;
  avgWeeklyWage: string;
  avgAnnualPay: string | null;
  lqEmp: string;
  otyEmpPct: string;
  otyWagesPct: string;
  otyAvgWeeklyWagePct: string;
  otyEstabsPct: string;
}

export const QCEW_QUARTERLY_COLUMNS: QcewColumns = {
  estabs: "qtrly_estabs",
  emp: "month3_emplvl",
  wages: "total_qtrly_wages",
  avgWeeklyWage: "avg_wkly_wage",
  avgAnnualPay: null,
  lqEmp: "lq_month3_emplvl",
  otyEmpPct: "oty_month3_emplvl_pct_chg",
  otyWagesPct: "oty_total_qtrly_wages_pct_chg",
  otyAvgWeeklyWagePct: "oty_avg_wkly_wage_pct_chg",
  otyEstabsPct: "oty_qtrly_estabs_pct_chg",
};

export const QCEW_ANNUAL_COLUMNS: QcewColumns = {
  estabs: "annual_avg_estabs",
  emp: "annual_avg_emplvl",
  wages: "total_annual_wages",
  avgWeeklyWage: "annual_avg_wkly_wage",
  avgAnnualPay: "avg_annual_pay",
  lqEmp: "lq_annual_avg_emplvl",
  otyEmpPct: "oty_annual_avg_emplvl_pct_chg",
  otyWagesPct: "oty_total_annual_wages_pct_chg",
  otyAvgWeeklyWagePct: "oty_annual_avg_wkly_wage_pct_chg",
  otyEstabsPct: "oty_annual_avg_estabs_pct_chg",
};

/** The column set a slice uses, decided by its header (an annual slice has annual_avg_emplvl). */
export function qcewColumns(header: Iterable<string>): QcewColumns {
  for (const h of header) if (h.trim() === "annual_avg_emplvl") return QCEW_ANNUAL_COLUMNS;
  return QCEW_QUARTERLY_COLUMNS;
}

/**
 * BLS aggregation levels (agglvl_code, per
 * https://data.bls.gov/cew/doc/titles/agglevel/agglevel_titles.csv) of the
 * rows read for one area code:
 *   total        industry 10, own_code 0 ("Total Covered")
 *   byOwnership  industry 10 for one ownership code ("Total -- by ownership sector")
 *   sector       NAICS sectors ("NAICS Sector -- by ownership sector")
 * A C-code (C + the first four digits of a CBSA code) is a metropolitan area
 * (40/41/44) or a micropolitan one (80, total row only); the code alone does
 * not say which, so both totals are accepted. CS-codes are combined
 * statistical areas (30, total row only). Micropolitan and CSA slices carry
 * no ownership or sector rows. An unrecognised code matches nothing.
 */
export interface QcewLevels {
  total: readonly string[];
  byOwnership: string | null;
  sector: string | null;
}

export function qcewLevels(area: string): QcewLevels {
  const a = area.trim().toUpperCase();
  if (a === "US000") return { total: ["10"], byOwnership: "11", sector: "14" };
  if (/^CS\d{3}$/.test(a)) return { total: ["30"], byOwnership: null, sector: null };
  if (/^C\d{4}$/.test(a)) return { total: ["40", "80"], byOwnership: "41", sector: "44" };
  if (/^\d{2}000$/.test(a)) return { total: ["50"], byOwnership: "51", sector: "54" };
  if (/^\d{5}$/.test(a)) return { total: ["70"], byOwnership: "71", sector: "74" };
  return { total: [], byOwnership: null, sector: null };
}

/**
 * The industry 10 row for `own` (default "0", all covered employment; "5" is
 * private), or null when the slice has none (unknown area, an ownership the
 * area does not publish, or a period that is not out). Annual slices are
 * detected from the header, and their row reports qtr "a".
 */
export function parseQcewAreaTotal(csv: string, fips: string, year: number, qtr: QcewQtr, opts: { own?: string } = {}): QcewTotalRow | null {
  const own = opts.own ?? "0";
  const rows = parseCsv(csv);
  const h = rows[0] ?? [];
  const idx = new Map(h.map((k, i) => [k.trim(), i] as const));
  const need = ["own_code", "industry_code", "agglvl_code"];
  if (need.some((k) => !idx.has(k))) return null;
  const levels = qcewLevels(fips);
  const accept = own === "0" ? levels.total : levels.byOwnership ? [levels.byOwnership] : [];
  if (!accept.length) return null;
  const cols = qcewColumns(idx.keys());
  const annual = cols === QCEW_ANNUAL_COLUMNS;
  for (const r of rows.slice(1)) {
    const cell = (k: string) => {
      const i = idx.get(k);
      return i == null ? "" : (r[i] ?? "").trim();
    };
    if (cell("own_code") !== own || cell("industry_code") !== "10" || !accept.includes(cell("agglvl_code"))) continue;
    const suppressed = isWithheld(cell("disclosure_code"));
    const n = (k: string | null) => (suppressed || k == null ? null : cellNum(cell(k)));
    return {
      area: cell("area_fips") || fips,
      year: cellNum(cell("year")) ?? year,
      qtr: annual ? "a" : (cellNum(cell("qtr")) ?? qtr),
      estabs: n(cols.estabs),
      emp: n(cols.emp),
      wages: n(cols.wages),
      avgWeeklyWage: n(cols.avgWeeklyWage),
      avgAnnualPay: n(cols.avgAnnualPay),
      otyEmpPct: n(cols.otyEmpPct),
      otyAvgWeeklyWagePct: n(cols.otyAvgWeeklyWagePct),
      otyEstabsPct: n(cols.otyEstabsPct),
      suppressed,
    };
  }
  return null;
}
