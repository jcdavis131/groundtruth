// Weekly Freddie Mac Primary Mortgage Market Survey 30-year rate, relayed by
// FRED as MORTGAGE30US, as a Series. The whole weekly history since 1971 is
// about 2,900 points; callers trim to their window.

import { fredSeries } from "@/lib/economy/sources";
import { source } from "@/lib/provenance/sources";
import { provenance } from "@/lib/provenance/types";
import type { Frequency, Point, Series } from "@/lib/series/types";
import { parseIsoDate } from "./align";

export const MORTGAGE_SERIES_ID = "MORTGAGE30US";

export interface FredMeta {
  title: string;
  unit: string;
  frequency: Frequency;
  notes?: string[];
}

/** fredgraph rows (date, value | null) to a Series with published provenance. Pure. */
export function fredRowsToSeries(id: string, rows: Array<[string, number | null]>, meta: FredMeta, retrievedAt?: string): Series {
  const points: Point[] = [];
  for (const [d, v] of rows) {
    const t = parseIsoDate(d);
    if (t != null) points.push({ t, v });
  }
  points.sort((a, b) => a.t - b.t);
  const lastPt = [...points].reverse().find((p) => p.v != null);
  return {
    id: `fred:${id}`,
    title: meta.title,
    unit: meta.unit,
    frequency: meta.frequency,
    geo: { kind: "us", id: "US", name: "United States" },
    tags: ["rates"],
    points,
    provenance: provenance(source("fred"), {
      kind: "published",
      seriesId: id,
      upstreamUrl: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`,
      period: lastPt ? new Date(lastPt.t).toISOString().slice(0, 10) : undefined,
      retrievedAt,
      notes: meta.notes,
    }),
  };
}

/** Weekly PMMS 30-year fixed rate; null when FRED returned no rows. */
export async function mortgageHistory(): Promise<Series | null> {
  const rows = await fredSeries(MORTGAGE_SERIES_ID);
  if (!rows.length) return null;
  return fredRowsToSeries(MORTGAGE_SERIES_ID, rows, {
    title: "30-year fixed mortgage rate, Freddie Mac Primary Mortgage Market Survey (weekly)",
    unit: "%",
    frequency: "weekly",
    notes: ["Freddie Mac PMMS, relayed by FRED; weekly average of the survey week"],
  });
}
