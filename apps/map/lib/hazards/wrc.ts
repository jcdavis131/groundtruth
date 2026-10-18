// USDA Forest Service Wildfire Risk to Communities (WRC, 2nd edition, 2024),
// county and community ranks, from the Rocky Mountain Research Station's
// ArcGIS Online services (owner USFSRMResearchStation, CORS *, CC0 1.0). Pure:
// the field lists, the four rank families by the service's own aliases, the
// percent-string parser, the fixed breaks, the county join onto the shared
// county outlines (lib/layers/areas.ts), WRC's own community polygons, and the
// click lines. The route is /api/hazards?op=wrc.
//
//   county  every county once (two pages of 2,000), attributes only, joined by
//           FIPS onto the county outlines the globe already draws; Connecticut
//           is in planning regions (09110-09190) in both
//   place   WRC's community (Census place) polygons below WRC_PLACE_MAX_M, in a
//           box of at most 1 degree, at most 1,000 rows
//   fips    one county (5 digits) or place (7 digits) for the click and MCP
//
// Ranks are strings with a "%" ("97.20%"): only the suffix is parsed, the
// string is kept as published for the click, and anything else (' ' for DC,
// the one unranked county; blanks for the 484 excluded places) is null with
// reason "not ranked by USFS", never 0. Which of RISK_* and EA_HURISK_* is
// wildfirerisk.org's "Risk to Homes" is not stated in the service, so the
// picker shows the service's aliases, not a plain-English name.
//
// The modelled values are WRC's 2nd edition (2024: LANDFIRE 2020 fuels, burn
// probability as of end-2020, intensity as of end-2022); the boundary layers
// were made in May 2025 from the 2023 TIGER/Line files. Firehazard draws WHP
// itself; these are WRC's community rankings.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";
import type { EmbedInput } from "@/lib/embed/types";

export const WRC_HOST = "https://services1.arcgis.com/gGHDlz6USftL5Pau/arcgis/rest/services";
/** WRC_County_Summary_Data (3,144 rows on 2026-10-17). */
export const WRC_COUNTY_LAYER = `${WRC_HOST}/county_boundaries_conus_ak_hi/FeatureServer/0`;
/** WRC_Community_Summary_Data (32,033 rows on 2026-10-17; 484 with exclude=1). */
export const WRC_PLACE_LAYER = `${WRC_HOST}/place_boundaries_conus_ak_hi/FeatureServer/0`;
export const WRC_PAGE = 2000;
export const WRC_COUNTY_PAGES = 2;
/** Below this camera height the layer shows community polygons. */
export const WRC_PLACE_MAX_M = 150_000;
/** The largest community box, degrees a side (about 1.9 kB a polygon at offset 0.001). */
export const WRC_PLACE_BOX_DEG = 1;
/** Rows asked for one box: 1,000 x 1.9 kB stays under the 4.5 MB response limit. */
export const WRC_PLACE_CAP = 1000;

/** The four rank families, by the service's own field aliases (national, then state). */
export const WRC_RANKS = [
  { national: "RISK_NATIO", state: "RISK_STATE", alias: "RISK_NATIONAL_RANK", stateAlias: "RISK_STATE_RANK" },
  { national: "BP_NATIONA", state: "BP_STATE_R", alias: "BP_NATIONAL_RANK", stateAlias: "BP_STATE_RANK" },
  { national: "WHP_NATION", state: "WHP_STATE_", alias: "WHP_NATIONAL_RANK", stateAlias: "WHP_STATE_RANK" },
  { national: "EA_HURISK1", state: "EA_HURISK_", alias: "EA_HURISK_NATIONAL_RANK", stateAlias: "EA_HURISK_STATE_RANK" },
] as const;
export type WrcMeasure = 0 | 1 | 2 | 3;
export type WrcScope = "national" | "state";

export function parseWrcMeasure(v: unknown): WrcMeasure {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[0-3]$/.test(v.trim()) ? Number(v.trim()) : 0;
  return (Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0) as WrcMeasure;
}
export const parseWrcScope = (v: unknown): WrcScope => (v === "state" ? "state" : "national");

/** The exposure shares (aliases as published): buildings and housing units in indirect (IE) and direct (DE) exposure. */
export const WRC_EXPOSURE = [
  { field: "BUILDINGS_", alias: "BUILDINGS_FRACTION_IE", label: "buildings in indirect exposure" },
  { field: "BUILDINGS1", alias: "BUILDINGS_FRACTION_DE", label: "buildings in direct exposure" },
  { field: "HU_FRACTIO", alias: "HU_FRACTION_IE", label: "housing units in indirect exposure" },
  { field: "HU_FRACT_1", alias: "HU_FRACTION_DE", label: "housing units in direct exposure" },
] as const;

/** The 14 rank and count fields, plus GEOID. */
export const WRC_VALUE_FIELDS = [...WRC_RANKS.flatMap((r) => [r.national, r.state]), ...WRC_EXPOSURE.map((e) => e.field), "TOTAL_BUIL", "TOTAL_HOUS"] as const;
export const WRC_COUNTY_FIELDS = ["GEOID", ...WRC_VALUE_FIELDS] as const;
export const WRC_PLACE_FIELDS = ["GEOID", "NAMELSAD", "STUSPS", ...WRC_VALUE_FIELDS, "exclude", "exclude_re"] as const;
/** The fips answer (one county or place): names for the click, every value field. */
export const WRC_FIPS_COUNTY_FIELDS = ["GEOID", "NAMELSAD", "STUSPS", ...WRC_VALUE_FIELDS] as const;

/** Fixed rank breaks (percent), the same in every view: 0-40, 40-70, 70-90, 90-95, 95-100. */
export const WRC_BREAKS = [40, 70, 90, 95] as const;
export const WRC_BIN_LABELS = ["under 40", "40 to 70", "70 to 90", "90 to 95", "95 or more"] as const;
export const WRC_BIN_COLORS = ["#FFF7BC", "#FEC44F", "#FB9A29", "#D95F0E", "#7F2704"] as const;
export const WRC_NO_RANK_EDGE = "#9CA3AF";

export const WRC_CAVEAT =
  "USDA Forest Service Wildfire Risk to Communities (2nd edition, 2024): modelled ranks that compare each county or community with all others nationally or in its state. A high rank is relative, not a forecast, and does not replace a local assessment. Fuels as of 2020-2022; 2023 Census boundaries.";
export const WRC_ALIAS_NOTE =
  "The measures are named by the service's own field aliases (RISK_NATIONAL_RANK, BP_NATIONAL_RANK, WHP_NATIONAL_RANK, EA_HURISK_NATIONAL_RANK). The service does not say which of RISK_* and EA_HURISK_* is wildfirerisk.org's 'Risk to Homes', so neither is given a plain-English name here.";
export const WRC_ATTRIBUTION = "USDA Forest Service, Wildfire Risk to Communities (Fire Modeling Institute, Rocky Mountain Research Station; Pyrologix). CC0 1.0.";
export const WRC_SOURCE_LABEL = "USFS Wildfire Risk to Communities (2nd ed., 2024)";
export const NOT_RANKED = "not ranked by USFS";

/** "97.20%" -> 97.2. Only a number with a "%" suffix (or a bare number in 0..100) parses; ' ', '' and anything else is null. */
export function parsePct(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  if (typeof v !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const cnt = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export interface WrcRow {
  geoid: string;
  name: string | null;
  state: string | null;
  /** National ranks in WRC_RANKS order, 0-100; null: not ranked. */
  national: [number | null, number | null, number | null, number | null];
  stateRank: [number | null, number | null, number | null, number | null];
  /** WRC_EXPOSURE order, percent; null where blank. */
  exposure: [number | null, number | null, number | null, number | null];
  buildings: number | null;
  housingUnits: number | null;
  /** USFS's exclude flag (places only): 1 = not ranked, with its reason. */
  excluded: boolean;
  excludeReason: string | null;
  /** The rank strings as published, by field, for the click. */
  raw: Record<string, string>;
}

/** One WRC attribute row -> a typed row; null when it has no GEOID. */
export function wrcRow(a: Readonly<Record<string, unknown>>): WrcRow | null {
  const geoid = str(a.GEOID);
  if (!geoid || !/^(\d{5}|\d{7})$/.test(geoid)) return null;
  const raw: Record<string, string> = {};
  for (const f of WRC_VALUE_FIELDS) if (typeof a[f] === "string") raw[f] = a[f] as string;
  return {
    geoid,
    name: str(a.NAMELSAD),
    state: str(a.STUSPS),
    national: WRC_RANKS.map((r) => parsePct(a[r.national])) as WrcRow["national"],
    stateRank: WRC_RANKS.map((r) => parsePct(a[r.state])) as WrcRow["stateRank"],
    exposure: WRC_EXPOSURE.map((e) => parsePct(a[e.field])) as WrcRow["exposure"],
    buildings: cnt(a.TOTAL_BUIL),
    housingUnits: cnt(a.TOTAL_HOUS),
    excluded: a.exclude === 1 || a.exclude === "1",
    excludeReason: str(a.exclude_re),
    raw,
  };
}

export function wrcValue(r: WrcRow, m: WrcMeasure, scope: WrcScope): number | null {
  if (r.excluded) return null;
  return (scope === "state" ? r.stateRank : r.national)[m];
}

export function wrcBin(v: number | null): number | null {
  if (v == null) return null;
  let b = 0;
  while (b < WRC_BREAKS.length && v >= WRC_BREAKS[b]) b++;
  return b;
}

const rankLine = (v: number | null, raw: string | undefined, scope: WrcScope, level: "county" | "place") =>
  v == null ? NOT_RANKED : `${raw ?? `${v}%`} (ranked at the ${v} percentile of ${scope === "national" ? "US" : "the state's"} ${level === "county" ? "counties" : "communities"})`;

/** The click lines for a county or community. */
export function wrcDetails(r: WrcRow, level: "county" | "place"): Record<string, string> {
  const d: Record<string, string> = {};
  if (r.excluded) d["not ranked because"] = r.excludeReason ?? "USFS marks this community excluded";
  WRC_RANKS.forEach((k, i) => {
    d[k.alias] = rankLine(r.national[i], r.raw[k.national], "national", level);
    d[k.stateAlias] = rankLine(r.stateRank[i], r.raw[k.state], "state", level);
  });
  d.buildings = r.buildings == null ? "not published" : r.buildings.toLocaleString("en-US");
  d["housing units"] = r.housingUnits == null ? "not published" : r.housingUnits.toLocaleString("en-US");
  WRC_EXPOSURE.forEach((e, i) => {
    d[e.label] = r.exposure[i] == null ? "not published" : (r.raw[e.field] ?? `${r.exposure[i]}%`);
  });
  d[level === "county" ? "county fips" : "place geoid"] = r.geoid;
  d.source = WRC_SOURCE_LABEL;
  d["see also"] = "The Wildfire hazard layer draws WHP itself; these are WRC's community rankings of it.";
  return d;
}

export interface WrcExtra {
  level: "county" | "place";
  geoid: string;
  row: WrcRow | null;
  measure: WrcMeasure;
  scope: WrcScope;
  value: number | null;
  bin: number | null;
  /** Why it has no bin. */
  noRank: string | null;
  embedText?: string;
}

function noRankReason(row: WrcRow | null): string {
  if (!row) return "not in this release";
  if (row.excluded) return `${NOT_RANKED}${row.excludeReason ? `: ${row.excludeReason.replace(/;\s*$/, "")}` : ""}`;
  return NOT_RANKED;
}

function wrcFeature(id: string, name: string, geometry: Polygon | MultiPolygon, geoid: string, row: WrcRow | null, level: "county" | "place", m: WrcMeasure, scope: WrcScope, anchor?: [number, number], embed: EmbedInput | null = null): LayerFeature<Polygon | MultiPolygon> {
  const value = row ? wrcValue(row, m, scope) : null;
  const bin = wrcBin(value);
  const noRank = bin != null ? null : noRankReason(row);
  const extra: WrcExtra = withEmbedText({ level, geoid, row, measure: m, scope, value, bin, noRank }, embed);
  return {
    type: "Feature",
    geometry,
    properties: {
      id,
      layer: "wildfirerisk",
      name,
      kind: bin == null ? (row ? "not-ranked" : "not-in-release") : `b${bin + 1}`,
      source: WRC_SOURCE_LABEL,
      details: row ? wrcDetails(row, level) : { [WRC_RANKS[0].alias]: "not in this release: WRC has no row for this FIPS (it covers the states and DC)", [level === "county" ? "county fips" : "place geoid"]: geoid },
      extra,
      anchor,
    },
  };
}

/** County rows joined by FIPS onto county outlines; an outline with no row is "not in this release", a row with no outline is counted in `unmatched`. */
export function joinWrcCounties(
  outlines: ReadonlyArray<{ geoid: string; name: string; stusab?: string; feature: LayerFeature<Polygon | MultiPolygon> }>,
  rows: readonly WrcRow[],
  m: WrcMeasure,
  scope: WrcScope,
): { features: LayerFeature<Polygon | MultiPolygon>[]; ranked: number; notRanked: number; notInRelease: number; unmatched: string[] } {
  const by = new Map<string, WrcRow>();
  for (const r of rows) by.set(r.geoid, r);
  const used = new Set<string>();
  let ranked = 0;
  let notRanked = 0;
  let notInRelease = 0;
  const features = outlines.map((o) => {
    const r = by.get(o.geoid) ?? null;
    if (r) used.add(o.geoid);
    const f = wrcFeature(`wrc:county:${o.geoid}`, o.stusab ? `${o.name}, ${o.stusab}` : o.name, o.feature.geometry, o.geoid, r, "county", m, scope, o.feature.properties.anchor);
    const x = f.properties.extra as WrcExtra;
    if (x.bin != null) ranked++;
    else if (r) notRanked++;
    else notInRelease++;
    return f;
  });
  const unmatched = [...by.keys()].filter((k) => !used.has(k)).sort();
  return { features, ranked, notRanked, notInRelease, unmatched };
}

/** A national rank as its record-text word: the layer's own bin label, or "not ranked by USFS"; never the number. */
export function wrcRankWords(v: number | null): string {
  const b = wrcBin(v);
  return b == null ? NOT_RANKED : `${WRC_BIN_LABELS[b]} percentile`;
}

/**
 * The row recordText reads for a community: the state, the RISK and BP national ranks as bins (an
 * excluded community is "not ranked by USFS", never low), and USFS's exclude reason. Never the name.
 */
export function wrcEmbedRow(r: WrcRow): Record<string, string | null> {
  const nat = (i: number) => wrcRankWords(r.excluded ? null : r.national[i]);
  return { STUSPS: r.state, RISK_NATIO: nat(0), BP_NATIONA: nat(1), exclude_re: r.excludeReason };
}

/** WRC community polygons (f=geojson rows), named by their Census name and state; a place that comes back twice is drawn once. */
export function buildWrcPlaces(rows: ReadonlyArray<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>, m: WrcMeasure, scope: WrcScope): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  const seen = new Set<string>();
  for (const f of rows) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const p = f.properties ?? {};
    const r = wrcRow(p);
    if (!r || r.geoid.length !== 7 || seen.has(r.geoid)) continue;
    seen.add(r.geoid);
    const name = `${r.name ?? `Place ${r.geoid}`}${r.state ? `, ${r.state}` : ""}`;
    out.push(wrcFeature(`wrc:place:${r.geoid}`, name, g, r.geoid, r, "place", m, scope, undefined, recordText("wrc-communities", wrcEmbedRow(r))));
  }
  return out;
}

/** Re-colour features already built for another measure or scope (no network). */
export function rerankWrc(features: ReadonlyArray<LayerFeature>, m: WrcMeasure, scope: WrcScope): LayerFeature[] {
  return features.map((f) => {
    const x = f.properties.extra as WrcExtra | undefined;
    if (!x || (x.measure === m && x.scope === scope)) return f;
    const value = x.row ? wrcValue(x.row, m, scope) : null;
    const bin = wrcBin(value);
    const noRank = bin != null ? null : noRankReason(x.row);
    return { ...f, properties: { ...f.properties, kind: bin == null ? (x.row ? "not-ranked" : "not-in-release") : `b${bin + 1}`, extra: { ...x, measure: m, scope, value, bin, noRank } } };
  });
}

/** The compact county row the route sends: national and state ranks, exposure, counts. */
export interface WrcWireRow {
  geoid: string;
  national: WrcRow["national"];
  state: WrcRow["stateRank"];
  exposure: WrcRow["exposure"];
  buildings: number | null;
  housingUnits: number | null;
  raw: Record<string, string>;
}
export const packWrcRow = (r: WrcRow): WrcWireRow => ({ geoid: r.geoid, national: r.national, state: r.stateRank, exposure: r.exposure, buildings: r.buildings, housingUnits: r.housingUnits, raw: r.raw });
export const unpackWrcRow = (w: WrcWireRow): WrcRow => ({ geoid: w.geoid, name: null, state: null, national: w.national, stateRank: w.state, exposure: w.exposure, buildings: w.buildings, housingUnits: w.housingUnits, excluded: false, excludeReason: null, raw: w.raw ?? {} });
