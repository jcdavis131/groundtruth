// Quarterly QCEW history for one area: employment, average weekly wage and
// establishments (total covered, industry 10 / ownership 0) over N years, one
// BLS area slice per quarter, plus derived over-the-year percent changes.
//
// BLS publishes its own over-the-year changes (rounded to 0.1); the derived
// series is computed here from the levels so it is labelled an estimate and
// carries its formula. It matches BLS's figure to rounding.

import { qcewAreaTotal, qcewAreaUrl, qcewLatest } from "@/lib/economy/sources";
import { source } from "@/lib/provenance/sources";
import { provenance, type Provenance } from "@/lib/provenance/types";
import type { Point, Series, SeriesMeta } from "@/lib/series/types";
import { isoDate, pctChangeQuarters, quarterEnd } from "./align";
import type { QcewTotalRow } from "./qcewCsv";

export interface QcewQuarter {
  year: number;
  qtr: number;
  /** Null when BLS had no total row for the area, or the fetch failed. */
  row: QcewTotalRow | null;
}

export interface QcewHistory {
  emp: Series;
  avgWeeklyWage: Series;
  estabs: Series;
  empYoY: Series;
  wageYoY: Series;
  estabsYoY: Series;
  /** "YYYY-Qn" of quarters that were requested but produced no row. */
  missing: string[];
}

/** Series id scope: county 48453 -> "county:48453", 48000 -> "state:48", US000 -> "us". */
export function qcewScope(fips: string): string {
  if (fips === "US000") return "us";
  if (fips.endsWith("000")) return `state:${fips.slice(0, 2)}`;
  return `county:${fips}`;
}

function geoFor(fips: string, name?: string): SeriesMeta["geo"] {
  if (fips === "US000") return { kind: "us", id: "US", name: "United States" };
  if (fips.endsWith("000")) return { kind: "state", id: fips.slice(0, 2), name };
  return { kind: "county", id: fips, name };
}

const LEVELS: Array<{ key: "emp" | "avgWeeklyWage" | "estabs"; suffix: string; title: string; unit: string }> = [
  { key: "emp", suffix: "emp", title: "Covered employment, third month of quarter", unit: "jobs" },
  { key: "avgWeeklyWage", suffix: "avg-weekly-wage", title: "Average weekly wage, all covered jobs", unit: "$ per week" },
  { key: "estabs", suffix: "estabs", title: "Establishments", unit: "count" },
];

/** Build the six series from fetched quarters. Pure. */
export function qcewQuartersToSeries(fips: string, quarters: QcewQuarter[], opts: { name?: string; retrievedAt?: string } = {}): QcewHistory {
  const sorted = [...quarters].sort((a, b) => a.year - b.year || a.qtr - b.qtr);
  const scope = qcewScope(fips);
  const geo = geoFor(fips, opts.name);
  const missing = sorted.filter((q) => !q.row).map((q) => `${q.year}-Q${q.qtr}`);
  const lastRow = [...sorted].reverse().find((q) => q.row);
  const period = lastRow ? `${lastRow.year}-Q${lastRow.qtr}` : undefined;
  const published = (upstream: string): Provenance =>
    provenance(source("bls-qcew"), {
      kind: "published",
      seriesId: `area/${fips} industry 10 own 0`,
      upstreamUrl: upstream,
      period,
      retrievedAt: opts.retrievedAt,
      revision: "the latest quarter is preliminary; BLS revises it with the next release",
      notes: missing.length ? [`no row for ${missing.join(", ")}`] : undefined,
    });
  const lastUrl = lastRow ? qcewAreaUrl(fips, lastRow.year, lastRow.qtr) : qcewAreaUrl(fips, 0, 0);
  const level = (key: (typeof LEVELS)[number]["key"]): Point[] => sorted.map((q) => ({ t: quarterEnd(q.year, q.qtr), v: q.row ? q.row[key] : null }));
  const mk = (l: (typeof LEVELS)[number]): Series => ({
    id: `qcew:${scope}:${l.suffix}`,
    title: `${l.title}: ${opts.name ?? fips}`,
    unit: l.unit,
    frequency: "quarterly",
    geo,
    tags: ["jobs", "wages"],
    points: level(l.key),
    provenance: published(lastUrl),
  });
  const [emp, avgWeeklyWage, estabs] = LEVELS.map(mk);
  const yoy = (base: Series, suffix: string, title: string): Series => ({
    id: `${base.id}:${suffix}`,
    title: `${title}, over-the-year change`,
    unit: "%",
    frequency: "quarterly",
    geo,
    tags: ["jobs", "wages", "change"],
    points: pctChangeQuarters(base.points, 4),
    provenance: provenance(source("bls-qcew"), {
      kind: "estimate",
      period,
      retrievedAt: opts.retrievedAt,
      method: `over-the-year % change = (value(q) / value(q − 4 quarters) − 1) × 100 from the published levels; BLS publishes the same figure rounded to 0.1`,
      notes: [`inputs: ${base.id}`, lastRow ? `last quarter ${isoDate(quarterEnd(lastRow.year, lastRow.qtr))}` : "no quarters answered"],
    }),
  });
  return {
    emp,
    avgWeeklyWage,
    estabs,
    empYoY: yoy(emp, "yoy", emp.title.split(":")[0]),
    wageYoY: yoy(avgWeeklyWage, "yoy", avgWeeklyWage.title.split(":")[0]),
    estabsYoY: yoy(estabs, "yoy", estabs.title.split(":")[0]),
    missing,
  };
}

/** The quarters to request: `years` of history plus four for the oldest YoY, ending at `latest`. */
export function quarterList(latest: { year: number; qtr: number }, years: number): Array<{ year: number; qtr: number }> {
  const out: Array<{ year: number; qtr: number }> = [];
  let { year, qtr } = latest;
  for (let k = 0; k < years * 4 + 4; k++) {
    out.push({ year, qtr });
    qtr--;
    if (qtr === 0) {
      qtr = 4;
      year--;
    }
  }
  return out.reverse();
}

/**
 * Fetch `years` of quarterly totals for an area (county SSCCC, state SS000,
 * or US000). Requests run one after another behind the shared BLS gate
 * (~3/s); each quarter is cached 12 h, so a warm county costs nothing. A
 * quarter that fails is recorded in `missing` and left null.
 */
export async function qcewHistory(fips: string, years = 10, opts: { name?: string; latest?: { year: number; qtr: number } } = {}): Promise<QcewHistory> {
  const latest = opts.latest ?? (await qcewLatest());
  const quarters: QcewQuarter[] = [];
  for (const q of quarterList({ year: latest.year, qtr: latest.qtr }, years)) {
    let row: QcewTotalRow | null = null;
    try {
      row = await qcewAreaTotal(fips, q.year, q.qtr);
    } catch {
      row = null;
    }
    quarters.push({ ...q, row });
  }
  return qcewQuartersToSeries(fips, quarters, { name: opts.name });
}
