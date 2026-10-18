// Types for the two finance layers: where insured deposits sit (FDIC
// BankFind Suite) and where federal dollars land (USAspending). Both sources
// are public domain and keyless. Institutions, branches, recipients and
// agencies are legal entities; nothing here describes a person.

import type { Provenance } from "@/lib/provenance/types";
import type { Series } from "@/lib/series/types";

// ---- FDIC BankFind Suite

/** One insured institution as /api/institutions publishes it. Money fields are $ thousands as FDIC reports them. */
export interface Institution {
  cert: number;
  name: string;
  city: string;
  state: string;
  zip: string;
  /** Total assets, $ thousands. */
  assets: number | null;
  /** Total deposits, $ thousands. */
  deposits: number | null;
  /** Net income year-to-date, $ thousands. */
  netIncome: number | null;
  /** Return on assets / equity, percent, as FDIC computes them. */
  roa: number | null;
  roe: number | null;
  offices: number | null;
  /** Operates offices in more than one state. */
  multiState: boolean;
  /** FDIC charter class: N national, SM state Fed member, NM state non-member, SB savings bank, SA thrift, OI insured branch of a foreign bank. */
  bkClass: string;
  active: boolean;
  /** Report date the figures belong to, ISO date. */
  reportDate: string | null;
  county: string | null;
  lat: number | null;
  lon: number | null;
}

/** One office from /api/locations. The address is a business address, which the guardrails allow. */
export interface Branch {
  cert: number;
  /** Office number within the institution; joins Summary of Deposits BRNUM. */
  officeNum: number | null;
  /** FDIC unique office number, when published. */
  uninum: number | null;
  /** Institution name. */
  name: string;
  /** Office name. */
  office: string;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  /** State + county FIPS of the office (STCNTYBR). */
  fips: string;
  /** Service type code as published (11 full service brick and mortar, 12 full service retail, 13 cyber, ...). */
  serviceType: string | null;
  /** Establishment date, ISO date, when published. */
  established: string | null;
  lat: number | null;
  lon: number | null;
}

/** One row of the annual Summary of Deposits (as of June 30). */
export interface SodRow {
  cert: number;
  name: string;
  /** Branch number; 0 is the main office. */
  brnum: number;
  uninum: number | null;
  /** Deposits at this office, $ thousands. */
  deposits: number | null;
  /** Institution total assets, $ thousands. */
  assets: number | null;
  fips: string;
  county: string | null;
  state: string | null;
  year: number;
  lat: number | null;
  lon: number | null;
  /**
   * CBSA code of the metropolitan statistical area FDIC assigns the office to
   * (SOD MSABR, e.g. "12420" Austin). Null outside any MSA: FDIC writes 0 there,
   * micropolitan counties included.
   */
  cbsa: string | null;
  /** That MSA's title as FDIC writes it (MSANAMB); null with `cbsa`. */
  cbsaName: string | null;
}

/** A bank's share of a county's deposits. */
export interface BankShare {
  cert: number;
  name: string;
  /** Dollars (SOD $ thousands × 1000). */
  deposits: number;
  branches: number;
  sharePct: number;
}

/** Herfindahl-Hirschman index of deposit shares, an estimate with its formula. */
export interface Hhi {
  value: number;
  /** DOJ 1995 bank merger screen: < 1000 unconcentrated, 1000-1800 moderate, > 1800 highly concentrated. */
  label: "unconcentrated" | "moderately concentrated" | "highly concentrated";
  formula: string;
  banks: number;
}

/** County aggregate of the Summary of Deposits. */
export interface CountyDeposits {
  fips: string;
  county: string | null;
  state: string | null;
  year: number;
  /** Total deposits at all offices in the county, dollars. */
  total: number;
  branches: number;
  banks: number;
  top: BankShare[];
  hhi: Hhi | null;
  provenance: Provenance[];
}

/** One quarter of /api/financials for a CERT; money is $ thousands, ratios percent. */
export interface FinancialsRow {
  /** ISO date. */
  reportDate: string;
  assets: number | null;
  deposits: number | null;
  netIncome: number | null;
  /** Net loans and leases. */
  netLoans: number | null;
  /** Noncurrent loans and leases. */
  noncurrentLoans: number | null;
  /** Noncurrent loans to total loans, percent. */
  noncurrentPct: number | null;
  roa: number | null;
  roe: number | null;
  equity: number | null;
}

export interface BankProfile {
  institution: Institution | null;
  rows: FinancialsRow[];
  /** One Series per ratio / level, ids "fdic:financials:<cert>:<field>". */
  series: Series[];
  provenance: Provenance[];
}

export interface BankFailure {
  name: string;
  cityState: string;
  /** ISO date. */
  failDate: string;
  /** Assets and deposits at the quarter before failure, $ thousands. */
  assets: number | null;
  deposits: number | null;
  /** Estimated cost to the insurance fund, $ thousands. */
  cost: number | null;
  /** Resolution type as published (PA purchase and assumption, PO payout, ...). */
  resolution: string | null;
}

// ---- USAspending

/** Award families as USAspending groups their type codes. Extend here to add a family. */
export type AwardGroup = "contracts" | "grants" | "loans" | "direct";

export const AWARD_GROUPS: Record<AwardGroup, { label: string; codes: string[] }> = {
  contracts: { label: "contracts", codes: ["A", "B", "C", "D"] },
  grants: { label: "grants", codes: ["02", "03", "04", "05"] },
  loans: { label: "loans", codes: ["07", "08"] },
  direct: { label: "direct payments", codes: ["06", "10"] },
};

export const AWARD_GROUP_IDS = Object.keys(AWARD_GROUPS) as AwardGroup[];

/** One row of spending_by_geography. */
export interface GeoObligation {
  /** County FIPS (SSCCC) or two-letter state code, as USAspending keys the layer. */
  shapeCode: string;
  name: string;
  /** Obligated dollars in the period. */
  amount: number;
  population: number | null;
  perCapita: number | null;
}

/** Obligations landing in one area over one period. */
export interface AreaObligations {
  /** Fiscal year the figures belong to. */
  fy: number;
  /** Null when the upstream did not answer for that family (not zero). */
  byGroup: Record<AwardGroup, number | null>;
  /** Sum of the families that answered. */
  total: number | null;
}

/** Fiscal-year-to-date total, all award families. */
export interface ToDateObligations {
  fy: number;
  /** ISO date the window ended (today at fetch time). */
  through: string;
  total: number | null;
}

export interface CategoryRow {
  name: string;
  amount: number;
  /** NAICS code, agency code or recipient id when published. */
  code: string | null;
  id: string | null;
}

export interface OverTimeRow {
  fy: number;
  amount: number;
}

export interface SpendingDetail {
  fips: string;
  fy: number;
  recipients: CategoryRow[];
  agencies: CategoryRow[];
  naics: CategoryRow[];
  overTime: OverTimeRow[];
  provenance: Provenance[];
}

/** Obligations per covered job, an estimate with its formula. */
export interface PerJob {
  value: number;
  obligations: number;
  jobs: number;
  /** QCEW period the employment figure is from. */
  jobsPeriod: string;
  formula: string;
}
