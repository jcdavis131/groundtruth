// Bundled snapshot -> GeoJSON point features and the lookups the route and
// the market report use: by bounding box, by county, by text. Pure and
// synchronous: the bundle is imported at build time, nothing is fetched.
//
// Feature `kind` is the GICS-style sector slug so the style can colour by
// sector; `details` is what the info panel prints verbatim; `extra` carries
// the record for the aside.

import type { Point } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import { fmtNum } from "@/lib/economy/features";
import { edgarCompanyUrl } from "./edgar";
import { fmtMoney } from "./facts";
import { sicToSector } from "./sectors";
import type { Bbox } from "./params";
import type { CompanyBundle, CompanyExtra, CompanyRecord } from "./types";
import bundleJson from "./data/companies.json";

export const BUNDLE: CompanyBundle = bundleJson as unknown as CompanyBundle;

/** The snapshot's companies that can be drawn: a point and a ticker. */
export function placedCompanies(bundle: CompanyBundle = BUNDLE): CompanyRecord[] {
  return bundle.companies.filter((c) => c.lon != null && c.lat != null && Number.isFinite(c.lon) && Number.isFinite(c.lat) && !!c.ticker);
}

/** HQ line as printed in the HUD: "Cupertino, CA 95014". */
export function hqLine(c: Pick<CompanyRecord, "city" | "state" | "zip">): string {
  const cityState = [c.city, c.state].filter(Boolean).join(", ");
  return [cityState, c.zip].filter(Boolean).join(" ") || "not published";
}

/** Snapshot row -> LayerFeature. Returns null when the company has no position. */
export function toFeature(c: CompanyRecord): LayerFeature<Point> | null {
  if (c.lon == null || c.lat == null || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) return null;
  const sector = sicToSector(c.sic);
  const rev = c.facts?.Revenues ?? null;
  const ni = c.facts?.NetIncomeLoss ?? null;
  const emp = c.facts?.EntityNumberOfEmployees ?? null;
  const details: Record<string, string | number | null | undefined> = {
    ticker: c.exchange ? `${c.ticker} · ${c.exchange}` : c.ticker,
    CIK: String(c.cik),
    sector: `${sector.gicsTitle}${sector.etfs.length ? ` · ${sector.etfs.join(" ")}` : ""}`,
    SIC: c.sic ? `${c.sic} ${c.sicDescription ?? ""}`.trim() : null,
    HQ: hqLine(c),
    county: c.countyFips ? `FIPS ${c.countyFips}` : null,
    revenue: rev ? `${fmtMoney(rev.value)} (${rev.period})` : null,
    "net income": ni ? `${fmtMoney(ni.value)} (${ni.period})` : null,
    employees: emp ? `${fmtNum(emp.value)} (${emp.period})` : null,
    "fiscal year end": c.fiscalYearEnd ? `${c.fiscalYearEnd.slice(0, 2)}/${c.fiscalYearEnd.slice(2)}` : null,
    EDGAR: edgarCompanyUrl(c.cik),
    placed: c.geo === "zcta-centroid" ? "ZIP centroid (Census ZCTA)" : c.geo === "city-centroid" ? "city centroid (approximate)" : null,
  };
  const extra: CompanyExtra = {
    cik: c.cik,
    ticker: c.ticker,
    exchange: c.exchange,
    sic: c.sic,
    sicDescription: c.sicDescription,
    sector,
    city: c.city,
    state: c.state,
    zip: c.zip,
    countyFips: c.countyFips,
    geo: c.geo,
    fiscalYearEnd: c.fiscalYearEnd,
    facts: c.facts ?? {},
    pulled: c.pulled,
    edgarUrl: edgarCompanyUrl(c.cik),
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [c.lon, c.lat, 0] },
    properties: {
      id: `cik:${c.cik}`,
      layer: "companies",
      name: c.name,
      kind: sector.gics,
      altitude: 0,
      source: "SEC EDGAR",
      details,
      extra,
    },
  };
}

function inBox(c: CompanyRecord, [w, s, e, n]: Bbox): boolean {
  return c.lon != null && c.lat != null && c.lon >= w && c.lon <= e && c.lat >= s && c.lat <= n;
}

/** Revenue as a size proxy for ordering when a box holds more companies than the cap. */
function sizeOf(c: CompanyRecord): number {
  return c.facts?.Revenues?.value ?? c.facts?.Assets?.value ?? -1;
}

/** Companies headquartered inside the box, largest by revenue first, capped. */
export function companiesInBbox(bbox: Bbox, cap = 2000, bundle: CompanyBundle = BUNDLE): LayerFeature<Point>[] {
  return placedCompanies(bundle)
    .filter((c) => inBox(c, bbox))
    .sort((a, b) => sizeOf(b) - sizeOf(a))
    .slice(0, cap)
    .map(toFeature)
    .filter((f): f is LayerFeature<Point> => !!f);
}

/** Companies headquartered in a county (five-digit GEOID) or a state (SS000), largest first. */
export function companiesInCounty(fips: string, bundle: CompanyBundle = BUNDLE): LayerFeature<Point>[] {
  const state = fips.endsWith("000") ? fips.slice(0, 2) : null;
  return bundle.companies
    .filter((c) => (state ? (c.countyFips ?? "").startsWith(state) && !!c.countyFips : c.countyFips === fips))
    .sort((a, b) => sizeOf(b) - sizeOf(a))
    .map(toFeature)
    .filter((f): f is LayerFeature<Point> => !!f);
}

/**
 * Text search over ticker and name: an exact ticker match ranks first, then
 * ticker prefix, then name prefix, then name contains. Case-insensitive.
 */
export function searchCompanies(q: string, limit = 25, bundle: CompanyBundle = BUNDLE): LayerFeature<Point>[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<[number, CompanyRecord]> = [];
  for (const c of bundle.companies) {
    const t = c.ticker.toLowerCase();
    const n = c.name.toLowerCase();
    let score = 0;
    if (t === needle) score = 4;
    else if (t.startsWith(needle)) score = 3;
    else if (n.startsWith(needle)) score = 2;
    else if (n.includes(needle)) score = 1;
    if (score) scored.push([score, c]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || sizeOf(b[1]) - sizeOf(a[1]))
    .slice(0, limit)
    .map(([, c]) => toFeature(c))
    .filter((f): f is LayerFeature<Point> => !!f);
}

/** Find one snapshot row by ticker (case-insensitive) or CIK. */
export function findCompany(by: { ticker?: string | null; cik?: number | null }, bundle: CompanyBundle = BUNDLE): CompanyRecord | null {
  if (by.cik != null) return bundle.companies.find((c) => c.cik === by.cik) ?? null;
  if (by.ticker) {
    const t = by.ticker.toUpperCase();
    return bundle.companies.find((c) => c.ticker.toUpperCase() === t) ?? null;
  }
  return null;
}

export const CSV_COLUMNS = ["cik", "ticker", "name", "exchange", "sector", "etfs", "sic", "sic_description", "city", "state", "zip", "county_fips", "lon", "lat", "geo", "fiscal_year_end", "revenue", "revenue_period", "net_income", "net_income_period", "assets", "assets_period", "employees", "edgar_url"] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Features -> CSV with a fixed header; raw numbers, no formatting. */
export function companiesCsv(features: LayerFeature<Point>[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const f of features) {
    const x = f.properties.extra as CompanyExtra;
    const [lon, lat] = f.geometry.coordinates;
    const rev = x.facts.Revenues ?? null;
    const ni = x.facts.NetIncomeLoss ?? null;
    const as = x.facts.Assets ?? null;
    const emp = x.facts.EntityNumberOfEmployees ?? null;
    lines.push(
      [
        x.cik,
        x.ticker,
        f.properties.name,
        x.exchange,
        x.sector.gics,
        x.sector.etfs.join(" "),
        x.sic,
        x.sicDescription,
        x.city,
        x.state,
        x.zip,
        x.countyFips,
        lon,
        lat,
        x.geo,
        x.fiscalYearEnd,
        rev?.value ?? null,
        rev?.period ?? null,
        ni?.value ?? null,
        ni?.period ?? null,
        as?.value ?? null,
        as?.period ?? null,
        emp?.value ?? null,
        x.edgarUrl,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
