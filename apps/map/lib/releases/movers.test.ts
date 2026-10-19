import { describe, expect, it } from "vitest";
import type { CrossingRow, HomeValue, JobsRow, PortStats } from "@/lib/economy/features";
import { borderMovers, moversCsv, portMovers, prevMonth, prevQuarterYear, qcewMovers, rank, zillowMovers, type MoverRow } from "./movers";

const T = "2026-09-11T14:00:00.000Z";

/** A Zillow row from a list of monthly values ending at `asOf`, one per month. */
function home(id: string, name: string, values: Array<number | null>, asOf = "2026-07-31", state = "TX"): HomeValue {
  const [y, m] = asOf.split("-").map(Number);
  const monthly: Array<[string, number]> = [];
  values.forEach((v, i) => {
    const k = values.length - 1 - i;
    const d = new Date(Date.UTC(y, m - 1 - k + 1, 0));
    if (v != null) monthly.push([d.toISOString().slice(0, 10), v]);
  });
  const latest = monthly[monthly.length - 1]?.[1] ?? 0;
  return { id, name, state, sizeRank: 1, asOf, latest, yoyPct: null, y5Pct: null, monthly, yearly: [] };
}

describe("helpers", () => {
  it("previous month and previous year quarter", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(prevMonth("2026-07")).toBe("2026-06");
    expect(prevQuarterYear("2026 Q1")).toBe("2025 Q1");
    expect(prevQuarterYear("odd")).toBe("odd");
  });
  it("rank breaks ties by id and drops rows without a percent", () => {
    const rows: MoverRow[] = [
      { id: "b", name: "b", before: 1, after: 2, changeAbs: 1, changePct: 100, period: "p" },
      { id: "a", name: "a", before: 1, after: 2, changeAbs: 1, changePct: 100, period: "p" },
      { id: "c", name: "c", before: 1, after: 0.5, changeAbs: -0.5, changePct: -50, period: "p" },
      { id: "d", name: "d", before: null, after: 2, changeAbs: null, changePct: null, period: "p" },
    ];
    const { up, down } = rank(rows, 2);
    expect(up.map((r) => r.id)).toEqual(["a", "b"]);
    expect(down.map((r) => r.id)).toEqual(["c", "a"]);
  });
});

describe("zillowMovers", () => {
  // 14 months so each of the two newest months has a value 12 months back.
  const flat = Array(14).fill(90) as number[];
  const rows: HomeValue[] = [
    home("48453", "Travis County", [...flat.slice(0, 12), 100, 110]), // +10 %
    home("48029", "Bexar County", [...flat.slice(0, 12), 100, 95]), // -5 %
    home("48201", "Harris County", [...flat.slice(0, 12), 200, 220]), // +10 % tie with Travis
    home("48113", "Dallas County", [...flat.slice(0, 12), 0, 50]), // zero base: skipped
    home("48439", "Tarrant County", [...flat.slice(0, 13), 100], "2026-06-30"), // stale region: skipped
    home("06037", "Los Angeles County", [...flat.slice(0, 12), 100, null], "2026-07-31", "CA"), // no latest: skipped
    // yoy sign flips: was below a year earlier, now above (to +); was above, now below (to -)
    home("12086", "Miami-Dade County", [120, ...Array(11).fill(100), 110, 112], "2026-07-31", "FL"),
    home("36061", "New York County", [90, 100, ...Array(10).fill(100), 95, 90], "2026-07-31", "NY"),
  ];
  const r = zillowMovers({ kind: "zhviCounty", asOf: "2026-07-31", rows }, { n: 2, retrievedAt: T });

  it("compares the newest two columns and ranks with stable ties", () => {
    expect(r.period).toBe("2026-07");
    expect(r.previousPeriod).toBe("2026-06");
    expect(r.up.map((x) => x.id)).toEqual(["48201", "48453"]);
    expect(r.up[0]).toMatchObject({ name: "Harris County, TX", before: 200, after: 220, changeAbs: 20, changePct: 10, period: "2026-07", previousPeriod: "2026-06" });
    expect(r.down[0].id).toBe("36061");
    expect(r.down[0].changePct).toBeCloseTo(-5.26, 2);
    expect(r.down[1]).toMatchObject({ id: "48029", changePct: -5 });
    expect(r.compared).toBe(5);
    expect(r.skipped).toBe(3);
  });
  it("counts yoy sign flips from the same series", () => {
    expect(r.signFlips).toEqual({ toPositive: 1, toNegative: 1 });
  });
  it("tags provenance as published with the arithmetic in method", () => {
    expect(r.provenance.kind).toBe("published");
    expect(r.provenance.source.id).toBe("zillow-zhvi");
    expect(r.provenance.method).toMatch(/after - before/);
    expect(r.provenance.retrievedAt).toBe(T);
    const zori = zillowMovers({ kind: "zoriCounty", asOf: "2026-07-31", rows: [] }, {});
    expect(zori.provenance.source.id).toBe("zillow-zori");
    expect(zori.unit).toBe("USD per month");
  });
  it("honours minBefore and clamps n", () => {
    const big = zillowMovers({ kind: "zhviCounty", asOf: "2026-07-31", rows }, { n: 999, minBefore: 150 });
    expect(big.up.map((x) => x.id)).toEqual(["48201"]);
    expect(big.compared).toBe(1);
  });
});

describe("qcewMovers", () => {
  const job = (area: string, emp: number | null, yoyEmp: number | null, yoyWage: number | null, suppressed = false): JobsRow => ({
    area,
    period: "2026 Q1",
    estabs: 10,
    emp,
    wages: 1000,
    avgWeeklyWage: 900,
    yoy: { estabs: 1, emp: yoyEmp, wages: 2, avgWeeklyWage: yoyWage },
    suppressed,
  });
  const counties = [job("48453", 700000, 3.2, 4.1), job("48029", 900000, -1.5, 2.0), job("48001", 500, 25, null), job("48003", null, null, null, true)];
  const names = new Map([
    ["48453", "Travis County, TX"],
    ["48029", "Bexar County, TX"],
  ]);
  it("ranks by the published over-the-year percent and never reconstructs the base", () => {
    const r = qcewMovers({ period: "2026 Q1", counties }, names, "emp", { n: 5 });
    expect(r.up.map((x) => x.id)).toEqual(["48001", "48453", "48029"]);
    expect(r.up[1]).toMatchObject({ name: "Travis County, TX", before: null, after: 700000, changeAbs: null, changePct: 3.2, period: "2026 Q1", previousPeriod: "2025 Q1" });
    expect(r.up[0].name).toBe("48001");
    expect(r.skipped).toBe(1);
    expect(r.provenance.seriesId).toBe("oty_emp_pct_chg");
    expect(r.provenance.kind).toBe("published");
  });
  it("wage metric skips rows with no published change; minBefore floors the level", () => {
    const w = qcewMovers({ period: "2026 Q1", counties }, names, "avgWeeklyWage", { n: 5 });
    expect(w.compared).toBe(2);
    expect(w.unit).toBe("USD per week");
    const floored = qcewMovers({ period: "2026 Q1", counties }, undefined, "emp", { minBefore: 600000 });
    expect(floored.up.map((x) => x.id)).toEqual(["48453", "48029"]);
  });
});

describe("borderMovers", () => {
  const port = (code: string, name: string, trucks: Array<[string, number]>): CrossingRow => ({
    code,
    name,
    state: "TX",
    border: "US-Mexico Border",
    lon: -98.5,
    lat: 29.4,
    asOf: trucks[trucks.length - 1][0],
    measures: { Trucks: { latest: trucks[trucks.length - 1][1], latestDate: trucks[trucks.length - 1][0], yoyPct: null, series: trucks } },
  });
  const rows = [
    port("2304", "Laredo", [["2026-05", 200000], ["2026-06", 220000]]),
    port("2402", "Eagle Pass", [["2026-05", 20000], ["2026-06", 18000]]),
    port("2301", "Brownsville", [["2026-04", 10000], ["2026-05", 11000]]), // stale
    port("2303", "Del Rio", [["2026-05", 0], ["2026-06", 5]]), // zero base
    { ...port("2305", "Presidio", [["2026-05", 100], ["2026-06", 110]]), measures: {} }, // no trucks
  ];
  it("compares consecutive months per port and carries coordinates", () => {
    const r = borderMovers({ asOf: "2026-06", rows }, "Trucks", { n: 3 });
    expect(r.period).toBe("2026-06");
    expect(r.up[0]).toMatchObject({ id: "2304", name: "Laredo, TX", before: 200000, after: 220000, changeAbs: 20000, changePct: 10, lon: -98.5, lat: 29.4 });
    expect(r.down[0].id).toBe("2402");
    expect(r.compared).toBe(2);
    expect(r.skipped).toBe(3);
    expect(r.provenance.source.id).toBe("bts-border");
  });
  it("other measures are empty when absent", () => {
    const r = borderMovers({ asOf: "2026-06", rows }, "Pedestrians");
    expect(r.compared).toBe(0);
    expect(r.metric).toBe("Pedestrians");
  });
});

describe("portMovers", () => {
  const stats = (portId: string, name: string, series: Array<[number, number]>, cargo: "container" | "tonnage" = "container"): PortStats => ({
    portId,
    name,
    position: "WPI",
    year: 2025,
    [cargo]: { total: series[series.length - 1][1], imports: null, exports: null, domestic: null, foreign: null, empty: null, ranking: null, pctChange: null, series },
    vesselCalls: [],
    topCommodities: [],
    topFarm: [],
  });
  const ports = [
    { stats: stats("C4110", "Los Angeles, CA", [[2023, 8.6e6], [2024, 10.3e6], [2025, 9.8e6]]), lon: -118.27, lat: 33.73 },
    { stats: stats("C4830", "Savannah, GA", [[2024, 5.5e6], [2025, 5.9e6]]) },
    { stats: stats("C2709", "Houston, TX", [[2025, 4.0e6]]) }, // one year only
    { stats: stats("C4900", "Tacoma, WA", [[2024, 1e6], [2025, 1.1e6]], "tonnage") }, // no container series
  ];
  it("compares latest year with the prior year per port", () => {
    const r = portMovers({ year: 2025, ports }, "container", { n: 5 });
    expect(r.period).toBe("2025");
    expect(r.previousPeriod).toBe("2024");
    expect(r.up[0]).toMatchObject({ id: "C4830", name: "Savannah, GA", before: 5.5e6, after: 5.9e6 });
    expect(r.up[0].changePct).toBeCloseTo(7.27, 2);
    expect(r.down[0]).toMatchObject({ id: "C4110", lon: -118.27, lat: 33.73 });
    expect(r.compared).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.unit).toBe("TEU");
    const t = portMovers({ year: 2025, ports }, "tonnage");
    expect(t.up.map((x) => x.id)).toEqual(["C4900"]);
    expect(t.unit).toBe("short tons");
  });
});

describe("moversCsv", () => {
  it("writes one row per mover with direction and a provenance comment", () => {
    const r = borderMovers(
      { asOf: "2026-06", rows: [{ code: "1", name: 'Port "A", odd', state: "TX", border: "b", lon: 1, lat: 2, asOf: "2026-06", measures: { Trucks: { latest: 2, latestDate: "2026-06", yoyPct: null, series: [["2026-05", 1], ["2026-06", 2]] } } }] },
      "Trucks",
    );
    const csv = moversCsv(r);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("direction,rank,id,name,before,after,change_abs,change_pct,period,previous_period,lon,lat");
    expect(lines[1]).toBe('up,1,1,"Port ""A"", odd, TX",1,2,1,100.000,2026-06,2026-05,1,2');
    expect(lines[2].startsWith("down,1,1,")).toBe(true);
    expect(lines[3].startsWith("# border Trucks (crossings per month); U.S. Bureau of Transportation Statistics")).toBe(true);
  });
});
