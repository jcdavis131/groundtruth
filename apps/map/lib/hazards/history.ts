// County hazard history: the record behind /api/hazards?op=history and the
// county dossier's Hazard history aside. Pure: the upstream URLs, the parsers
// for each answer, the per-year series, the Connecticut and Alaska rules and
// the assembled answer. The route fetches; this module never does.
//
//   FEMA OpenFEMA Disaster Declarations Summaries v2   declarations naming the county
//   U.S. Drought Monitor county statistics (NDMC/UNL)   weekly DSCI since 2000, this week's D0-D4
//   NOAA NCEI Climate at a Glance, county series        annual mean temperature and precipitation
//   NOAA SPC tornadoes 1950-2025                        baked: tornadoes per county per year
//   USGS landslide susceptibility, county table          baked: share of susceptible terrain
//   NOAA NCEI Storm Events, county-coded rows since 1996 baked: reports per year by type (round 8)
//
// Every number is published or a count of published rows. Missing is null
// with a reason, never 0: a year with no FEMA row or no SPC tornado is absent
// unless HISTORY_ZERO_FILL is on (Cam's call, pending; off until he rules).
//
// Connecticut: FEMA, NOAA CAG, SPC and the landslide table publish the eight
// legacy counties; current Census geography (and the globe) uses nine
// planning regions. Only USDM publishes the regions, so a region's history is
// drought only; the other four are null with join:legacy_ct_counties, never
// crosswalked.

import type { Point, Series } from "@/lib/series/types";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { BOUNDARY_CHANGED_SINCE_2010, CENSUS_CHANGES_2010, type LandslideBake, type SpcBake } from "./bake";
import type { StormMeta, StormShard } from "./stormBake";
import { STORM_ALASKA_LINE, STORM_CT_LINE, STORM_EVENTS_CAVEAT, STORM_GATE_NOTE, STORM_MAIN_TYPES, STORM_NAME_CHECK_NOTE, STORM_ZONE_SHARE_MAX, stormAsSeries, stormSeries, type StormsAnswer } from "./storms";

/**
 * Cam's decision 1 (pending): whether a year with no FEMA declaration or no SPC tornado is a 0
 * (both are the complete federal record: `complete-registry-zero`) or absent (`published-or-null`).
 * Off until he rules: those years are absent from the series.
 */
export const HISTORY_ZERO_FILL = false;

/** When the two bakes were built from the upstream files (scripts/bake-hazard-history.mjs). */
export const BAKED_ON = "2026-10-17";

// ---------------------------------------------------------------- upstreams

export const FEMA_DDS = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
export const FEMA_FIELDS = [
  "disasterNumber",
  "declarationDate",
  "incidentType",
  "declarationTitle",
  "declarationType",
  "incidentBeginDate",
  "incidentEndDate",
  "ihProgramDeclared",
  "iaProgramDeclared",
  "paProgramDeclared",
  "hmProgramDeclared",
  "designatedArea",
  "fipsStateCode",
  "fipsCountyCode",
  "placeCode",
  "tribalRequest",
] as const;
export const FEMA_MAX = 1000;
/** FEMA's first declaration year (DR-1, 1953). */
export const FEMA_FIRST_YEAR = 1953;
export const FEMA_CREDIT = "FEMA OpenFEMA, Disaster Declarations Summaries v2. This product uses the FEMA OpenFEMA API, but is not endorsed by FEMA.";

/** The OpenFEMA filter for one county: its state, and its county code (or its codes, for a FEMA_RENAMES county). */
export function femaFilter(fips: string): string {
  const codes = femaCodes(fips).map((c) => `fipsCountyCode eq '${c.slice(2)}'`);
  return `fipsStateCode eq '${fips.slice(0, 2)}' and ${codes.length > 1 ? `(${codes.join(" or ")})` : codes[0]}`;
}

/** One county's declarations, newest first, the selected fields only. */
export function femaUrl(fips: string): string {
  const f = femaFilter(fips);
  return `${FEMA_DDS}?%24filter=${encodeURIComponent(f)}&%24select=${FEMA_FIELDS.join(",")}&%24top=${FEMA_MAX}&%24inlinecount=allpages&%24orderby=${encodeURIComponent("declarationDate desc")}`;
}

export const USDM_API = "https://usdmdataservices.unl.edu/api/CountyStatistics";
export const USDM_FIRST = "1/1/2000";
export const USDM_CREDIT = "U.S. Drought Monitor, National Drought Mitigation Center at the University of Nebraska-Lincoln, USDA and NOAA.";
const mdy = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
};
/** Weekly DSCI (0-500) since 2000. */
export function usdmDsciUrl(fips: string, now: number): string {
  return `${USDM_API}/GetDSCI?aoi=${fips}&startdate=${USDM_FIRST}&enddate=${mdy(now)}&statisticsType=1`;
}
/** Categorical D0-D4 area shares (statisticsType=2, summing to 100) for the last three weeks; the newest is used. */
export function usdmCategoryUrl(fips: string, now: number): string {
  return `${USDM_API}/GetDroughtSeverityStatisticsByAreaPercent?aoi=${fips}&startdate=${mdy(now - 20 * 86_400_000)}&enddate=${mdy(now)}&statisticsType=2`;
}

export const CAG_BASE = "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/county/time-series";
export type CagElement = "tavg" | "pcp";
/** Annual (January-December) county values, 1895 to the last complete year. */
export function cagUrl(stusab: string, fips: string, element: CagElement, year: number): string {
  return `${CAG_BASE}/${stusab}-${fips.slice(2)}/${element}/12/12/1895-${year}/data.json`;
}

// ---------------------------------------------------------------- geography rules

export const CT_LEGACY = /^090(0[1-9]|1[0-5])$/;
export const CT_REGION = /^091[1-9]0$/;
/** Counties whose boundary changed after 2010 (Census county-change pages): no landslide row. Kept by the bake. */
export { BOUNDARY_CHANGED_SINCE_2010 };
/** FEMA files declarations before the 2019 split under Valdez-Cordova (02261), which names no current county. */
export const FEMA_VALDEZ_CORDOVA_NOTE =
  "FEMA files Alaska declarations made before the 2019 split of Valdez-Cordova Census Area under its old code 261 (11 rows on 2026-10-17, 1986-2020); that code names no current county, so those rows are not attached to Chugach or Copper River.";
/**
 * Two current counties FEMA still files under their old codes (Census renames, same boundary;
 * probed 2026-10-17): Oglala Lakota (46102) has 16 rows under Shannon's 113 and none under 102;
 * Kusilvak (02158) has 12 under Wade Hampton's 270 and 2 under 158. The history asks for both
 * codes and keeps each disaster once across them. Dade to Miami-Dade is not here: FEMA migrated it.
 */
export const FEMA_RENAMES: ReadonlyArray<{ fips: string; oldFips: string; what: string; citation: string }> = [
  { fips: "46102", oldFips: "46113", what: "Shannon County, SD, renamed Oglala Lakota County (2015-05-01)", citation: CENSUS_CHANGES_2010 },
  { fips: "02158", oldFips: "02270", what: "Wade Hampton Census Area, AK, renamed Kusilvak Census Area (2015-07-01)", citation: CENSUS_CHANGES_2010 },
];
/** The FIPS codes FEMA files a county under: its own, then any old code. */
export function femaCodes(fips: string): string[] {
  return [fips, ...FEMA_RENAMES.filter((r) => r.fips === fips).map((r) => r.oldFips)];
}
export function femaRenameNote(fips: string): string | null {
  const r = FEMA_RENAMES.find((x) => x.fips === fips);
  return r
    ? `FEMA files many of this county's declarations under its old code ${r.oldFips.slice(2)} (${r.what}, a Census change of name and code with the same boundary), so both codes are read and each disaster is kept once.`
    : null;
}
export const ALASKA_FEMA_NOTE ="Alaska's declarations are as FEMA files them: Regional Educational Attendance Areas and school districts sit under the census area code FEMA chose, with the designated area shown as FEMA names it.";

export type MissingReason =
  | "join:legacy_ct_counties"
  | "join:boundary_changed_since_2010"
  | "source:not_in_release"
  | "source:not_published_for_puerto_rico"
  | "join:ncei_areas_not_counties"
  | "source:failed";

// ---------------------------------------------------------------- parsers

export type FemaRow = { [K in (typeof FEMA_FIELDS)[number]]?: unknown };

/** OpenFEMA's answer: the rows (selected fields only) and $inlinecount. */
export function parseFema(j: unknown): { rows: FemaRow[]; count: number | null } {
  const o = (j ?? {}) as { metadata?: { count?: unknown }; DisasterDeclarationsSummaries?: unknown };
  const raw = Array.isArray(o.DisasterDeclarationsSummaries) ? (o.DisasterDeclarationsSummaries as Array<Record<string, unknown>>) : [];
  const rows = raw.map((r) => Object.fromEntries(FEMA_FIELDS.filter((k) => k in r).map((k) => [k, r[k]])) as FemaRow);
  const c = o.metadata?.count;
  return { rows, count: typeof c === "number" && Number.isInteger(c) && c > 0 ? c : rows.length ? rows.length : null };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const fipsOf = (r: FemaRow) => {
  const s = str(r.fipsStateCode);
  const c = str(r.fipsCountyCode);
  return s && c ? `${s.padStart(2, "0")}${c.padStart(3, "0")}` : null;
};

/**
 * FEMA rows attached to one county: a row is the county's when its state + county code is the
 * county's FIPS, or one of its old codes in FEMA_RENAMES (each disaster kept once). A county code of
 * 000 (tribal areas, statewide designations) names no county and is counted in notCounty; any other
 * code is unmatched (a legacy Connecticut county, Valdez-Cordova 261).
 */
export function attachFema(rows: readonly FemaRow[], fips: string): { rows: FemaRow[]; notCounty: number; unmatched: string[] } {
  const mine: FemaRow[] = [];
  const old: FemaRow[] = [];
  const olds = new Set(femaCodes(fips).slice(1));
  let notCounty = 0;
  const unmatched = new Set<string>();
  for (const r of rows) {
    const f = fipsOf(r);
    if (f === fips) mine.push(r);
    else if (f && olds.has(f)) old.push(r);
    else if (!f || f.endsWith("000")) notCounty++;
    else unmatched.add(f);
  }
  // A FEMA_RENAMES county: an old-code row joins unless its disaster is already filed under the current code.
  const seen = new Set(mine.map((r) => String(r.disasterNumber)));
  for (const r of old) if (!seen.has(String(r.disasterNumber))) mine.push(r);
  return { rows: mine, notCounty, unmatched: [...unmatched].sort() };
}

const yearOf = (iso: unknown): number | null => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
};
export const yearT = (y: number) => Date.UTC(y, 0, 1);

/**
 * Declarations per year by declaration type (DR, EM, FM; never blended): distinct
 * disasterNumber per year of declarationDate. With zeroFill, every year from 1953 to `toYear`
 * with no row is 0; without, it is absent.
 */
export function femaPerYear(rows: readonly FemaRow[], type: "DR" | "EM" | "FM", zeroFill: boolean, toYear: number): Point[] {
  const by = new Map<number, Set<number>>();
  for (const r of rows) {
    if (str(r.declarationType) !== type) continue;
    const y = yearOf(r.declarationDate);
    const n = typeof r.disasterNumber === "number" ? r.disasterNumber : Number(r.disasterNumber);
    if (y == null || !Number.isFinite(n)) continue;
    let s = by.get(y);
    if (!s) by.set(y, (s = new Set()));
    s.add(n);
  }
  return yearly(by, zeroFill, FEMA_FIRST_YEAR, toYear);
}

function yearly(by: Map<number, { size: number } | number>, zeroFill: boolean, from: number, to: number): Point[] {
  const val = (x: { size: number } | number) => (typeof x === "number" ? x : x.size);
  if (!zeroFill) return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([y, x]) => ({ t: yearT(y), v: val(x) }));
  const out: Point[] = [];
  for (let y = from; y <= to; y++) {
    const x = by.get(y);
    out.push({ t: yearT(y), v: x == null ? 0 : val(x) });
  }
  return out;
}

/** The programs FEMA declared for a row, as its two-letter codes. */
export function femaPrograms(r: FemaRow): string[] {
  return (
    [
      ["IH", r.ihProgramDeclared],
      ["IA", r.iaProgramDeclared],
      ["PA", r.paProgramDeclared],
      ["HM", r.hmProgramDeclared],
    ] as const
  )
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/** USDM GetDSCI rows -> weekly points (t = mapDate, UTC), as published, oldest first. */
export function parseDsci(j: unknown): Point[] {
  if (!Array.isArray(j)) return [];
  const out: Point[] = [];
  for (const r of j as Array<Record<string, unknown>>) {
    const t = typeof r.mapDate === "string" ? Date.parse(`${r.mapDate.slice(0, 19)}Z`) : NaN;
    const v = typeof r.dsci === "number" && Number.isFinite(r.dsci) ? r.dsci : null;
    if (Number.isFinite(t)) out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface DroughtNow {
  mapDate: string;
  validStart: string | null;
  validEnd: string | null;
  /** Area percent in each category as USDM publishes it (statisticsType=2: categorical, summing to 100). */
  none: number | null;
  d0: number | null;
  d1: number | null;
  d2: number | null;
  d3: number | null;
  d4: number | null;
}

/** The newest week of USDM's categorical area shares, or null when none came back. */
export function parseDroughtNow(j: unknown): DroughtNow | null {
  if (!Array.isArray(j) || !j.length) return null;
  const rows = (j as Array<Record<string, unknown>>).filter((r) => typeof r.mapDate === "string").sort((a, b) => String(b.mapDate).localeCompare(String(a.mapDate)));
  const r = rows[0];
  if (!r) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { mapDate: String(r.mapDate).slice(0, 10), validStart: str(r.validStart)?.slice(0, 10) ?? null, validEnd: str(r.validEnd)?.slice(0, 10) ?? null, none: n(r.none), d0: n(r.d0), d1: n(r.d1), d2: n(r.d2), d3: n(r.d3), d4: n(r.d4) };
}

/** Climate at a Glance's data.json -> annual points (t = Jan 1 of the year), its title and units. */
export function parseCag(j: unknown): { title: string | null; units: string | null; points: Point[] } {
  const o = (j ?? {}) as { description?: { title?: unknown; units?: unknown }; data?: Record<string, { value?: unknown }> };
  const points: Point[] = [];
  for (const [k, x] of Object.entries(o.data ?? {})) {
    const y = /^(\d{4})12$/.exec(k);
    if (!y) continue;
    const v = typeof x?.value === "number" && Number.isFinite(x.value) ? x.value : null;
    points.push({ t: yearT(Number(y[1])), v });
  }
  points.sort((a, b) => a.t - b.t);
  return { title: str(o.description?.title), units: str(o.description?.units), points };
}

/** A county's SPC row from the bake as yearly points; zeroFill fills 1950..lastYear. */
export function spcPerYear(bake: Pick<SpcBake, "counties" | "meta">, fips: string, zeroFill: boolean): Point[] | null {
  const row = bake.counties[fips];
  const first = bake.meta.firstYear ?? 1950;
  const last = bake.meta.lastYear ?? first;
  if (!row) return zeroFill && !CT_REGION.test(fips) ? yearly(new Map(), true, first, last) : null;
  return yearly(new Map(row.map(([y, n]) => [y, n])), zeroFill, first, last);
}

export interface LandslideLine {
  /** Proportion of the county's land that is susceptible terrain (susc_area / county_area), 0-1, as published. */
  prop_susc: number | null;
  /** Susceptible terrain, km2. */
  susc_area: number | null;
  /** County land area, km2 (water bodies and bays not counted). */
  county_area: number | null;
  /** Landslides in version 2 of USGS's national inventory within the county's susceptible terrain. */
  v2_ls_count: number | null;
  /** Those landslides per km2 of susceptible terrain. */
  v2_density: number | null;
}

/** One county's landslide row, or null with the reason. */
export function landslideLine(bake: Pick<LandslideBake, "counties" | "columns">, fips: string): { line: LandslideLine | null; reason: MissingReason | null } {
  // Fail closed before the row lookup: a 2010 row is never attached to a changed boundary.
  if (fips in BOUNDARY_CHANGED_SINCE_2010) return { line: null, reason: "join:boundary_changed_since_2010" };
  const row = bake.counties[fips];
  if (row) {
    const at = (c: string) => {
      const i = (bake.columns as readonly string[]).indexOf(c);
      return i >= 0 ? (row[i] ?? null) : null;
    };
    return { line: { prop_susc: at("prop_susc"), susc_area: at("susc_area"), county_area: at("county_area"), v2_ls_count: at("v2_ls_count"), v2_density: at("v2_density") }, reason: null };
  }
  if (CT_REGION.test(fips)) return { line: null, reason: "join:legacy_ct_counties" };
  return { line: null, reason: "source:not_in_release" };
}

// ---------------------------------------------------------------- the answer

export const HISTORY_CAVEAT =
  "Disaster declarations are FEMA's record of federal declarations naming this county. A declaration is a federal decision, not a measure of damage. Drought is the U.S. Drought Monitor's weekly index (0-500) since 2000. Climate is NOAA's county series. Tornadoes are SPC's record since 1950, which undercounts weak tornadoes before the 1990s radar network, and tornadoes with no county recorded are left out. Landslide susceptibility is a USGS 2024 model of terrain, not a forecast. Connecticut is published by FEMA, NOAA and USGS in its old counties.";
export const CT_HISTORY_LINE = "FEMA, NOAA and USGS publish Connecticut in its old counties, so only drought is shown for planning regions.";
export { STORM_EVENTS_CAVEAT };
export const ZERO_RULE_NOTE =
  "A year with no FEMA declaration or no SPC tornado is absent from those series, not 0, until the zero rule is decided (HISTORY_ZERO_FILL is off).";
export const ZERO_RULE_ON_NOTE = "A year with no FEMA declaration (from 1953) or no SPC tornado (from 1950) is 0: both are the complete federal record (HISTORY_ZERO_FILL is on).";

/** One upstream's outcome: its answer, a skip (the regime says it publishes nothing here) or a failure. */
export type Part<T> = { value: T; retrievedAt: string; url: string } | { skip: MissingReason } | { error: string; url: string };

export interface HistoryInputs {
  fips: string;
  name: string;
  stusab: string;
  now: number;
  /** Last N calendar years to return (null: all). */
  years: number | null;
  /** Declarations listed (0-1000); the series always count every row. */
  declarationsCap: number;
  zeroFill?: boolean;
  fema: Part<{ rows: FemaRow[]; count: number | null }>;
  dsci: Part<Point[]>;
  droughtNow: Part<DroughtNow | null>;
  tavg: Part<{ title: string | null; units: string | null; points: Point[] }>;
  pcp: Part<{ title: string | null; units: string | null; points: Point[] }>;
  spc: SpcBake;
  landslide: LandslideBake;
  /** The county's storm-events shard (one state's, lazily loaded) with the bake's meta; absent: not asked. */
  storms?: Part<{ meta: StormMeta; shard: StormShard }>;
}

export interface HistoryDeclaration {
  disasterNumber: number | null;
  declarationType: string | null;
  declarationDate: string | null;
  incidentType: string | null;
  /** Verbatim, never embedded. */
  declarationTitle: string | null;
  incidentBeginDate: string | null;
  incidentEndDate: string | null;
  programs: string[];
  /** As FEMA names it, verbatim, never embedded. */
  designatedArea: string | null;
  placeCode: string | null;
  tribalRequest: boolean | null;
}

export interface HistoryData {
  fips: string;
  name: string;
  state: string;
  series: Series[];
  declarations: HistoryDeclaration[];
  /** Every declaration row FEMA returned for the county (the series count all of them). */
  declarationRows: number | null;
  droughtNow: DroughtNow | null;
  landslide: LandslideLine | null;
  /** NCEI Storm Events reports per year by type (county-coded rows, tornadoes left to SPC); null when not asked, skipped or failed. */
  storms: StormsAnswer | null;
  missing: Array<{ source: string; reason: MissingReason; detail?: string }>;
}

export interface HistoryAnswer {
  data: HistoryData;
  meta: {
    zeroFill: boolean;
    years: number | null;
    notCounty: number;
    unmatched: string[];
    ctRegime: { fema: string; usdm: string; cag: string; spc: string; landslide: string; storms?: string } | null;
    asOf: Record<string, string | null>;
  };
  provenance: Provenance[];
  caveats: string[];
}

const isOk = <T,>(p: Part<T>): p is { value: T; retrievedAt: string; url: string } => "value" in p;
const ymd = (iso: unknown) => (typeof iso === "string" ? iso.slice(0, 10) : null);
const iso = (t: number) => new Date(t).toISOString();

export function declarationOf(r: FemaRow): HistoryDeclaration {
  const n = typeof r.disasterNumber === "number" ? r.disasterNumber : Number(r.disasterNumber);
  return {
    disasterNumber: Number.isFinite(n) ? n : null,
    declarationType: str(r.declarationType),
    declarationDate: ymd(r.declarationDate),
    incidentType: str(r.incidentType),
    declarationTitle: str(r.declarationTitle),
    incidentBeginDate: ymd(r.incidentBeginDate),
    incidentEndDate: ymd(r.incidentEndDate),
    programs: femaPrograms(r),
    designatedArea: str(r.designatedArea),
    placeCode: str(r.placeCode),
    tribalRequest: typeof r.tribalRequest === "boolean" ? r.tribalRequest : null,
  };
}

/** The whole answer from the parts the route fetched (pure; the tests feed it captured fixtures). */
export function assembleHistory(i: HistoryInputs): HistoryAnswer {
  const zeroFill = i.zeroFill ?? HISTORY_ZERO_FILL;
  const nowYear = new Date(i.now).getUTCFullYear();
  const cutoff = i.years == null ? -Infinity : yearT(nowYear - i.years + 1);
  const keep = (pts: Point[]) => pts.filter((p) => p.t >= cutoff);
  const geo = { kind: "county" as const, id: i.fips, name: `${i.name}, ${i.stusab}` };
  const series: Series[] = [];
  const missing: HistoryData["missing"] = [];
  const provs: Provenance[] = [];
  const caveats = [HISTORY_CAVEAT, zeroFill ? ZERO_RULE_ON_NOTE : ZERO_RULE_NOTE];
  const asOf: Record<string, string | null> = {};
  const fail = (sourceName: string, p: Part<unknown>) => {
    if ("skip" in p) missing.push({ source: sourceName, reason: p.skip });
    else if ("error" in p) {
      missing.push({ source: sourceName, reason: "source:failed", detail: p.error.slice(0, 160) });
      caveats.push(`${sourceName} did not answer this time (${p.error.slice(0, 80)}): its series are unknown, not empty.`);
    }
  };

  // FEMA
  let notCounty = 0;
  let unmatched: string[] = [];
  let declarations: HistoryDeclaration[] = [];
  let declarationRows: number | null = null;
  if (isOk(i.fema)) {
    const a = attachFema(i.fema.value.rows, i.fips);
    notCounty = a.notCounty;
    unmatched = a.unmatched;
    declarationRows = a.rows.length;
    const prov = provenance(source("fema-openfema"), {
      kind: "published",
      seriesId: `DisasterDeclarationsSummaries v2, ${femaFilter(i.fips)}`,
      upstreamUrl: i.fema.url,
      retrievedAt: i.fema.retrievedAt,
      method: "per year: distinct disasterNumber by the year of declarationDate (UTC), one series per declarationType",
      notes: [FEMA_CREDIT],
    });
    provs.push(prov);
    asOf.fema = i.fema.retrievedAt;
    for (const [type, title] of [
      ["DR", "major disaster declarations"],
      ["EM", "emergency declarations"],
      ["FM", "fire management assistance declarations"],
    ] as const) {
      series.push({ id: `fema:${type.toLowerCase()}:${i.fips}`, title: `FEMA ${title} per year`, unit: "declarations", frequency: "annual", geo, provenance: prov, tags: ["hazards", "fema"], points: keep(femaPerYear(a.rows, type, zeroFill, nowYear)) });
    }
    declarations = a.rows.map(declarationOf).sort((x, y) => String(y.declarationDate).localeCompare(String(x.declarationDate))).slice(0, Math.max(0, Math.min(FEMA_MAX, i.declarationsCap)));
    if (i.fema.value.count != null && i.fema.value.count > FEMA_MAX) caveats.push(`FEMA has ${i.fema.value.count} rows for this county; only the newest ${FEMA_MAX} were read, so the earliest years are short.`);
    if (i.stusab === "AK") caveats.push(ALASKA_FEMA_NOTE);
    if (i.fips === "02063" || i.fips === "02066") caveats.push(FEMA_VALDEZ_CORDOVA_NOTE);
    const renameNote = femaRenameNote(i.fips);
    if (renameNote) caveats.push(renameNote);
  } else fail("FEMA", i.fema);

  // USDM
  if (isOk(i.dsci)) {
    const prov = provenance(source("usdm"), { kind: "published", seriesId: `CountyStatistics/GetDSCI aoi=${i.fips}`, upstreamUrl: i.dsci.url, retrievedAt: i.dsci.retrievedAt, notes: [USDM_CREDIT] });
    provs.push(prov);
    asOf.usdm = i.dsci.value.length ? iso(i.dsci.value[i.dsci.value.length - 1].t).slice(0, 10) : null;
    if (!i.dsci.value.length) missing.push({ source: "USDM", reason: "source:not_in_release", detail: `USDM returned no weeks for ${i.fips}` });
    else series.push({ id: `usdm:dsci:${i.fips}`, title: "U.S. Drought Monitor Drought Severity and Coverage Index (weekly)", unit: "index 0-500", frequency: "weekly", geo, provenance: prov, tags: ["hazards", "drought"], points: keep(i.dsci.value) });
  } else fail("USDM", i.dsci);
  const droughtNow = isOk(i.droughtNow) ? i.droughtNow.value : null;
  if (isOk(i.droughtNow) && droughtNow) provs.push(provenance(source("usdm"), { kind: "published", seriesId: `CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent aoi=${i.fips} statisticsType=2 (categorical), map of ${droughtNow.mapDate}`, upstreamUrl: i.droughtNow.url, retrievedAt: i.droughtNow.retrievedAt, notes: [USDM_CREDIT] }));

  // NOAA CAG
  for (const [p, element, unitFallback, title] of [
    [i.tavg, "tavg", "Degrees Fahrenheit", "Annual average temperature (NOAA Climate at a Glance)"],
    [i.pcp, "pcp", "Inches", "Annual precipitation (NOAA Climate at a Glance)"],
  ] as const) {
    if (isOk(p)) {
      const prov = provenance(source("noaa-cag"), { kind: "published", seriesId: `county/time-series/${i.stusab}-${i.fips.slice(2)}/${element}/12/12 (January-December)${p.value.title ? `: ${p.value.title}` : ""}`, upstreamUrl: p.url, retrievedAt: p.retrievedAt });
      provs.push(prov);
      const pts = p.value.points;
      asOf[`cag_${element}`] = pts.length ? String(new Date(pts[pts.length - 1].t).getUTCFullYear()) : null;
      series.push({ id: `cag:${element}:${i.fips}`, title, unit: p.value.units ?? unitFallback, frequency: "annual", geo, provenance: prov, tags: ["hazards", "climate"], points: keep(pts) });
    } else fail(`NOAA Climate at a Glance (${element})`, p);
  }

  // SPC (bake)
  const spcProv = provenance(source("noaa-spc"), {
    kind: "published",
    seriesId: "1950-2025_all_tornadoes.csv, distinct tornadoes per county per year (lib/hazards/data/spc-tornado-county.json)",
    upstreamUrl: i.spc.meta.url,
    retrievedAt: `${BAKED_ON}T00:00:00.000Z`,
    releasedAt: i.spc.meta.lastModified ? new Date(i.spc.meta.lastModified).toISOString() : undefined,
    method: "distinct tornadoes per year naming the county in f1..f4 of any of their rows (state segments and continuation rows past four counties included; the whole-track summaries of multi-state tornadoes skipped); baked by scripts/bake-hazard-history.mjs",
  });
  asOf.spc = String(i.spc.meta.lastYear ?? "");
  if (CT_REGION.test(i.fips)) missing.push({ source: "SPC", reason: "join:legacy_ct_counties" });
  else {
    const pts = spcPerYear(i.spc, i.fips, zeroFill);
    provs.push(spcProv);
    series.push({ id: `spc:tornadoes:${i.fips}`, title: "Tornadoes per year (NOAA SPC)", unit: "tornadoes", frequency: "annual", geo, provenance: spcProv, tags: ["hazards", "tornado"], points: keep(pts ?? []) });
    if (!pts) caveats.push("SPC records no tornado naming this county since 1950; with the zero rule off, that is shown as no points, not as zeros.");
  }

  // Landslide (bake)
  const ls = landslideLine(i.landslide, i.fips);
  if (ls.line) provs.push(provenance(source("usgs-landslide-susc"), { kind: "published", seriesId: "county_analysis.csv (2010 counties), keyed by FIPS (lib/hazards/data/landslide-county.json)", upstreamUrl: i.landslide.meta.url, retrievedAt: `${BAKED_ON}T00:00:00.000Z`, period: "2024 release", notes: ["CC0 1.0", "v2_ls_count counts version 2 of USGS's landslide inventory; the Landslides layer draws version 3."] }));
  else if (ls.reason) missing.push({ source: "USGS landslide susceptibility", reason: ls.reason, detail: BOUNDARY_CHANGED_SINCE_2010[i.fips] });
  asOf.landslide = "2024-08-22";

  // NCEI Storm Events (bake, per-state shard)
  let storms: StormsAnswer | null = null;
  if (i.storms) {
    const st = assembleStorms({ fips: i.fips, now: i.now, years: i.years, zeroFill, storms: i.storms }, geo);
    storms = st.storms;
    series.push(...st.series);
    provs.push(...st.provenance);
    missing.push(...st.missing);
    caveats.push(...st.caveats);
    if (st.asOf) asOf.storms = st.asOf;
  }

  let ctRegime: HistoryAnswer["meta"]["ctRegime"] = null;
  if (CT_REGION.test(i.fips)) {
    ctRegime = { fema: "legacy counties", usdm: "planning regions", cag: "legacy counties", spc: "legacy counties", landslide: "legacy counties", ...(i.storms ? { storms: "legacy counties" } : {}) };
    caveats.push(CT_HISTORY_LINE);
    if (i.storms) caveats.push(STORM_CT_LINE);
  }
  if (i.stusab === "PR") caveats.push("NOAA Climate at a Glance publishes no Puerto Rico county series, so climate is not shown.");
  if (i.stusab === "HI") caveats.push("NOAA Climate at a Glance's Hawaii county series start in 1991.");

  return {
    data: { fips: i.fips, name: i.name, state: i.stusab, series, declarations, declarationRows, droughtNow, landslide: ls.line, storms, missing },
    meta: { zeroFill, years: i.years, notCounty, unmatched, ctRegime, asOf },
    provenance: provs,
    caveats,
  };
}

/** The storms part alone (op=history&part=storms) or inside the whole answer: the series, the provenance and the reasons. */
export function assembleStorms(
  i: { fips: string; now: number; years: number | null; zeroFill?: boolean; storms: Part<{ meta: StormMeta; shard: StormShard }> },
  geo: Series["geo"],
): { storms: StormsAnswer | null; series: Series[]; provenance: Provenance[]; missing: HistoryData["missing"]; caveats: string[]; asOf: string | null } {
  const zeroFill = i.zeroFill ?? HISTORY_ZERO_FILL;
  const out = { storms: null as StormsAnswer | null, series: [] as Series[], provenance: [] as Provenance[], missing: [] as HistoryData["missing"], caveats: [] as string[], asOf: null as string | null };
  if (CT_REGION.test(i.fips)) {
    out.missing.push({ source: "NCEI Storm Events", reason: "join:legacy_ct_counties" });
    return out;
  }
  const p = i.storms;
  if ("skip" in p) {
    out.missing.push({ source: "NCEI Storm Events", reason: p.skip });
    if (p.skip === "join:ncei_areas_not_counties") out.caveats.push(STORM_ALASKA_LINE);
    return out;
  }
  if ("error" in p) {
    out.missing.push({ source: "NCEI Storm Events", reason: "source:failed", detail: p.error.slice(0, 160) });
    out.caveats.push(`NCEI Storm Events could not be read this time (${p.error.slice(0, 80)}): its series are unknown, not empty.`);
    return out;
  }
  const { meta, shard } = p.value;
  const cutYear = i.years == null ? -Infinity : new Date(i.now).getUTCFullYear() - i.years + 1;
  const a = stormSeries(meta, shard, i.fips, zeroFill);
  // Every type with a report in the county, and the three main types always (so a blank year is said even with no report).
  const shown = a.types.filter((t) => t.points.length || (STORM_MAIN_TYPES as readonly string[]).includes(t.type));
  const storms: StormsAnswer = { ...a, types: shown.map((t) => ({ ...t, points: t.points.filter(([y]) => y >= cutYear), blank: t.blank.filter(([y]) => y >= cutYear) })).map((t) => ({ ...t, total: t.points.reduce((x, [, n]) => x + n, 0) })) };
  const prov = provenance(source("ncei-storm-events"), {
    kind: "published",
    seriesId: `Storm Events details files ${meta.firstYear}-${meta.lastYear}, county-coded rows per year per event type, Tornado excluded (lib/hazards/data/storm-events/${i.fips.slice(0, 2)}.json)`,
    upstreamUrl: meta.dir,
    retrievedAt: p.retrievedAt,
    period: meta.lastYearMonth ? `${meta.firstYear}-01 to ${meta.lastYearMonth.slice(0, 4)}-${meta.lastYearMonth.slice(4)}` : undefined,
    method: `reports per year where CZ_TYPE = C, EVENT_TYPE is not Tornado, and the county code and CZ_NAME agree with the county; a type's year is null ("zone-coded") where ${Math.round(STORM_ZONE_SHARE_MAX * 100)} % or more of its rows nationally were zone-coded; baked by scripts/bake-storm-events.mjs from ${meta.files.length} files (c stamps and sha256 in meta.json)`,
    notes: [meta.credit],
  });
  out.storms = storms;
  out.provenance.push(prov);
  out.series.push(...stormAsSeries(storms, geo, prov));
  out.asOf = meta.lastYearMonth;
  out.caveats.push(STORM_EVENTS_CAVEAT, STORM_GATE_NOTE, STORM_NAME_CHECK_NOTE, zeroFill ? STORM_ZERO_ON_NOTE : STORM_ZERO_NOTE);
  if (storms.break) out.caveats.push(`Storm events: ${storms.break.what}; the series counts the county as it was each year, so ${storms.break.year} is a break in the series.`);
  if (!storms.types.some((t) => t.points.length)) out.caveats.push("NCEI records no county-coded storm event naming this county in these years outside tornadoes; with the zero rule off, that is shown as no bars, not as zeros.");
  return out;
}

export const STORM_ZERO_NOTE = "A drawn year with no storm-event report for the county is absent, not 0, until the zero rule is decided (HISTORY_ZERO_FILL is off).";
export const STORM_ZERO_ON_NOTE = "A drawn year with no storm-event report for the county is 0 (HISTORY_ZERO_FILL is on); a zone-coded year stays blank.";

/** What a regime says about a county before anything is fetched: which upstreams publish nothing in its geography. */
export function skips(fips: string, stusab: string): { fema: MissingReason | null; cag: MissingReason | null } {
  if (CT_REGION.test(fips)) return { fema: "join:legacy_ct_counties", cag: "join:legacy_ct_counties" };
  return { fema: null, cag: stusab === "PR" ? "source:not_published_for_puerto_rico" : null };
}

// ---------------------------------------------------------------- derivations the aside draws (labelled as computed)

/** The highest weekly DSCI in each calendar year, labelled "highest weekly DSCI in the year" wherever drawn. */
export function dsciYearlyMax(points: readonly Point[]): Array<[string, number]> {
  const by = new Map<number, number>();
  for (const p of points) {
    if (p.v == null) continue;
    const y = new Date(p.t).getUTCFullYear();
    by.set(y, Math.max(by.get(y) ?? -Infinity, p.v));
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => [String(y), v]);
}

/** The 1901-2000 mean of an annual series, computed from its own published values; null unless all 100 years are present. */
export function centuryMean(points: readonly Point[]): number | null {
  const vals = points.filter((p) => {
    const y = new Date(p.t).getUTCFullYear();
    return y >= 1901 && y <= 2000 && p.v != null;
  });
  if (vals.length !== 100) return null;
  return vals.reduce((s, p) => s + (p.v as number), 0) / 100;
}

/** Yearly [label, value] rows for a count series (only the years present; no zero is invented). */
export function yearRows(points: readonly Point[]): Array<[string, number]> {
  return points.filter((p) => p.v != null).map((p) => [String(new Date(p.t).getUTCFullYear()), p.v as number]);
}

/** The county FIPS whose hazard history a click opens: a county of the NRI, SVI or WRC layers; null otherwise. */
export function countyHistoryFips(layer: string, extra: unknown): string | null {
  const ok = (f: unknown) => (typeof f === "string" && /^\d{5}$/.test(f) ? f : null);
  if (layer === "riskindex") {
    const x = extra as { level?: string; row?: { stcofips?: unknown } } | undefined;
    return x?.level === "county" ? ok(x.row?.stcofips) : null;
  }
  if (layer === "vulnerability") {
    const x = extra as { level?: string; fips?: unknown } | undefined;
    return x?.level === "county" ? ok(x.fips) : null;
  }
  if (layer === "wildfirerisk") {
    const x = extra as { level?: string; geoid?: unknown } | undefined;
    return x?.level === "county" ? ok(x.geoid) : null;
  }
  return null;
}
