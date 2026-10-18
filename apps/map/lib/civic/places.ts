// CDC PLACES: Local Data for Better Health, 2025 release (data year 2023;
// 2022 for five measures). Model-based estimates for counties and census
// tracts on data.cdc.gov (Socrata, CORS *). Pure: the measure list, the
// SoQL for each call, the row parsers, the joins and the quantile bins. The
// route is /api/civic?op=health.
//
//   county  one whole-measure pull per measure, age-adjusted (2,957 counties
//           for most measures, 3,144 for the five 2022 ones, 2,299 for the
//           social-needs module, plus one national row the parser drops), joined by FIPS onto the shared county
//           outlines (lib/layers/areas.ts); never a per-location or
//           within_box query in a pan path (one cold per-location call took
//           13.8 s on 2026-10-16, a within_box 19.6 s)
//   tract   crude prevalence by countyfips for at most 6 counties in view,
//           joined by tract FIPS onto fabric's TIGER tract outlines
//   place   every measure for one county (the click answer), age-adjusted
//
// A county or tract with no row for a measure is masked ("not published"),
// never 0. Connecticut is in planning regions (09110-09190) in both levels,
// as TIGER current is.

export const PLACES_COUNTY = "https://data.cdc.gov/resource/swc5-untb.json";
export const PLACES_TRACT = "https://data.cdc.gov/resource/cwsq-ngmh.json";
/** Counties asked for tracts at most (one request each). */
export const PLACES_MAX_COUNTIES = 6;
/** Below this camera height the layer shows tracts. */
export const PLACES_TRACT_MAX_M = 100_000;

export const PLACES_CAVEAT =
  "Model-based estimates from CDC's BRFSS survey, ACS and the Census population; they are not counts of diagnosed people and are not for ranking small differences. Tracts with very small populations are not published.";
export const PLACES_ATTRIBUTION = "Centers for Disease Control and Prevention, PLACES: Local Data for Better Health, 2025 release";

/** The 40 measures (data.cdc.gov swc5-untb, grouped by measureid on 2026-10-16): CDC's wording, short name, category, data year and how many age-adjusted rows CDC publishes (the counties with a value, plus one national row, locationid 59 "US", which the parser drops). */
export const PLACES_MEASURES = {
  "ACCESS2": { name: "Current lack of health insurance among adults aged 18-64 years", short: "Health Insurance", category: "Prevention", year: 2023, rows: 2958 },
  "ARTHRITIS": { name: "Arthritis among adults", short: "Arthritis", category: "Health Outcomes", year: 2023, rows: 2958 },
  "BINGE": { name: "Binge drinking among adults", short: "Binge Drinking", category: "Health Risk Behaviors", year: 2023, rows: 2958 },
  "BPHIGH": { name: "High blood pressure among adults", short: "High Blood Pressure", category: "Health Outcomes", year: 2023, rows: 2958 },
  "BPMED": { name: "Taking medicine to control high blood pressure among adults with high blood pressure", short: "High Blood Pressure Medication", category: "Prevention", year: 2023, rows: 2958 },
  "CANCER": { name: "Cancer (non-skin) or melanoma among adults", short: "Cancer (non-skin) or Melanoma", category: "Health Outcomes", year: 2023, rows: 2958 },
  "CASTHMA": { name: "Current asthma among adults", short: "Current Asthma", category: "Health Outcomes", year: 2023, rows: 2958 },
  "CHD": { name: "Coronary heart disease among adults", short: "Coronary Heart Disease", category: "Health Outcomes", year: 2023, rows: 2958 },
  "CHECKUP": { name: "Visits to doctor for routine checkup within the past year among adults", short: "Annual Checkup", category: "Prevention", year: 2023, rows: 2958 },
  "CHOLSCREEN": { name: "Cholesterol screening among adults", short: "Cholesterol Screening", category: "Prevention", year: 2023, rows: 2958 },
  "COGNITION": { name: "Cognitive disability among adults", short: "Cognitive Disability", category: "Disability", year: 2023, rows: 2958 },
  "COLON_SCREEN": { name: "Colorectal cancer screening among adults aged 45–75 years", short: "Colorectal Cancer Screening", category: "Prevention", year: 2022, rows: 3145 },
  "COPD": { name: "Chronic obstructive pulmonary disease among adults", short: "COPD", category: "Health Outcomes", year: 2023, rows: 2958 },
  "CSMOKING": { name: "Current cigarette smoking among adults", short: "Current Cigarette Smoking", category: "Health Risk Behaviors", year: 2023, rows: 2958 },
  "DENTAL": { name: "Visited dentist or dental clinic in the past year among adults", short: "Dental Visit", category: "Prevention", year: 2022, rows: 3145 },
  "DEPRESSION": { name: "Depression among adults", short: "Depression", category: "Health Outcomes", year: 2023, rows: 2958 },
  "DIABETES": { name: "Diagnosed diabetes among adults", short: "Diabetes", category: "Health Outcomes", year: 2023, rows: 2958 },
  "DISABILITY": { name: "Any disability among adults", short: "Any Disability", category: "Disability", year: 2023, rows: 2958 },
  "EMOTIONSPT": { name: "Lack of social and emotional support among adults", short: "Lack of Social/Emotional Support", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "FOODINSECU": { name: "Food insecurity in the past 12 months among adults", short: "Food Insecurity", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "FOODSTAMP": { name: "Received food stamps in the past 12 months among adults", short: "Food Stamps", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "GHLTH": { name: "Fair or poor self-rated health status among adults", short: "General Health", category: "Health Status", year: 2023, rows: 2958 },
  "HEARING": { name: "Hearing disability among adults", short: "Hearing Disability", category: "Disability", year: 2023, rows: 2958 },
  "HIGHCHOL": { name: "High cholesterol among adults who have ever been screened", short: "High Cholesterol", category: "Health Outcomes", year: 2023, rows: 2958 },
  "HOUSINSECU": { name: "Housing insecurity in the past 12 months among adults", short: "Housing Insecurity", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "INDEPLIVE": { name: "Independent living disability among adults", short: "Independent Living Disability", category: "Disability", year: 2023, rows: 2958 },
  "LACKTRPT": { name: "Lack of reliable transportation in the past 12 months among adults", short: "Transportation Barriers", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "LONELINESS": { name: "Loneliness among adults", short: "Loneliness", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "LPA": { name: "No leisure-time physical activity among adults", short: "Physical Inactivity", category: "Health Risk Behaviors", year: 2023, rows: 2958 },
  "MAMMOUSE": { name: "Mammography use among women aged 50-74 years", short: "Mammography", category: "Prevention", year: 2022, rows: 3145 },
  "MHLTH": { name: "Frequent mental distress among adults", short: "Frequent Mental Distress", category: "Health Status", year: 2023, rows: 2958 },
  "MOBILITY": { name: "Mobility disability among adults", short: "Mobility Disability", category: "Disability", year: 2023, rows: 2958 },
  "OBESITY": { name: "Obesity among adults", short: "Obesity", category: "Health Outcomes", year: 2023, rows: 2958 },
  "PHLTH": { name: "Frequent physical distress among adults", short: "Frequent Physical Distress", category: "Health Status", year: 2023, rows: 2958 },
  "SELFCARE": { name: "Self-care disability among adults", short: "Self-care Disability", category: "Disability", year: 2023, rows: 2958 },
  "SHUTUTILITY": { name: "Utility services shut-off threat in the past 12 months among adults", short: "Utility Services Threat", category: "Health-Related Social Needs", year: 2023, rows: 2300 },
  "SLEEP": { name: "Short sleep duration among adults", short: "Short Sleep Duration", category: "Health Risk Behaviors", year: 2022, rows: 3145 },
  "STROKE": { name: "Stroke among adults", short: "Stroke", category: "Health Outcomes", year: 2023, rows: 2958 },
  "TEETHLOST": { name: "All teeth lost among adults aged >=65 years", short: "All Teeth Lost", category: "Health Outcomes", year: 2022, rows: 3145 },
  "VISION": { name: "Vision disability among adults", short: "Vision Disability", category: "Disability", year: 2023, rows: 2958 },
} as const;

export type PlacesMeasure = keyof typeof PLACES_MEASURES;
export const PLACES_DEFAULT_MEASURE: PlacesMeasure = "DIABETES";

export function isPlacesMeasure(v: unknown): v is PlacesMeasure {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PLACES_MEASURES, v);
}

/** The Health-Related Social Needs measures: an optional BRFSS module not every state fielded. */
export const SOCIAL_NEEDS: readonly PlacesMeasure[] = ["EMOTIONSPT", "FOODINSECU", "FOODSTAMP", "HOUSINSECU", "LACKTRPT", "LONELINESS", "SHUTUTILITY"];

const COUNTY_SELECT = "year,stateabbr,statedesc,locationid,locationname,measureid,datavaluetypeid,data_value,low_confidence_limit,high_confidence_limit,totalpopulation";
const TRACT_SELECT = "year,stateabbr,countyfips,countyname,locationname,measureid,datavaluetypeid,data_value,low_confidence_limit,high_confidence_limit,totalpopulation";

/** The whole-measure county pull: every county's age-adjusted row for one measure. */
export function countyMeasureUrl(m: PlacesMeasure): string {
  const q = new URLSearchParams({ $select: COUNTY_SELECT, measureid: m, datavaluetypeid: "AgeAdjPrv", $order: "locationid", $limit: "5000" });
  return `${PLACES_COUNTY}?${q.toString()}`;
}

/** One county's tracts, crude prevalence, for one measure: by countyfips, never within_box. */
export function tractUrl(countyFips: string, m: PlacesMeasure): string {
  const q = new URLSearchParams({ $select: TRACT_SELECT, $where: `countyfips='${countyFips}' AND measureid='${m}' AND datavaluetypeid='CrdPrv'`, $order: "locationname", $limit: "5000" });
  return `${PLACES_TRACT}?${q.toString()}`;
}

/** Every measure for one county, age-adjusted (the click answer). */
export function placeUrl(countyFips: string): string {
  const q = new URLSearchParams({ $select: COUNTY_SELECT, locationid: countyFips, datavaluetypeid: "AgeAdjPrv", $limit: "100" });
  return `${PLACES_COUNTY}?${q.toString()}`;
}

export interface PlacesValue {
  /** County FIPS (5) or tract FIPS (11). */
  fips: string;
  /** County name as CDC lists it; null for a tract. */
  name: string | null;
  state: string | null;
  measure: PlacesMeasure;
  /** Percent, as published; null when CDC published none. */
  value: number | null;
  low: number | null;
  high: number | null;
  year: number | null;
  /** AgeAdjPrv (county) or CrdPrv (tract). */
  type: "AgeAdjPrv" | "CrdPrv";
  population: number | null;
}

const n = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Socrata rows -> values; a row with no FIPS, an unknown measure or another value type is dropped. */
export function parsePlaces(rows: unknown, level: "county" | "tract"): PlacesValue[] {
  if (!Array.isArray(rows)) return [];
  const out: PlacesValue[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const fips = level === "county" ? s(r.locationid) : s(r.locationname);
    const m = s(r.measureid);
    const type = s(r.datavaluetypeid);
    if (!fips || !(level === "county" ? /^\d{5}$/ : /^\d{11}$/).test(fips) || !isPlacesMeasure(m)) continue;
    if (type !== (level === "county" ? "AgeAdjPrv" : "CrdPrv")) continue;
    out.push({
      fips,
      name: level === "county" ? s(r.locationname) : null,
      state: s(r.stateabbr),
      measure: m,
      value: n(r.data_value),
      low: n(r.low_confidence_limit),
      high: n(r.high_confidence_limit),
      year: n(r.year),
      type,
      population: n(r.totalpopulation),
    });
  }
  return out;
}

/** The one shade every published value takes when there are too few to rank. */
export const UNRANKED_BIN = 2;

/**
 * Quintile breaks of the published values (null values left out): the four cut points between
 * five equal-count bins, as values. Fewer than five values have no breaks.
 */
export function quintiles(values: ReadonlyArray<number | null>): number[] {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (v.length < 5) return [];
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}

/**
 * The bin (0..4) of a value against quintile breaks; null only for a value not published. With no
 * breaks (fewer than five values to rank) a published value takes the middle bin, UNRANKED_BIN:
 * drawn as published, never as "not published".
 */
export function binOf(value: number | null, breaks: readonly number[]): number | null {
  if (value == null) return null;
  if (breaks.length !== 4) return UNRANKED_BIN;
  let b = 0;
  while (b < 4 && value >= breaks[b]) b++;
  return b;
}

export const PLACES_BIN_COLORS = ["#EFF6FF", "#BFDBFE", "#60A5FA", "#2563EB", "#1E3A8A"] as const;

/** The dossier line for one value. */
export function valueText(v: Pick<PlacesValue, "value" | "low" | "high" | "year" | "type">): string {
  if (v.value == null) return "not published";
  const ci = v.low != null && v.high != null ? ` (95% CI ${v.low}-${v.high})` : "";
  return `${v.value}%${ci}, ${v.type === "AgeAdjPrv" ? "age-adjusted" : "crude"} prevalence, ${v.year ?? "year not given"}`;
}

/**
 * The click answer: every measure for one county, grouped by CDC category. A social-needs
 * measure the county has no row for reads "this state did not field the social-needs module"
 * when the county has none of the seven; any other missing measure reads "not published".
 */
export function placeDetails(values: readonly PlacesValue[]): Record<string, string> {
  const by = new Map(values.map((v) => [v.measure, v]));
  const noModule = SOCIAL_NEEDS.every((m) => !by.has(m));
  const d: Record<string, string> = {};
  const cats = [...new Set(Object.values(PLACES_MEASURES).map((m) => m.category))];
  for (const c of cats) {
    for (const [id, m] of Object.entries(PLACES_MEASURES) as Array<[PlacesMeasure, (typeof PLACES_MEASURES)[PlacesMeasure]]>) {
      if (m.category !== c) continue;
      const v = by.get(id);
      d[`${c}: ${m.short}`] = v ? valueText(v) : SOCIAL_NEEDS.includes(id) && noModule ? "this state did not field the social-needs module" : "not published";
    }
  }
  return d;
}
