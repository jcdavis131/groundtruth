// Placing a company: business-address ZIP -> county (Census 2020 ZCTA to
// county relationship file) and ZIP -> point (TIGERweb ZCTA centroid). Both
// keyless and public domain. A ZIP is not a ZCTA, but the Census Bureau's
// ZCTAs are built from ZIP codes and match them for the vast majority of
// street addresses; the record says which method placed it.
//
// The parsers are pure and unit-tested; the fetchers are used by
// scripts/companies-data.mjs (via the same URLs) and by the route only when a
// company is not in the bundle.
//
// shape per https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/2020-zcta-record-layout.html; unverified in sandbox

import { cached } from "@/lib/server/cache";
import { polite, upstream, upstreamJson } from "@/lib/server/upstream";

export const ZCTA_COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";

/**
 * TIGERweb generalized ACS2023 ZCTA layer. The layer id inside the
 * Tracts_Blocks service could not be checked from the sandbox; the service
 * directory lists it as "Zip Code Tabulation Areas". Change ZCTA_LAYER_ID
 * here if the query returns an ArcGIS "Invalid layer" error, and see
 * scripts/companies-data.mjs which fails loudly when a query returns no
 * features.
 */
export const TIGER_ZCTA_SERVICE = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/Tracts_Blocks/MapServer";
export const ZCTA_LAYER_ID = 2; // unverified in sandbox; see comment above

/** First five digits of a US ZIP / ZIP+4; null for anything else (foreign postcodes, blanks). */
export function normalizeZip(zip: string | null | undefined): string | null {
  const m = String(zip ?? "").trim().match(/^(\d{5})(?:-?\d{4})?$/);
  return m ? m[1] : null;
}

/**
 * Parse the pipe-delimited ZCTA -> county relationship file into a
 * ZCTA -> county GEOID map, keeping the county with the largest land area
 * share when a ZCTA straddles several. Column names are read from the
 * header line, so a reordered release still parses.
 */
export function parseZctaCounty(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return new Map();
  const header = lines[0].split("|").map((h) => h.trim().replace(/^﻿/, ""));
  const iZcta = header.indexOf("GEOID_ZCTA5_20");
  const iCounty = header.indexOf("GEOID_COUNTY_20");
  const iLand = header.indexOf("AREALAND_PART");
  if (iZcta < 0 || iCounty < 0) throw new Error("ZCTA relationship file: GEOID_ZCTA5_20 / GEOID_COUNTY_20 columns missing");
  const best = new Map<string, { county: string; land: number }>();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("|");
    const zcta = (cells[iZcta] ?? "").trim();
    const county = (cells[iCounty] ?? "").trim();
    if (!/^\d{5}$/.test(zcta) || !/^\d{5}$/.test(county)) continue;
    const land = iLand >= 0 ? Number(cells[iLand]) : 0;
    const l = Number.isFinite(land) ? land : 0;
    const cur = best.get(zcta);
    if (!cur || l > cur.land) best.set(zcta, { county, land: l });
  }
  return new Map([...best.entries()].map(([z, v]) => [z, v.county]));
}

export interface ZctaCentroidResponse {
  features?: Array<{ attributes?: Record<string, unknown>; properties?: Record<string, unknown> }>;
  error?: { message?: string };
}

/** Query string for one ZCTA's centroid from the TIGERweb layer (CENTLAT/CENTLON attributes, no geometry). */
export function zctaCentroidQuery(zcta: string): string {
  const qs = new URLSearchParams({
    where: `ZCTA5=${JSON.stringify(zcta).replace(/"/g, "'")}`,
    outFields: "ZCTA5,CENTLAT,CENTLON",
    returnGeometry: "false",
    f: "json",
  });
  return `${TIGER_ZCTA_SERVICE}/${ZCTA_LAYER_ID}/query?${qs}`;
}

/** [lon, lat] from a TIGERweb attribute query, or null when no feature came back. Throws on an ArcGIS error object. */
export function parseZctaCentroid(j: ZctaCentroidResponse): [number, number] | null {
  if (j?.error) throw new Error("TIGERweb: " + (j.error.message ?? "error"));
  const f = j?.features?.[0];
  const a = f?.attributes ?? f?.properties;
  if (!a) return null;
  const lat = Number(a.CENTLAT);
  const lon = Number(a.CENTLON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4];
}

const H = 3600_000;

/** ZCTA -> county map, fetched once a day (the file is ~5 MB and changes with a decennial census). */
export function zctaCounties(): Promise<Map<string, string>> {
  return cached("census:zcta-county", 7 * 24 * H, async () => {
    const res = await upstream("census-zcta", ZCTA_COUNTY_URL, { timeoutMs: 60_000, headers: { accept: "text/plain,*/*" } });
    return parseZctaCounty(await res.text());
  }).then((c) => c.value);
}

/** Centroid of one ZCTA from TIGERweb, null when the layer has no such ZCTA. */
export function zctaCentroid(zcta: string): Promise<[number, number] | null> {
  return cached(`tiger:zcta:${zcta}`, 30 * 24 * H, async () => {
    const j = await polite("tigerweb", 150, 30_000, () => upstreamJson<ZctaCentroidResponse>("tigerweb", zctaCentroidQuery(zcta), { timeoutMs: 30_000 }));
    return parseZctaCentroid(j);
  }).then((c) => c.value);
}
