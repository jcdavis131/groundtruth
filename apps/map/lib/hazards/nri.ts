// FEMA National Risk Index (December 2025): composite risk, expected annual
// loss, social vulnerability, community resilience and 18 per-hazard ratings
// for every county and census tract. Pure: field lists, the rating words,
// the county join onto the shared county outlines (lib/layers/areas.ts), the
// tract features and the dossier lines. The route is /api/hazards?op=nri.
//
// Ratings are FEMA's words, shown verbatim. "Not Applicable", "Insufficient
// Data", "No Rating" and "Data Unavailable" (and an empty rating) are not a
// class: they are drawn unfilled with a dashed grey edge and never as low.
// Counties are joined by FIPS (STCOFIPS) onto the county outlines the globe
// already draws, so NRI's own county geometry is never fetched; Connecticut
// is in planning regions (09110-09190) in both, so no crosswalk is needed.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";

export const NRI_COUNTIES = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0";
export const NRI_TRACTS = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0";
/** Below this camera height the layer asks for tracts (NRI's own tract geometry). */
export const NRI_TRACT_MAX_M = 60_000;
/** The layers' maxRecordCount (read 2026-10-16). */
export const NRI_PAGE = 2000;
/**
 * The largest tract box, degrees a side. New York is the densest place measured (2026-10-16):
 * 0.4 x 0.4 degree boxes over the city held 2,544 to 2,884 tracts, up to 3.44 MB answered (for
 * example -74.12,40.58,-73.72,40.98), so they take two pages. Los Angeles at 0.4 x 0.4 held 1,523
 * and at 0.6 x 0.4 held 1,913 (2.26 MB; the GeoJSON is almost all attributes, and a coarser
 * maxAllowableOffset saved under 12 %). Two pages of 2,000 cover the New York boxes and keep
 * the answer under Vercel's 4.5 MB response limit.
 */
export const NRI_TRACT_BOX_DEG = 0.4;
/** Tract pages asked for one box at most: dense New York boxes need the second; none measured needed a third. */
export const NRI_MAX_PAGES = 2;

/** The 18 hazards, in FEMA's field prefixes, with FEMA's names (the field aliases, read 2026-10-16). */
export const NRI_HAZARDS = {
  AVLN: "avalanche",
  CFLD: "coastal flooding",
  CWAV: "cold wave",
  DRGT: "drought",
  ERQK: "earthquake",
  HAIL: "hail",
  HWAV: "heat wave",
  HRCN: "hurricane",
  ISTM: "ice storm",
  IFLD: "inland flooding",
  LNDS: "landslide",
  LTNG: "lightning",
  SWND: "strong wind",
  TRND: "tornado",
  TSUN: "tsunami",
  VLCN: "volcanic activity",
  WFIR: "wildfire",
  WNTW: "winter weather",
} as const;
export type NriHazard = keyof typeof NRI_HAZARDS;
export const NRI_HAZARD_CODES = Object.keys(NRI_HAZARDS) as NriHazard[];

/** What the layer colours by: the composite or one hazard. */
export type NriPick = "composite" | NriHazard;
export function parseNriPick(v: unknown): NriPick {
  return typeof v === "string" && (v === "composite" || v in NRI_HAZARDS) ? (v as NriPick) : "composite";
}

const RISKR = NRI_HAZARD_CODES.map((h) => `${h}_RISKR`);

/** The fields asked (named, never *): about 33 of 467. */
export const NRI_COUNTY_FIELDS = [
  "NRI_ID",
  "STATEABBRV",
  "COUNTY",
  "STCOFIPS",
  "POPULATION",
  "BUILDVALUE",
  "RISK_SCORE",
  "RISK_RATNG",
  "EAL_VALT",
  "EAL_RATNG",
  "SOVI_SCORE",
  "SOVI_RATNG",
  "RESL_SCORE",
  "RESL_RATNG",
  "NRI_VER",
  ...RISKR,
] as const;
export const NRI_TRACT_FIELDS = [...NRI_COUNTY_FIELDS, "TRACTFIPS"] as const;

/** FEMA's five rating classes, highest first. */
export const NRI_CLASSES = ["Very High", "Relatively High", "Relatively Moderate", "Relatively Low", "Very Low"] as const;
export type NriClass = (typeof NRI_CLASSES)[number];

/** The class colours (high is hot), and the dashed grey edge for no rating. */
export const NRI_COLORS: Record<NriClass, string> = {
  "Very High": "#B91C1C",
  "Relatively High": "#EA580C",
  "Relatively Moderate": "#F59E0B",
  "Relatively Low": "#84CC16",
  "Very Low": "#22C55E",
};
export const NRI_NO_RATING_EDGE = "#9CA3AF";

export function isNriClass(v: unknown): v is NriClass {
  return typeof v === "string" && (NRI_CLASSES as readonly string[]).includes(v);
}

export const NRI_CAVEATS = [
  "A relative index: a county's score is its percentile among all US counties, and a tract's among all tracts. 'Very High' does not mean likely. It means high compared with everywhere else.",
  "Expected annual loss is a modelled average over many years, in dollars of buildings, population equivalence and agriculture. It is not a forecast for this year.",
  "County and tract scores are computed separately and can't be compared with each other.",
];

/** FEMA's own terms (item licenseInfo, read 2026-10-16), quoted. */
export const NRI_TERMS =
  "FEMA: \"The National Risk Index data are meant for planning purposes only. This National Risk Index dataset was created for broad nationwide comparisons and is not a substitute for localized risk assessment analysis.\"";
/** The citation FEMA requires users to state, verbatim. */
export const NRI_CITATION =
  "This product uses the Federal Emergency Management Agency's National Risk Index dataset API or downloadable datasets but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have been retrieved from the Agency's website(s).";
/** Where FEMA says the social vulnerability values come from (item description, read 2026-10-16), quoted. */
export const NRI_SOVI_NOTE =
  "Social vulnerability as published in the National Risk Index. FEMA: \"Data for Social Vulnerability are provided by the U.S. Census Community Resilience Estimate\"; it is not the CDC/ATSDR Social Vulnerability Index, and the two can disagree.";

export interface NriRow {
  nriId: string | null;
  state: string | null;
  county: string | null;
  /** 5-digit county FIPS. */
  stcofips: string | null;
  /** 11-digit tract FIPS (tracts only). */
  tractfips: string | null;
  population: number | null;
  buildValue: number | null;
  riskScore: number | null;
  riskRating: string | null;
  ealValue: number | null;
  ealRating: string | null;
  soviScore: number | null;
  soviRating: string | null;
  reslScore: number | null;
  reslRating: string | null;
  version: string | null;
  /** Each hazard's rating word as FEMA publishes it; null when empty. */
  hazards: Record<NriHazard, string | null>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One NRI attribute row -> a typed row (values as published; empties null). */
export function nriRow(a: Readonly<Record<string, unknown>>): NriRow {
  const hazards = {} as Record<NriHazard, string | null>;
  for (const h of NRI_HAZARD_CODES) hazards[h] = str(a[`${h}_RISKR`]);
  return {
    nriId: str(a.NRI_ID),
    state: str(a.STATEABBRV),
    county: str(a.COUNTY),
    stcofips: str(a.STCOFIPS),
    tractfips: str(a.TRACTFIPS),
    population: num(a.POPULATION),
    buildValue: num(a.BUILDVALUE),
    riskScore: num(a.RISK_SCORE),
    riskRating: str(a.RISK_RATNG),
    ealValue: num(a.EAL_VALT),
    ealRating: str(a.EAL_RATNG),
    soviScore: num(a.SOVI_SCORE),
    soviRating: str(a.SOVI_RATNG),
    reslScore: num(a.RESL_SCORE),
    reslRating: str(a.RESL_RATNG),
    version: str(a.NRI_VER),
    hazards,
  };
}

/** The rating the layer colours by: the composite or the picked hazard. */
export function pickedRating(r: NriRow, pick: NriPick): string | null {
  return pick === "composite" ? r.riskRating : r.hazards[pick];
}

const usd = (v: number | null) => (v == null ? "not published" : `$${Math.round(v).toLocaleString("en-US")} a year`);
const score = (s: number | null) => (s == null ? "" : ` (score ${s.toFixed(2)} of 100)`);
const word = (w: string | null) => w ?? "not published";

/** The dossier lines, in the plan's order: composite, loss, social vulnerability and resilience, then the 18 hazards by rating. */
export function nriDetails(r: NriRow, level: "county" | "tract"): Record<string, string> {
  const d: Record<string, string> = {};
  d["composite risk (FEMA NRI)"] = `${word(r.riskRating)}${score(r.riskScore)}`;
  d["expected annual loss"] = `${usd(r.ealValue)}${r.ealRating ? ` (${r.ealRating})` : ""}`;
  d["social vulnerability, as published in the NRI"] = `${word(r.soviRating)}${score(r.soviScore)}`;
  d["a different index"] = "CDC/ATSDR SVI is on the Social vulnerability layer";
  d["community resilience (NRI)"] = `${word(r.reslRating)}${score(r.reslScore)}`;
  const rank = (w: string | null) => (isNriClass(w) ? NRI_CLASSES.indexOf(w) : NRI_CLASSES.length);
  const order = [...NRI_HAZARD_CODES].sort((a, b) => rank(r.hazards[a]) - rank(r.hazards[b]) || NRI_HAZARDS[a].localeCompare(NRI_HAZARDS[b]));
  for (const h of order) d[`${NRI_HAZARDS[h]} risk`] = word(r.hazards[h]);
  if (level === "county" && r.stcofips) d["county fips"] = r.stcofips;
  if (level === "tract" && r.tractfips) d["tract fips"] = r.tractfips;
  if (r.version) d["NRI version"] = r.version;
  d["what this is"] = level === "county" ? "a county's percentile among all US counties, not a likelihood" : "a tract's percentile among all US tracts, not comparable with a county's";
  return d;
}

export interface NriExtra {
  level: "county" | "tract";
  row: NriRow;
  /** The rating the layer is coloured by, or null: no class (drawn dashed grey, never low). */
  rating: NriClass | null;
  /** The published word when it is not a class ("Not Applicable", "Insufficient Data", ...), or "not in the index". */
  noRating: string | null;
  pick: NriPick;
}

function nriFeature(id: string, name: string, geometry: Polygon | MultiPolygon, row: NriRow, level: "county" | "tract", pick: NriPick, anchor?: [number, number]): LayerFeature<Polygon | MultiPolygon> {
  const w = pickedRating(row, pick);
  const rating = isNriClass(w) ? w : null;
  const extra: NriExtra = { level, row, rating, noRating: rating ? null : (w ?? "not rated"), pick };
  return {
    type: "Feature",
    geometry,
    properties: {
      id,
      layer: "riskindex",
      name,
      kind: rating ?? "no-rating",
      source: "FEMA National Risk Index",
      details: nriDetails(row, level),
      extra,
      anchor,
    },
  };
}

/**
 * NRI county rows joined by FIPS onto county outlines. An outline with no NRI row reads
 * "not in the index" (drawn dashed grey, never low); an NRI row with no outline is counted in
 * `unmatched`, not drawn and never guessed a place.
 */
export function joinCounties(
  outlines: ReadonlyArray<{ geoid: string; name: string; stusab?: string; feature: LayerFeature<Polygon | MultiPolygon> }>,
  rows: readonly NriRow[],
  pick: NriPick,
): { features: LayerFeature<Polygon | MultiPolygon>[]; matched: number; notInIndex: number; unmatched: string[] } {
  const by = new Map<string, NriRow>();
  for (const r of rows) if (r.stcofips) by.set(r.stcofips, r);
  const features: LayerFeature<Polygon | MultiPolygon>[] = [];
  const used = new Set<string>();
  let notInIndex = 0;
  for (const o of outlines) {
    const r = by.get(o.geoid);
    const name = o.stusab ? `${o.name}, ${o.stusab}` : o.name;
    if (!r) {
      notInIndex++;
      const f = nriFeature(`nri:county:${o.geoid}`, name, o.feature.geometry, nriRow({ STCOFIPS: o.geoid }), "county", pick, o.feature.properties.anchor);
      (f.properties.extra as NriExtra).noRating = "not in the index";
      f.properties.details = { "composite risk (FEMA NRI)": "not in the index: FEMA publishes no row for this county FIPS", "county fips": o.geoid };
      features.push(f);
      continue;
    }
    used.add(o.geoid);
    features.push(nriFeature(`nri:county:${o.geoid}`, name, o.feature.geometry, r, "county", pick, o.feature.properties.anchor));
  }
  const unmatched = [...by.keys()].filter((k) => !used.has(k)).sort();
  return { features, matched: used.size, notInIndex, unmatched };
}

/** NRI tract features (f=geojson rows with their own geometry), named by tract FIPS; a tract that comes back twice (pages overlapping) is drawn once. */
export function buildTracts(rows: ReadonlyArray<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>, pick: NriPick): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  const seen = new Set<string>();
  for (const f of rows) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const r = nriRow(f.properties ?? {});
    if (!r.tractfips || seen.has(r.tractfips)) continue;
    seen.add(r.tractfips);
    out.push(nriFeature(`nri:tract:${r.tractfips}`, `Tract ${r.tractfips}${r.county ? ` · ${r.county}` : ""}${r.state ? `, ${r.state}` : ""}`, g, r, "tract", pick));
  }
  return out;
}

/** Re-colour features already built for another pick (no network). */
export function repick(features: ReadonlyArray<LayerFeature>, pick: NriPick): LayerFeature[] {
  return features.map((f) => {
    const x = f.properties.extra as NriExtra | undefined;
    if (!x?.row || x.pick === pick) return f;
    if (x.noRating === "not in the index") return { ...f, properties: { ...f.properties, extra: { ...x, pick } } };
    const w = pickedRating(x.row, pick);
    const rating = isNriClass(w) ? w : null;
    return { ...f, properties: { ...f.properties, kind: rating ?? "no-rating", extra: { ...x, pick, rating, noRating: rating ? null : (w ?? "not rated") } } };
  });
}
