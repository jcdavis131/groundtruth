// Per-company RSU equity dossiers: vesting schedules, equity plans, and
// insider-trading policies mined from SEC EDGAR 10-K, 20-F, 40-F, and DEF 14A filings.
//
// Built offline by workspace/.jarvis/idea-executions/929aed6e-f13e-4822-b549-0290326204ba/scratch/build_dossiers.py.
// Public filings only: no personal data of any individual is collected here.
// Every fact carries its exact source filing (form, section, filing date,
// accession number, source URL).
//
// Inferred blackout windows are ESTIMATES: companies disclose that an insider
// trading policy exists but do not publish exact blackout calendars. The
// estimate label is part of the data (blackoutWindowEstimate.label) and must
// be rendered verbatim wherever the window is shown.

import bundleJson from "./data/equity_dossiers.json";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

/** One cited statement pulled from a filing. */
export interface CitedStatement {
  statement: string;
  section: string;
  form: string;
  filingDate: string;
  accessionNumber: string;
  url: string;
}

/** An inferred blackout window. The label must be shown verbatim. */
export interface BlackoutWindowEstimate {
  label: string;
  statement: string;
  method: string;
  fiscalQuarterEndMonths: number[];
}

/** One company's equity dossier. */
export interface EquityDossier {
  ticker: string;
  company: string;
  cik: number;
  /** Source registry: SEC (EDGAR) or HKEX (issuer annual reports). Defaults to SEC. */
  registry: "SEC" | "HKEX";
  /** Rank in the atlas employer layer, when the company is one of the 1,364. */
  atlasEmployerRank: number | null;
  vesting: CitedStatement[];
  equityPlan: CitedStatement | null;
  tradingPolicy: CitedStatement | null;
  /** Blackout language actually disclosed in a filing (rarely dated). */
  blackoutDisclosed: CitedStatement[];
  /** Inferred window — always an estimate, label rendered verbatim. */
  blackoutWindowEstimate: BlackoutWindowEstimate | null;
  /** Major-ETF membership from official issuer holdings files (may be empty). */
  etfMembership: EtfMembership[];
}

export interface EtfMembership {
  etf: string;
  weightPct: number;
  asOf: string;
  holdingName: string;
  /** Local listing ticker when the ETF holds a non-US listing. */
  holdingTicker?: string;
  source: string;
}

interface DossierBundle {
  meta: {
    built: string;
    method: string;
    pilotSize: number;
    note: string;
  };
  dossiers: EquityDossier[];
}

const BUNDLE: DossierBundle = bundleJson as unknown as DossierBundle;

/** All dossiers in the pilot batch. */
export function allEquityDossiers(): EquityDossier[] {
  return BUNDLE.dossiers;
}

/** One dossier by ticker (case-insensitive), or null. */
export function getEquityDossier(ticker: string): EquityDossier | null {
  const t = ticker.trim().toUpperCase();
  return BUNDLE.dossiers.find((d) => d.ticker.toUpperCase() === t) ?? null;
}

/** Tickers covered by the pilot batch. */
export function equityDossierTickers(): string[] {
  return BUNDLE.dossiers.map((d) => d.ticker);
}

const SEC_EDGAR = "sec-edgar";

export function equityProvenance(): Provenance {
  return provenance(
    source(SEC_EDGAR),
    {
      // The bundle was mined once, offline; "retrieved" is the build date,
      // not the moment this function runs.
      retrievedAt: BUNDLE.meta.built,
      kind: "published",
      notes: [
        "Vesting schedules and trading policies are quoted from each company's latest 10-K and DEF 14A as filed with the SEC.",
        "Inferred blackout windows are estimates (labeled ESTIMATE in the dossier copy): companies disclose that a policy exists but do not publish exact blackout dates.",
      ],
    }
  );
}
