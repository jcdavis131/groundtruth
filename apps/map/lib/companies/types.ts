// Types for the companies layer: public companies from SEC EDGAR placed at
// their registered business address, with filings and XBRL financial facts.
//
// Two shapes flow through the layer:
//   CompanyRecord   one row of the bundled snapshot (lib/companies/data/
//                   companies.json) built offline by scripts/companies-data.mjs;
//                   what the globe draws and the county lookups read.
//   CompanyProfile  the live dossier assembled from the submissions and
//                   companyfacts APIs when a company is selected.
//
// Company-level public filings are in scope. These types carry nothing about
// a person: no shareholder names, no mailing addresses. The people who file
// Forms 3, 4 and 5 about a company are kept apart, by CIK, in the server-only
// store in lib/people, and are reached from the company, never from a place
// (docs/PEOPLE.md). Only the business address a filer registers with the
// Commission is used, and only to place the company.

import type { Provenance } from "@/lib/provenance/types";

/** Keys of the financial concepts the snapshot and the dossier carry. */
export type ConceptKey =
  | "Revenues"
  | "NetIncomeLoss"
  | "OperatingIncomeLoss"
  | "Assets"
  | "StockholdersEquity"
  | "CashAndCashEquivalentsAtCarryingValue"
  | "LongTermDebt"
  | "EntityNumberOfEmployees";

/** How a concept is read from XBRL: taxonomy, unit, whether it is a balance (instant) or a flow (duration), and fallbacks. */
export interface ConceptSpec {
  key: ConceptKey;
  taxonomy: "us-gaap" | "dei";
  /** Primary concept name, then alternatives filers use for the same idea (tried in order). */
  concepts: string[];
  unit: "USD" | "pure";
  /** Balance-sheet items are reported at an instant (frame CY2024Q4I); income items over a duration (frame CY2024). */
  instant: boolean;
  label: string;
  /** Employees is rarely tagged in XBRL; missing is normal, not an error. */
  optional?: boolean;
}

/** One reported value with the period it describes. */
export interface FactValue {
  value: number;
  /** Calendar frame the value was read from ("CY2024" / "CY2024Q4I") or, from companyfacts, the fiscal period ("FY2024"). */
  period: string;
  /** Period end date, ISO. */
  end: string;
  /** Accession number of the filing the value came from, when known. */
  accn?: string;
  /** Filing date, ISO, when known. */
  filed?: string;
  /** Form type, when known. */
  form?: string;
  /** Concept actually used (a fallback may differ from the key). */
  concept?: string;
}

export type GeoMethod = "zcta-centroid" | "city-centroid";

/** One company in the bundled snapshot. Null means the upstream did not send it (never invented). */
export interface CompanyRecord {
  cik: number;
  name: string;
  ticker: string;
  exchange: string | null;
  sic: string | null;
  sicDescription: string | null;
  /** Business address, as registered with the SEC. */
  state: string | null;
  city: string | null;
  zip: string | null;
  /** Five-digit county GEOID from the Census ZCTA-to-county relationship file. */
  countyFips: string | null;
  lon: number | null;
  lat: number | null;
  /** How lon/lat were derived; null when the company could not be placed. */
  geo: GeoMethod | null;
  /** MMDD as EDGAR reports it. */
  fiscalYearEnd: string | null;
  stateOfIncorporation?: string | null;
  /** Latest value per concept for the years the script pulled, keyed by concept then frame year. */
  facts: Partial<Record<ConceptKey, FactValue | null>>;
  /** ISO date the facts were pulled; null in the hand-checked fixture. */
  pulled: string | null;
}

export interface CompanyBundle {
  source: string;
  /** ISO date of the pull, or null for the committed fixture. */
  pulled: string | null;
  counts: { companies: number; geocoded: number; withFacts: number };
  /** Calendar years the frames were pulled for, newest first. */
  frameYears?: number[];
  companies: CompanyRecord[];
}

// ---- EDGAR raw shapes
// shape per https://www.sec.gov/search-filings/edgar-application-programming-interfaces; unverified in sandbox

/** https://www.sec.gov/files/company_tickers.json */
export type TickersFile = Record<string, { cik_str: number; ticker: string; title: string }>;

/** https://www.sec.gov/files/company_tickers_exchange.json */
export interface TickersExchangeFile {
  fields: string[];
  data: Array<Array<string | number | null>>;
}

export interface CompanyListing {
  cik: number;
  name: string;
  ticker: string;
  exchange: string | null;
}

export interface EdgarAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  stateOrCountry?: string | null;
  zipCode?: string | null;
  stateOrCountryDescription?: string | null;
}

/** https://data.sec.gov/submissions/CIK##########.json (only the fields we read). */
export interface SubmissionsFile {
  cik: string | number;
  name: string;
  sic?: string;
  sicDescription?: string;
  tickers?: string[];
  exchanges?: string[];
  stateOfIncorporation?: string;
  fiscalYearEnd?: string;
  entityType?: string;
  addresses?: { business?: EdgarAddress | null; mailing?: EdgarAddress | null };
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

/** One XBRL fact as companyfacts lists it. */
export interface FactPoint {
  end: string;
  val: number;
  /** Start date for duration facts. */
  start?: string;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

/** https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json */
export interface CompanyFactsFile {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; description?: string; units: Record<string, FactPoint[]> }>>;
}

/** https://data.sec.gov/api/xbrl/frames/<taxonomy>/<concept>/<unit>/<period>.json */
export interface FrameFile {
  taxonomy: string;
  tag: string;
  ccp: string;
  uom: string;
  label?: string;
  pts?: number;
  data: Array<{ accn: string; cik: number; entityName: string; loc?: string; start?: string; end: string; val: number }>;
}

// ---- Derived / served shapes

export interface Filing {
  accession: string;
  form: string;
  filed: string;
  reportDate?: string;
  primaryDocument: string;
  description: string;
  url: string;
}

export interface CompanyProfile {
  cik: number;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  stateOfIncorporation: string | null;
  fiscalYearEnd: string | null;
  entityType: string | null;
  business: { street1: string | null; city: string | null; state: string | null; zip: string | null } | null;
  /** Number of filings in the "recent" window (a size hint, not a total). */
  recentFilings: number;
  edgarUrl: string;
}

/** A ratio computed here from two published facts; always labelled as an estimate. */
export interface DerivedRatio {
  key: "netMargin" | "operatingMargin" | "returnOnEquity" | "debtToEquity";
  label: string;
  value: number;
  /** Percent for margins/ROE, ratio for debt-to-equity. */
  unit: "%" | "x";
  period: string;
  formula: string;
}

export type GicsSector =
  | "energy"
  | "materials"
  | "industrials"
  | "consumer-discretionary"
  | "consumer-staples"
  | "health-care"
  | "financials"
  | "information-technology"
  | "communication-services"
  | "utilities"
  | "real-estate"
  | "unclassified";

export interface SectorMapping {
  /** SIC division letter and title, e.g. "D" Manufacturing. */
  division: { code: string; title: string };
  gics: GicsSector;
  gicsTitle: string;
  /** Sector ETF tickers by convention (see lib/companies/sectors.ts); not advice. */
  etfs: string[];
}

/** Opaque payload on a company feature; everything the aside needs before it fetches the dossier. */
export interface CompanyExtra {
  cik: number;
  ticker: string;
  exchange: string | null;
  sic: string | null;
  sicDescription: string | null;
  sector: SectorMapping;
  city: string | null;
  state: string | null;
  zip: string | null;
  countyFips: string | null;
  geo: GeoMethod | null;
  fiscalYearEnd: string | null;
  facts: CompanyRecord["facts"];
  pulled: string | null;
  edgarUrl: string;
}

/** A county's employment mix bridged to GICS sectors and their ETFs, location quotient carried through. */
export interface SectorExposure {
  gics: GicsSector;
  gicsTitle: string;
  etfs: string[];
  /** NAICS sectors that were folded into this GICS sector. */
  naics: Array<{ code: string; title: string; emp: number | null; lq: number | null }>;
  emp: number | null;
  /** Employment-weighted mean of the NAICS location quotients; null when every input was withheld. */
  lq: number | null;
  provenance: Provenance;
}
