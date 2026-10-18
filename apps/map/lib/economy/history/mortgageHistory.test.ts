import { describe, expect, it } from "vitest";
import { fredRowsToSeries } from "./mortgageHistory";

describe("fredRowsToSeries", () => {
  it("keeps every dated row, nulls for '.', sorted, with FRED provenance", () => {
    const s = fredRowsToSeries(
      "MORTGAGE30US",
      [
        ["2024-01-11", null],
        ["2024-01-04", 6.62],
        ["not a date", 1],
        ["2024-01-18", 6.6],
      ],
      { title: "PMMS", unit: "%", frequency: "weekly", notes: ["n"] },
      "2024-02-01T00:00:00.000Z",
    );
    expect(s.id).toBe("fred:MORTGAGE30US");
    expect(s.points).toEqual([
      { t: Date.UTC(2024, 0, 4), v: 6.62 },
      { t: Date.UTC(2024, 0, 11), v: null },
      { t: Date.UTC(2024, 0, 18), v: 6.6 },
    ]);
    expect(s.provenance).toMatchObject({ kind: "published", seriesId: "MORTGAGE30US", period: "2024-01-18", retrievedAt: "2024-02-01T00:00:00.000Z", notes: ["n"] });
    expect(s.provenance.source.id).toBe("fred");
    expect(s.geo?.kind).toBe("us");
  });
  it("empty input gives an empty series without a period", () => {
    const s = fredRowsToSeries("X", [], { title: "x", unit: "", frequency: "weekly" });
    expect(s.points).toEqual([]);
    expect(s.provenance.period).toBeUndefined();
  });
});
