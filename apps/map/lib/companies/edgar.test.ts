import { describe, expect, it } from "vitest";
import { cikId, companyFactsUrl, DOSSIER_FORMS, edgarCompanyUrl, factPoints, filingUrl, frameUrl, isOperatingIssuer, padCik, parseFilings, parseFrame, parseProfile, parseTickers, parseTickersExchange, submissionsUrl } from "./edgar";
import type { CompanyFactsFile, FrameFile, SubmissionsFile, TickersExchangeFile, TickersFile } from "./types";

// shape per https://www.sec.gov/search-filings/edgar-application-programming-interfaces; unverified in sandbox
const TICKERS: TickersFile = {
  "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  "1": { cik_str: 789019, ticker: "msft", title: "MICROSOFT CORP" },
  "2": { cik_str: 0, ticker: "BAD", title: "no cik" },
};

const TICKERS_EXCHANGE: TickersExchangeFile = {
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [73309, "NUCOR CORP", "NUE", "NYSE"],
    [1234, "No ticker", "", "NYSE"],
    [5678, "No exchange", "NOEX", null],
  ],
};

export const SUBMISSIONS: SubmissionsFile = {
  cik: "73309",
  name: "NUCOR CORP",
  sic: "3312",
  sicDescription: "Steel Works, Blast Furnaces & Rolling Mills (Coke Ovens)",
  tickers: ["NUE"],
  exchanges: ["NYSE"],
  stateOfIncorporation: "DE",
  fiscalYearEnd: "1231",
  entityType: "operating",
  addresses: {
    business: { street1: "1915 REXFORD ROAD", city: "CHARLOTTE", stateOrCountry: "NC", zipCode: "28211" },
    mailing: { street1: "PO BOX 1", city: "CHARLOTTE", stateOrCountry: "NC", zipCode: "28211" },
  },
  filings: {
    recent: {
      accessionNumber: ["0000073309-25-000010", "0000073309-25-000009", "0000073309-25-000008", "0000073309-25-000007", "0000073309-24-000050"],
      form: ["4", "8-K", "10-Q", "SC 13G/A", "10-K"],
      filingDate: ["2025-05-02", "2025-04-29", "2025-04-30", "2025-02-10", "2025-02-27"],
      reportDate: ["2025-04-30", "2025-04-28", "2025-03-29", "", "2024-12-31"],
      primaryDocument: ["xslF345X05/wk-form4.xml", "nue-20250428.htm", "nue-20250329.htm", "sc13ga.htm", "nue-20241231.htm"],
      primaryDocDescription: ["FORM 4", "8-K", "10-Q", "SC 13G/A", "10-K"],
    },
  },
};

describe("padCik / urls", () => {
  it("pads to ten digits and builds EDGAR urls", () => {
    expect(padCik(73309)).toBe("0000073309");
    expect(padCik("0000320193")).toBe("0000320193");
    expect(cikId(320193)).toBe("CIK0000320193");
    expect(submissionsUrl(73309)).toBe("https://data.sec.gov/submissions/CIK0000073309.json");
    expect(companyFactsUrl("73309")).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000073309.json");
    expect(frameUrl("us-gaap", "Assets", "USD", "CY2024Q4I")).toBe("https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2024Q4I.json");
    expect(filingUrl(73309, "0000073309-24-000050", "nue-20241231.htm")).toBe("https://www.sec.gov/Archives/edgar/data/73309/000007330924000050/nue-20241231.htm");
    expect(edgarCompanyUrl(73309)).toContain("CIK=0000073309");
  });
});

describe("parseTickers", () => {
  it("upper-cases tickers and drops rows without a CIK", () => {
    const l = parseTickers(TICKERS);
    expect(l).toHaveLength(2);
    expect(l[1]).toEqual({ cik: 789019, name: "MICROSOFT CORP", ticker: "MSFT", exchange: null });
  });
  it("tolerates an empty object", () => {
    expect(parseTickers({} as TickersFile)).toEqual([]);
  });
});

describe("parseTickersExchange", () => {
  it("reads columns by name and keeps exchange when present", () => {
    const l = parseTickersExchange(TICKERS_EXCHANGE);
    expect(l).toHaveLength(3);
    expect(l[1]).toEqual({ cik: 73309, name: "NUCOR CORP", ticker: "NUE", exchange: "NYSE" });
    expect(l[2].exchange).toBeNull();
  });
  it("copes with a reordered header", () => {
    const l = parseTickersExchange({ fields: ["ticker", "exchange", "cik", "name"], data: [["NUE", "NYSE", 73309, "NUCOR CORP"]] });
    expect(l[0]).toEqual({ cik: 73309, name: "NUCOR CORP", ticker: "NUE", exchange: "NYSE" });
  });
  it("throws when the key columns are missing", () => {
    expect(() => parseTickersExchange({ fields: ["name"], data: [] })).toThrow(/cik\/ticker/);
  });
});

describe("parseProfile", () => {
  it("reads the business address only, never the mailing one", () => {
    const p = parseProfile(SUBMISSIONS);
    expect(p.cik).toBe(73309);
    expect(p.business).toEqual({ street1: "1915 REXFORD ROAD", city: "CHARLOTTE", state: "NC", zip: "28211" });
    expect(JSON.stringify(p)).not.toContain("PO BOX");
    expect(p.sic).toBe("3312");
    expect(p.fiscalYearEnd).toBe("1231");
    expect(p.recentFilings).toBe(5);
    expect(p.edgarUrl).toContain("0000073309");
  });
  it("leaves unknown fields null instead of inventing them", () => {
    const p = parseProfile({ cik: 1, name: "X" });
    expect(p.sic).toBeNull();
    expect(p.business).toBeNull();
    expect(p.tickers).toEqual([]);
  });
});

describe("isOperatingIssuer", () => {
  it("admits an operating company with an SIC code", () => {
    expect(isOperatingIssuer(SUBMISSIONS)).toBe(true);
  });
  it("refuses an individual filer (entityType other, no SIC)", () => {
    expect(isOperatingIssuer({ cik: 1234567, name: "DOE JANE Q", entityType: "other", sic: "" })).toBe(false);
  });
  it("refuses an operating entity without an SIC code, and a missing entityType", () => {
    expect(isOperatingIssuer({ ...SUBMISSIONS, sic: "  " })).toBe(false);
    expect(isOperatingIssuer({ cik: 1, name: "X", sic: "3312" })).toBe(false);
  });
});

describe("parseFilings", () => {
  it("keeps periodic and current reports, drops ownership forms and 13G, newest first", () => {
    const f = parseFilings(SUBMISSIONS);
    expect(f.map((x) => x.form)).toEqual(["10-Q", "8-K", "10-K"]);
    expect(f.some((x) => x.form === "4")).toBe(false);
    expect(f[2].url).toBe("https://www.sec.gov/Archives/edgar/data/73309/000007330924000050/nue-20241231.htm");
    expect(f[2].reportDate).toBe("2024-12-31");
  });
  it("respects the limit", () => {
    expect(parseFilings(SUBMISSIONS, 1)).toHaveLength(1);
  });
  it("returns [] without a recent window", () => {
    expect(parseFilings({ cik: 1, name: "X" })).toEqual([]);
  });
  it("never lists Forms 3, 4 or 5", () => {
    for (const f of ["3", "4", "5", "3/A", "4/A", "5/A"]) expect(DOSSIER_FORMS.has(f)).toBe(false);
  });
});

describe("factPoints", () => {
  const facts: CompanyFactsFile = {
    cik: 73309,
    entityName: "NUCOR CORP",
    facts: {
      "us-gaap": {
        Assets: { units: { USD: [{ end: "2024-12-31", val: 33940000000, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-27", frame: "CY2024Q4I" }, { end: "2024-12-31", val: NaN }] } },
      },
    },
  };
  it("returns the unit's points and drops non-numeric ones", () => {
    expect(factPoints(facts, "us-gaap", "Assets", "USD")).toHaveLength(1);
    expect(factPoints(facts, "us-gaap", "Assets", "EUR")).toEqual([]);
    expect(factPoints(facts, "dei", "EntityNumberOfEmployees", "pure")).toEqual([]);
  });
});

describe("parseFrame", () => {
  it("keys rows by CIK", () => {
    const j: FrameFile = {
      taxonomy: "us-gaap",
      tag: "Revenues",
      ccp: "CY2024",
      uom: "USD",
      data: [
        { accn: "0000073309-25-000009", cik: 73309, entityName: "NUCOR CORP", loc: "US-NC", start: "2024-01-01", end: "2024-12-31", val: 30734000000 },
        { accn: "x", cik: 1, entityName: "bad", end: "2024-12-31", val: Number.NaN },
      ],
    };
    const m = parseFrame(j);
    expect(m.size).toBe(1);
    expect(m.get(73309)?.val).toBe(30734000000);
    expect(m.get(73309)?.end).toBe("2024-12-31");
  });
});
