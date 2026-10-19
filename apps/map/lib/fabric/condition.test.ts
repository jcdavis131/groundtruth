import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { departure, flowClass, flowPercentile, median, monthDay, ordinal, parseNormals } from "./condition";
import { computeVitals, conditionVitals, type FeatureCondition } from "./emergence";
import { buildIndex, describeCover, minimalCover, upstream, upstreamOf } from "./upstream";
import type { ConstructNode } from "./types";
import { bareSite, statUrl } from "@/lib/water/normals";

// The slice of an observationNormals answer the parser reads: per site, a
// daily-mean series (00003) and the max/min series it must ignore.
const series = (stat: string, values: string[], count: number, day = "09-23") => ({
  parameter_code: "00060",
  unit_of_measure: "ft^3/s",
  parent_statistic_id: stat,
  values: [{ time_of_year: day, values, percentiles: ["5", "10", "25", "50", "75", "90", "95"], sample_count: count }],
});
const NORMALS = {
  type: "FeatureCollection",
  features: [
    {
      properties: {
        monitoring_location_id: "USGS-08158000",
        data: [series("00003", ["155.0", "243.4", "472.5", "898.5", "1495.0", "2538.0", "4777.5"], 128), series("00001", ["nan", "152.0", "317.0", "1360.0", "2130.0", "3630.0", "5120.0"], 19)],
      },
    },
    { properties: { monitoring_location_id: "USGS-08155300", data: [series("00003", ["nan", "0.0", "0.0", "0.0", "0.0", "8.0", "nan"], 49)] } },
    { properties: { monitoring_location_id: "USGS-08167000", data: [series("00003", ["1", "2", "3", "4", "5", "6", "7"], 87, "09-22")] } },
  ],
  next: null,
};

describe("daily flow statistics", () => {
  it("reads the daily-mean series for the day, 'nan' being no value", () => {
    const t = parseNormals(NORMALS, 9, 23);
    expect(Object.keys(t).sort()).toEqual(["08155300", "08158000"]);
    expect(t["08158000"]).toEqual({ site: "08158000", month: 9, day: 23, years: 128, p: { 5: 155, 10: 243.4, 25: 472.5, 50: 898.5, 75: 1495, 90: 2538, 95: 4777.5 } });
    expect(t["08155300"].p).toEqual({ 10: 0, 25: 0, 50: 0, 75: 0, 90: 8 });
  });
  it("asks the Statistics API for one day of discharge percentiles per site", () => {
    const u = new URL(statUrl(["08158000", "08167000"], 9, 3));
    expect(u.searchParams.getAll("monitoring_location_id")).toEqual(["USGS-08158000", "USGS-08167000"]);
    expect(u.searchParams.get("start_date")).toBe("09-03");
    expect(u.searchParams.get("end_date")).toBe("09-03");
    expect(u.searchParams.get("computation_type")).toBe("percentile");
    expect(u.searchParams.get("parameter_code")).toBe("00060");
    expect(bareSite("USGS-08158000")).toBe("08158000");
    expect(bareSite("nwps:ATIT2")).toBeNull();
  });
});

describe("where a flow stands", () => {
  const n = { p: { 10: 100, 25: 200, 50: 400, 75: 800, 90: 1600 } };
  it("interpolates between published percentiles", () => {
    expect(flowPercentile(400, n)).toBe(50);
    expect(flowPercentile(300, n)).toBeCloseTo(37.5);
    expect(flowPercentile(1200, n)).toBeCloseTo(82.5);
  });
  it("claims no more than the tails the table publishes", () => {
    expect(flowPercentile(5, n)).toBe(5);
    expect(flowPercentile(99_999, n)).toBe(95);
    expect(flowPercentile(1, { p: { 5: 10, 50: 20, 95: 30 } })).toBe(2.5);
    expect(flowPercentile(99, { p: { 5: 10, 50: 20, 95: 30 } })).toBe(97.5);
    // No p90 published: above p75 cannot be placed.
    expect(flowPercentile(5000, { p: { 10: 1, 25: 2, 50: 3, 75: 4 } })).toBeNull();
  });
  it("puts a flow in the middle of tied percentiles (a dry creek)", () => {
    expect(flowPercentile(0, { p: { 10: 0, 25: 0, 50: 0, 75: 0, 90: 0.4 } })).toBe(42.5);
  });
  it("needs at least two percentiles", () => {
    expect(flowPercentile(10, { p: { 50: 10 } })).toBeNull();
    expect(flowPercentile(NaN, n)).toBeNull();
  });
  it("classes the percentile the way WaterWatch did", () => {
    expect([5, 10, 24, 25, 75, 76, 90, 91].map(flowClass)).toEqual(["much-below", "below", "below", "normal", "normal", "above", "above", "much-above"]);
    expect(departure(50)).toBe(0);
    expect(departure(95)).toBe(1);
    expect(departure(5)).toBe(1);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect([1, 2, 3, 11, 12, 13, 21, 88].map(ordinal)).toEqual(["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "88th"]);
    expect(monthDay("2026-09-23T04:00:00Z")).toEqual({ month: 9, day: 23 });
  });
});

describe("a construct's condition", () => {
  it("is the median of its rated gauges, and a flood inside takes it to the top", () => {
    const c = conditionVitals([
      { pct: 92, flooding: false },
      { pct: 80, flooding: false },
      { pct: null, flooding: false },
    ]);
    expect(c.condition).toMatchObject({ median: 86, gauges: 3, rated: 2, flooding: 0, classes: { "much-above": 1, above: 1 } });
    expect(c.display).toBe("86th pct");
    expect(c.heat).toBeCloseTo(36 / 45);
    const f = conditionVitals([{ pct: 50, flooding: true }]);
    expect(f.heat).toBe(1);
    expect(f.display).toBe("50th pct · 1 in flood");
    expect(conditionVitals([{ pct: null, flooding: false }])).toMatchObject({ heat: 0, display: "", color: undefined });
  });

  it("joins gauges into units and ranks units by distance from normal", () => {
    const sq = (x0: number, y0: number) => [[[x0, y0], [x0 + 1, y0], [x0 + 1, y0 + 1], [x0, y0 + 1], [x0, y0]]];
    const node = (id: string, rings: number[][][]): ConstructNode => ({ id, kind: "huc8", domain: "hydrologic", name: id, facts: {}, links: [], source: "usgs-wbd", rings, areaKm2: 1000 });
    const g = (id: string, lon: number, lat: number) =>
      ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat, 0] }, properties: { id, layer: "water", name: id, source: "t" } }) as unknown as LayerFeature;
    const plane = { ...g("a1", 0.5, 0.5), properties: { id: "a1", layer: "aircraft", name: "a1", source: "t" } } as unknown as LayerFeature;
    const cond: Record<string, FeatureCondition> = { w1: { pct: 50, flooding: false }, w2: { pct: 97, flooding: false }, w3: { pct: 8, flooding: false } };
    const v = computeVitals([node("A", sq(0, 0)), node("B", sq(1, 0))], [g("w1", 0.5, 0.5), g("w2", 1.5, 0.5), g("w3", 1.6, 0.6), plane], "streamflow", "density", (f) => cond[f.properties.id] ?? null);
    expect(v.get("A")!.condition).toMatchObject({ median: 50, gauges: 1 });
    expect(v.get("A")!.heat).toBe(0);
    expect(v.get("A")!.total).toBe(2); // presence is still counted
    expect(v.get("B")!.condition!.median).toBe(52.5);
    // Without the condition function, streamflow degrades to no condition rather than a guess.
    const bare = computeVitals([node("A", sq(0, 0))], [g("w1", 0.5, 0.5)], "streamflow");
    expect(bare.get("A")!.condition).toMatchObject({ median: null, gauges: 0 });
  });
});

describe("the upstream catchment", () => {
  // Two HUC-8s in one region: 01010001 (three HUC-12s, all draining to 010100010003)
  // and 01010002 (two HUC-12s, one drains into the first HUC-8, one elsewhere).
  const bundle = {
    pulled: "t",
    complete: true,
    basins: {
      "0101": [
        "010100010001>010100010003",
        "010100010002>010100010003",
        "010100010003>OCEAN",
        "010100020001>010100010002",
        "010100020002>CLOSED BASIN",
      ].join("|"),
    },
  };
  const idx = buildIndex(bundle);

  it("reads ToHUC backwards", () => {
    expect(idx.size).toBe(5);
    expect(idx.up.get("010100010003")?.sort()).toEqual(["010100010001", "010100010002"]);
    expect(idx.countByPrefix.get("01010001")).toBe(3);
    expect([...upstreamOf("010100010002", idx)].sort()).toEqual(["010100010002", "010100020001"]);
  });

  it("compacts to the coarsest units that are wholly upstream", () => {
    const all = upstreamOf("010100010003", idx);
    expect(all.size).toBe(4);
    const cover = minimalCover(all, idx.countByPrefix);
    // 01010001 is whole; of 01010002 only one HUC-12 drains here.
    expect(cover).toEqual([
      { code: "01010001", level: 8 },
      { code: "010100020001", level: 12 },
    ]);
    const whole = minimalCover(new Set(["010100010001", "010100010002", "010100010003", "010100020001", "010100020002"]), idx.countByPrefix);
    expect(whole).toEqual([{ code: "01", level: 2 }]);
  });

  it("describes the cover and refuses codes it does not know", () => {
    const u = upstream("010100010003", idx)!;
    expect(u).toMatchObject({ huc12s: 4, basins: ["0101"], byLevel: { 8: 1, 12: 1 } });
    expect(describeCover(u.byLevel)).toBe("1 subbasin and 1 subwatershed");
    expect(describeCover({ 2: 2, 8: 3, 12: 1 })).toBe("2 regions, 3 subbasins and 1 subwatershed");
    expect(upstream("999999999999", idx)).toBeNull();
    expect(upstream("0101", idx)).toBeNull();
  });
});
