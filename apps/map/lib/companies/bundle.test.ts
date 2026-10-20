// The compact on-disk companies format against the in-memory CompanyBundle it
// stands for. The encoder is scripts/companies-compact.mjs (what
// scripts/companies-data.mjs writes with); the decoder under test is the one
// the app imports, lib/companies/bundle.ts.
import { describe, expect, it } from "vitest";
import { COMPACT_FORMAT, decodeBundle } from "./bundle";
import { BUNDLE } from "./features";
import type { CompanyBundle, CompanyRecord, ConceptKey } from "./types";
import { encodeBundle } from "@/scripts/companies-compact.mjs";
import fixtureJson from "./fixtures/companies.fixture.json";

const KEYS: ConceptKey[] = ["Revenues", "NetIncomeLoss", "OperatingIncomeLoss", "Assets", "StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "LongTermDebt", "EntityNumberOfEmployees"];
const nullFacts = () => Object.fromEntries(KEYS.map((k) => [k, null])) as CompanyRecord["facts"];

/** Apple as the 2026-10-20 pull has it (facts trimmed to two). */
const APPLE: CompanyRecord = {
  cik: 320193,
  name: "Apple Inc.",
  ticker: "AAPL",
  exchange: "Nasdaq",
  sic: "3571",
  sicDescription: "Electronic Computers",
  state: "CA",
  city: "CUPERTINO",
  zip: "95014",
  countyFips: "06085",
  lon: -122.0798,
  lat: 37.3083,
  geo: "zcta-centroid",
  fiscalYearEnd: "0926",
  stateOfIncorporation: "CA",
  facts: {
    ...nullFacts(),
    Revenues: { value: 416161000000, period: "CY2025", end: "2025-09-27", accn: "0000320193-25-000079", concept: "RevenueFromContractWithCustomerExcludingAssessedTax" },
    Assets: { value: 379297000000, period: "CY2025Q4I", end: "2025-12-27", accn: "0000320193-26-000006", concept: "Assets" },
  },
  pulled: "2026-10-20",
};
const NO_FACTS: CompanyRecord = { ...APPLE, cik: 13, name: "No Facts Corp", ticker: "NOF", lon: null, lat: null, geo: null, countyFips: null, facts: nullFacts() };
const FULL: CompanyBundle = { source: "test", pulled: "2026-10-20", counts: { companies: 2, geocoded: 1, withFacts: 1 }, frameYears: [2025, 2024], companies: [APPLE, NO_FACTS] };

describe("compact companies format", () => {
  it("round-trips a bundle exactly", () => {
    const compact = encodeBundle(FULL);
    expect(compact.format).toBe(COMPACT_FORMAT);
    expect(decodeBundle(JSON.parse(JSON.stringify(compact)))).toEqual(FULL);
  });

  it("keeps every fact's citation: value, period, end date, accession number and XBRL concept", () => {
    const back = decodeBundle(JSON.parse(JSON.stringify(encodeBundle(FULL))));
    expect(back.companies[0].facts.Revenues).toEqual({ value: 416161000000, period: "CY2025", end: "2025-09-27", accn: "0000320193-25-000079", concept: "RevenueFromContractWithCustomerExcludingAssessedTax" });
    expect(back.companies[0].facts.Assets?.accn).toBe("0000320193-26-000006");
    expect(back.companies[0].facts.Assets?.concept).toBe("Assets");
  });

  it("writes a company with no facts as no tuples and reads it back as eight nulls", () => {
    const compact = encodeBundle(FULL);
    expect(compact.companies[1].at(-1)).toEqual([]);
    const back = decodeBundle(JSON.parse(JSON.stringify(compact))).companies[1];
    expect(Object.keys(back.facts)).toEqual(KEYS);
    for (const v of Object.values(back.facts)) expect(v).toBeNull();
  });

  it("keeps a company pulled on another day instead of folding it into the bundle's date", () => {
    const mixed = { ...FULL, companies: [APPLE, { ...NO_FACTS, pulled: "2026-10-19" }] };
    const back = decodeBundle(JSON.parse(JSON.stringify(encodeBundle(mixed))));
    expect(back.companies.map((c) => c.pulled)).toEqual(["2026-10-20", "2026-10-19"]);
  });

  it("refuses to encode what it would lose, and to decode a format it does not know", () => {
    expect(() => encodeBundle({ ...FULL, companies: [{ ...APPLE, extra: 1 }] })).toThrow(/no place/);
    expect(() => encodeBundle({ ...FULL, companies: [{ ...APPLE, facts: { ...APPLE.facts, Assets: { ...APPLE.facts.Assets, form: "10-K" } } }] })).toThrow(/no place/);
    expect(() => decodeBundle({ format: "companies/9" })).toThrow(/unknown format/);
  });

  it("passes the older full format through, as the 25-company fixture is written", () => {
    const fixture = decodeBundle(fixtureJson);
    expect(fixture.companies).toHaveLength(25);
    expect(fixture.pulled).toBeNull();
    expect(fixture).toBe(fixtureJson);
  });
});

describe("committed snapshot", () => {
  it("is the dated EDGAR pull, not the fixture, so the layer never marks it missing", () => {
    expect(BUNDLE.pulled).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(BUNDLE.companies.length).toBe(BUNDLE.counts.companies);
    expect(BUNDLE.companies.length).toBeGreaterThan(25);
    expect(BUNDLE.companies.filter((c) => c.lon != null).length).toBe(BUNDLE.counts.geocoded);
    expect(BUNDLE.companies.filter((c) => Object.values(c.facts).some((v) => v)).length).toBe(BUNDLE.counts.withFacts);
  });

  it("decodes every company to the in-memory shape, every fact cited", () => {
    for (const c of BUNDLE.companies) {
      expect(c.pulled).toBe(BUNDLE.pulled);
      expect(Object.keys(c.facts)).toEqual(KEYS);
      for (const f of Object.values(c.facts)) {
        if (f == null) continue;
        expect(Number.isFinite(f.value)).toBe(true);
        expect(f.period).toMatch(/^CY\d{4}(Q4I)?$/);
        expect(f.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(f.accn).toMatch(/^\d{10}-\d{2}-\d{6}$/);
        expect(f.concept).toBeTruthy();
      }
    }
  });
});
