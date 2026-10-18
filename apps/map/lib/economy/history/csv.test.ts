import { describe, expect, it } from "vitest";
import { seriesToLongCsv } from "./csv";
import { mortgage, zori } from "./fixtures";

describe("seriesToLongCsv", () => {
  it("long format, ISO dates, empty cell for null, quoted ids when needed", () => {
    const out = seriesToLongCsv([
      { ...zori, points: [zori.points[0], { t: zori.points[1].t, v: null }] },
      { ...mortgage, id: 'weird,"id"', points: [mortgage.points[0]] },
    ]);
    expect(out).toBe(['series_id,t_iso,value', 'zori:county:48453,2021-01-31,1000', 'zori:county:48453,2021-02-28,', '"weird,""id""",2020-01-16,4', ''].join("\n"));
  });
  it("header only for no series", () => {
    expect(seriesToLongCsv([])).toBe("series_id,t_iso,value\n");
  });
});
