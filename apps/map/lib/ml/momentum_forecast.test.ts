// Evidence contract for SPEC-1.1 (momentum-v1).
// All data is REAL Zillow county ZHVI (apps/map/lib/ml/fixtures/zhvi_counties.json,
// captured 2026-10-23 from files.zillowstatic.com) — no synthetic series, and
// the tests never touch the network.
import { describe, expect, it } from "vitest";
import {
  buildPanel,
  evaluateSplit,
  latestFeatures,
  pickLambda,
  splitRegime,
  splitSpatial,
  trainRidge,
  type CountyMonthly,
} from "./momentum_forecast";
import fixture from "./fixtures/zhvi_counties.json";

const counties = fixture as CountyMonthly[];

describe("momentum_forecast", () => {
  it("builds a point-in-time panel (no lookahead)", () => {
    // Null every value after 2020-06; origins at or before 2019-06 (needing
    // at most the 2020-06 target) must be byte-identical to the full panel.
    const rows = buildPanel(counties);
    const cut = counties.map((c) => {
      const months = c.months;
      return { ...c, values: c.values.map((v, i) => (months[i] > "2020-06" ? null : v)) };
    });
    const rowsCut = buildPanel(cut);
    const full = new Map(rows.map((r) => [`${r.fips}|${r.month}`, r]));
    let checked = 0;
    for (const r of rowsCut) {
      if (r.month > "2019-06") continue;
      const f = full.get(`${r.fips}|${r.month}`);
      expect(f).toBeDefined();
      expect(r.features).toEqual(f!.features);
      expect(r.target).toBeCloseTo(f!.target, 12);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("(a) beats naive and seasonal on held-out counties (MAE, 12-month horizon)", () => {
    const rows = buildPanel(counties);
    const { train, test } = splitSpatial(rows);
    expect(test.length).toBeGreaterThan(100);
    const lambda = pickLambda(train, [0.01, 0.1, 1, 10, 100], "2026-09");
    const model = trainRidge(train, lambda, "2026-09");
    const e = evaluateSplit(model, test);
    expect(e.ridge.mae).toBeLessThan(e.naive.mae);
    expect(e.ridge.mae).toBeLessThan(e.seasonal.mae);
  });

  it("(b) beats naive on the regime-shift slice (train <= 2019-12, test 2020-01..2023-12)", () => {
    const rows = buildPanel(counties);
    const { train, test } = splitRegime(rows, "2019-12", "2020-01", "2023-12");
    expect(test.length).toBeGreaterThan(100);
    const lambda = pickLambda(train, [0.01, 0.1, 1, 10, 100], "2019-12");
    const model = trainRidge(train, lambda, "2019-12");
    const e = evaluateSplit(model, test);
    expect(e.ridge.mae).toBeLessThan(e.naive.mae);
  });

  it("latestFeatures needs 25 months and is null-safe", () => {
    expect(latestFeatures(new Array(24).fill(300000))).toBeNull();
    const vals = Array.from({ length: 40 }, (_, i) => 200000 * 1.004 ** i);
    const f = latestFeatures(vals);
    expect(f).not.toBeNull();
    expect(f).toHaveLength(5);
    expect(f!.every(Number.isFinite)).toBe(true);
  });
});
