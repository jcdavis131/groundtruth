import { describe, expect, it } from "vitest";
import { evaluate, moveQuality, nearestPoint, SPARKLINE_POINTS, statusRank, triggeredThresholds, yoyToleranceMs } from "./evaluate";
import type { Threshold } from "./types";
import type { Point } from "@/lib/series/types";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function daily(values: Array<number | null>, start = T0): Point[] {
  return values.map((v, i) => ({ t: start + i * DAY, v }));
}

function monthly(values: number[], startYear = 2024, startMonth = 0): Point[] {
  return values.map((v, i) => ({ t: Date.UTC(startYear, startMonth + i, 1), v }));
}

describe("statusRank", () => {
  it("orders alert > watch > ok > no data", () => {
    expect(statusRank("alert")).toBeGreaterThan(statusRank("watch"));
    expect(statusRank("watch")).toBeGreaterThan(statusRank("ok"));
    expect(statusRank("ok")).toBeGreaterThan(statusRank("no data"));
  });
});

describe("thresholds", () => {
  const th: Threshold[] = [
    { level: "watch", op: "<=", value: -5, label: "low" },
    { level: "alert", op: "<=", value: -8, label: "very low" },
    { level: "alert", op: ">=", value: 34, label: "flood" },
  ];
  it("fires the low side, worst level wins", () => {
    const e = evaluate({ thresholds: th, cadence: "daily" }, { points: daily([1, 0, -6, -9]) });
    expect(e.status).toBe("alert");
    expect(e.triggered.map((t) => t.label)).toEqual(["low", "very low"]);
  });
  it("fires the high side", () => {
    const e = evaluate({ thresholds: th, cadence: "daily" }, { points: daily([30, 35]) });
    expect(e.status).toBe("alert");
    expect(e.triggered.map((t) => t.label)).toEqual(["flood"]);
  });
  it("is ok in between and watch at the boundary (<= is inclusive)", () => {
    expect(evaluate({ thresholds: th, cadence: "daily" }, { points: daily([10, 12]) }).status).toBe("ok");
    const e = evaluate({ thresholds: th, cadence: "daily" }, { points: daily([1, -5]) });
    expect(e.status).toBe("watch");
  });
  it("strict operators exclude the boundary", () => {
    const strict: Threshold[] = [
      { level: "watch", op: "<", value: 70, label: "below 70" },
      { level: "alert", op: ">", value: 90, label: "above 90" },
    ];
    expect(triggeredThresholds(strict, { latest: 70, yoyPct: null, yoyAbs: null })).toEqual([]);
    expect(triggeredThresholds(strict, { latest: 69.9, yoyPct: null, yoyAbs: null }).map((t) => t.label)).toEqual(["below 70"]);
    expect(triggeredThresholds(strict, { latest: 90, yoyPct: null, yoyAbs: null })).toEqual([]);
    expect(triggeredThresholds(strict, { latest: 90.1, yoyPct: null, yoyAbs: null }).map((t) => t.label)).toEqual(["above 90"]);
  });
  it("skips a yoy rule when no year-ago point exists, never assumes", () => {
    const yoy: Threshold[] = [{ level: "watch", op: "<", value: -5, on: "yoyPct", label: "down y/y" }];
    const e = evaluate({ thresholds: yoy, cadence: "monthly" }, { points: monthly([100, 90]) });
    expect(e.yoyPct).toBeNull();
    expect(e.status).toBe("ok");
    expect(e.triggered).toEqual([]);
  });
  it("tests yoyPct and yoyAbs rules against the year-ago point", () => {
    const rules: Threshold[] = [
      { level: "watch", op: "<", value: -5, on: "yoyPct", label: "down 5 % y/y" },
      { level: "watch", op: ">=", value: 0.5, on: "yoyAbs", label: "up half a point y/y" },
    ];
    const down = evaluate({ thresholds: rules, cadence: "monthly" }, { points: monthly([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 90]) });
    expect(down.yoyPct).toBeCloseTo(-10);
    expect(down.triggered.map((t) => t.label)).toEqual(["down 5 % y/y"]);
    const up = evaluate({ thresholds: rules, cadence: "monthly" }, { points: monthly([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4.6]) });
    expect(up.yoyAbs).toBeCloseTo(0.6);
    expect(up.triggered.map((t) => t.label)).toEqual(["up half a point y/y"]);
  });
});

describe("evaluate arithmetic", () => {
  it("reports latest, previous, change and dates, ignoring nulls", () => {
    const e = evaluate({ thresholds: [], cadence: "daily" }, { points: daily([10, 12, null]) });
    expect(e.latest).toBe(12);
    expect(e.latestAt).toBe(new Date(T0 + DAY).toISOString());
    expect(e.prev).toBe(10);
    expect(e.changeAbs).toBe(2);
    expect(e.changePct).toBeCloseTo(20);
    expect(e.status).toBe("ok");
  });
  it("sorts unsorted input by time", () => {
    const pts = [
      { t: T0 + 2 * DAY, v: 3 },
      { t: T0, v: 1 },
      { t: T0 + DAY, v: 2 },
    ];
    const e = evaluate({ thresholds: [], cadence: "daily" }, { points: pts });
    expect(e.latest).toBe(3);
    expect(e.prev).toBe(2);
    expect(e.sparkline.map((p) => p.v)).toEqual([1, 2, 3]);
  });
  it("is 'no data' for an empty or all-null series", () => {
    for (const pts of [[], daily([null, null])]) {
      const e = evaluate({ thresholds: [{ level: "alert", op: ">=", value: 0, label: "x" }], cadence: "daily" }, { points: pts });
      expect(e.status).toBe("no data");
      expect(e.latest).toBeNull();
      expect(e.triggered).toEqual([]);
      expect(e.sparkline).toEqual([]);
    }
  });
  it("changePct is null when the previous value is zero", () => {
    const e = evaluate({ thresholds: [], cadence: "daily" }, { points: daily([0, 5]) });
    expect(e.changeAbs).toBe(5);
    expect(e.changePct).toBeNull();
  });
  it("caps the sparkline at the last 60 points", () => {
    const e = evaluate({ thresholds: [], cadence: "daily" }, { points: daily(Array.from({ length: 100 }, (_, i) => i)) });
    expect(e.sparkline).toHaveLength(SPARKLINE_POINTS);
    expect(e.sparkline[0].v).toBe(40);
    expect(e.sparkline[59].v).toBe(99);
  });
});

describe("year-ago lookup", () => {
  it("finds a daily point exactly 365 days back", () => {
    const pts = daily(Array.from({ length: 366 }, (_, i) => 100 + i));
    const e = evaluate({ thresholds: [], cadence: "daily" }, { points: pts });
    expect(e.yoyAbs).toBe(365);
    expect(e.yoyAt).toBe(new Date(T0).toISOString());
  });
  it("tolerates a leap-year month (366 days) for monthly data but not an 11-month gap", () => {
    const pts = monthly([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], 2024, 1); // Feb 2024 .. Feb 2025, 366 days apart
    expect(evaluate({ thresholds: [], cadence: "monthly" }, { points: pts }).yoyAbs).toBe(1);
    const short = monthly([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], 2024, 2); // Mar 2024 .. Feb 2025, nearest is 337 days back
    expect(evaluate({ thresholds: [], cadence: "monthly" }, { points: short }).yoyAbs).toBeNull();
  });
  it("picks the nearest point within tolerance and skips nulls", () => {
    const target = 1000 * DAY;
    const pts: Point[] = [
      { t: target - 3 * DAY, v: 1 },
      { t: target + 1 * DAY, v: null },
      { t: target + 2 * DAY, v: 2 },
    ];
    expect(nearestPoint(pts, target, 5 * DAY)?.v).toBe(2);
    expect(nearestPoint(pts, target, 1 * DAY)).toBeNull();
  });
  it("uses the previous year for annual series", () => {
    const pts = [
      { t: Date.UTC(2023, 0, 1), v: 100 },
      { t: Date.UTC(2024, 0, 1), v: 90 },
    ];
    const e = evaluate({ thresholds: [], cadence: "annual" }, { points: pts });
    expect(e.yoyPct).toBeCloseTo(-10);
    expect(yoyToleranceMs("annual")).toBeGreaterThan(yoyToleranceMs("monthly"));
    expect(yoyToleranceMs("weekly")).toBeGreaterThan(yoyToleranceMs("daily"));
  });
});

describe("moveQuality", () => {
  it("reads a rise as worse by default and better when inverted", () => {
    expect(moveQuality(1, undefined)).toBe("worse");
    expect(moveQuality(-1, undefined)).toBe("better");
    expect(moveQuality(1, true)).toBe("better");
    expect(moveQuality(-1, true)).toBe("worse");
    expect(moveQuality(0, true)).toBe("flat");
    expect(moveQuality(null, false)).toBeNull();
  });
});
