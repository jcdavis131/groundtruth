// The companies section of a place: which public filers give a business
// address in this county, and which GICS sectors the county's jobs mix leans
// on. Pure and synchronous - the snapshot is a build-time import - so this is
// the one section of a place page that works with no network at all.
//
// Two rules the shape encodes. It returns null rather than an empty section,
// because "no rows" and "no public companies are headquartered here" are
// different claims and the fixture cannot tell them apart: the committed
// bundle is 25 hand-checked rows across 18 counties, so an empty list would be
// false for roughly 3,125 of them. And when BUNDLE.pulled is null the summary
// says in words that these are fixture rows, not a pull, so nobody reads a
// null revenue as a company that earns nothing.
//
// Ethics: registered business addresses and legal entities only. Positions are
// ZCTA or city centroids, which the basis line states; no officer, insider or
// shareholder data is read anywhere (lib/companies/edgar.ts DOSSIER_FORMS
// already excludes Forms 3, 4 and 5 - do not widen it).

import type { SectorRow } from "@/lib/economy/features";
import type { MarketItem, MarketSection } from "@/lib/economy/report";
import { dedupeProvenance } from "@/lib/provenance/collect";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { BUNDLE, companiesInCounty, hqLine } from "./features";
import { countySectorExposure } from "./sectors";
import type { CompanyExtra, SectorExposure } from "./types";

/** Companies named in the section body; the count reports the rest. */
export const MAX_COMPANY_ITEMS = 10;

export interface CompaniesData {
  n: number;
  withFacts: number;
  /** ISO date the snapshot was pulled; null while it is a committed fixture. */
  bundlePulled: string | null;
  sectorExposure: SectorExposure[];
}

export type CompaniesSection = MarketSection<CompaniesData>;

/** Where the bundled snapshot came from and how its points were placed. */
export function bundleProvenance(retrievedAt?: string): Provenance[] {
  const notes = [BUNDLE.pulled ? `snapshot pulled ${BUNDLE.pulled}` : "committed fixture; financial facts are null until scripts/companies-data.mjs runs"];
  return [
    provenance(source("sec-edgar"), { kind: "published", upstreamUrl: "https://www.sec.gov/files/company_tickers_exchange.json", releasedAt: BUNDLE.pulled ?? undefined, retrievedAt, notes }),
    provenance(source("census-zcta-county"), { kind: "published", retrievedAt, notes: ["business-address ZIP to county, largest land-area share"] }),
    provenance(source("census-tigerweb"), { kind: "published", retrievedAt, notes: ["ZCTA centroid places the HQ; a city centroid is used where the fixture says so"] }),
  ];
}

export const BUNDLE_CAVEATS: readonly string[] = [
  "Positions are ZIP or city centroids of the registered business address, not building footprints.",
  "Sector and ETF names are a stated convention (lib/companies/sectors.ts), not classification by MSCI/S&P and not advice.",
];

const BASIS =
  "Public filers whose registered business address with the SEC falls in this county, from a committed snapshot of EDGAR's company_tickers_exchange file. A position is the centroid of the address's ZIP code (Census ZCTA) or, where the snapshot says so, of its city: it is not a building. Legal entities only - no officer, insider or shareholder data is read, and Forms 3, 4 and 5 are excluded everywhere. Sector exposure is the county's BLS QCEW jobs mix bridged to GICS sectors by a convention documented in lib/companies/sectors.ts; a jobs mix is not a portfolio.";

function factCount(extra: CompanyExtra | undefined): number {
  if (!extra?.facts) return 0;
  return Object.values(extra.facts).filter((f) => f != null).length;
}

/**
 * The section for one county (SSCCC) or state (SS000). Returns null when the
 * snapshot has no row there, so the caller omits the section rather than
 * printing an empty list.
 */
export function companiesSection(fips: string, opts: { sectors?: SectorRow[]; retrievedAt?: string } = {}): CompaniesSection | null {
  const features = companiesInCounty(fips);
  if (!features.length) return null;
  const at = opts.retrievedAt ?? new Date().toISOString();
  const sectorExposure = countySectorExposure(opts.sectors ?? [], { fips, retrievedAt: at });

  const items: MarketItem[] = [];
  let withFacts = 0;
  for (const f of features) {
    const extra = f.properties.extra as CompanyExtra | undefined;
    if (factCount(extra) > 0) withFacts++;
    if (items.length >= MAX_COMPANY_ITEMS) continue;
    const ticker = extra?.exchange ? `${extra.ticker} · ${extra.exchange}` : (extra?.ticker ?? "");
    const where = extra ? hqLine(extra) : "";
    items.push({
      id: f.properties.id,
      layer: "companies",
      name: f.properties.name,
      value: [ticker, extra?.sector.gicsTitle, where].filter(Boolean).join(" · "),
    });
  }

  const n = features.length;
  const named = features
    .slice(0, 3)
    .map((f) => f.properties.name)
    .join(", ");
  const lead = `${n} public compan${n === 1 ? "y files" : "ies file"} with the SEC from a business address here (${named}${n > 3 ? `, and ${n - 3} more` : ""})`;
  const summary = BUNDLE.pulled
    ? `${lead}. The snapshot was pulled ${BUNDLE.pulled}; ${withFacts} of ${n} carry financial facts.`
    : `${lead}. These rows are a committed fixture, not a pull: the snapshot has never been refreshed, so every financial fact is null and the list is not a complete census of filers in this county.`;
  const exposureLine = sectorExposure.length
    ? ` The county's jobs mix maps to ${sectorExposure.length} GICS sector${sectorExposure.length === 1 ? "" : "s"}, led by ${sectorExposure[0].gicsTitle}.`
    : "";

  return {
    title: "Public companies",
    loaded: true,
    summary: summary + exposureLine,
    basis: BASIS,
    provenance: dedupeProvenance([bundleProvenance(at), sectorExposure.length ? sectorExposure.map((e) => e.provenance) : undefined]),
    items,
    data: { n, withFacts, bundlePulled: BUNDLE.pulled, sectorExposure },
  };
}
