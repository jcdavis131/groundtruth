// Flatten water rows to one CSV row each for `format=csv`. Pure: the route's
// own reading shapes in, plain objects with stable snake_case columns out.
// USGS readings are already one row per (site, parameter, time), which is
// the shape a notebook wants, so they pass through with renamed columns.

import type { GaugeReading, WellReading } from "@/app/api/water/route";
import type { CsvRow } from "@/lib/server/csv";
import type { NwpsRow, TwdbRow } from "./features";
import { PARAM_INFO } from "./quality";

const label = (code: string): string | null => PARAM_INFO[code]?.label ?? null;

export const GAUGE_COLUMNS = ["site", "name", "site_type", "lon", "lat", "parameter", "parameter_label", "value", "unit", "time", "approval"] as const;

/** Latest continuous readings from `op=gauges`, one row per (site, parameter). */
export function flattenGauges(rows: GaugeReading[]): CsvRow[] {
  return rows.map((r) => ({
    site: r.site,
    name: r.name ?? null,
    site_type: r.siteType ?? null,
    lon: r.lon,
    lat: r.lat,
    parameter: r.param,
    parameter_label: label(r.param),
    value: r.value,
    unit: r.unit,
    time: r.time,
    approval: r.approval ?? null,
  }));
}

export const WELL_COLUMNS = [...GAUGE_COLUMNS, "aquifer", "aquifer_code", "local_aquifer", "well_depth_ft"] as const;

/** Latest daily groundwater levels from `op=wells`, one row per (site, parameter). */
export function flattenWells(rows: WellReading[]): CsvRow[] {
  return rows.map((r) => ({
    ...flattenGauges([r])[0],
    aquifer: r.aquifer ?? null,
    aquifer_code: r.aquiferCode ?? null,
    local_aquifer: r.localAquifer ?? null,
    well_depth_ft: r.wellDepthFt ?? null,
  }));
}

export const TWDB_COLUMNS = ["id", "name", "lon", "lat", "percent_full", "capacity_acft", "storage_acft", "elevation_ft", "pool_elevation_ft", "date", "tags"] as const;

/** TWDB reservoirs from `op=twdb`, one row each; tags joined with `;`. */
export function flattenTwdb(rows: TwdbRow[]): CsvRow[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lon: r.lon,
    lat: r.lat,
    percent_full: r.percentFull,
    capacity_acft: r.capacityAcFt,
    storage_acft: r.storageAcFt,
    elevation_ft: r.elevationFt,
    pool_elevation_ft: r.poolElevationFt,
    date: r.date ?? null,
    tags: r.tags.join(";"),
  }));
}

export const NWPS_COLUMNS = [
  "lid",
  "name",
  "state",
  "lon",
  "lat",
  "flood_category",
  "observed_primary",
  "observed_primary_unit",
  "observed_secondary",
  "observed_secondary_unit",
  "observed_time",
  "forecast_category",
  "forecast_primary",
  "forecast_primary_unit",
  "forecast_time",
] as const;

/** NOAA NWPS gauges from `op=nwps`, one row each. Sentinel -999 values (NWPS "no data") become empty cells. */
export function flattenNwps(rows: NwpsRow[]): CsvRow[] {
  const v = (n: number | undefined): number | null => (n == null || n <= -999 ? null : n);
  return rows.map((g) => ({
    lid: g.lid,
    name: g.name,
    state: g.state ?? null,
    lon: g.lon,
    lat: g.lat,
    flood_category: g.observed?.floodCategory ?? null,
    observed_primary: v(g.observed?.primary),
    observed_primary_unit: g.observed?.primaryUnit ?? null,
    observed_secondary: v(g.observed?.secondary),
    observed_secondary_unit: g.observed?.secondaryUnit ?? null,
    observed_time: g.observed?.validTime ?? null,
    forecast_category: g.forecast?.floodCategory ?? null,
    forecast_primary: v(g.forecast?.primary),
    forecast_primary_unit: g.forecast?.primaryUnit ?? null,
    forecast_time: g.forecast?.validTime ?? null,
  }));
}

export const HISTORY_COLUMNS = ["site", "parameter", "parameter_label", "date", "value"] as const;

/** Daily means from `op=history`, one row per day. */
export function flattenHistory(site: string, param: string, rows: Array<[string, number]>): CsvRow[] {
  return rows.map(([date, value]) => ({ site, parameter: param, parameter_label: label(param), date, value }));
}

export const MATCHUP_COLUMNS = ["site", "parameter", "parameter_label", "time", "value", "unit"] as const;

/** Instantaneous values from `op=matchup`, one row per observation. */
export function flattenMatchup(site: string, param: string, rows: Array<[string, number, string]>): CsvRow[] {
  return rows.map(([time, value, unit]) => ({ site, parameter: param, parameter_label: label(param), time, value, unit }));
}
