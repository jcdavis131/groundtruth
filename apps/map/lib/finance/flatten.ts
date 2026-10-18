// Flatten finance features and tables to one row each for `format=csv`.
// Pure: GeoJSON or parsed rows in, plain objects out, stable snake_case
// columns so a notebook can rely on the header. Column lists are exported
// so the route can pin the order.
//
// Nothing is invented: a value the upstream withheld is null (an empty
// cell), never zero. Money is in dollars unless the column says _thousands.

import type { Point } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import type { CsvRow } from "@/lib/server/csv";
import type { BranchExtra, SpendingExtra } from "./features";
import type { BankFailure, CountyDeposits, FinancialsRow, SpendingDetail } from "./types";

const r2 = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export const BRANCH_COLUMNS = [
  "id",
  "cert",
  "bank",
  "short_name",
  "office",
  "office_num",
  "uninum",
  "address",
  "city",
  "state",
  "zip",
  "county_fips",
  "lon",
  "lat",
  "service_type",
  "established",
  "deposits",
  "sod_year",
] as const;

/** Offices from `op=banks`, one row per office; `deposits` is empty when the SOD lists none. */
export function flattenBranches(features: LayerFeature[]): CsvRow[] {
  return features.map((f) => {
    const x = f.properties.extra as BranchExtra;
    const c = f.geometry.type === "Point" ? (f as LayerFeature<Point>).geometry.coordinates : null;
    return {
      id: f.properties.id,
      cert: x.cert,
      bank: x.bank,
      short_name: x.shortName,
      office: x.office,
      office_num: x.officeNum,
      uninum: x.uninum,
      address: x.address,
      city: x.city,
      state: x.state,
      zip: x.zip,
      county_fips: x.fips,
      lon: c ? c[0] : null,
      lat: c ? c[1] : null,
      service_type: x.serviceType,
      established: x.established,
      deposits: x.deposits,
      sod_year: x.deposits != null ? x.sodYear : null,
    };
  });
}

export const BANK_SHARE_COLUMNS = ["county_fips", "county", "state", "year", "rank", "cert", "bank", "deposits", "branches", "share_pct", "county_deposits", "county_branches", "county_banks", "hhi", "hhi_label"] as const;

/** A county's Summary of Deposits aggregate from `op=deposits`, one row per bank in the top list; county totals repeat on every row. */
export function flattenDeposits(d: CountyDeposits): CsvRow[] {
  return d.top.map((s, i) => ({
    county_fips: d.fips,
    county: d.county,
    state: d.state,
    year: d.year,
    rank: i + 1,
    cert: s.cert,
    bank: s.name,
    deposits: s.deposits,
    branches: s.branches,
    share_pct: r2(s.sharePct),
    county_deposits: d.total,
    county_branches: d.branches,
    county_banks: d.banks,
    hhi: d.hhi ? Math.round(d.hhi.value) : null,
    hhi_label: d.hhi?.label ?? null,
  }));
}

export const FINANCIALS_COLUMNS = ["cert", "report_date", "assets_thousands", "deposits_thousands", "net_income_thousands", "net_loans_thousands", "noncurrent_loans_thousands", "noncurrent_pct", "roa", "roe", "equity_thousands"] as const;

/** Quarterly financials from `op=bank`, newest first as FDIC sorts them. */
export function flattenFinancials(cert: number, rows: FinancialsRow[]): CsvRow[] {
  return rows.map((r) => ({
    cert,
    report_date: r.reportDate,
    assets_thousands: r.assets,
    deposits_thousands: r.deposits,
    net_income_thousands: r.netIncome,
    net_loans_thousands: r.netLoans,
    noncurrent_loans_thousands: r.noncurrentLoans,
    noncurrent_pct: r.noncurrentPct,
    roa: r.roa,
    roe: r.roe,
    equity_thousands: r.equity,
  }));
}

export const FAILURE_COLUMNS = ["name", "city_state", "fail_date", "assets_thousands", "deposits_thousands", "cost_thousands", "resolution"] as const;

export function flattenFailures(rows: BankFailure[]): CsvRow[] {
  return rows.map((r) => ({
    name: r.name,
    city_state: r.cityState,
    fail_date: r.failDate,
    assets_thousands: r.assets,
    deposits_thousands: r.deposits,
    cost_thousands: r.cost,
    resolution: r.resolution,
  }));
}

export const SPENDING_AREA_COLUMNS = [
  "geoid",
  "name",
  "level",
  "state",
  "state_name",
  "lon",
  "lat",
  "fy",
  "obligations",
  "contracts",
  "grants",
  "loans",
  "direct_payments",
  "fytd_fy",
  "fytd_through",
  "fytd_obligations",
  "qcew_period",
  "emp",
  "qcew_suppressed",
  "per_job",
] as const;

/** Counties or states from `op=spending`, one row per area. */
export function flattenSpendingAreas(features: LayerFeature[]): CsvRow[] {
  return features.map((f) => {
    const x = f.properties.extra as SpendingExtra;
    const o = x.obligations;
    return {
      geoid: x.geoid,
      name: x.name,
      level: x.level,
      state: x.stusab ?? null,
      state_name: x.stateName ?? null,
      lon: f.properties.anchor?.[0] ?? null,
      lat: f.properties.anchor?.[1] ?? null,
      fy: o.fy,
      obligations: r2(o.total),
      contracts: r2(o.byGroup.contracts),
      grants: r2(o.byGroup.grants),
      loans: r2(o.byGroup.loans),
      direct_payments: r2(o.byGroup.direct),
      fytd_fy: x.toDate?.fy ?? null,
      fytd_through: x.toDate?.through ?? null,
      fytd_obligations: r2(x.toDate?.total),
      qcew_period: x.jobs?.period ?? null,
      emp: x.jobs?.emp ?? null,
      qcew_suppressed: x.jobs ? x.jobs.suppressed : null,
      per_job: r2(x.perJob?.value),
    };
  });
}

export const CATEGORY_COLUMNS = ["county_fips", "fy", "category", "rank", "name", "code", "id", "amount"] as const;

/** Recipients, agencies, NAICS and the over-time trace from `op=spending-detail`, stacked with a `category` column. */
export function flattenDetail(d: SpendingDetail): CsvRow[] {
  const out: CsvRow[] = [];
  const push = (category: string, rows: Array<{ name: string; amount: number; code: string | null; id: string | null }>) =>
    rows.forEach((r, i) => out.push({ county_fips: d.fips, fy: d.fy, category, rank: i + 1, name: r.name, code: r.code, id: r.id, amount: r2(r.amount) }));
  push("recipient", d.recipients);
  push("awarding_agency", d.agencies);
  push("naics", d.naics);
  d.overTime.forEach((r) => out.push({ county_fips: d.fips, fy: r.fy, category: "over_time", rank: null, name: `FY${r.fy}`, code: null, id: null, amount: r2(r.amount) }));
  return out;
}
