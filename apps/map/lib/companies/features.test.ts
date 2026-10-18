import { describe, expect, it } from "vitest";
import { BUNDLE, companiesCsv, companiesInBbox, companiesInCounty, CSV_COLUMNS, findCompany, hqLine, placedCompanies, searchCompanies, toFeature } from "./features";
import type { CompanyBundle, CompanyExtra, CompanyRecord } from "./types";

function rec(over: Partial<CompanyRecord>): CompanyRecord {
  return {
    cik: 1,
    name: "Test Co",
    ticker: "TST",
    exchange: "NYSE",
    sic: "3674",
    sicDescription: "Semiconductors",
    state: "TX",
    city: "Austin",
    zip: "78725",
    countyFips: "48453",
    lon: -97.62,
    lat: 30.22,
    geo: "zcta-centroid",
    fiscalYearEnd: "1231",
    facts: {},
    pulled: "2026-09-01",
    ...over,
  };
}

const BIG = rec({ cik: 10, name: "Big Semis Inc", ticker: "BIG", facts: { Revenues: { value: 5e10, period: "CY2024", end: "2024-12-31" }, NetIncomeLoss: { value: 1e10, period: "CY2024", end: "2024-12-31" } } });
const SMALL = rec({ cik: 11, name: "Small Steel Corp", ticker: "SML", sic: "3312", countyFips: "48453", facts: { Revenues: { value: 1e8, period: "CY2024", end: "2024-12-31" } } });
const ELSEWHERE = rec({ cik: 12, name: "Elsewhere Bank", ticker: "ELS", sic: "6021", state: "NC", city: "Charlotte", zip: "28211", countyFips: "37119", lon: -80.83, lat: 35.17 });
const UNPLACED = rec({ cik: 13, name: "No Address Ltd", ticker: "NOA", state: null, city: null, zip: null, countyFips: null, lon: null, lat: null, geo: null });
const TEST_BUNDLE: CompanyBundle = { source: "test", pulled: "2026-09-01", counts: { companies: 4, geocoded: 3, withFacts: 2 }, companies: [SMALL, BIG, ELSEWHERE, UNPLACED] };

describe("committed fixture", () => {
  it("has 25 real filers with county FIPS, positions and null facts", () => {
    expect(BUNDLE.companies).toHaveLength(25);
    expect(BUNDLE.pulled).toBeNull();
    for (const c of BUNDLE.companies) {
      expect(c.cik).toBeGreaterThan(0);
      expect(c.ticker).toMatch(/^[A-Z.]+$/);
      expect(c.countyFips).toMatch(/^\d{5}$/);
      expect(c.zip).toMatch(/^\d{5}$/);
      expect(c.geo).toBe("city-centroid");
      expect(c.lon).toBeLessThan(-60);
      expect(c.lat).toBeGreaterThan(20);
      expect(c.pulled).toBeNull();
      for (const v of Object.values(c.facts)) expect(v).toBeNull();
    }
    expect(findCompany({ ticker: "aapl" })?.cik).toBe(320193);
    expect(findCompany({ cik: 1045810 })?.ticker).toBe("NVDA");
    expect(findCompany({ ticker: "ZZZZ" })).toBeNull();
    expect(findCompany({})).toBeNull();
  });
  it("places every fixture company", () => {
    expect(placedCompanies()).toHaveLength(25);
  });
});

describe("toFeature", () => {
  it("builds a companies feature with sector kind, details and extra", () => {
    const f = toFeature(BIG)!;
    expect(f.geometry.coordinates).toEqual([-97.62, 30.22, 0]);
    expect(f.properties.layer).toBe("companies");
    expect(f.properties.id).toBe("cik:10");
    expect(f.properties.kind).toBe("information-technology");
    expect(f.properties.details?.ticker).toBe("BIG · NYSE");
    expect(f.properties.details?.revenue).toBe("$50.0B (CY2024)");
    expect(f.properties.details?.HQ).toBe("Austin, TX 78725");
    expect(f.properties.details?.county).toBe("FIPS 48453");
    expect(f.properties.details?.placed).toContain("ZCTA");
    expect(String(f.properties.details?.EDGAR)).toContain("sec.gov");
    const x = f.properties.extra as CompanyExtra;
    expect(x.sector.etfs).toEqual(["XLK", "SMH"]);
    expect(x.cik).toBe(10);
  });
  it("omits facts the snapshot does not have instead of inventing them", () => {
    const f = toFeature(ELSEWHERE)!;
    expect(f.properties.details?.revenue).toBeNull();
    expect(f.properties.details?.["net income"]).toBeNull();
  });
  it("returns null for an unplaced company", () => {
    expect(toFeature(UNPLACED)).toBeNull();
  });
  it("prints a readable HQ line with gaps", () => {
    expect(hqLine({ city: "Austin", state: "TX", zip: null })).toBe("Austin, TX");
    expect(hqLine({ city: null, state: null, zip: null })).toBe("not published");
  });
});

describe("companiesInBbox", () => {
  it("returns companies inside the box, largest revenue first, capped", () => {
    const f = companiesInBbox([-100, 28, -95, 32], 10, TEST_BUNDLE);
    expect(f.map((x) => x.properties.name)).toEqual(["Big Semis Inc", "Small Steel Corp"]);
    expect(companiesInBbox([-100, 28, -95, 32], 1, TEST_BUNDLE)).toHaveLength(1);
    expect(companiesInBbox([0, 0, 1, 1], 10, TEST_BUNDLE)).toEqual([]);
  });
});

describe("companiesInCounty", () => {
  it("filters by county GEOID and by state SS000", () => {
    expect(companiesInCounty("48453", TEST_BUNDLE).map((f) => f.properties.name)).toEqual(["Big Semis Inc", "Small Steel Corp"]);
    expect(companiesInCounty("37119", TEST_BUNDLE)).toHaveLength(1);
    expect(companiesInCounty("48000", TEST_BUNDLE)).toHaveLength(2);
    expect(companiesInCounty("06085", TEST_BUNDLE)).toEqual([]);
  });
  it("finds the fixture's Santa Clara County companies", () => {
    const t = companiesInCounty("06085").map((f) => (f.properties.extra as CompanyExtra).ticker).sort();
    expect(t).toEqual(["AAPL", "HPQ", "NVDA"]);
  });
});

describe("searchCompanies", () => {
  it("ranks exact ticker, then ticker prefix, then name prefix, then contains", () => {
    expect(searchCompanies("sml", 10, TEST_BUNDLE)[0].properties.name).toBe("Small Steel Corp");
    expect(searchCompanies("b", 10, TEST_BUNDLE)[0].properties.name).toBe("Big Semis Inc");
    expect(searchCompanies("steel", 10, TEST_BUNDLE).map((f) => f.properties.name)).toEqual(["Small Steel Corp"]);
    expect(searchCompanies("zzz", 10, TEST_BUNDLE)).toEqual([]);
    expect(searchCompanies("   ", 10, TEST_BUNDLE)).toEqual([]);
    expect(searchCompanies("e", 1, TEST_BUNDLE)).toHaveLength(1);
  });
  it("skips unplaced matches (no feature without a point)", () => {
    expect(searchCompanies("No Address", 10, TEST_BUNDLE)).toEqual([]);
  });
});

describe("companiesCsv", () => {
  it("writes the fixed header and raw values, quoting where needed", () => {
    const csv = companiesCsv(companiesInBbox([-100, 28, -95, 32], 10, TEST_BUNDLE));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    const cells = lines[1].split(",");
    expect(cells[0]).toBe("10");
    expect(cells[1]).toBe("BIG");
    expect(cells[4]).toBe("information-technology");
    expect(cells[5]).toBe("XLK SMH");
    expect(cells[16]).toBe("50000000000");
    expect(cells[17]).toBe("CY2024");
    const quoted = companiesCsv([toFeature(rec({ name: 'Comma, "Quote" Inc' }))!]);
    expect(quoted).toContain('"Comma, ""Quote"" Inc"');
  });
});
