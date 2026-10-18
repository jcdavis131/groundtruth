import { describe, expect, it } from "vitest";
import { annualSeries, CONCEPTS, derivedRatios, factSeries, fmtMoney, isAnnual, latestFacts, pickLatestAnnual, seriesForSpec } from "./facts";
import type { CompanyFactsFile, FactPoint } from "./types";

// shape per https://www.sec.gov/search-filings/edgar-application-programming-interfaces; unverified in sandbox
const REV: FactPoint[] = [
  // FY2023 as originally filed, then restated in the FY2024 10-K (later filed wins)
  { start: "2023-01-01", end: "2023-12-31", val: 34700000000, accn: "a-24", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-28", frame: "CY2023" },
  { start: "2023-01-01", end: "2023-12-31", val: 34714000000, accn: "a-25", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27" },
  // FY2024
  { start: "2024-01-01", end: "2024-12-31", val: 30734000000, accn: "a-25", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27", frame: "CY2024" },
  // a quarter reported inside the 10-K must not be mistaken for a year
  { start: "2024-10-01", end: "2024-12-31", val: 7000000000, accn: "a-25", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27" },
  // quarterly report
  { start: "2025-01-01", end: "2025-03-29", val: 7830000000, accn: "q-25", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-04-30", frame: "CY2025Q1" },
];

const ASSETS: FactPoint[] = [
  { end: "2023-12-31", val: 33940000000, accn: "a-24", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-28", frame: "CY2023Q4I" },
  { end: "2024-12-31", val: 33900000000, accn: "a-25", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27", frame: "CY2024Q4I" },
  { end: "2025-03-29", val: 34100000000, accn: "q-25", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-04-30", frame: "CY2025Q1I" },
];

const FACTS: CompanyFactsFile = {
  cik: 73309,
  entityName: "NUCOR CORP",
  facts: {
    "us-gaap": {
      Revenues: { units: { USD: REV } },
      NetIncomeLoss: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 2027000000, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27", frame: "CY2024" }] } },
      Assets: { units: { USD: ASSETS } },
      StockholdersEquity: { units: { USD: [{ end: "2024-12-31", val: 20000000000, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27", frame: "CY2024Q4I" }] } },
      LongTermDebt: { units: { USD: [{ end: "2024-12-31", val: 6700000000, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27", frame: "CY2024Q4I" }] } },
    },
    dei: {},
  },
};

describe("isAnnual", () => {
  it("accepts a full-year 10-K flow and rejects quarters, 10-Qs and short spans", () => {
    expect(isAnnual(REV[2], false)).toBe(true);
    expect(isAnnual(REV[3], false)).toBe(false);
    expect(isAnnual(REV[4], false)).toBe(false);
    expect(isAnnual({ end: "2024-12-31", val: 1, fp: "FY", form: "10-K" }, false)).toBe(false);
  });
  it("accepts a 10-K instant regardless of span", () => {
    expect(isAnnual(ASSETS[1], true)).toBe(true);
    expect(isAnnual(ASSETS[2], true)).toBe(false);
  });
});

describe("annualSeries / pickLatestAnnual", () => {
  it("dedupes restatements by latest filed and orders oldest first", () => {
    const s = annualSeries(REV, false, "Revenues");
    expect(s.map((v) => v.end)).toEqual(["2023-12-31", "2024-12-31"]);
    expect(s[0].value).toBe(34714000000);
    expect(s[0].period).toBe("FY2024");
    expect(s[1].period).toBe("CY2024");
    expect(s[1].concept).toBe("Revenues");
  });
  it("picks the newest annual value", () => {
    const v = pickLatestAnnual(REV, false);
    expect(v?.value).toBe(30734000000);
    expect(v?.end).toBe("2024-12-31");
    expect(pickLatestAnnual([], false)).toBeNull();
  });
});

describe("seriesForSpec / latestFacts", () => {
  it("falls back to the concept with the newest annual value", () => {
    const j: CompanyFactsFile = {
      cik: 1,
      entityName: "X",
      facts: {
        "us-gaap": {
          Revenues: { units: { USD: [{ start: "2020-01-01", end: "2020-12-31", val: 5, fy: 2020, fp: "FY", form: "10-K", filed: "2021-02-01" }] } },
          RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 9, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" }] } },
        },
      },
    };
    const s = seriesForSpec(j, CONCEPTS[0]);
    expect(s?.concept).toBe("RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(s?.series[0].value).toBe(9);
  });
  it("returns null for concepts the filer never tagged", () => {
    const f = latestFacts(FACTS);
    expect(f.Revenues?.value).toBe(30734000000);
    expect(f.Assets?.period).toBe("CY2024Q4I");
    expect(f.EntityNumberOfEmployees).toBeNull();
    expect(f.CashAndCashEquivalentsAtCarryingValue).toBeNull();
  });
});

describe("factSeries", () => {
  it("emits lib/series Series with published provenance and CIK:Concept seriesId", () => {
    const s = factSeries(FACTS, { retrievedAt: "2026-09-11T00:00:00Z" });
    const rev = s.find((x) => x.id === "edgar:CIK0000073309:Revenues")!;
    expect(rev.frequency).toBe("annual");
    expect(rev.unit).toBe("USD");
    expect(rev.points.map((p) => p.v)).toEqual([34714000000, 30734000000]);
    expect(rev.points[0].t).toBe(Date.parse("2023-12-31"));
    expect(rev.provenance.kind).toBe("published");
    expect(rev.provenance.seriesId).toBe("CIK0000073309:Revenues");
    expect(rev.provenance.period).toBe("CY2024");
    expect(rev.provenance.releasedAt).toBe("2025-02-27");
    expect(rev.provenance.retrievedAt).toBe("2026-09-11T00:00:00Z");
    expect(s.some((x) => x.id.endsWith(":EntityNumberOfEmployees"))).toBe(false);
  });
});

describe("derivedRatios", () => {
  it("computes margins, ROE and D/E from same-year facts with formulas", () => {
    const r = derivedRatios(latestFacts(FACTS));
    const byKey = Object.fromEntries(r.map((x) => [x.key, x]));
    expect(byKey.netMargin.value).toBeCloseTo(6.6, 1);
    expect(byKey.netMargin.formula).toContain("NetIncomeLoss / Revenues");
    expect(byKey.returnOnEquity.value).toBeCloseTo(10.1, 1);
    expect(byKey.debtToEquity.value).toBeCloseTo(0.34, 2);
    expect(byKey.operatingMargin).toBeUndefined();
  });
  it("refuses mismatched years and non-positive denominators", () => {
    expect(derivedRatios({ Revenues: { value: 10, period: "CY2023", end: "2023-12-31" }, NetIncomeLoss: { value: 1, period: "CY2024", end: "2024-12-31" } })).toEqual([]);
    expect(derivedRatios({ NetIncomeLoss: { value: 1, period: "CY2024", end: "2024-12-31" }, StockholdersEquity: { value: -5, period: "CY2024Q4I", end: "2024-12-31" } })).toEqual([]);
    expect(derivedRatios({})).toEqual([]);
  });
});

describe("fmtMoney", () => {
  it("formats compact dollars and keeps signs", () => {
    expect(fmtMoney(391035000000)).toBe("$391.0B");
    expect(fmtMoney(1.5e12)).toBe("$1.50T");
    expect(fmtMoney(-2500000)).toBe("-$2.5M");
    expect(fmtMoney(1500)).toBe("$2K");
    expect(fmtMoney(null)).toBe("n/a");
  });
});
