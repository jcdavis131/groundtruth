// FEMA National Risk Index, county table: one row per STCOFIPS. Ratings are classes; FEMA's own non-values
// ("Insufficient Data", "Data Unavailable", "Not Applicable") are its suppression flags, so they read as NOT_PUBLISHED.
// The row's NRI_VER ("December 2025") is the release: a later one than the item's period reads as CHANGED_SINCE_RETRIEVAL.

import type { CiteItem, Matcher, Reading, Scalar } from "../types";
import { absent, also, arcgisRows, monthYearIndex, norm, toNum, unreadable } from "./util";

const HAZARDS: Record<string, string> = {
  AVLN: "avalanche",
  CFLD: "coastal flooding",
  CWAV: "cold wave",
  DRGT: "drought",
  ERQK: "earthquake",
  HAIL: "hail",
  HWAV: "heat wave",
  HRCN: "hurricane",
  ISTM: "ice storm",
  IFLD: "riverine flooding",
  LNDS: "landslide",
  LTNG: "lightning",
  SWND: "strong wind",
  TRND: "tornado",
  TSUN: "tsunami",
  VLCN: "volcanic activity",
  WFIR: "wildfire",
  WNTW: "winter weather",
};

const CLASSES = new Set(["Very Low", "Relatively Low", "Relatively Moderate", "Relatively High", "Very High"]);
const FLAGS = new Set(["Insufficient Data", "Data Unavailable", "Not Applicable", "No Rating"]);

/** "score 97.7 (...)" or "score 14.8 of 100" -> 97.7 */
const noteScore = (note: string | undefined): number | null => {
  const m = /^score (-?[\d.]+)/.exec((note ?? "").trim());
  return m ? Number(m[1]) : null;
};

export const femaNri: Matcher = {
  id: "fema-nri",
  sourceId: "fema-nri",
  // EAL is rounded to whole USD and population is a count; a score is rounded to 0.1 in the note
  tolerance: { RISK_RATNG: 0, EAL_VALT: 0.5, POPULATION: 0, SOVI_RATNG: 0, RISK_SCORE: 0.05, SOVI_SCORE: 0.05, EAL_RATNG: 0, NRI_VER: 0, hazards: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (!rows.length) return absent("FEMA's NRI table has no row for this county");
    const r = rows[0];
    const release = norm(r.NRI_VER);
    const a = monthYearIndex(release);
    const b = monthYearIndex(item.period);
    const later = release !== null && item.period !== undefined && (a !== null && b !== null ? a > b : release !== item.period);
    const base = { period: release, later };
    const flag = (v: unknown, what: string): Reading | null => {
      const s = norm(v);
      return s !== null && FLAGS.has(s) ? { kind: "suppressed", reason: `FEMA's own flag for ${what}: "${s}"`, period: release } : null;
    };
    const extra: Array<{ field: string; item: Scalar; publisher: Scalar }> = [];
    switch (item.fact) {
      case "FEMA NRI overall risk rating": {
        const f = flag(r.RISK_RATNG, "the overall rating");
        if (f) return f;
        if (noteScore(item.note) !== null) extra.push(also("RISK_SCORE", noteScore(item.note), toNum(r.RISK_SCORE)));
        return { kind: "value", field: "RISK_RATNG", publisherValue: norm(r.RISK_RATNG), itemValue: typeof item.value === "string" ? item.value : null, ...base, also: extra };
      }
      case "FEMA NRI expected annual loss": {
        const f = flag(r.EAL_VALT, "expected annual loss");
        if (f) return f;
        const rating = /^rating (.+)$/.exec(item.note ?? "")?.[1] ?? null;
        if (rating && CLASSES.has(rating)) extra.push(also("EAL_RATNG", rating, norm(r.EAL_RATNG)));
        return { kind: "value", field: "EAL_VALT", publisherValue: toNum(r.EAL_VALT), itemValue: typeof item.value === "number" ? item.value : null, ...base, also: extra };
      }
      case "population (as carried in FEMA's NRI row)":
        return { kind: "value", field: "POPULATION", publisherValue: toNum(r.POPULATION), itemValue: typeof item.value === "number" ? item.value : null, ...base };
      case "NRI hazards rated Very High or Relatively High": {
        const by: Record<string, string[]> = {};
        for (const [code, name] of Object.entries(HAZARDS)) {
          const rating = norm(r[`${code}_RISKR`]);
          if (rating === "Very High" || rating === "Relatively High") (by[rating] ??= []).push(name);
        }
        const top = ["Very High", "Relatively High"].filter((k) => by[k]).map((k) => `${k}: ${by[k].join(", ")}`).join("; ");
        return { kind: "value", field: "hazards", publisherValue: top, itemValue: typeof item.value === "string" ? item.value : null, ...base };
      }
      case "FEMA NRI social vulnerability rating (Census Community Resilience Estimate; not CDC SVI)": {
        const f = flag(r.SOVI_RATNG, "the social vulnerability rating");
        if (f) return f;
        if (noteScore(item.note) !== null) extra.push(also("SOVI_SCORE", noteScore(item.note), toNum(r.SOVI_SCORE)));
        return { kind: "value", field: "SOVI_RATNG", publisherValue: norm(r.SOVI_RATNG), itemValue: typeof item.value === "string" ? item.value : null, ...base, also: extra };
      }
      default:
        return unreadable(`no rule for the NRI fact "${item.fact}"`);
    }
  },
};
