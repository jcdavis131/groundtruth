import { describe, expect, it } from "vitest";
import type { GaugeReading, WellReading } from "@/app/api/water/route";
import { toCsv } from "@/lib/server/csv";
import type { NwpsRow, TwdbRow } from "./features";
import { flattenGauges, flattenHistory, flattenMatchup, flattenNwps, flattenTwdb, flattenWells, GAUGE_COLUMNS, HISTORY_COLUMNS, MATCHUP_COLUMNS, NWPS_COLUMNS, TWDB_COLUMNS, WELL_COLUMNS } from "./flatten";

const G: GaugeReading = { site: "USGS-08180800", name: "Medina Rv nr Somerset, TX", siteType: "Stream", lon: -98.55, lat: 29.26, param: "00060", value: 45.2, unit: "ft^3/s", time: "2026-09-11T09:30:00Z", approval: "Provisional" };

describe("flattenGauges / flattenWells", () => {
  it("renames to snake_case, labels the parameter, keeps one row per reading", () => {
    const rows = flattenGauges([G, { ...G, param: "99999", name: undefined, approval: undefined }]);
    expect(rows[0]).toEqual({ site: "USGS-08180800", name: "Medina Rv nr Somerset, TX", site_type: "Stream", lon: -98.55, lat: 29.26, parameter: "00060", parameter_label: "Discharge", value: 45.2, unit: "ft^3/s", time: "2026-09-11T09:30:00Z", approval: "Provisional" });
    expect(rows[1].parameter_label).toBeNull();
    expect(rows[1].name).toBeNull();
    expect(rows[1].approval).toBeNull();
    expect(Object.keys(rows[0])).toEqual([...GAUGE_COLUMNS]);
  });
  it("wells add aquifer columns", () => {
    const w: WellReading = { ...G, site: "USGS-292859098282801", param: "72019", value: 312.4, unit: "ft", aquifer: "Edwards-Trinity aquifer system", aquiferCode: "S500EDRTRN", localAquifer: "124EDRD", wellDepthFt: 640 };
    const rows = flattenWells([w, { ...w, aquifer: undefined, aquiferCode: undefined, localAquifer: undefined, wellDepthFt: undefined }]);
    expect(rows[0]).toMatchObject({ parameter: "72019", parameter_label: "Depth to water (below land)", aquifer: "Edwards-Trinity aquifer system", aquifer_code: "S500EDRTRN", local_aquifer: "124EDRD", well_depth_ft: 640 });
    expect(rows[1].aquifer).toBeNull();
    expect(rows[1].well_depth_ft).toBeNull();
    expect(Object.keys(rows[0])).toEqual([...WELL_COLUMNS]);
  });
});

describe("flattenTwdb", () => {
  it("one row per reservoir, tags joined", () => {
    const r: TwdbRow = { id: "medina", name: "Medina Lake", lon: -98.93, lat: 29.54, percentFull: 41.2, capacityAcFt: 254000, storageAcFt: 104648, elevationFt: 1032.1, poolElevationFt: 1064.2, date: "2026-09-10T00:00:00", tags: ["water_supply", "monitored"] };
    const rows = flattenTwdb([r, { ...r, id: "x", percentFull: null, capacityAcFt: null, storageAcFt: null, elevationFt: null, poolElevationFt: null, date: undefined, tags: [] }]);
    expect(rows[0]).toEqual({ id: "medina", name: "Medina Lake", lon: -98.93, lat: 29.54, percent_full: 41.2, capacity_acft: 254000, storage_acft: 104648, elevation_ft: 1032.1, pool_elevation_ft: 1064.2, date: "2026-09-10T00:00:00", tags: "water_supply;monitored" });
    expect(rows[1].percent_full).toBeNull();
    expect(rows[1].date).toBeNull();
    expect(rows[1].tags).toBe("");
    expect(Object.keys(rows[0])).toEqual([...TWDB_COLUMNS]);
  });
});

describe("flattenNwps", () => {
  it("one row per gauge, -999 sentinels blanked, forecast optional", () => {
    const g: NwpsRow = { lid: "SATT2", name: "San Antonio River at Loop 410", lat: 29.36, lon: -98.45, state: "TX", observed: { primary: 4.12, primaryUnit: "ft", secondary: -999, secondaryUnit: "kcfs", floodCategory: "no_flooding", validTime: "2026-09-11T09:15:00Z" }, forecast: { primary: 4.3, primaryUnit: "ft", floodCategory: "no_flooding", validTime: "2026-09-12T00:00:00Z" } };
    const rows = flattenNwps([g, { lid: "X", name: "bare", lat: 0, lon: 0 }]);
    expect(rows[0]).toEqual({ lid: "SATT2", name: "San Antonio River at Loop 410", state: "TX", lon: -98.45, lat: 29.36, flood_category: "no_flooding", observed_primary: 4.12, observed_primary_unit: "ft", observed_secondary: null, observed_secondary_unit: "kcfs", observed_time: "2026-09-11T09:15:00Z", forecast_category: "no_flooding", forecast_primary: 4.3, forecast_primary_unit: "ft", forecast_time: "2026-09-12T00:00:00Z" });
    expect(rows[1].flood_category).toBeNull();
    expect(rows[1].observed_primary).toBeNull();
    expect(Object.keys(rows[0])).toEqual([...NWPS_COLUMNS]);
  });
});

describe("flattenHistory / flattenMatchup", () => {
  it("history: one row per day with site and parameter repeated", () => {
    const rows = flattenHistory("USGS-08180800", "00060", [["2026-09-09", 40.1], ["2026-09-10", 41.7]]);
    expect(rows).toEqual([
      { site: "USGS-08180800", parameter: "00060", parameter_label: "Discharge", date: "2026-09-09", value: 40.1 },
      { site: "USGS-08180800", parameter: "00060", parameter_label: "Discharge", date: "2026-09-10", value: 41.7 },
    ]);
    expect(Object.keys(rows[0])).toEqual([...HISTORY_COLUMNS]);
    expect(toCsv(rows, [...HISTORY_COLUMNS]).split("\r\n")[1]).toBe("USGS-08180800,00060,Discharge,2026-09-09,40.1");
  });
  it("matchup: one row per instantaneous value with its unit", () => {
    const rows = flattenMatchup("USGS-08181500", "63680", [["2026-09-02T15:30:00Z", 12.5, "_FNU"]]);
    expect(rows).toEqual([{ site: "USGS-08181500", parameter: "63680", parameter_label: "Turbidity", time: "2026-09-02T15:30:00Z", value: 12.5, unit: "_FNU" }]);
    expect(Object.keys(rows[0])).toEqual([...MATCHUP_COLUMNS]);
    expect(flattenMatchup("USGS-1", "00060", [])).toEqual([]);
  });
});
