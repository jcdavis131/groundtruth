// FCC Broadband Data Collection (December 2025), as Esri Policy Maps
// summarizes it on ArcGIS Online (owner esri_policymaps, CORS *). Pure: the
// field lists, the four measures, the fixed breaks, the row parser, the county
// join onto the shared county outlines (lib/layers/areas.ts), BDC's own H3
// resolution-8 hexagons, the click lines and the place answer. The route is
// /api/civic?op=broadband.
//
//   county  every county once (two pages of 2,000), attributes only, joined by
//           FIPS onto the county outlines the globe already draws
//   hex     BDC's own H3 r8 hexagons below BROADBAND_HEX_MAX_M, in a box of at
//           most 0.3 degrees, one page of 2,000
//   place   one county with every technology column, for the click and MCP
//
// The figures are the FCC's (providers' availability filings, counted at
// Broadband Serviceable Locations); the summary layer and its geometry are
// Esri's packaging of them, under the Esri Master License Agreement. Both are
// credited everywhere the data is shown. FCC's own map host answers 403 to a
// keyless call (2026-10-17), so there is no public-domain path today (D6-1).
//
// Connecticut: this layer still publishes the eight legacy counties
// (09001-09015); the globe's outlines are the nine planning regions
// (09110-09190). No crosswalk is invented: the regions are drawn unfilled with
// "not published in this geography", and the eight rows are counted unmatched.
// The hexagons below 60 km still cover Connecticut.
//
// A share is a ratio of two published counts (e.g. UnservedBSLs / TotalBSLs).
// A geography with no locations (TotalBSLs = 0; none on 2026-10-17) has no
// share: null, never 0 %.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";

export const BDC_SERVICE = "https://services8.arcgis.com/peDZJliSvYims39Q/arcgis/rest/services/FCC_Broadband_Data_Collection_December_2024_View/FeatureServer";
/** "Counties" (3,234 rows on 2026-10-17). */
export const BDC_COUNTY_LAYER = `${BDC_SERVICE}/1`;
/** "H3 Resolution 8" (3,835,270 hexagons on 2026-10-17). */
export const BDC_HEX_LAYER = `${BDC_SERVICE}/5`;
/** The layers' maxRecordCount (read 2026-10-17). */
export const BDC_PAGE = 2000;
export const BDC_COUNTY_PAGES = 2;
/** Below this camera height the layer shows BDC's own hexagons. */
export const BROADBAND_HEX_MAX_M = 60_000;
/** The largest hexagon box, degrees a side (about 612 kB at the 2,000-row cap). */
export const BROADBAND_HEX_BOX_DEG = 0.3;

/** The fields asked for counties and hexagons (named, never *). */
export const BDC_FIELDS = [
  "GEOID",
  "TotalBSLs",
  "UnservedBSLs",
  "UnderservedBSLs",
  "ServedBSLs",
  "ServedBSLsFiber",
  "ServedBSLsCable",
  "ServedBSLsLTFW",
  "UniqueProviders",
  "UnservedBSLs_12monthPrevious",
] as const;

const TECHS = ["Copper", "Cable", "Fiber", "LTFW", "LBRTFW"] as const;
/** The technologies as the item description names them. */
export const BDC_TECH_NAMES: Record<(typeof TECHS)[number], string> = {
  Copper: "copper",
  Cable: "cable",
  Fiber: "fiber",
  LTFW: "licensed fixed wireless",
  LBRTFW: "licensed-by-rule fixed wireless",
};

/** The place answer's fields: every count by technology, providers, and the 6- and 12-month-previous counts as published. */
export const BDC_PLACE_FIELDS = [
  "GEOID",
  "CountyName",
  "StateAbbr",
  "TotalBSLs",
  "UnservedBSLs",
  "UnderservedBSLs",
  "ServedBSLs",
  ...TECHS.flatMap((t) => [`UnservedBSLs${t}`, `UnderservedBSLs${t}`, `ServedBSLs${t}`]),
  "UniqueProviders",
  ...TECHS.map((t) => `UniqueProviders${t}`),
  "UnservedBSLs_6monthPrevious",
  "UnderservedBSLs_6monthPrevious",
  "ServedBSLs_6monthPrevious",
  "UnservedBSLs_12monthPrevious",
  "UnderservedBSLs_12monthPrevious",
  "ServedBSLs_12monthPrevious",
] as const;

/** The four measures the layer can colour by. Shares are percentages of TotalBSLs. */
export const BROADBAND_MEASURES = [
  { id: "unserved", name: "Unserved share", field: "UnservedBSLs", unit: "%" },
  { id: "underserved", name: "Underserved share", field: "UnderservedBSLs", unit: "%" },
  { id: "fiber", name: "Served by fiber share", field: "ServedBSLsFiber", unit: "%" },
  { id: "providers", name: "Providers (unique)", field: "UniqueProviders", unit: "providers" },
] as const;
export type BroadbandMeasure = 0 | 1 | 2 | 3;

export function parseBroadbandMeasure(v: unknown): BroadbandMeasure {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[0-3]$/.test(v.trim()) ? Number(v.trim()) : 0;
  return (Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0) as BroadbandMeasure;
}

/** Fixed breaks, the same in every view: shares in percent, providers as a count. */
export const SHARE_BREAKS = [1, 2, 5, 10, 25] as const;
export const SHARE_BIN_LABELS = ["under 1 %", "1 to 2 %", "2 to 5 %", "5 to 10 %", "10 to 25 %", "25 % or more"] as const;
export const PROVIDER_BREAKS = [3, 5, 10, 20, 40] as const;
export const PROVIDER_BIN_LABELS = ["1 or 2", "3 or 4", "5 to 9", "10 to 19", "20 to 39", "40 or more"] as const;
/** Low (pale) to high (deep). */
export const BROADBAND_BIN_COLORS = ["#EFF6FF", "#BFDBFE", "#60A5FA", "#2563EB", "#1E40AF", "#172554"] as const;
export const BROADBAND_NO_DATA_EDGE = "#9CA3AF";

export function breaksFor(m: BroadbandMeasure): readonly number[] {
  return m === 3 ? PROVIDER_BREAKS : SHARE_BREAKS;
}
export function binLabelsFor(m: BroadbandMeasure): readonly string[] {
  return m === 3 ? PROVIDER_BIN_LABELS : SHARE_BIN_LABELS;
}

/** The item description's definitions (Esri's summary of the FCC tiers, quoted). */
export const BDC_DEFINITIONS = {
  served: "low-latency Fiber, Cable, Copper, or Licensed Terrestrial Fixed Wireless offering of speeds greater than or equal to 100/20 Mbps.",
  underserved: "low-latency Fiber, Cable, Copper, or Terrestrial Licensed Fixed Wireless offering of speeds less than 100/20 Mbps, but greater than or equal to 25/3 Mbps.",
  unserved: "all service that is not low-latency or less than 25/3 Mbps, and all Geostationary Satellite, Non-geostationary Satellite, Unlicensed Terrestrial Fixed Wireless, and Other.",
} as const;

export const BDC_LICENCE = "Summarized by Esri from FCC data; Esri's layer is under the Esri Master License Agreement.";
export const BROADBAND_CAVEAT =
  "Fixed broadband availability as providers reported it to the FCC for December 2025, counted at Broadband Serviceable Locations. Available is not subscribed, and a provider's claim is not a measured speed. Summarized by Esri from FCC data; Esri's layer is under the Esri Master License Agreement. Connecticut is published here in its old counties, so its planning regions are not shown.";
export const BDC_VINTAGE_NOTE =
  "The service is named FCC_Broadband_Data_Collection_December_2024_View; its item is titled 'FCC Broadband Data Collection December 2025 (Latest)' and its description says December 2025. The item title is trusted (Esri's own statement of the vintage; the county layer's data was last edited 2026-06-10).";
export const BDC_ATTRIBUTION = "Federal Communications Commission, Broadband Data Collection (December 2025), as summarized by Esri (Esri Master License Agreement).";
export const BDC_SOURCE_LABEL = "FCC BDC December 2025, summarized by Esri";

/** Legacy Connecticut county FIPS, which the globe's outlines no longer carry. */
export const CT_LEGACY = /^090(0[1-9]|1[0-5])$/;
export const CT_REGION = /^091[1-9]0$/;

export interface BdcRow {
  geoid: string;
  total: number | null;
  unserved: number | null;
  underserved: number | null;
  served: number | null;
  fiber: number | null;
  cable: number | null;
  ltfw: number | null;
  providers: number | null;
  unserved12: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A published count; anything else (null, negative, not a number) is null. */
const cnt = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** One BDC attribute row -> a typed row; null when it has no GEOID. */
export function bdcRow(a: Readonly<Record<string, unknown>>): BdcRow | null {
  const geoid = str(a.GEOID);
  if (!geoid) return null;
  return {
    geoid,
    total: cnt(a.TotalBSLs),
    unserved: cnt(a.UnservedBSLs),
    underserved: cnt(a.UnderservedBSLs),
    served: cnt(a.ServedBSLs),
    fiber: cnt(a.ServedBSLsFiber),
    cable: cnt(a.ServedBSLsCable),
    ltfw: cnt(a.ServedBSLsLTFW),
    providers: cnt(a.UniqueProviders),
    unserved12: cnt(a.UnservedBSLs_12monthPrevious),
  };
}

/** The wire order of a compact county row (the route sends arrays, the layer reads them back). */
export const BDC_ROW_COLUMNS = ["geoid", "total", "unserved", "underserved", "served", "fiber", "cable", "ltfw", "providers", "unserved12"] as const;
export type BdcWireRow = [string, ...Array<number | null>];

export const packBdcRow = (r: BdcRow): BdcWireRow => [r.geoid, r.total, r.unserved, r.underserved, r.served, r.fiber, r.cable, r.ltfw, r.providers, r.unserved12];
export function unpackBdcRow(w: readonly unknown[]): BdcRow | null {
  const geoid = typeof w[0] === "string" ? w[0] : null;
  if (!geoid) return null;
  const n = (i: number) => cnt(w[i]);
  return { geoid, total: n(1), unserved: n(2), underserved: n(3), served: n(4), fiber: n(5), cable: n(6), ltfw: n(7), providers: n(8), unserved12: n(9) };
}

/** n / total as a fraction; null when either is unpublished or there are no locations. */
export function share(n: number | null, total: number | null): number | null {
  if (n == null || total == null || total <= 0) return null;
  return n / total;
}

/** The value a measure colours by: a percentage for the shares, a count for providers. Null: no bin. */
export function measureValue(r: BdcRow, m: BroadbandMeasure): number | null {
  if (m === 3) return r.total != null && r.total > 0 ? r.providers : null;
  const s = share(m === 0 ? r.unserved : m === 1 ? r.underserved : r.fiber, r.total);
  return s == null ? null : s * 100;
}

export function broadbandBin(v: number | null, m: BroadbandMeasure): number | null {
  if (v == null) return null;
  const br = breaksFor(m);
  let b = 0;
  while (b < br.length && v >= br[b]) b++;
  return b;
}

const fmtN = (v: number | null) => (v == null ? "not published" : v.toLocaleString("en-US"));
/** A share for display: "0.8 %" (one decimal), "not published" when null. */
export function fmtShare(n: number | null, total: number | null): string {
  const s = share(n, total);
  if (s == null) return total === 0 ? "no locations" : "not published";
  return `${(s * 100).toFixed(1)} %`;
}

/** The click lines for a county or hexagon row. */
export function broadbandDetails(r: BdcRow, level: "county" | "hex"): Record<string, string> {
  const d: Record<string, string> = {};
  d["broadband serviceable locations"] = fmtN(r.total);
  d.served = `${fmtN(r.served)} (${fmtShare(r.served, r.total)})`;
  d.underserved = `${fmtN(r.underserved)} (${fmtShare(r.underserved, r.total)})`;
  d.unserved = `${fmtN(r.unserved)} (${fmtShare(r.unserved, r.total)})`;
  d["served by fiber"] = `${fmtN(r.fiber)} (${fmtShare(r.fiber, r.total)})`;
  d["served by cable"] = fmtN(r.cable);
  d["served by licensed fixed wireless"] = fmtN(r.ltfw);
  d["providers (unique)"] = fmtN(r.providers);
  d["unserved 12 months earlier"] = fmtN(r.unserved12);
  d["served means"] = BDC_DEFINITIONS.served;
  d["underserved means"] = BDC_DEFINITIONS.underserved;
  d["unserved means"] = BDC_DEFINITIONS.unserved;
  d[level === "county" ? "county fips" : "H3 hexagon"] = r.geoid;
  d.source = BDC_SOURCE_LABEL;
  d.licence = "Esri Master License Agreement (Esri's layer); figures from the FCC";
  return d;
}

export interface BroadbandExtra {
  level: "county" | "hex";
  geoid: string;
  row: BdcRow | null;
  measure: BroadbandMeasure;
  value: number | null;
  bin: number | null;
  /** Why it has no bin. */
  noData: string | null;
}

function noDataReason(row: BdcRow | null, geoid: string): string {
  if (!row) return CT_REGION.test(geoid) ? "not published in this geography (BDC uses Connecticut's old counties)" : "not in this release";
  return row.total === 0 ? "no locations" : "not published";
}

function feature(id: string, name: string, geometry: Polygon | MultiPolygon, geoid: string, row: BdcRow | null, level: "county" | "hex", m: BroadbandMeasure, anchor?: [number, number]): LayerFeature<Polygon | MultiPolygon> {
  const value = row ? measureValue(row, m) : null;
  const bin = broadbandBin(value, m);
  const noData = bin != null ? null : noDataReason(row, geoid);
  const extra: BroadbandExtra = { level, geoid, row, measure: m, value, bin, noData };
  return {
    type: "Feature",
    geometry,
    properties: {
      id,
      layer: "broadband",
      name,
      kind: bin == null ? "no-data" : `b${bin + 1}`,
      source: BDC_SOURCE_LABEL,
      details: row ? broadbandDetails(row, level) : { "broadband serviceable locations": noData ?? "not published", [level === "county" ? "county fips" : "H3 hexagon"]: geoid, source: BDC_SOURCE_LABEL },
      extra,
      anchor,
    },
  };
}

/**
 * County rows joined by FIPS onto county outlines. An outline with no row is "not in this
 * release" (Connecticut's planning regions: "not published in this geography"); a row with no
 * outline (Connecticut's eight legacy counties) is counted in `unmatched`.
 */
export function joinBroadbandCounties(
  outlines: ReadonlyArray<{ geoid: string; name: string; stusab?: string; feature: LayerFeature<Polygon | MultiPolygon> }>,
  rows: readonly BdcRow[],
  m: BroadbandMeasure,
): { features: LayerFeature<Polygon | MultiPolygon>[]; drawn: number; noData: number; ctRegions: number; unmatched: string[] } {
  const by = new Map<string, BdcRow>();
  for (const r of rows) by.set(r.geoid, r);
  const used = new Set<string>();
  let drawn = 0;
  let noData = 0;
  let ctRegions = 0;
  const features = outlines.map((o) => {
    const r = by.get(o.geoid) ?? null;
    if (r) used.add(o.geoid);
    const f = feature(`broadband:county:${o.geoid}`, o.stusab ? `${o.name}, ${o.stusab}` : o.name, o.feature.geometry, o.geoid, r, "county", m, o.feature.properties.anchor);
    const x = f.properties.extra as BroadbandExtra;
    if (x.bin != null) drawn++;
    else {
      noData++;
      if (!r && CT_REGION.test(o.geoid)) ctRegions++;
    }
    return f;
  });
  const unmatched = [...by.keys()].filter((k) => !used.has(k)).sort();
  return { features, drawn, noData, ctRegions, unmatched };
}

/** BDC hexagon features (f=geojson rows with their own geometry), named by H3 id; a hexagon that comes back twice is drawn once. */
export function buildBroadbandHexes(rows: ReadonlyArray<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>, m: BroadbandMeasure): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  const seen = new Set<string>();
  for (const f of rows) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const r = bdcRow(f.properties ?? {});
    if (!r || seen.has(r.geoid)) continue;
    seen.add(r.geoid);
    out.push(feature(`broadband:hex:${r.geoid}`, `H3 ${r.geoid}`, g, r.geoid, r, "hex", m));
  }
  return out;
}

/** Re-colour features already built for another measure (no network). */
export function remeasureBroadband(features: ReadonlyArray<LayerFeature>, m: BroadbandMeasure): LayerFeature[] {
  return features.map((f) => {
    const x = f.properties.extra as BroadbandExtra | undefined;
    if (!x || x.measure === m) return f;
    const value = x.row ? measureValue(x.row, m) : null;
    const bin = broadbandBin(value, m);
    const noData = bin != null ? null : noDataReason(x.row, x.geoid);
    return { ...f, properties: { ...f.properties, kind: bin == null ? "no-data" : `b${bin + 1}`, extra: { ...x, measure: m, value, bin, noData } } };
  });
}

// ---------------------------------------------------------------- the place answer

export interface BdcPlace {
  geoid: string;
  county: string | null;
  state: string | null;
  totalLocations: number | null;
  served: number | null;
  underserved: number | null;
  unserved: number | null;
  byTechnology: Record<string, { served: number | null; underserved: number | null; unserved: number | null; providers: number | null }>;
  providers: number | null;
  previous: {
    sixMonths: { served: number | null; underserved: number | null; unserved: number | null };
    twelveMonths: { served: number | null; underserved: number | null; unserved: number | null };
  };
  /** Ratios of two published counts, each named with its formula; null where TotalBSLs is 0 or unpublished. */
  shares: Array<{ name: string; formula: string; value: number | null }>;
}

/** One county's full row as the place answer; null when it has no GEOID. */
export function bdcPlace(a: Readonly<Record<string, unknown>>): BdcPlace | null {
  const geoid = str(a.GEOID);
  if (!geoid) return null;
  const total = cnt(a.TotalBSLs);
  const byTechnology: BdcPlace["byTechnology"] = {};
  for (const t of TECHS) byTechnology[BDC_TECH_NAMES[t]] = { served: cnt(a[`ServedBSLs${t}`]), underserved: cnt(a[`UnderservedBSLs${t}`]), unserved: cnt(a[`UnservedBSLs${t}`]), providers: cnt(a[`UniqueProviders${t}`]) };
  const sh = (name: string, field: string) => ({ name, formula: `${field} / TotalBSLs`, value: share(cnt(a[field]), total) });
  return {
    geoid,
    county: str(a.CountyName),
    state: str(a.StateAbbr),
    totalLocations: total,
    served: cnt(a.ServedBSLs),
    underserved: cnt(a.UnderservedBSLs),
    unserved: cnt(a.UnservedBSLs),
    byTechnology,
    providers: cnt(a.UniqueProviders),
    previous: {
      sixMonths: { served: cnt(a.ServedBSLs_6monthPrevious), underserved: cnt(a.UnderservedBSLs_6monthPrevious), unserved: cnt(a.UnservedBSLs_6monthPrevious) },
      twelveMonths: { served: cnt(a.ServedBSLs_12monthPrevious), underserved: cnt(a.UnderservedBSLs_12monthPrevious), unserved: cnt(a.UnservedBSLs_12monthPrevious) },
    },
    shares: [sh("unserved share", "UnservedBSLs"), sh("underserved share", "UnderservedBSLs"), sh("served share", "ServedBSLs"), sh("served by fiber share", "ServedBSLsFiber")],
  };
}
