import { describe, expect, it } from "vitest";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { Series } from "@/lib/series/types";
import { monthEnd } from "./align";
import { forwardChangePct, icCrossSection, icPanel, icRowsAt, icSeries, pearson, ranks, spearman, summarize, tStat } from "./ic";

const mk = (id: string, vals: Array<number | null>, start = 2020): Series => ({
  id,
  title: id,
  unit: "",
  frequency: "monthly",
  provenance: provenance(source("zillow-zhvi"), { kind: "published" }),
  points: vals.map((v, k) => ({ t: monthEnd(start + Math.floor(k / 12), (k % 12) + 1), v })),
});

describe("ranks and correlations", () => {
  it("average ranks for ties", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(ranks([3, 1, 2])).toEqual([3, 1, 2]);
  });
  it("Spearman without ties matches 1 − 6Σd²/(n(n²−1)) (Wikipedia IQ / TV example)", () => {
    const iq = [106, 100, 86, 101, 99, 103, 97, 113, 112, 110];
    const tv = [7, 27, 2, 50, 28, 29, 20, 12, 6, 17];
    expect(spearman(iq, tv)).toBeCloseTo(-29 / 165, 12); // Σd² = 194 -> 1 − 1164/990
  });
  it("Spearman with ties is Pearson on average ranks: x=1..5, y=[5,6,7,8,7] -> 8/√95", () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(8 / Math.sqrt(95), 12);
  });
  it("monotone -> ±1, degenerate -> null", () => {
    expect(spearman([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 12);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(() => spearman([1], [1, 2])).toThrow();
  });
  it("t-stat: rho 0.5, n 27 -> 0.5·√(25/0.75)", () => {
    expect(tStat(0.5, 27)).toBeCloseTo(0.5 * Math.sqrt(25 / 0.75), 12);
    expect(tStat(1, 10)).toBeNull();
    expect(tStat(null, 10)).toBeNull();
    expect(tStat(0.5, 2)).toBeNull();
  });
  it("icCrossSection drops non-finite rows", () => {
    const r = icCrossSection([
      { signal: 1, forward: 10 },
      { signal: 2, forward: 20 },
      { signal: 3, forward: 15 },
      { signal: NaN, forward: 1 },
    ]);
    expect(r.n).toBe(3);
    expect(r.rho).toBeCloseTo(0.5, 12);
    expect(r.t).toBeCloseTo(0.5 * Math.sqrt(1 / 0.75), 12);
  });
});

describe("forward changes and the panel", () => {
  it("forwardChangePct keys by month and needs both ends", () => {
    const f = forwardChangePct(mk("p", [100, 110, 121]), 1);
    expect([...f.values()].map((v) => Number(v.toFixed(9)))).toEqual([10, 10]);
    expect(f.size).toBe(2);
    expect(forwardChangePct(mk("p", [0, 110, null, 121]), 1).size).toBe(0);
  });
  const prices = new Map([
    ["A", mk("zhvi:county:A", [100, 110, 105])],
    ["B", mk("zhvi:county:B", [100, 120, 100])],
    ["C", mk("zhvi:county:C", [100, 130, 100])],
  ]);
  const signals = new Map([
    ["A", mk("sig:A", [1, 1, null])],
    ["B", mk("sig:B", [2, 2, null])],
    ["C", mk("sig:C", [3, 3, null])],
  ]);
  it("perfect ranking gives IC 1, reversed gives −1", () => {
    const p = icPanel(signals, prices, 1, { minN: 3 });
    expect(p.byMonth.map((r) => r.month)).toEqual(["2020-01", "2020-02"]);
    expect(p.byMonth[0].rho).toBeCloseTo(1, 12);
    expect(p.byMonth[0].n).toBe(3);
    expect(p.byMonth[0].t).toBeNull(); // |rho| = 1
    // 2020-02 forward: A −4.5 %, B −16.7 %, C −23.1 %; signals 1, 2, 3 -> perfectly reversed
    expect(p.byMonth[1].rho).toBeCloseTo(-1, 12);
    expect(p.summary.months).toBe(2);
    expect(p.summary.meanIc).toBeCloseTo(0, 12);
    expect(p.summary.positiveShare).toBe(0.5);
    expect(p.summary.meanN).toBe(3);
  });
  it("respects minN and date bounds", () => {
    expect(icPanel(signals, prices, 1, { minN: 4 }).byMonth).toHaveLength(0);
    expect(icPanel(signals, prices, 1, { minN: 3, from: "2020-02" }).byMonth.map((r) => r.month)).toEqual(["2020-02"]);
    expect(icPanel(signals, prices, 1, { minN: 3, to: "2020-01" }).byMonth.map((r) => r.month)).toEqual(["2020-01"]);
  });
  it("icRowsAt lists the cross-section for one month", () => {
    const rows = icRowsAt(signals, prices, 1, "2020-01");
    expect(rows).toEqual([
      { id: "A", signal: 1, forward: expect.closeTo(10, 9) },
      { id: "B", signal: 2, forward: expect.closeTo(20, 9) },
      { id: "C", signal: 3, forward: expect.closeTo(30, 9) },
    ]);
    expect(icRowsAt(signals, prices, 1, "2020-03")).toEqual([]);
    expect(icRowsAt(signals, prices, 1, "nope")).toEqual([]);
  });
  it("summarize: mean, sample sd, IR, positive share", () => {
    const s = summarize([
      { month: "a", rho: 0.2, n: 10, t: null },
      { month: "b", rho: -0.1, n: 20, t: null },
      { month: "c", rho: 0.5, n: 30, t: null },
      { month: "d", rho: null, n: 0, t: null },
    ]);
    expect(s.months).toBe(3);
    expect(s.meanIc).toBeCloseTo(0.2, 12);
    expect(s.sdIc).toBeCloseTo(0.3, 12);
    expect(s.icIr).toBeCloseTo(2 / 3, 12);
    expect(s.positiveShare).toBeCloseTo(2 / 3, 12);
    expect(s.meanN).toBe(20);
    expect(summarize([]).meanIc).toBeNull();
  });
  it("icSeries carries the panel as an estimate series", () => {
    const s = icSeries(icPanel(signals, prices, 1, { minN: 3 }), "momentum:home-only");
    expect(s.id).toBe("ic:momentum:home-only:h1");
    expect(s.points.map((p) => p.v)).toEqual([expect.closeTo(1, 9), expect.closeTo(-1, 9)]);
    expect(s.provenance.kind).toBe("estimate");
    expect(s.provenance.method).toContain("Spearman");
  });
});
