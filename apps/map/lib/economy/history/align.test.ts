import { describe, expect, it } from "vitest";
import type { Series } from "@/lib/series/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { addMonths, asOfJoin, isoDate, monthEnd, monthEndOf, monthFromIndex, monthIndex, monthKey, parseIsoDate, pctChangeMonths, pctChangeQuarters, quarterEnd, window } from "./align";

const series = (points: Array<[number, number | null]>): Series => ({
  id: "t",
  title: "t",
  unit: "",
  frequency: "monthly",
  provenance: provenance(source("zillow-zhvi"), { kind: "published" }),
  points: points.map(([t, v]) => ({ t, v })),
});

describe("calendar helpers", () => {
  it("month ends are the last UTC day, leap years included", () => {
    expect(isoDate(monthEnd(2024, 2))).toBe("2024-02-29");
    expect(isoDate(monthEnd(2023, 2))).toBe("2023-02-28");
    expect(isoDate(monthEnd(2024, 12))).toBe("2024-12-31");
    expect(isoDate(monthEndOf(Date.UTC(2024, 1, 10)))).toBe("2024-02-29");
  });
  it("month index round-trips and addMonths snaps to month end", () => {
    const t = monthEnd(2024, 1);
    expect(monthFromIndex(monthIndex(t))).toBe(t);
    expect(isoDate(addMonths(t, 1))).toBe("2024-02-29");
    expect(isoDate(addMonths(t, -12))).toBe("2023-01-31");
    expect(monthKey(t)).toBe("2024-01");
  });
  it("quarters stamp on the last day of the quarter", () => {
    expect(isoDate(quarterEnd(2024, 1))).toBe("2024-03-31");
    expect(isoDate(quarterEnd(2024, 4))).toBe("2024-12-31");
  });
  it("parses ISO dates and months, rejects impossible ones", () => {
    expect(isoDate(parseIsoDate("2000-01-31")!)).toBe("2000-01-31");
    expect(isoDate(parseIsoDate("2024-02")!)).toBe("2024-02-29");
    expect(parseIsoDate("2024-02-30")).toBeNull();
    expect(parseIsoDate("2024-13")).toBeNull();
    expect(parseIsoDate("junk")).toBeNull();
  });
});

describe("asOfJoin", () => {
  const quarterly = [
    { t: quarterEnd(2024, 1), v: 1 },
    { t: quarterEnd(2024, 2), v: 2 },
    { t: quarterEnd(2024, 3), v: null },
  ];
  const months = Array.from({ length: 12 }, (_, i) => monthEnd(2024, i + 1));
  it("carries the latest published quarter forward from its period end", () => {
    expect(asOfJoin(quarterly, months)).toEqual([null, null, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]);
  });
  it("carries a null observation when skipNull is off", () => {
    expect(asOfJoin(quarterly, months, { skipNull: false })).toEqual([null, null, 1, 1, 1, 2, 2, 2, null, null, null, null]);
  });
  it("shifts by the publication lag", () => {
    expect(asOfJoin(quarterly, months, { lagMonths: 5 })).toEqual([null, null, null, null, null, null, null, 1, 1, 1, 2, 2]);
  });
  it("stops carrying after maxStaleMonths", () => {
    expect(asOfJoin(quarterly, months, { maxStaleMonths: 2 })).toEqual([null, null, 1, 1, 1, 2, 2, 2, null, null, null, null]);
  });
  it("snaps mid-month observations (weekly rates) to their month", () => {
    const weekly = [
      { t: Date.UTC(2024, 0, 4), v: 6.6 },
      { t: Date.UTC(2024, 0, 25), v: 6.7 },
      { t: Date.UTC(2024, 1, 1), v: 6.9 },
    ];
    expect(asOfJoin(weekly, months.slice(0, 3), { maxStaleMonths: 3 })).toEqual([6.7, 6.9, 6.9]);
  });
});

describe("percent changes", () => {
  it("compares calendar months, not positions", () => {
    const s = series([
      [monthEnd(2023, 1), 100],
      [monthEnd(2023, 2), 100],
      [monthEnd(2024, 1), 110],
      [monthEnd(2024, 3), 120], // 2023-03 is absent
    ]);
    const out = pctChangeMonths(s, 12);
    expect(out.map((p) => p.v)).toEqual([null, null, expect.closeTo(10, 9), null]);
    expect(out[2].v).toBeCloseTo(10, 10);
  });
  it("null on null or zero base", () => {
    const s = series([
      [monthEnd(2023, 1), 0],
      [monthEnd(2023, 2), null],
      [monthEnd(2024, 1), 110],
      [monthEnd(2024, 2), 120],
    ]);
    expect(pctChangeMonths(s, 12).map((p) => p.v)).toEqual([null, null, null, null]);
  });
  it("quarterly over-the-year change uses four quarters back", () => {
    const pts = [1, 2, 3, 4, 5, 6].map((q, i) => ({ t: quarterEnd(2023 + Math.floor(i / 4), (i % 4) + 1), v: 1000 * (1 + q / 100) }));
    const out = pctChangeQuarters(pts, 4);
    expect(out.slice(0, 4).map((p) => p.v)).toEqual([null, null, null, null]);
    expect(out[4].v).toBeCloseTo(((1.05 / 1.01) - 1) * 100, 10);
  });
  it("window keeps inclusive bounds", () => {
    const pts = [1, 2, 3, 4].map((t) => ({ t, v: t }));
    expect(window(pts, 2, 3).map((p) => p.t)).toEqual([2, 3]);
    expect(window(pts, 3).map((p) => p.t)).toEqual([3, 4]);
  });
});
