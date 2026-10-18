import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/server/csv";
import { buildCountries, buildCrossings, buildPorts, type CountryFeatureIn, type CountryStats, type CrossingRow, type PortStats, type SectorRow, type WpiPort } from "./features";
import { areaFixtures } from "./testFixtures";
import { AREA_COLUMNS, COUNTRY_COLUMNS, CROSSING_COLUMNS, flattenAreas, flattenCountries, flattenCrossings, flattenPorts, flattenPulse, flattenPulseSeries, flattenSectors, PORT_COLUMNS, PULSE_COLUMNS, PULSE_SERIES_COLUMNS, SECTOR_COLUMNS } from "./flatten";
import type { PulseItem } from "./sources";

describe("flattenAreas", () => {
  it("one row per area with every join, rounded percentages and nulls for what is missing", () => {
    const rows = flattenAreas(areaFixtures());
    expect(rows).toHaveLength(2);
    const travis = rows.find((r) => r.geoid === "48453")!;
    expect(travis).toMatchObject({ name: "Travis", level: "county", state: "TX", state_name: "Texas", metro: "Austin-Round Rock-San Marcos, TX", lon: -97.78, lat: 30.33, home_value: 452000, home_as_of: "2026-07-31", home_yoy_pct: -1.23, home_y5_pct: 31.9, rent: 1810, rent_yoy_pct: 0.8, qcew_period: "2026 Q1", emp: 730000, emp_yoy_pct: 0.9, estabs: 41000, avg_weekly_wage: 1580, avg_weekly_wage_yoy_pct: 4.57, wages_qtr: 1.5e10, qcew_suppressed: false });
    expect(travis.price_to_rent).toBeCloseTo(20.81, 2);
    const loving = rows.find((r) => r.geoid === "48301")!;
    expect(loving.home_value).toBeNull();
    expect(loving.rent).toBeNull();
    expect(loving.price_to_rent).toBeNull();
    expect(loving.emp).toBeNull();
    expect(loving.qcew_suppressed).toBe(true);
    expect(Object.keys(travis)).toEqual([...AREA_COLUMNS]);
  });
  it("writes a CSV with the stable header and empty cells for nulls", () => {
    const text = toCsv(flattenAreas(areaFixtures()), [...AREA_COLUMNS]);
    const [header, ...lines] = text.split("\r\n");
    expect(header).toBe(AREA_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
    const loving = lines.find((l) => l.startsWith("48301"))!;
    expect(loving).toContain(",,,");
    expect(loving).not.toContain("null");
  });
});

const WPI_PORT: WpiPort = { id: 1234, name: "Corpus Christi", country: "United States", region: "Gulf of Mexico", water: "Corpus Christi Bay", lat: 27.8, lon: -97.4, size: "medium", type: "Coastal Breakwater", use: "Commercial", locode: "USCRP", channelM: 14.3, anchorageM: 12, cargoPierM: 13.7, oilM: null, lngM: null, maxLengthM: null, maxDraftM: 13.7, tidalRangeM: 0.6, facilities: ["wharves"], firstPortOfEntry: true };
const STATS: PortStats = { portId: "2422", name: "Corpus Christi, TX Port of", position: "World Port Index entry", year: 2024, container: undefined, tonnage: { total: 200_000_000, imports: null, exports: null, domestic: null, foreign: null, empty: null, ranking: 3, pctChange: 2.345, series: [[2023, 1.9e8], [2024, 2e8]] }, vesselCalls: [], topCommodities: [["crude petroleum", 1]], topFarm: [] };

describe("flattenPorts", () => {
  it("carries WPI fields and BTS statistics where matched, blanks where not", () => {
    const withStats = flattenPorts(buildPorts([WPI_PORT], new Map([[1234, STATS]])));
    expect(withStats).toHaveLength(1);
    expect(withStats[0]).toMatchObject({ id: "port:1234", wpi_id: 1234, name: "Corpus Christi", locode: "USCRP", size: "medium", channel_m: 14.3, first_port_of_entry: true, bts_port_id: "2422", bts_year: 2024, container_teu: null, tonnage_tons: 200_000_000, tonnage_rank: 3, tonnage_pct_change: 2.35, position_basis: "World Port Index entry", lon: -97.4, lat: 27.8 });
    const bare = flattenPorts(buildPorts([WPI_PORT], new Map()))[0];
    expect(bare.bts_year).toBeNull();
    expect(bare.position_basis).toBe("World Port Index");
    expect(Object.keys(bare)).toEqual([...PORT_COLUMNS]);
  });
  it("ignores non-port features", () => {
    expect(flattenPorts(areaFixtures())).toEqual([]);
  });
});

const CROSSING: CrossingRow = {
  code: "2301", name: "Laredo", state: "TX", border: "US-Mexico Border", lon: -99.5, lat: 27.5, asOf: "2026-06",
  measures: {
    Trucks: { latest: 280000, latestDate: "2026-06", yoyPct: 3.456, series: [["2025-06", 270000], ["2026-06", 280000]] },
    Pedestrians: { latest: 150000, latestDate: "2026-06", yoyPct: null, series: [["2026-06", 150000]] },
  },
};

describe("flattenCrossings", () => {
  it("one row per port with every BTS measure as a column triple", () => {
    const rows = flattenCrossings(buildCrossings([CROSSING]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "crossing:2301", code: "2301", name: "Laredo, TX", state: "TX", border: "US-Mexico Border", lon: -99.5, lat: 27.5, as_of: "2026-06", trucks: 280000, trucks_month: "2026-06", trucks_yoy_pct: 3.46, pedestrians: 150000, pedestrians_yoy_pct: null, trains: null, trains_month: null, bus_passengers: null });
    expect(Object.keys(rows[0])).toEqual([...CROSSING_COLUMNS]);
  });
});

describe("flattenCountries", () => {
  it("one row per country with each World Bank value's own year", () => {
    const ne: CountryFeatureIn[] = [
      { type: "Feature", properties: { name: "Mexico", iso3: "MEX", iso2: "MX", lx: -102, ly: 23.6, pop: 128_000_000, popYear: 2023, continent: "North America" }, geometry: { type: "Polygon", coordinates: [[[-110, 20], [-90, 20], [-90, 30], [-110, 30], [-110, 20]]] } },
      { type: "Feature", properties: { name: "Nowhere", iso3: "XXX", lx: 0, ly: 0 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
    ];
    const wb = new Map<string, CountryStats>([["MEX", { iso3: "MEX", name: "Mexico", gdp: { value: 1.8e12, year: "2024" }, exports: { value: 6e11, year: "2024" }, imports: { value: 6.2e11, year: "2024" }, tradePct: { value: 73.456, year: "2023" } }]]);
    const rows = flattenCountries(buildCountries(ne, wb));
    expect(rows).toHaveLength(2);
    const mex = rows.find((r) => r.iso3 === "MEX")!;
    expect(mex).toMatchObject({ iso2: "MX", name: "Mexico", continent: "North America", lon: -102, lat: 23.6, population: 128_000_000, population_year: 2023, gdp_usd: 1.8e12, gdp_year: "2024", exports_usd: 6e11, imports_year: "2024", trade_pct_gdp: 73.46, trade_pct_gdp_year: "2023", container_teu: null, trade_rank: 1 });
    const xxx = rows.find((r) => r.iso3 === "XXX")!;
    expect(xxx.gdp_usd).toBeNull();
    expect(xxx.trade_rank).toBeNull();
    expect(Object.keys(mex)).toEqual([...COUNTRY_COLUMNS]);
  });
});

describe("flattenSectors / flattenPulse", () => {
  it("sectors: one row per NAICS sector with the fips and period repeated", () => {
    const sectors: SectorRow[] = [
      { code: "54", title: "Professional and technical services", estabs: 9000, emp: 95000, avgWeeklyWage: 2400, lq: 1.8765, yoyEmp: 2.1, suppressed: false },
      { code: "21", title: "Mining, oil and gas", estabs: null, emp: null, avgWeeklyWage: null, lq: null, yoyEmp: null, suppressed: true },
    ];
    const rows = flattenSectors("48453", "2026 Q1", sectors);
    expect(rows[0]).toEqual({ fips: "48453", period: "2026 Q1", naics: "54", sector: "Professional and technical services", estabs: 9000, emp: 95000, avg_weekly_wage: 2400, lq: 1.88, emp_yoy_pct: 2.1, suppressed: false });
    expect(rows[1].emp).toBeNull();
    expect(rows[1].suppressed).toBe(true);
    expect(Object.keys(rows[0])).toEqual([...SECTOR_COLUMNS]);
    expect(flattenSectors("48453", null, [])).toEqual([]);
  });
  it("pulse: latest row per series, or long format with one row per observation", () => {
    const items: PulseItem[] = [
      { id: "MORTGAGE30US", label: "30-year fixed mortgage rate", value: 6.21, unit: "%", date: "2026-09-04", prev: 6.25, prevDate: "2026-08-28", changePct: -0.64, source: "FRED MORTGAGE30US", series: [["2026-08-28", 6.25], ["2026-09-04", 6.21]] },
      { id: "bts-diesel", label: "diesel, $ per gallon", value: 3.71, unit: "$/gal", date: "2026-09-07", prev: null, prevDate: null, changePct: null, source: "BTS Supply Chain Indicators", series: [["2026-09-07", 3.71]] },
    ];
    const rows = flattenPulse(items);
    expect(rows[0]).toEqual({ id: "MORTGAGE30US", label: "30-year fixed mortgage rate", value: 6.21, unit: "%", date: "2026-09-04", prev: 6.25, prev_date: "2026-08-28", change_pct: -0.64, source: "FRED MORTGAGE30US" });
    expect(rows[1].prev).toBeNull();
    expect(Object.keys(rows[0])).toEqual([...PULSE_COLUMNS]);
    const long = flattenPulseSeries(items);
    expect(long).toHaveLength(3);
    expect(long[0]).toEqual({ id: "MORTGAGE30US", label: "30-year fixed mortgage rate", date: "2026-08-28", value: 6.25, unit: "%", source: "FRED MORTGAGE30US" });
    expect(Object.keys(long[0])).toEqual([...PULSE_SERIES_COLUMNS]);
  });
});
