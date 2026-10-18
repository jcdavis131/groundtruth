import { describe, expect, it } from "vitest";
import { dateMs, findCrossing, metaFor, parseTwdbStatewideCsv, parseUsgsDaily, pointsFromRows, seriesFromCrossing, seriesFromPorts, seriesFromPulse, statewideFromRecent, sumContainerSeries, ttlForCadence, type UsgsDailyFeature } from "./readers";
import { indicatorById } from "./registry";
import type { PulseItem } from "@/lib/economy/sources";
import type { CrossingRow, PortStats } from "@/lib/economy/features";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

describe("dateMs / pointsFromRows", () => {
  it("parses year, month, day and full ISO forms as UTC", () => {
    expect(dateMs("2024")).toBe(Date.UTC(2024, 0, 1));
    expect(dateMs("2024-03")).toBe(Date.UTC(2024, 2, 1));
    expect(dateMs("2024-03-05")).toBe(Date.UTC(2024, 2, 5));
    expect(dateMs("2024-03-05T12:00:00Z")).toBe(Date.UTC(2024, 2, 5, 12));
    expect(dateMs("not a date")).toBeNull();
  });
  it("drops bad rows and sorts", () => {
    const pts = pointsFromRows([
      ["2024-02", 2],
      ["junk", 9],
      ["2024-01", 1],
      ["2024-03", NaN],
    ]);
    expect(pts).toEqual([
      { t: Date.UTC(2024, 0, 1), v: 1 },
      { t: Date.UTC(2024, 1, 1), v: 2 },
    ]);
  });
});

describe("USGS daily values", () => {
  // shape per https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily; same reader as /api/water?op=history
  const features: UsgsDailyFeature[] = [
    { properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00065", statistic_id: "00003", time: "2026-09-02", value: "-3.1", unit_of_measure: "ft", approval_status: "Provisional" } },
    { properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00065", statistic_id: "00001", time: "2026-09-02", value: "-2.5", unit_of_measure: "ft" } },
    { properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00065", statistic_id: "00003", time: "2026-09-01", value: "-2.9", unit_of_measure: "ft", approval_status: "Approved" } },
    { properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00065", statistic_id: "00003", time: "2026-08-31", value: null, unit_of_measure: "ft" } },
    { properties: { monitoring_location_id: "USGS-07032000", parameter_code: "00065", time: "2026-08-30", value: "Ice", unit_of_measure: "ft" } },
  ];
  it("keeps daily means only, sorted, numeric, and reports unit and approval", () => {
    const r = parseUsgsDaily(features);
    expect(r.rows).toEqual([
      ["2026-09-01", -2.9],
      ["2026-09-02", -3.1],
    ]);
    expect(r.unit).toBe("ft");
    expect(r.approval).toBe("Approved");
  });
  it("can select another statistic", () => {
    expect(parseUsgsDaily(features, "00001").rows).toEqual([["2026-09-02", -2.5]]);
  });
});

describe("TWDB statewide", () => {
  it("parses the statewide CSV with a comment preamble", () => {
    // shape per https://www.waterdatafortexas.org/reservoirs/statewide; unverified in sandbox
    const csv = ["# Statewide reservoir storage", "# generated 2026-09-10", "date,percent_full,conservation_storage,conservation_capacity", "2026-09-08,74.12,23000000,31000000", "2026-09-09,73.90,22950000,31000000", "2026-09-10,,22900000,31000000", ""].join("\n");
    expect(parseTwdbStatewideCsv(csv)).toEqual([
      ["2026-09-08", 74.12],
      ["2026-09-09", 73.9],
    ]);
    expect(parseTwdbStatewideCsv("nothing,here\n1,2")).toEqual([]);
  });
  it("sums storage over capacity as a fallback, skipping incomplete reservoirs", () => {
    const s = statewideFromRecent([
      { short_name: "a", conservation_storage: 50, conservation_capacity: 100, timestamp: "2026-09-09T00:00:00" },
      { short_name: "b", conservation_storage: 30, conservation_capacity: 100, timestamp: "2026-09-10T00:00:00" },
      { short_name: "c", conservation_storage: null, conservation_capacity: 100 },
      { short_name: "d", conservation_storage: 10, conservation_capacity: 0 },
    ]);
    expect(s).toMatchObject({ pct: 40, n: 2, date: "2026-09-10", storage: 80, capacity: 200 });
    expect(statewideFromRecent([])).toBeNull();
  });
});

describe("converters", () => {
  const laredo = indicatorById("laredo-trucks")!;
  const row: CrossingRow = {
    code: "2304",
    name: "Laredo",
    state: "Texas",
    border: "US-Mexico Border",
    lon: -99.5,
    lat: 27.5,
    asOf: "2026-07",
    measures: {
      Trucks: {
        latest: 260000,
        latestDate: "2026-07",
        yoyPct: -2,
        series: [
          ["2026-06", 255000],
          ["2026-07", 260000],
        ],
      },
    },
  };
  it("finds a crossing by code or by name+state", () => {
    expect(findCrossing([row], "2304", /^Laredo/, "Texas")).toBe(row);
    expect(findCrossing([row], "9999", /^Laredo/, "Texas")).toBe(row);
    expect(findCrossing([row], "9999", /^Laredo/, "Arizona")).toBeUndefined();
  });
  it("builds a crossing series with BTS provenance", () => {
    const s = seriesFromCrossing(laredo, row, "Trucks", "2026-09-11T00:00:00.000Z");
    expect(s.id).toBe("indicator:laredo-trucks");
    expect(s.frequency).toBe("monthly");
    expect(s.points.map((p) => p.v)).toEqual([255000, 260000]);
    expect(s.provenance.source.id).toBe("bts-border");
    expect(s.provenance.kind).toBe("published");
    expect(s.provenance.period).toBe("2026-07");
    expect(s.provenance.retrievedAt).toBe("2026-09-11T00:00:00.000Z");
    expect(seriesFromCrossing(laredo, row, "Trains").points).toEqual([]);
  });
  it("sums annual container TEU only for years both ports reported and labels it an estimate", () => {
    const la: PortStats = { portId: "4120", name: "LA", position: "", year: 2024, vesselCalls: [], topCommodities: [], topFarm: [], container: { total: 10, imports: null, exports: null, domestic: null, foreign: null, empty: null, ranking: null, pctChange: null, series: [[2022, 9], [2023, 9.5], [2024, 10]] } };
    const lb: PortStats = { ...la, portId: "4110", name: "LB", container: { ...la.container!, series: [[2023, 8], [2024, 9]] } };
    expect(sumContainerSeries([la, lb])).toEqual([
      ["2023", 17.5],
      ["2024", 19],
    ]);
    expect(sumContainerSeries([])).toEqual([]);
    const s = seriesFromPorts(indicatorById("la-lb-container-teu")!, [la, lb]);
    expect(s.provenance.kind).toBe("estimate");
    expect(s.provenance.method).toMatch(/4120 \+ 4110/);
    expect(s.points.map((p) => p.v)).toEqual([17.5, 19]);
  });
  it("wraps a pulse item with the right source", () => {
    const item: PulseItem = { id: "MORTGAGE30US", label: "x", value: 6.5, unit: "%", date: "2026-09-04", prev: 6.6, prevDate: "2026-08-28", changePct: -1.5, source: "FRED MORTGAGE30US", series: [["2026-08-28", 6.6], ["2026-09-04", 6.5]] };
    const s = seriesFromPulse(indicatorById("mortgage-30y")!, item, { sourceId: "fred", upstreamUrl: "https://fred.stlouisfed.org/series/MORTGAGE30US" });
    expect(s.provenance.source.id).toBe("fred");
    expect(s.provenance.seriesId).toBe("MORTGAGE30US");
    expect(s.provenance.upstreamUrl).toContain("MORTGAGE30US");
    expect(s.points).toHaveLength(2);
    expect(s.tags).toContain("housing");
  });
  it("metaFor carries geo and tags", () => {
    const m = metaFor(indicatorById("mississippi-memphis-stage")!, provenance(source("usgs-water"), { kind: "published" }));
    expect(m.geo?.kind).toBe("gauge");
    expect(m.tags).toEqual(["water", "indicator"]);
  });
  it("ttl grows with cadence", () => {
    expect(ttlForCadence("daily")).toBeLessThan(ttlForCadence("weekly"));
    expect(ttlForCadence("weekly")).toBeLessThan(ttlForCadence("monthly"));
    expect(ttlForCadence("monthly")).toBeLessThan(ttlForCadence("annual"));
  });
});
