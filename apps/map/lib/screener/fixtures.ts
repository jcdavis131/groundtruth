// Deterministic fixture features for the screener tests: a handful of
// counties, states, ports, crossings and countries built through the same
// builders the route uses, with realistic magnitudes and deliberate gaps
// (a suppressed QCEW cell, a county without rent, a port without BTS data).
// Values are illustrative, not published figures.

import type { AreaJoins, CountryFeatureIn, CountryStats, CrossingMeasure, CrossingRow, HomeValue, JobsRow, PortStats, WpiPort } from "@/lib/economy/features";
import { buildCountries, buildCrossings, buildPorts } from "@/lib/economy/features";
import type { LayerFeature } from "@/lib/layers/types";
import { buildAreaPoints } from "./entities";

function home(id: string, name: string, latest: number, yoyPct: number | null, opts: Partial<HomeValue> = {}): HomeValue {
  return { id, name, sizeRank: 1, asOf: "2026-07-31", latest, yoyPct, y5Pct: yoyPct == null ? null : yoyPct * 4, monthly: [], yearly: [], ...opts };
}

function jobs(area: string, emp: number | null, yoyEmp: number | null, wage: number | null, yoyWage: number | null, suppressed = false): JobsRow {
  return {
    area,
    period: "2026 Q1",
    estabs: suppressed ? null : 1000,
    emp,
    wages: suppressed || emp == null || wage == null ? null : emp * wage * 13,
    avgWeeklyWage: wage,
    yoy: { estabs: suppressed ? null : 1.0, emp: yoyEmp, wages: suppressed ? null : 2.0, avgWeeklyWage: yoyWage },
    suppressed,
  };
}

export const COUNTY_POINTS = [
  { geoid: "48453", name: "Travis County", stusab: "TX", lon: -97.78, lat: 30.33 },
  { geoid: "48029", name: "Bexar County", stusab: "TX", lon: -98.52, lat: 29.45 },
  { geoid: "06037", name: "Los Angeles County", stusab: "CA", lon: -118.23, lat: 34.31 },
  { geoid: "36061", name: "New York County", stusab: "NY", lon: -73.97, lat: 40.78 },
  { geoid: "38053", name: "McKenzie County", stusab: "ND", lon: -103.4, lat: 47.74 },
  { geoid: "02013", name: "Aleutians East Borough", stusab: "AK", lon: -161.9, lat: 55.2 },
];

export function countyJoins(): AreaJoins {
  return {
    jobs: new Map([
      ["48453", jobs("48453", 800_000, 2.5, 1_600, 4.0)],
      ["48029", jobs("48029", 950_000, -1.2, 1_150, 3.1)],
      ["06037", jobs("06037", 4_400_000, -0.4, 1_700, 2.2)],
      ["36061", jobs("36061", 2_500_000, 1.1, 2_900, 5.5)],
      ["38053", jobs("38053", null, null, null, null, true)],
    ]),
    home: new Map([
      ["48453", home("48453", "Travis County", 520_000, -3.5, { metro: "Austin-Round Rock-San Marcos, TX" })],
      ["48029", home("48029", "Bexar County", 290_000, -1.0, { metro: "San Antonio-New Braunfels, TX" })],
      ["06037", home("06037", "Los Angeles County", 900_000, 2.0)],
      ["36061", home("36061", "New York County", 1_200_000, 6.0)],
      ["38053", home("38053", "McKenzie County", 260_000, 8.0)],
    ]),
    rent: new Map([
      ["48453", home("48453", "Travis County", 1_700, -2.0)],
      ["48029", home("48029", "Bexar County", 1_400, 1.5)],
      ["06037", home("06037", "Los Angeles County", 2_900, 3.0)],
      ["36061", home("36061", "New York County", 3_800, 4.5)],
    ]),
    stateNames: new Map([
      ["48", "Texas"],
      ["06", "California"],
      ["36", "New York"],
      ["38", "North Dakota"],
      ["02", "Alaska"],
    ]),
  };
}

/** Five counties with data; the Aleutians has none and is dropped by the builder. */
export function countyFeatures(): LayerFeature[] {
  return buildAreaPoints(COUNTY_POINTS, "county", countyJoins());
}

export function stateFeatures(): LayerFeature[] {
  const joins: AreaJoins = {
    jobs: new Map([
      ["48", jobs("48000", 14_000_000, 1.8, 1_300, 3.6)],
      ["06", jobs("06000", 18_000_000, 0.2, 1_700, 3.0)],
    ]),
    home: new Map([
      ["48", home("Texas", "Texas", 300_000, -1.5)],
      ["06", home("California", "California", 780_000, 1.2)],
    ]),
    rent: new Map(),
  };
  return buildAreaPoints(
    [
      { geoid: "48", name: "Texas", stusab: "TX", lon: -99.3, lat: 31.5 },
      { geoid: "06", name: "California", stusab: "CA", lon: -119.6, lat: 37.2 },
    ],
    "state",
    joins,
  );
}

function wpi(id: number, name: string, country: string, lon: number, lat: number, size: WpiPort["size"], channelM: number | null, extra: Partial<WpiPort> = {}): WpiPort {
  return { id, name, country, region: "test", lat, lon, size, channelM, anchorageM: null, cargoPierM: null, oilM: null, lngM: null, maxLengthM: null, maxDraftM: null, tidalRangeM: null, facilities: [], ...extra };
}

function stat(year: number, teu: [number, number | null, number | null, number | null] | null, tons: [number, number | null] | null): PortStats {
  return {
    portId: "x",
    name: "Port Authority",
    position: "World Port Index entry",
    year,
    container: teu ? { total: teu[0], imports: null, exports: null, domestic: null, foreign: null, empty: teu[1], ranking: teu[2], pctChange: teu[3], series: [] } : undefined,
    tonnage: tons ? { total: tons[0], imports: null, exports: null, domestic: null, foreign: null, empty: null, ranking: null, pctChange: tons[1], series: [] } : undefined,
    vesselCalls: [],
    topCommodities: [["Petroleum", 100]],
    topFarm: [],
  };
}

export function portFeatures(): LayerFeature[] {
  const ports = [
    wpi(1, "Los Angeles", "United States", -118.27, 33.73, "large", 16.2, { locode: "USLAX" }),
    wpi(2, "Savannah", "United States", -81.09, 32.08, "large", 12.8, { locode: "USSAV" }),
    wpi(3, "Rotterdam", "Netherlands", 4.4, 51.9, "large", 23.0, { locode: "NLRTM" }),
    wpi(4, "Maurer", "United States", -74.25, 40.53, "very small", 11, {}),
  ];
  const stats = new Map<number, PortStats>([
    [1, stat(2024, [9_600_000, 2_100_000, 1, -4.1], [80_000_000, 1.2])],
    [2, stat(2024, [5_500_000, 900_000, 4, 8.3], [40_000_000, 2.5])],
  ]);
  return buildPorts(ports, stats);
}

function measure(latest: number, yoyPct: number | null): CrossingMeasure {
  return { latest, latestDate: "2026-06", yoyPct, series: [] };
}

export function crossingFeatures(): LayerFeature[] {
  const rows: CrossingRow[] = [
    { code: "2304", name: "Laredo", state: "TX", border: "US-Mexico Border", lon: -99.5, lat: 27.5, asOf: "2026-06", measures: { Trucks: measure(260_000, 3.2), "Personal Vehicles": measure(500_000, -1.0), "Personal Vehicle Passengers": measure(900_000, -0.5), Pedestrians: measure(150_000, 2.0), Trains: measure(700, 1.0) } },
    { code: "0712", name: "Detroit", state: "MI", border: "US-Canada Border", lon: -83.05, lat: 42.31, asOf: "2026-06", measures: { Trucks: measure(150_000, -2.5), "Personal Vehicles": measure(300_000, 4.0), "Personal Vehicle Passengers": measure(520_000, 3.5), "Bus Passengers": measure(9_000, null) } },
    { code: "2506", name: "San Ysidro", state: "CA", border: "US-Mexico Border", lon: -117.03, lat: 32.54, asOf: "2026-06", measures: { "Personal Vehicles": measure(1_200_000, 0.5), "Personal Vehicle Passengers": measure(2_300_000, 0.2), Pedestrians: measure(700_000, 5.0) } },
  ];
  return buildCrossings(rows);
}

function country(iso3: string, name: string, lx: number, ly: number, pop: number, continent: string): CountryFeatureIn {
  return { type: "Feature", properties: { name, iso3, lx, ly, pop, popYear: 2019, continent }, geometry: { type: "Polygon", coordinates: [[[lx - 1, ly - 1], [lx + 1, ly - 1], [lx + 1, ly + 1], [lx - 1, ly + 1], [lx - 1, ly - 1]]] } };
}

export function countryFeatures(): LayerFeature[] {
  const wb = new Map<string, CountryStats>([
    ["DEU", { iso3: "DEU", name: "Germany", gdp: { value: 4.5e12, year: "2024" }, exports: { value: 2.0e12, year: "2024" }, imports: { value: 1.8e12, year: "2024" }, tradePct: { value: 84, year: "2024" }, teu: { value: 1.5e7, year: "2023" } }],
    ["USA", { iso3: "USA", name: "United States", gdp: { value: 2.9e13, year: "2024" }, exports: { value: 3.2e12, year: "2024" }, imports: { value: 4.1e12, year: "2024" }, tradePct: { value: 25, year: "2024" } }],
    ["NLD", { iso3: "NLD", name: "Netherlands", gdp: { value: 1.2e12, year: "2024" }, exports: { value: 9.0e11, year: "2023" }, imports: { value: 8.0e11, year: "2024" } }],
  ]);
  return buildCountries(
    [country("DEU", "Germany", 10.4, 51.1, 83_000_000, "Europe"), country("USA", "United States", -97, 39, 330_000_000, "North America"), country("NLD", "Netherlands", 5.3, 52.1, 17_000_000, "Europe"), country("ATA", "Antarctica", 0, -80, 0, "Antarctica")],
    wb,
  );
}
