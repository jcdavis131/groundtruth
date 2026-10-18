// Monthly ZHVI / ZORI history as Series. Reads the full-history Zillow tables
// from lib/economy/sources.ts zillowHistory() and turns one row into a Series
// with published provenance. The row-to-series step is pure for tests.

import { ZILLOW_FILES, zillowHistory, type ZillowKind } from "@/lib/economy/sources";
import { source } from "@/lib/provenance/sources";
import { provenance } from "@/lib/provenance/types";
import type { Point, Series, SeriesMeta } from "@/lib/series/types";
import type { ZillowHistoryRow, ZillowHistoryTable } from "./zillowCsv";

export type ZillowMeasure = "zhvi" | "zori";

export type ZillowScope =
  | { kind: "county"; fips: string }
  | { kind: "state"; name: string }
  | { kind: "metro"; regionId: string }
  | { kind: "us" };

const TITLE: Record<ZillowMeasure, string> = {
  zhvi: "Zillow Home Value Index, typical home (35th–65th percentile), smoothed, seasonally adjusted",
  zori: "Zillow Observed Rent Index, typical asking rent, smoothed",
};

/** Which file holds a scope. ZORI has no state file, so state rent is null. */
export function zillowFileFor(measure: ZillowMeasure, scope: ZillowScope): ZillowKind | null {
  if (scope.kind === "county") return measure === "zhvi" ? "zhviCounty" : "zoriCounty";
  if (scope.kind === "state") return measure === "zhvi" ? "zhviState" : null;
  return measure === "zhvi" ? "zhviMetro" : "zoriMetro";
}

/** Table row key for a scope, matching parseZillowHistory's id convention. */
export function zillowRowKey(scope: ZillowScope): string {
  switch (scope.kind) {
    case "county":
      return scope.fips;
    case "state":
      return scope.name;
    case "metro":
      return scope.regionId;
    case "us":
      return "US";
  }
}

function geoFor(row: ZillowHistoryRow): SeriesMeta["geo"] {
  switch (row.regionType) {
    case "county":
      return { kind: "county", id: row.id, name: row.state ? `${row.name}, ${row.state}` : row.name };
    case "state":
      return { kind: "state", id: row.state ?? row.name, name: row.name };
    case "country":
      return { kind: "us", id: "US", name: "United States" };
    default:
      return undefined;
  }
}

/** Series id for a row: zhvi:county:48453, zhvi:state:TX, zhvi:metro:394355, zhvi:us. */
export function zillowSeriesId(measure: ZillowMeasure, row: ZillowHistoryRow): string {
  switch (row.regionType) {
    case "county":
      return `${measure}:county:${row.id}`;
    case "state":
      return `${measure}:state:${row.state ?? row.id}`;
    case "country":
      return `${measure}:us`;
    default:
      return `${measure}:metro:${row.id}`;
  }
}

/** One table row as a Series, provenance kind "published". Pure. */
export function zillowRowToSeries(measure: ZillowMeasure, table: ZillowHistoryTable, row: ZillowHistoryRow, retrievedAt?: string): Series {
  const points: Point[] = table.times.map((t, i) => ({ t, v: row.values[i] }));
  let lastIdx = row.values.length - 1;
  while (lastIdx >= 0 && row.values[lastIdx] == null) lastIdx--;
  const file = ZILLOW_FILES[table.kind];
  return {
    id: zillowSeriesId(measure, row),
    title: `${TITLE[measure]}: ${row.name}${row.regionType === "county" && row.state ? ", " + row.state : ""}`,
    unit: measure === "zhvi" ? "$" : "$ per month",
    frequency: "monthly",
    geo: geoFor(row),
    tags: ["housing", measure === "zhvi" ? "home-values" : "rents"],
    points,
    provenance: provenance(source(measure === "zhvi" ? "zillow-zhvi" : "zillow-zori"), {
      kind: "published",
      seriesId: file.slice(file.lastIndexOf("/") + 1, -4),
      upstreamUrl: file,
      period: lastIdx >= 0 ? table.dates[lastIdx].slice(0, 7) : undefined,
      retrievedAt,
      revision: "Zillow revises recent months in each release",
    }),
  };
}

/** Fetch (cached) and build the series for one scope; null when the scope is not in the file. */
export async function zillowSeries(measure: ZillowMeasure, scope: ZillowScope): Promise<Series | null> {
  const kind = zillowFileFor(measure, scope);
  if (!kind) return null;
  const table = await zillowHistory(kind);
  const row = table.rows.get(zillowRowKey(scope));
  return row ? zillowRowToSeries(measure, table, row) : null;
}

export const zhviSeries = (scope: ZillowScope) => zillowSeries("zhvi", scope);
export const zoriSeries = (scope: ZillowScope) => zillowSeries("zori", scope);

/** Every county's ZHVI as Series keyed by FIPS (for the IC panel). */
export async function zhviAllCounties(): Promise<Map<string, Series>> {
  const table = await zillowHistory("zhviCounty");
  const out = new Map<string, Series>();
  for (const row of table.rows.values()) if (row.regionType === "county") out.set(row.id, zillowRowToSeries("zhvi", table, row));
  return out;
}
