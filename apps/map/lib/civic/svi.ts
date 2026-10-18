// CDC/ATSDR Social Vulnerability Index 2022 (ACS 2018-2022), from CDC's own
// ArcGIS Online service (owner data_cdc, CORS *). Pure: the field lists, the
// theme names, the fixed percentile breaks, the row parser, the county join
// onto the shared county outlines (lib/layers/areas.ts), SVI's own tract
// features, the click lines, and the pairing with FEMA's National Risk Index
// social vulnerability. The route is /api/civic?op=svi.
//
//   county  every county once (two pages of 2,000), attributes only, joined
//           by FIPS onto the county outlines the globe already draws;
//           Connecticut is in planning regions (09110-09190) in both
//   tract   SVI's own tract polygons in a box of at most 0.4 degrees, below
//           60 km (the NRI tract height, so the two tract indices appear
//           together)
//   place   one county or tract with the 16 estimates and their margins
//
// CDC ranks within the release: a percentile among US counties (or tracts),
// 0 least to 1 most vulnerable. -999 is CDC's "not ranked" (778 tracts with no
// population or unreliable estimates, 0 counties, on 2026-10-16): drawn
// unfilled with a dashed grey edge, never as least vulnerable. The colour
// breaks are fixed (0.25, 0.5, 0.75), so a county reads the same in every
// view. This is not FEMA's NRI social vulnerability (from the Census
// Community Resilience Estimate); the two are shown side by side, each with
// its own title, and nothing is converted, averaged or ranked across them.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import { NRI_SOVI_NOTE, type NriRow } from "@/lib/hazards/nri";

export const SVI_SERVICE = "https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/arcgis/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer";
/** "SVI2022 US county" (there is no layer 0). */
export const SVI_COUNTY_LAYER = `${SVI_SERVICE}/1`;
/** "SVI2022 US tract". */
export const SVI_TRACT_LAYER = `${SVI_SERVICE}/2`;
/** The layers' maxRecordCount (read 2026-10-16). */
export const SVI_PAGE = 2000;
/** County pages asked: 3,144 counties on 2026-10-16. */
export const SVI_COUNTY_PAGES = 2;
/** Below this camera height the layer shows tracts (the NRI tract height). */
export const SVI_TRACT_MAX_M = 60_000;
/** The largest tract box, degrees a side (as NRI's: two pages cover the densest boxes). */
export const SVI_TRACT_BOX_DEG = 0.4;
export const SVI_TRACT_PAGES = 2;

/** The five rankings, in CDC's own theme names. Index 0 is the overall ranking. */
export const SVI_THEMES = [
  { field: "RPL_THEMES", name: "Overall" },
  { field: "RPL_THEME1", name: "Socioeconomic Status" },
  { field: "RPL_THEME2", name: "Household Characteristics" },
  { field: "RPL_THEME3", name: "Racial and Ethnic Minority Status" },
  { field: "RPL_THEME4", name: "Housing Type and Transportation" },
] as const;
export type SviTheme = 0 | 1 | 2 | 3 | 4;

export function parseSviTheme(v: unknown): SviTheme {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[0-4]$/.test(v) ? Number(v) : 0;
  return (Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0) as SviTheme;
}

/** The fields asked for counties and tracts (named, never *). */
export const SVI_COUNTY_FIELDS = ["FIPS", "COUNTY", "STATE", "ST_ABBR", "RPL_THEMES", "RPL_THEME1", "RPL_THEME2", "RPL_THEME3", "RPL_THEME4", "F_TOTAL"] as const;

/** The 16 measures by CDC's variable stems, with short descriptions after CDC's SVI 2022 documentation (paraphrased, not CDC's text). Percentages of the population (or of households or housing units, as said). */
export const SVI_MEASURES = {
  POV150: "persons below 150% of the poverty line",
  UNEMP: "civilian unemployed (16+)",
  HBURD: "housing cost-burdened occupied units (income under $75,000, 30%+ of income on housing)",
  NOHSDP: "persons with no high school diploma (25+)",
  UNINSUR: "uninsured in the civilian noninstitutionalized population",
  AGE65: "persons aged 65 and older",
  AGE17: "persons aged 17 and younger",
  DISABL: "civilian noninstitutionalized population with a disability",
  SNGPNT: "single-parent households with children under 18",
  LIMENG: "persons (5+) who speak English 'less than well'",
  MINRTY: "racial and ethnic minority (all persons except white, non-Hispanic)",
  MUNIT: "housing in structures with 10 or more units",
  MOBILE: "mobile homes",
  CROWD: "occupied housing units with more people than rooms",
  NOVEH: "households with no vehicle available",
  GROUPQ: "persons in group quarters",
} as const;
export type SviMeasure = keyof typeof SVI_MEASURES;
export const SVI_MEASURE_CODES = Object.keys(SVI_MEASURES) as SviMeasure[];

/** The place answer's fields: the rankings, flags, population, and each measure's estimate (EP_) and margin (MP_). */
export const SVI_PLACE_FIELDS = [...SVI_COUNTY_FIELDS, "LOCATION", "E_TOTPOP", ...SVI_MEASURE_CODES.flatMap((m) => [`EP_${m}`, `MP_${m}`])] as const;

/** Fixed percentile breaks: four bins, the same in every view. */
export const SVI_BREAKS = [0.25, 0.5, 0.75] as const;
export const SVI_BIN_LABELS = ["0 to 0.25 (least)", "0.25 to 0.50", "0.50 to 0.75", "0.75 to 1 (most)"] as const;
/** Least (pale) to most (deep) vulnerable. */
export const SVI_BIN_COLORS = ["#FEF3C7", "#FCD34D", "#F97316", "#9A3412"] as const;
export const SVI_NO_RANK_EDGE = "#9CA3AF";

export const SVI_CAVEAT =
  "Percentile rank within the United States (0 least, 1 most vulnerable) from ACS 2018-2022 estimates, by CDC/ATSDR. A relative measure, not a measure of risk by itself. Tracts with no population or unreliable estimates are not ranked. This is not FEMA's social vulnerability score in the National Risk Index, which comes from the Census Community Resilience Estimate; the two can disagree.";
export const SVI_VINTAGE_NOTE =
  "The service describes itself as the 2020 SVI; its layers are named SVI2022 and the values match the 2022 release (Travis County, TX overall 0.5702), so the layer names are trusted.";
export const SVI_ATTRIBUTION =
  "Centers for Disease Control and Prevention/Agency for Toxic Substances and Disease Registry/Geospatial Research, Analysis, and Services Program. CDC/ATSDR Social Vulnerability Index 2022 Database US.";

export interface SviRow {
  fips: string;
  county: string | null;
  state: string | null;
  stAbbr: string | null;
  /** Overall and the four themes, in SVI_THEMES order; null where CDC does not rank (-999). */
  rpl: [number | null, number | null, number | null, number | null, number | null];
  /** F_TOTAL: how many of the 16 measures are in the top 10 %; null where not ranked. */
  flags: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A published value; any negative (CDC's -999) is "not ranked", null. */
const pub = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** One SVI attribute row -> a typed row; null when it has no FIPS. */
export function sviRow(a: Readonly<Record<string, unknown>>): SviRow | null {
  const fips = str(a.FIPS);
  if (!fips || !/^(\d{5}|\d{11})$/.test(fips)) return null;
  return {
    fips,
    county: str(a.COUNTY),
    state: str(a.STATE),
    stAbbr: str(a.ST_ABBR),
    rpl: SVI_THEMES.map((t) => pub(a[t.field])) as SviRow["rpl"],
    flags: pub(a.F_TOTAL),
  };
}

/** The bin (0..3) of a published percentile on the fixed breaks; null when not ranked. */
export function sviBin(v: number | null): number | null {
  if (v == null) return null;
  let b = 0;
  while (b < SVI_BREAKS.length && v >= SVI_BREAKS[b]) b++;
  return b;
}

const pct = (v: number | null) => (v == null ? "not ranked by CDC" : v.toFixed(2));

/** The click lines for a ranked (or unranked) county or tract. */
export function sviDetails(r: SviRow, level: "county" | "tract"): Record<string, string> {
  const d: Record<string, string> = {};
  SVI_THEMES.forEach((t, i) => {
    d[i === 0 ? "overall SVI (CDC/ATSDR)" : t.name] = pct(r.rpl[i]);
  });
  d.flags = r.flags == null ? "not ranked by CDC" : `${r.flags} of 16 measures in the top 10 %`;
  d[level === "county" ? "county fips" : "tract fips"] = r.fips;
  d["what this is"] = level === "county" ? "a county's percentile among all US counties, 0 least to 1 most vulnerable" : "a tract's percentile among all US tracts, 0 least to 1 most vulnerable";
  d["not this"] = "FEMA's NRI social vulnerability, a different index (shown beside it when you click)";
  return d;
}

export interface SviExtra {
  level: "county" | "tract";
  fips: string;
  row: SviRow | null;
  theme: SviTheme;
  /** The percentile the feature is coloured by; null when not ranked or not in the release. */
  value: number | null;
  /** 0..3 on the fixed breaks; null: drawn dashed grey. */
  bin: number | null;
  /** Why it has no bin: "not ranked by CDC" or "not in this release". */
  noRank: string | null;
}

function sviFeature(id: string, name: string, geometry: Polygon | MultiPolygon, fips: string, row: SviRow | null, level: "county" | "tract", theme: SviTheme, anchor?: [number, number]): LayerFeature<Polygon | MultiPolygon> {
  const value = row ? row.rpl[theme] : null;
  const bin = sviBin(value);
  const noRank = bin != null ? null : row ? "not ranked by CDC" : "not in this release";
  const extra: SviExtra = { level, fips, row, theme, value, bin, noRank };
  return {
    type: "Feature",
    geometry,
    properties: {
      id,
      layer: "vulnerability",
      name,
      kind: bin == null ? (row ? "not-ranked" : "not-in-release") : `b${bin + 1}`,
      source: "CDC/ATSDR SVI 2022",
      details: row ? sviDetails(row, level) : { "overall SVI (CDC/ATSDR)": "not in this release: CDC's US database has no row for this FIPS (it covers the states and DC)", [level === "county" ? "county fips" : "tract fips"]: fips },
      extra,
      anchor,
    },
  };
}

/** County rows joined by FIPS onto county outlines. An outline with no row is "not in this release" (dashed grey); a row with no outline is counted in `unmatched`. */
export function joinSviCounties(
  outlines: ReadonlyArray<{ geoid: string; name: string; stusab?: string; feature: LayerFeature<Polygon | MultiPolygon> }>,
  rows: readonly SviRow[],
  theme: SviTheme,
): { features: LayerFeature<Polygon | MultiPolygon>[]; ranked: number; notRanked: number; notInRelease: number; unmatched: string[] } {
  const by = new Map<string, SviRow>();
  for (const r of rows) by.set(r.fips, r);
  const used = new Set<string>();
  let ranked = 0;
  let notRanked = 0;
  let notInRelease = 0;
  const features = outlines.map((o) => {
    const r = by.get(o.geoid) ?? null;
    if (r) used.add(o.geoid);
    const f = sviFeature(`svi:county:${o.geoid}`, o.stusab ? `${o.name}, ${o.stusab}` : o.name, o.feature.geometry, o.geoid, r, "county", theme, o.feature.properties.anchor);
    const x = f.properties.extra as SviExtra;
    if (x.bin != null) ranked++;
    else if (r) notRanked++;
    else notInRelease++;
    return f;
  });
  const unmatched = [...by.keys()].filter((k) => !used.has(k)).sort();
  return { features, ranked, notRanked, notInRelease, unmatched };
}

/** SVI tract features (f=geojson rows with their own geometry), named by tract FIPS; a tract that comes back twice is drawn once. */
export function buildSviTracts(rows: ReadonlyArray<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>, theme: SviTheme): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  const seen = new Set<string>();
  for (const f of rows) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const r = sviRow(f.properties ?? {});
    if (!r || r.fips.length !== 11 || seen.has(r.fips)) continue;
    seen.add(r.fips);
    out.push(sviFeature(`svi:tract:${r.fips}`, `Tract ${r.fips}${r.county ? ` · ${r.county}` : ""}${r.stAbbr ? `, ${r.stAbbr}` : ""}`, g, r.fips, r, "tract", theme));
  }
  return out;
}

/** Re-colour features already built for another theme (no network). */
export function rethemeSvi(features: ReadonlyArray<LayerFeature>, theme: SviTheme): LayerFeature[] {
  return features.map((f) => {
    const x = f.properties.extra as SviExtra | undefined;
    if (!x || x.theme === theme) return f;
    const value = x.row ? x.row.rpl[theme] : null;
    const bin = sviBin(value);
    const noRank = bin != null ? null : x.row ? "not ranked by CDC" : "not in this release";
    return { ...f, properties: { ...f.properties, kind: bin == null ? (x.row ? "not-ranked" : "not-in-release") : `b${bin + 1}`, extra: { ...x, theme, value, bin, noRank } } };
  });
}

// ---------------------------------------------------------------- the place answer and the pairing

export interface SviPlace {
  row: SviRow;
  location: string | null;
  /** E_TOTPOP as published. */
  population: number | null;
  measures: Record<SviMeasure, { estimate: number | null; margin: number | null }>;
}

export function sviPlace(a: Readonly<Record<string, unknown>>): SviPlace | null {
  const row = sviRow(a);
  if (!row) return null;
  const measures = {} as SviPlace["measures"];
  for (const m of SVI_MEASURE_CODES) measures[m] = { estimate: pub(a[`EP_${m}`]), margin: pub(a[`MP_${m}`]) };
  return { row, location: str(a.LOCATION), population: pub(a.E_TOTPOP), measures };
}

export interface PairBlock {
  title: string;
  /** Who publishes it and from what. */
  basis: string;
  lines: Array<[string, string]>;
  note: string;
}

/**
 * The click answer's two blocks: CDC/ATSDR SVI, then FEMA's NRI social vulnerability, each in
 * its own native form (CDC's 0-1 percentile; FEMA's 0-100 score and rating word), each titled
 * with its publisher and inputs. Nothing is derived from both.
 */
export function sviPairBlocks(svi: SviPlace | null, nri: NriRow | null, level: "county" | "tract"): [PairBlock, PairBlock] {
  const cdcLines: Array<[string, string]> = [];
  if (svi) {
    SVI_THEMES.forEach((t, i) => cdcLines.push([i === 0 ? "overall percentile" : t.name, pct(svi.row.rpl[i])]));
    cdcLines.push(["flags", svi.row.flags == null ? "not ranked by CDC" : `${svi.row.flags} of 16 measures in the top 10 %`]);
    cdcLines.push(["population (ACS estimate)", svi.population == null ? "not published" : svi.population.toLocaleString("en-US")]);
  } else cdcLines.push(["overall percentile", "not in this release"]);
  const femaLines: Array<[string, string]> = nri
    ? [
        ["rating", nri.soviRating ?? "not published"],
        ["score", nri.soviScore == null ? "not published" : `${nri.soviScore.toFixed(2)} of 100`],
      ]
    : [["rating", `not in the NRI ${level} layer`]];
  return [
    {
      title: "CDC/ATSDR Social Vulnerability Index 2022",
      basis: "CDC/ATSDR, from ACS 2018-2022 estimates; a percentile among US " + (level === "county" ? "counties" : "tracts") + ", 0 least to 1 most vulnerable",
      lines: cdcLines,
      note: SVI_CAVEAT,
    },
    {
      title: "FEMA National Risk Index: social vulnerability (Census Community Resilience Estimate)",
      basis: "FEMA, December 2025; a score of 0 to 100 and FEMA's rating word",
      lines: femaLines,
      note: NRI_SOVI_NOTE,
    },
  ];
}

/** The 16 estimates with their margins, for the expandable list. */
export function sviMeasureLines(p: SviPlace): Array<[string, string]> {
  return SVI_MEASURE_CODES.map((m) => {
    const v = p.measures[m];
    return [SVI_MEASURES[m], v.estimate == null ? "not published" : `${v.estimate}%${v.margin != null ? ` ± ${v.margin}` : ""}`];
  });
}
