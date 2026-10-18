import { describe, expect, it } from "vitest";
import type { Point, Series } from "@/lib/series/types";
import { colorAt, dateTicks, extent, fmtAxis, fmtDate, nearestIndex, niceStep, niceTicks, normalise, planAxes, scaleLinear, seriesCsv, sideExtent, timeExtent, toChartSeries, type ChartSeries } from "./chart";

const DAY = 86_400_000;
const pts = (vals: Array<number | null>, start = Date.UTC(2024, 0, 1), step = DAY): Point[] => vals.map((v, i) => ({ t: start + i * step, v }));

describe("extent", () => {
  it("ignores nulls and non-finite values", () => {
    expect(extent(pts([3, null, -1, NaN, 7]))).toEqual({ min: -1, max: 7 });
    expect(extent(pts([null, null]))).toBeNull();
    expect(extent([])).toBeNull();
  });
  it("time extent spans every series", () => {
    const a: ChartSeries = { id: "a", label: "a", color: "#000", unit: "x", points: pts([1, 2]) };
    const b: ChartSeries = { id: "b", label: "b", color: "#000", unit: "x", points: pts([1], Date.UTC(2025, 0, 1)) };
    expect(timeExtent([a, b])).toEqual({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2025, 0, 1) });
    expect(timeExtent([])).toBeNull();
  });
});

describe("niceStep / niceTicks", () => {
  it("rounds steps to 1, 2, 2.5, 5 × 10^n", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(3.1)).toBe(2.5);
    expect(niceStep(6)).toBe(5);
    expect(niceStep(85)).toBe(100);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
  });
  it("covers the extent with round ticks and widens the domain to them", () => {
    const { ticks, domain } = niceTicks(3, 97, 5);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(domain).toEqual({ min: 0, max: 100 });
  });
  it("prints clean decimals", () => {
    const { ticks } = niceTicks(0.1, 0.35, 5);
    expect(ticks).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  });
  it("pads a flat series and survives reversed or bad input", () => {
    expect(niceTicks(5, 5).domain.min).toBeLessThan(5);
    expect(niceTicks(0, 0).domain).toEqual({ min: -1, max: 1 });
    expect(niceTicks(10, 0, 3).domain).toEqual({ min: 0, max: 10 });
    expect(niceTicks(NaN, 1).ticks).toEqual([0, 1]);
  });
});

describe("scaleLinear", () => {
  it("maps a domain onto a range, including a flipped pixel range", () => {
    const y = scaleLinear({ min: 0, max: 100 }, [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
    expect(scaleLinear({ min: 5, max: 5 }, [0, 10])(5)).toBe(5);
  });
});

describe("normalise", () => {
  it("rebases so the first non-null value is 100", () => {
    const out = normalise(pts([null, 50, 75, null, 100]));
    expect(out.map((p) => p.v)).toEqual([null, 100, 150, null, 200]);
  });
  it("refuses a zero base instead of dividing by it", () => {
    expect(normalise(pts([0, 1])).every((p) => p.v === null)).toBe(true);
    expect(normalise([]).length).toBe(0);
  });
});

describe("planAxes / sideExtent", () => {
  const usd: ChartSeries = { id: "a", label: "A", color: "#000", unit: "USD", points: pts([100, 200]) };
  const pct: ChartSeries = { id: "b", label: "B", color: "#000", unit: "%", points: pts([1, 2]) };
  const teu: ChartSeries = { id: "c", label: "C", color: "#000", unit: "TEU", points: pts([5, 6]) };
  const usd2: ChartSeries = { id: "d", label: "D", color: "#000", unit: "USD", points: pts([50, 400]) };
  it("puts the first unit left, the second right, and reports a third as overflow", () => {
    const plan = planAxes([usd, pct, teu, usd2], false);
    expect(plan.units).toEqual({ left: "USD", right: "%" });
    expect(plan.side).toEqual({ a: "left", b: "right", c: "left", d: "left" });
    expect(plan.overflow).toEqual(["TEU"]);
  });
  it("uses one dimensionless axis when normalised", () => {
    const plan = planAxes([usd, pct], true);
    expect(plan.units.right).toBeUndefined();
    expect(plan.units.left).toContain("100");
    expect(plan.side.b).toBe("left");
    expect(planAxes([], true).units.left).toBeUndefined();
  });
  it("side extents cover every series on that side", () => {
    const plan = planAxes([usd, pct, usd2], false);
    expect(sideExtent([usd, pct, usd2], plan, "left", false)).toEqual({ min: 50, max: 400 });
    expect(sideExtent([usd, pct, usd2], plan, "right", false)).toEqual({ min: 1, max: 2 });
    const norm = planAxes([usd, usd2], true);
    expect(sideExtent([usd, usd2], norm, "left", true)).toEqual({ min: 100, max: 800 });
    expect(sideExtent([usd], norm, "right", true)).toBeNull();
  });
});

describe("dateTicks", () => {
  it("uses years for long spans", () => {
    const t = dateTicks(Date.UTC(2015, 5, 1), Date.UTC(2025, 5, 1));
    expect(t[0].label).toBe("2016");
    expect(t.every((x) => /^\d{4}$/.test(x.label))).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(4);
  });
  it("uses months for medium spans and days for short ones", () => {
    const m = dateTicks(Date.UTC(2024, 0, 15), Date.UTC(2024, 6, 15));
    expect(m[0]).toEqual({ t: Date.UTC(2024, 1, 1), label: "Feb 2024" });
    const d = dateTicks(Date.UTC(2024, 2, 1), Date.UTC(2024, 2, 11));
    expect(d[0].label).toBe("1 Mar");
    expect(d.length).toBeGreaterThan(2);
  });
  it("returns nothing for a degenerate span", () => {
    expect(dateTicks(5, 5)).toEqual([]);
    expect(dateTicks(NaN, 1)).toEqual([]);
  });
});

describe("nearestIndex / fmtDate / fmtAxis", () => {
  it("finds the closest point by time", () => {
    const p = pts([1, 2, 3, 4]);
    expect(nearestIndex(p, Date.UTC(2024, 0, 1) - 5 * DAY)).toBe(0);
    expect(nearestIndex(p, Date.UTC(2024, 0, 2) + DAY * 0.4)).toBe(1);
    expect(nearestIndex(p, Date.UTC(2024, 0, 2) + DAY * 0.6)).toBe(2);
    expect(nearestIndex(p, Date.UTC(2030, 0, 1))).toBe(3);
    expect(nearestIndex([], 0)).toBe(-1);
  });
  it("prints dates without a midnight time and axis numbers compactly", () => {
    expect(fmtDate(Date.UTC(2024, 2, 5))).toBe("2024-03-05");
    expect(fmtDate(Date.UTC(2024, 2, 5, 13, 30))).toBe("2024-03-05 13:30Z");
    expect(fmtAxis(1_250_000)).toBe("1.3M");
    expect(fmtAxis(2_000_000_000)).toBe("2B");
    expect(fmtAxis(12_500)).toBe("13k");
    expect(fmtAxis(250)).toBe("250");
    expect(fmtAxis(2.5)).toBe("2.5");
    expect(fmtAxis(0.123)).toBe("0.12");
    expect(fmtAxis(0)).toBe("0");
  });
});

describe("seriesCsv / toChartSeries / colorAt", () => {
  it("joins series on the union of timestamps with units in the header", () => {
    const a: ChartSeries = { id: "a", label: "Rate, weekly", color: "#000", unit: "%", points: pts([6.5, 6.4]) };
    const b: ChartSeries = { id: "b", label: "Home", color: "#000", unit: "USD", points: pts([null, 300], Date.UTC(2024, 0, 2)) };
    expect(seriesCsv([a, b]).split("\n")).toEqual(['date,"Rate, weekly (%)",Home (USD)', "2024-01-01,6.5,", "2024-01-02,6.4,", "2024-01-03,,300"]);
  });
  it("wraps a Series with a palette colour and sorted points", () => {
    const s: Series = { id: "x", title: "X", unit: "u", frequency: "daily", provenance: { source: { id: "a", name: "a", publisher: "a", url: "", license: "" }, retrievedAt: "", kind: "published" }, points: [{ t: 2, v: 1 }, { t: 1, v: 0 }] };
    const c = toChartSeries(s, 1);
    expect(c.points.map((p) => p.t)).toEqual([1, 2]);
    expect(c.color).toBe(colorAt(1));
    expect(toChartSeries(s, 0, "#fff").color).toBe("#fff");
    expect(colorAt(8)).toBe(colorAt(0));
    expect(colorAt(-1)).toBe(colorAt(7));
  });
});
