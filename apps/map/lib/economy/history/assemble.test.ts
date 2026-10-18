import { describe, expect, it } from "vitest";
import { isoDate, monthEnd } from "./align";
import { assembleHistory, dedupeProvenance } from "./assemble";
import { emp, empYoY, mortgage, wage, wageYoY, zhvi, zori } from "./fixtures";
import type { QcewHistory } from "./qcewHistory";

const qcew: QcewHistory = { emp, avgWeeklyWage: wage, estabs: { ...emp, id: "qcew:county:48453:estabs" }, empYoY, wageYoY, estabsYoY: { ...empYoY, id: "qcew:county:48453:estabs:yoy" }, missing: [] };
const now = monthEnd(2022, 12);

describe("assembleHistory", () => {
  it("returns every input plus the indices, trimmed to the window, with deduped provenance", () => {
    const b = assembleHistory({ zhvi, zori, qcew, mortgage }, { years: 1, now });
    expect(b.series.map((s) => s.id)).toEqual([
      "zhvi:county:48453",
      "zori:county:48453",
      "qcew:county:48453:emp",
      "qcew:county:48453:avg-weekly-wage",
      "qcew:county:48453:estabs",
      "qcew:county:48453:emp:yoy",
      "qcew:county:48453:avg-weekly-wage:yoy",
      "qcew:county:48453:estabs:yoy",
      "fred:MORTGAGE30US",
      "momentum:county:48453",
      "affordability:county:48453:payment",
      "affordability:county:48453:wage-share",
      "affordability:county:48453:price-to-rent",
    ]);
    const z = b.series[0];
    expect(isoDate(z.points[0].t)).toBe("2021-12-31");
    expect(z.points).toHaveLength(13);
    // the first window month still has its 12-month base: momentum is defined
    const m = b.series.find((s) => s.id === "momentum:county:48453")!;
    expect(m.points[0].v).not.toBeNull();
    expect(b.provenance.map((p) => p.kind).filter((k) => k === "published")).toHaveLength(4);
    expect(b.provenance.some((p) => p.kind === "estimate" && p.method?.includes("clip"))).toBe(true);
    expect(b.caveats.some((c) => c.includes("no publication lag"))).toBe(true);
  });
  it("names what is missing and still returns what it has", () => {
    const b = assembleHistory({ zhvi, zori: null, qcew: null, mortgage: null }, { years: 5, now, lagMonths: 5 });
    expect(b.series.map((s) => s.id)).toEqual(["zhvi:county:48453", "momentum:county:48453"]);
    expect(b.caveats.join(" ")).toMatch(/ZORI/);
    expect(b.caveats.join(" ")).toMatch(/MORTGAGE30US/);
    expect(b.caveats.join(" ")).toMatch(/QCEW did not answer/);
    expect(b.caveats.join(" ")).toMatch(/shifted 5 months/);
  });
  it("no ZHVI: nothing derived, caveat says so", () => {
    const b = assembleHistory({ zhvi: null, zori, qcew: { ...qcew, missing: ["2020-Q1"] }, mortgage }, { years: 3, now });
    expect(b.series.some((s) => s.id.startsWith("momentum") || s.id.startsWith("affordability"))).toBe(false);
    expect(b.caveats[0]).toMatch(/No Zillow ZHVI/);
    expect(b.caveats.join(" ")).toContain("2020-Q1");
  });
  it("dedupeProvenance collapses identical records", () => {
    expect(dedupeProvenance([emp, wage])).toHaveLength(1);
    expect(dedupeProvenance([emp, { ...empYoY, provenance: { ...empYoY.provenance, kind: "estimate", method: "x" } }])).toHaveLength(2);
  });
});
