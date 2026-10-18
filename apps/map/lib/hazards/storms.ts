// County storm events: the part=storms answer of /api/hazards?op=history,
// from the per-state shards scripts/bake-storm-events.mjs writes (NOAA NCEI's
// Storm Events Database, county-coded rows since 1996, tornadoes left to SPC).
//
// Pure: the gate, the per-county series and the caveats. The shards are
// loaded by lib/hazards/stormShards.ts (server only), lazily, one state per
// cold call, through a static map of import() loaders: the bundler emits one
// chunk per state, nothing is fetched at request time, and the route never
// calls NCEI. meta.json (the national tallies the zone-share gate reads) is
// small and imported eagerly by the route.
//
// The zone-share gate: forecast-zone rows are never attached to counties, so
// a type's year is drawn only where fewer than STORM_ZONE_SHARE_MAX of that
// type's rows nationally were zone-coded; otherwise it is null with the reason
// "zone-coded", never 0. A gated-in year with no report for the county is
// absent unless HISTORY_ZERO_FILL is on (the round-7 zero rule, Cam's call).

import type { Point, Series } from "@/lib/series/types";
import type { StormMeta, StormShard } from "./stormBake";

/** A type's year is blanked when this share or more of its rows nationally were zone-coded (Cam's decision 3, pending). */
export const STORM_ZONE_SHARE_MAX = 0.1;

/** The three types the aside draws as bars and the place-tower spec names (zone share 0-1 % in every probed year). */
export const STORM_MAIN_TYPES = ["Hail", "Thunderstorm Wind", "Flash Flood"] as const;

export const STORM_EVENTS_CAVEAT = `NOAA's Storm Events Database as NCEI compiles it, county-coded rows only, 1996 onward: hail, thunderstorm wind, flash floods and other events NWS logs by county. Winter, heat, drought and wind events NWS logs by forecast zone are not attached to counties, because zones cross county lines; a type's year is blank when ${Math.round(STORM_ZONE_SHARE_MAX * 100)} % or more of its rows that year nationally were zone-coded. Tornadoes are counted from SPC's record above. A count is of reports, which grew with population and spotter networks.`;
export const STORM_GATE_NOTE = `A type's year is drawn only where fewer than ${Math.round(STORM_ZONE_SHARE_MAX * 100)} % of its reports nationally were coded by forecast zone (meta.zoneRows / countyRows in the bake); otherwise it is blank, "zone-coded", never 0.`;
export const STORM_NAME_CHECK_NOTE =
  "A row is attached only when its county code and its county name agree with the county: NCEI files some rows under codes that are not this county's (Puerto Rico's multi-municipio areas in the early years, Oklahoma in 1996 and Georgia in 2025 under forecast-zone numbers), and those are listed in the bake, never attached.";
export const STORM_ALASKA_LINE =
  "NCEI files Alaska's storm events under its own areas (\"Middle Tanana Valley\", \"Susitna Valley\") and forecast zones, none of which is a borough or census area by code and name, so no storm events are shown for Alaska.";
export const STORM_CT_LINE = "NCEI files Connecticut's storm events under its old counties, so no storm events are shown for planning regions.";

export type StormGate = { drawn: true; share: number } | { drawn: false; reason: "zone-coded" | "not-recorded"; share: number | null };

/** The national zone share of a type in a year, and whether the type's year is drawn. */
export function stormGate(meta: Pick<StormMeta, "countyRows" | "zoneRows">, year: number | string, type: string, max = STORM_ZONE_SHARE_MAX): StormGate {
  const c = meta.countyRows[String(year)]?.[type] ?? 0;
  const z = meta.zoneRows[String(year)]?.[type] ?? 0;
  if (c + z === 0) return { drawn: false, reason: "not-recorded", share: null };
  const share = z / (c + z);
  return share < max ? { drawn: true, share } : { drawn: false, reason: "zone-coded", share };
}

export interface StormTypeSeries {
  type: string;
  /** Reports per year where drawn; a gated-in year with no report is absent unless zeroFill (then 0). */
  points: Array<[number, number]>;
  /** Years blanked by the gate, with the reason; never 0. */
  blank: Array<[number, "zone-coded"]>;
  total: number;
}

export interface StormsAnswer {
  fips: string;
  /** Every year of the files read (meta.firstYear..meta.lastYear). */
  years: [number, number] | null;
  lastYearMonth: string | null;
  types: StormTypeSeries[];
  /** A boundary change inside the series (the county as it was that year keeps its rows). */
  break: { year: number; what: string } | null;
  zeroFill: boolean;
}

/**
 * One county's series per type from its shard. Every type in meta.types gets a series; the county's
 * gated-in years carry its count (or 0 with zeroFill, from the first year to the last); gated-out
 * years are listed as blank. Not-recorded type-years (no row of the type anywhere that year) are
 * absent either way.
 */
export function stormSeries(meta: Pick<StormMeta, "types" | "countyRows" | "zoneRows" | "firstYear" | "lastYear" | "lastYearMonth" | "breaks">, shard: StormShard, fips: string, zeroFill: boolean, max = STORM_ZONE_SHARE_MAX): StormsAnswer {
  const row = shard.counties[fips] ?? {};
  const first = meta.firstYear;
  const last = meta.lastYear;
  const types: StormTypeSeries[] = meta.types.map((type, i) => {
    const points: Array<[number, number]> = [];
    const blank: Array<[number, "zone-coded"]> = [];
    if (first != null && last != null) {
      for (let y = first; y <= last; y++) {
        const g = stormGate(meta, y, type, max);
        const n = row[String(y)]?.[String(i)];
        if (!g.drawn) {
          if (g.reason === "zone-coded") blank.push([y, "zone-coded"]);
          continue;
        }
        if (n != null) points.push([y, n]);
        else if (zeroFill) points.push([y, 0]);
      }
    }
    return { type, points, blank, total: points.reduce((a, [, n]) => a + n, 0) };
  });
  return {
    fips,
    years: first != null && last != null ? [first, last] : null,
    lastYearMonth: meta.lastYearMonth,
    types,
    break: meta.breaks[fips] ? { ...meta.breaks[fips] } : null,
    zeroFill,
  };
}

const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The series id of a type's reports per year in a county ("se:hail:48453"). */
export const stormSeriesId = (type: string, fips: string) => `se:${slug(type)}:${fips}`;

/** The answer's per-type series as yearly Series, for the types with a report in the county (gated-out years as null points, so a chart shows a gap). */
export function stormAsSeries(a: StormsAnswer, geo: Series["geo"], provenance: Series["provenance"]): Series[] {
  return a.types
    .filter((t) => t.points.length)
    .map((t) => {
      const pts: Point[] = [...t.points.map(([y, n]) => ({ t: Date.UTC(y, 0, 1), v: n as number | null })), ...t.blank.map(([y]) => ({ t: Date.UTC(y, 0, 1), v: null }))].sort((p, q) => p.t - q.t);
      return { id: stormSeriesId(t.type, a.fips), title: `${t.type} reports per year (NOAA NCEI Storm Events)`, unit: "reports", frequency: "annual" as const, geo, provenance, tags: ["hazards", "storms"], points: pts };
    });
}
