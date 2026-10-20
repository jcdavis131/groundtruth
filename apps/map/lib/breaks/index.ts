// breaks/1: the cut points a styled layer bins against, committed with where they came from.
//
// One file per layer and measure under data/breaks (schema: data/breaks/breaks.schema.json), written
// by scripts/export-breaks.mjs from a committed input: the 40 CDC PLACES county measures (layer
// "health") and the four place exports. This module is the one reader. The health layer bins its
// counties and its tracts on placesBreaks(measure), the /api/civic health reply serves the same
// numbers, and the legend prints the file's own universe and n, so what is drawn, what the API says
// and what the key says cannot differ.
//
// Nothing here computes a break. A break computed from the features in view moves when the camera
// does; the files do not.

import h_ACCESS2 from "@/data/breaks/health/ACCESS2.json";
import h_ARTHRITIS from "@/data/breaks/health/ARTHRITIS.json";
import h_BINGE from "@/data/breaks/health/BINGE.json";
import h_BPHIGH from "@/data/breaks/health/BPHIGH.json";
import h_BPMED from "@/data/breaks/health/BPMED.json";
import h_CANCER from "@/data/breaks/health/CANCER.json";
import h_CASTHMA from "@/data/breaks/health/CASTHMA.json";
import h_CHD from "@/data/breaks/health/CHD.json";
import h_CHECKUP from "@/data/breaks/health/CHECKUP.json";
import h_CHOLSCREEN from "@/data/breaks/health/CHOLSCREEN.json";
import h_COGNITION from "@/data/breaks/health/COGNITION.json";
import h_COLON_SCREEN from "@/data/breaks/health/COLON_SCREEN.json";
import h_COPD from "@/data/breaks/health/COPD.json";
import h_CSMOKING from "@/data/breaks/health/CSMOKING.json";
import h_DENTAL from "@/data/breaks/health/DENTAL.json";
import h_DEPRESSION from "@/data/breaks/health/DEPRESSION.json";
import h_DIABETES from "@/data/breaks/health/DIABETES.json";
import h_DISABILITY from "@/data/breaks/health/DISABILITY.json";
import h_EMOTIONSPT from "@/data/breaks/health/EMOTIONSPT.json";
import h_FOODINSECU from "@/data/breaks/health/FOODINSECU.json";
import h_FOODSTAMP from "@/data/breaks/health/FOODSTAMP.json";
import h_GHLTH from "@/data/breaks/health/GHLTH.json";
import h_HEARING from "@/data/breaks/health/HEARING.json";
import h_HIGHCHOL from "@/data/breaks/health/HIGHCHOL.json";
import h_HOUSINSECU from "@/data/breaks/health/HOUSINSECU.json";
import h_INDEPLIVE from "@/data/breaks/health/INDEPLIVE.json";
import h_LACKTRPT from "@/data/breaks/health/LACKTRPT.json";
import h_LONELINESS from "@/data/breaks/health/LONELINESS.json";
import h_LPA from "@/data/breaks/health/LPA.json";
import h_MAMMOUSE from "@/data/breaks/health/MAMMOUSE.json";
import h_MHLTH from "@/data/breaks/health/MHLTH.json";
import h_MOBILITY from "@/data/breaks/health/MOBILITY.json";
import h_OBESITY from "@/data/breaks/health/OBESITY.json";
import h_PHLTH from "@/data/breaks/health/PHLTH.json";
import h_SELFCARE from "@/data/breaks/health/SELFCARE.json";
import h_SHUTUTILITY from "@/data/breaks/health/SHUTUTILITY.json";
import h_SLEEP from "@/data/breaks/health/SLEEP.json";
import h_STROKE from "@/data/breaks/health/STROKE.json";
import h_TEETHLOST from "@/data/breaks/health/TEETHLOST.json";
import h_VISION from "@/data/breaks/health/VISION.json";
import e_npl_status from "@/data/breaks/npl-status/npl_active.json";
import e_ust_releases_county from "@/data/breaks/ust-releases-county/ust_release_count.json";
import e_ust_facilities_county from "@/data/breaks/ust-facilities-county/ust_facility_count.json";
import e_fuds_properties from "@/data/breaks/fuds-properties/fuds_properties.json";
import type { PlacesMeasure } from "@/lib/civic/places";

export type BreaksMethod = "quintile-nearest-rank" | "zero-bin-quartile-nearest-rank";

export interface BreaksPage {
  url: string;
  sha256: string;
  lastModified: string | null;
  rows: number;
}

export interface BreaksSource {
  url: string;
  retrievedAt: string;
  lastModified: string | null;
  /** sha256 of the one fetched body; a paginated source lists `pages` instead. */
  sha256?: string;
  pages?: BreaksPage[];
}

export interface BreaksFile {
  schema: "breaks/1";
  layer: string;
  measure: string;
  period: string;
  valueType: string;
  method: BreaksMethod;
  rule: string;
  breaks: number[];
  n: number;
  nNull: number;
  universe: string;
  source: BreaksSource;
  input: { path: string; sha256: string };
}

// Every PLACES measure has a file or this does not compile.
const PLACES = {
  ACCESS2: h_ACCESS2,
  ARTHRITIS: h_ARTHRITIS,
  BINGE: h_BINGE,
  BPHIGH: h_BPHIGH,
  BPMED: h_BPMED,
  CANCER: h_CANCER,
  CASTHMA: h_CASTHMA,
  CHD: h_CHD,
  CHECKUP: h_CHECKUP,
  CHOLSCREEN: h_CHOLSCREEN,
  COGNITION: h_COGNITION,
  COLON_SCREEN: h_COLON_SCREEN,
  COPD: h_COPD,
  CSMOKING: h_CSMOKING,
  DENTAL: h_DENTAL,
  DEPRESSION: h_DEPRESSION,
  DIABETES: h_DIABETES,
  DISABILITY: h_DISABILITY,
  EMOTIONSPT: h_EMOTIONSPT,
  FOODINSECU: h_FOODINSECU,
  FOODSTAMP: h_FOODSTAMP,
  GHLTH: h_GHLTH,
  HEARING: h_HEARING,
  HIGHCHOL: h_HIGHCHOL,
  HOUSINSECU: h_HOUSINSECU,
  INDEPLIVE: h_INDEPLIVE,
  LACKTRPT: h_LACKTRPT,
  LONELINESS: h_LONELINESS,
  LPA: h_LPA,
  MAMMOUSE: h_MAMMOUSE,
  MHLTH: h_MHLTH,
  MOBILITY: h_MOBILITY,
  OBESITY: h_OBESITY,
  PHLTH: h_PHLTH,
  SELFCARE: h_SELFCARE,
  SHUTUTILITY: h_SHUTUTILITY,
  SLEEP: h_SLEEP,
  STROKE: h_STROKE,
  TEETHLOST: h_TEETHLOST,
  VISION: h_VISION,
} satisfies Record<PlacesMeasure, unknown>;

const PLACES_FILES = PLACES as unknown as Record<PlacesMeasure, BreaksFile>;

/** The committed national county breaks for one PLACES measure: four cut points, five bins. */
export function placesBreaks(measure: PlacesMeasure): BreaksFile {
  return PLACES_FILES[measure];
}

/** The four place exports' breaks files, by collection id. No styled layer reads them yet. */
export const PLACE_EXPORT_BREAKS: Readonly<Record<string, BreaksFile>> = {
  "npl-status": e_npl_status as unknown as BreaksFile,
  "ust-releases-county": e_ust_releases_county as unknown as BreaksFile,
  "ust-facilities-county": e_ust_facilities_county as unknown as BreaksFile,
  "fuds-properties": e_fuds_properties as unknown as BreaksFile,
};

/** What the breaks were cut from, for a legend. Throws on a file without a usable n or universe: a legend never prints an n the file lacks. */
export function scaleOf(file: BreaksFile): { universe: string; n: number } {
  const where = `${file.layer}/${file.measure}`;
  if (!Number.isInteger(file.n) || file.n < 1) throw new Error(`breaks file ${where} has no usable n`);
  if (typeof file.universe !== "string" || !file.universe.trim()) throw new Error(`breaks file ${where} has no universe`);
  return { universe: file.universe, n: file.n };
}

/** The caveat on tracts, which are drawn against their counties' breaks: tracts are CDC crude prevalence, the breaks age-adjusted. */
export function tractCaveat(file: BreaksFile): string {
  const { n } = scaleOf(file);
  return `tracts binned on national county breaks (n=${n}); a tract value is crude prevalence and the breaks are ${file.valueType}`;
}
