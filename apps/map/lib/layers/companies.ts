// Layer 14: public companies. Where listed companies are headquartered and
// what they report to the SEC.
//
//   SEC EDGAR        company_tickers_exchange.json for the universe, the
//                    submissions API for the registered business address and
//                    SIC, the XBRL frames API for annual financial facts;
//                    bundled as lib/companies/data/companies.json by
//                    scripts/companies-data.mjs because 6,000+ filers cannot
//                    be fetched at request time under the fair-access policy
//   Census           ZCTA-to-county relationship file (county) and TIGERweb
//                    ZCTA centroids (position)
//
// The layer activates below 3,000 km and fetches the HQs in the visible
// box. Selecting a company loads the live dossier (filings, facts) through
// /api/companies?op=company. Company-level public filings only; nothing
// about people.

import type { Point, FeatureCollection } from "geojson";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";

export type { CompanyExtra, CompanyRecord, SectorMapping } from "@/lib/companies/types";

/** Above this camera height the layer shows nothing and says why. */
export const COMPANIES_MAX_HEIGHT_M = 3_000_000;

interface Env {
  data: FeatureCollection<Point, BaseProps>;
  source?: string;
  count?: number;
  capped?: boolean;
  pulled?: string | null;
  cacheAge?: number;
}

async function fetchCompanies(ctx: FetchContext): Promise<FetchResult> {
  const h = ctx.view.height;
  if (h > COMPANIES_MAX_HEIGHT_M) {
    return { collection: { type: "FeatureCollection", features: [] }, source: "SEC EDGAR", fetchedAt: ctx.now, note: "descend below 3,000 km for company headquarters" };
  }
  // With the horizon in view there is no visible extent; cover the ground under the camera instead.
  const bbox = viewBbox(ctx, ctx.view.bbox ? 300_000 : Math.min(h, 1_500_000))
    .map((x) => x.toFixed(2))
    .join(",");
  const env = await proxy<Env["data"]>(`/api/companies?op=near&bbox=${bbox}`, ctx);
  const e = env as unknown as Env;
  const features = e.data.features as LayerFeature<Point>[];
  const notes: string[] = [`${features.length} headquarters in view`];
  if (e.capped) notes.push("capped at 2,000, largest by revenue kept");
  notes.push(e.pulled ? `snapshot ${e.pulled}` : "fixture snapshot; run scripts/companies-data.mjs for the full universe and facts");
  return {
    collection: { type: "FeatureCollection", features },
    source: "SEC EDGAR",
    fetchedAt: ctx.now,
    note: notes.join(" · "),
    meta: { count: features.length, pulled: e.pulled ?? null, capped: !!e.capped },
  };
}

export const companiesLayer: LayerDefinition = {
  id: "companies",
  label: "Public companies",
  description:
    "Listed companies at their SEC-registered business address, coloured by sector, with recent filings, annual revenue, income, assets and equity from XBRL on selection, and a sector-to-ETF bridge stated as a convention. Company-level filings only; no insiders, officers or shareholders.",
  color: "#7CC4FF",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  attribution: "SEC EDGAR (public domain) · US Census Bureau ZCTA relationship file and TIGERweb",
  fetch: fetchCompanies,
};
