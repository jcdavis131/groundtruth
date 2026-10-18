import { describe, expect, it } from "vitest";
import {
  allAwardCodes,
  categoryBody,
  daysSinceFyClose,
  fiscalYearOf,
  fiscalYearRange,
  foldObligations,
  fyToDateRange,
  geographyBody,
  latestCompleteFy,
  overTimeBody,
  parseCategory,
  parseGeography,
  parseOverTime,
  placeFilter,
} from "./usaspending";

describe("fiscal calendar", () => {
  it("starts the federal year on 1 October", () => {
    expect(fiscalYearOf(new Date("2026-09-30T23:59:59Z"))).toBe(2026);
    expect(fiscalYearOf(new Date("2026-10-01T00:00:00Z"))).toBe(2027);
    expect(fiscalYearOf(new Date("2026-01-15T00:00:00Z"))).toBe(2026);
  });
  it("gives the range of a fiscal year", () => {
    expect(fiscalYearRange(2025)).toEqual({ start_date: "2024-10-01", end_date: "2025-09-30" });
  });
  it("names the latest complete year and the year-to-date window", () => {
    expect(latestCompleteFy(new Date("2026-09-11T00:00:00Z"))).toBe(2025);
    expect(latestCompleteFy(new Date("2026-10-02T00:00:00Z"))).toBe(2026);
    expect(fyToDateRange(new Date("2026-09-11T12:00:00Z"))).toEqual({ fy: 2026, start_date: "2025-10-01", end_date: "2026-09-11" });
    expect(fyToDateRange(new Date("2026-11-03T12:00:00Z"))).toEqual({ fy: 2027, start_date: "2026-10-01", end_date: "2026-11-03" });
  });
  it("counts days since the latest complete year closed", () => {
    expect(daysSinceFyClose(new Date("2026-10-15T00:00:00Z"))).toBe(15);
    expect(daysSinceFyClose(new Date("2026-09-11T00:00:00Z"))).toBe(346);
  });
});

describe("request bodies", () => {
  it("builds a geography request with optional shape filters", () => {
    const b = geographyBody({ start_date: "2024-10-01", end_date: "2025-09-30" }, ["A", "B"], "county", ["48453"]);
    expect(b).toEqual({ scope: "place_of_performance", geo_layer: "county", geo_layer_filters: ["48453"], filters: { time_period: [{ start_date: "2024-10-01", end_date: "2025-09-30" }], award_type_codes: ["A", "B"] } });
    expect("geo_layer_filters" in geographyBody({ start_date: "a", end_date: "b" }, ["A"], "state")).toBe(false);
  });
  it("addresses a county as its three-digit code inside the state", () => {
    expect(placeFilter("48453", "tx")).toEqual([{ country: "USA", state: "TX", county: "453" }]);
  });
  it("builds category and over-time bodies", () => {
    const c = categoryBody({ start_date: "a", end_date: "b" }, ["A"], "48453", "TX", 15);
    expect(c.limit).toBe(15);
    expect(c.filters.place_of_performance_locations[0].county).toBe("453");
    const o = overTimeBody([{ start_date: "a", end_date: "b" }], ["A"], "48453", "TX");
    expect(o.group).toBe("fiscal_year");
    expect(o.filters.time_period.length).toBe(1);
  });
  it("lists every award code once", () => {
    const codes = allAwardCodes();
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining(["A", "B", "C", "D", "02", "03", "04", "05", "07", "08", "06", "10"]));
  });
});

// shape per https://api.usaspending.gov/docs/endpoints; unverified in sandbox
const GEO = {
  scope: "place_of_performance",
  geo_layer: "county",
  results: [
    { shape_code: "48453", display_name: "Travis County", aggregated_amount: 1_234_567_890.12, population: 1_300_000, per_capita: 949.67 },
    { shape_code: "48491", display_name: "Williamson County", aggregated_amount: "250000000", population: null, per_capita: null },
    { shape_code: "", display_name: "?", aggregated_amount: 5 },
    { shape_code: "48021", display_name: "Bastrop County", aggregated_amount: null },
  ],
  messages: [],
};

describe("parseGeography", () => {
  it("keeps rows with a shape code and a numeric amount", () => {
    const rows = parseGeography(GEO);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ shapeCode: "48453", name: "Travis County", amount: 1_234_567_890.12, population: 1_300_000, perCapita: 949.67 });
    expect(rows[1]).toMatchObject({ shapeCode: "48491", amount: 250_000_000, population: null });
  });
  it("is empty for garbage", () => {
    expect(parseGeography(null)).toEqual([]);
    expect(parseGeography({ results: "x" })).toEqual([]);
  });
});

describe("parseCategory", () => {
  it("reads name, amount, code and either id", () => {
    const rows = parseCategory({
      category: "recipient",
      results: [
        { name: "UNIVERSITY OF TEXAS AT AUSTIN", amount: 900_000_000, code: null, recipient_id: "abc-123-R" },
        { name: "Department of Defense", amount: "12000000", code: "097", id: 97 },
        { name: "no amount", amount: null },
      ],
    });
    expect(rows).toEqual([
      { name: "UNIVERSITY OF TEXAS AT AUSTIN", amount: 900_000_000, code: null, id: "abc-123-R" },
      { name: "Department of Defense", amount: 12_000_000, code: "097", id: "97" },
    ]);
  });
});

describe("parseOverTime", () => {
  it("sorts by fiscal year and drops incomplete rows", () => {
    const rows = parseOverTime({ group: "fiscal_year", results: [{ time_period: { fiscal_year: "2025" }, aggregated_amount: 10 }, { time_period: { fiscal_year: 2023 }, aggregated_amount: 8 }, { time_period: {}, aggregated_amount: 1 }] });
    expect(rows).toEqual([
      { fy: 2023, amount: 8 },
      { fy: 2025, amount: 10 },
    ]);
  });
});

describe("foldObligations", () => {
  it("sums families per area, zero-fills answered families, and keeps failed families null", () => {
    const m = foldObligations(2025, {
      contracts: [
        { shapeCode: "48453", name: "Travis", amount: 100, population: null, perCapita: null },
        { shapeCode: "48453", name: "Travis", amount: 50, population: null, perCapita: null },
      ],
      grants: [{ shapeCode: "48491", name: "Williamson", amount: 30, population: null, perCapita: null }],
      loans: null,
    });
    expect(m.get("48453")).toEqual({ fy: 2025, byGroup: { contracts: 150, grants: 0, loans: null, direct: null }, total: 150 });
    expect(m.get("48491")).toEqual({ fy: 2025, byGroup: { contracts: 0, grants: 30, loans: null, direct: null }, total: 30 });
    expect(m.size).toBe(2);
  });
  it("is empty when nothing answered", () => {
    expect(foldObligations(2025, {}).size).toBe(0);
  });
});
