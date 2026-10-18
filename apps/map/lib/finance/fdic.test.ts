import { describe, expect, it } from "vitest";
import {
  cell,
  chunkCounties,
  COUNTIES_PER_CALL,
  countyDeposits,
  countyFilter,
  fdicDate,
  FDIC_BASE,
  fdicUrl,
  financialsSeries,
  msaCode,
  parseBranch,
  parseFailure,
  parseFinancialsRow,
  parseInstitution,
  parseSodRow,
  SOD_FIELDS,
  sodYears,
  unwrapFdic,
} from "./fdic";

// shape per https://api.fdic.gov/banks/docs/
const INSTITUTIONS = {
  meta: { total: 1, parameters: { filters: "STALP:TX AND ACTIVE:1" } },
  data: [
    {
      data: {
        CERT: 3511,
        NAME: "Wells Fargo Bank, National Association",
        CITY: "Sioux Falls",
        STALP: "SD",
        ZIP: "57104",
        ASSET: 1_712_000_000,
        DEP: 1_401_500_000,
        NETINC: 4_950_000,
        ROA: 1.16,
        ROE: 11.9,
        OFFICES: 4302,
        STMULT: 1,
        BKCLASS: "N",
        ACTIVE: 1,
        REPDTE: "2026-03-31",
        LATITUDE: 43.5461,
        LONGITUDE: -96.7313,
        COUNTY: "Minnehaha",
      },
      score: 0,
    },
  ],
};

const LOCATIONS = {
  meta: { total: 3 },
  data: [
    { data: { CERT: 3511, NAME: "WELLS FARGO BANK, NATIONAL ASSOCIATION", OFFNAME: "CONGRESS AVENUE BRANCH", OFFNUM: 1234, UNINUM: 200456, ADDRESS: "111 Congress Ave", CITY: "AUSTIN", STALP: "TX", ZIP: "78701", STCNTYBR: 48453, LATITUDE: 30.2652, LONGITUDE: -97.7431, SERVTYPE: 11, ESTYMD: "01/15/1998" } },
    { data: { CERT: 9999, NAME: "FROST BANK", OFFNAME: "FROST BANK", OFFNUM: 0, UNINUM: 100001, ADDRESS: "111 W Houston St", CITY: "SAN ANTONIO", STALP: "TX", ZIP: "78205", STCNTYBR: "1073", LATITUDE: "29.4265", LONGITUDE: "-98.4917", SERVTYPE: "11", ESTYMD: "1868-01-01" } },
    { data: { CERT: 42, NAME: "NO COORDS BANK", OFFNAME: "MAIN", OFFNUM: 0, UNINUM: null, ADDRESS: null, CITY: "X", STALP: "TX", ZIP: "1", STCNTYBR: null, LATITUDE: null, LONGITUDE: null, SERVTYPE: null, ESTYMD: null } },
  ],
};

const SOD = {
  meta: { total: 3 },
  data: [
    { data: { CERT: 3511, NAMEFULL: "Wells Fargo Bank, National Association", BRNUM: 1234, UNINUMBR: 200456, DEPSUMBR: "812345", ASSET: 1_712_000_000, STCNTYBR: 48453, CNTYNAMB: "Travis", STALPBR: "TX", YEAR: 2025, SIMS_LATITUDE: 30.2652, SIMS_LONGITUDE: -97.7431 } },
    { data: { CERT: 3511, NAMEFULL: "Wells Fargo Bank, National Association", BRNUM: 1235, UNINUMBR: 200457, DEPSUMBR: 187655, ASSET: 1_712_000_000, STCNTYBR: 48453, CNTYNAMB: "Travis", STALPBR: "TX", YEAR: 2025, SIMS_LATITUDE: 30.3, SIMS_LONGITUDE: -97.7 } },
    { data: { CERT: 9999, NAMEFULL: "Frost Bank", BRNUM: 7, UNINUMBR: 100007, DEPSUMBR: 500000, ASSET: 50_000_000, STCNTYBR: 48453, CNTYNAMB: "Travis", STALPBR: "TX", YEAR: "2025", SIMS_LATITUDE: null, SIMS_LONGITUDE: null } },
  ],
};

const FINANCIALS = {
  meta: { total: 3 },
  data: [
    { data: { REPDTE: "20260331", ASSET: 1_712_000_000, DEP: 1_401_500_000, NETINC: 4_950_000, LNLSNET: 900_000_000, NCLNLS: 8_100_000, NPTLA: 0.9, ROA: 1.16, ROE: 11.9, EQ: 165_000_000 } },
    { data: { REPDTE: "20251231", ASSET: 1_700_000_000, DEP: 1_390_000_000, NETINC: 19_800_000, LNLSNET: 895_000_000, NCLNLS: 8_500_000, NPTLA: 0.95, ROA: 1.12, ROE: 11.5, EQ: 162_000_000 } },
    { data: { REPDTE: "20250930", ASSET: 1_690_000_000, DEP: null, NETINC: 14_500_000, LNLSNET: 890_000_000, NCLNLS: null, NPTLA: null, ROA: 1.1, ROE: 11.2, EQ: 160_000_000 } },
  ],
};

const FAILURES = {
  meta: { total: 2 },
  data: [
    { data: { NAME: "First Republic Bank", CITYST: "San Francisco, CA", FAILDATE: "05/01/2023", QBFASSET: 229_100_000, QBFDEP: 103_900_000, COST: 15_600_000, RESTYPE: "PA" } },
    { data: { NAME: "Silicon Valley Bank", CITYST: "Santa Clara, CA", FAILDATE: "03/10/2023", QBFASSET: 209_000_000, QBFDEP: 175_400_000, COST: 16_100_000, RESTYPE: "PA" } },
    { data: { NAME: "", CITYST: "", FAILDATE: "bad", QBFASSET: 1 } },
  ],
};

describe("unwrapFdic", () => {
  it("returns rows and the upstream total", () => {
    const { total, rows } = unwrapFdic<{ CERT: number }>(INSTITUTIONS);
    expect(total).toBe(1);
    expect(rows[0].CERT).toBe(3511);
  });
  it("is empty for garbage and falls back to the row count for total", () => {
    expect(unwrapFdic(null)).toEqual({ total: 0, rows: [] });
    expect(unwrapFdic({ data: "nope" })).toEqual({ total: 0, rows: [] });
    expect(unwrapFdic({ data: [{ data: { A: 1 } }, { nodata: 1 }] })).toEqual({ total: 1, rows: [{ A: 1 }] });
  });
});

describe("cell and fdicDate", () => {
  it("reads numbers, numeric strings with commas, and null for blanks", () => {
    expect(cell(5)).toBe(5);
    expect(cell("1,234")).toBe(1234);
    expect(cell("")).toBeNull();
    expect(cell(null)).toBeNull();
    expect(cell("n/a")).toBeNull();
    expect(cell(true)).toBe(1);
  });
  it("normalises the three date spellings FDIC uses", () => {
    expect(fdicDate("2026-03-31")).toBe("2026-03-31");
    expect(fdicDate("2026-03-31T00:00:00")).toBe("2026-03-31");
    expect(fdicDate("20260331")).toBe("2026-03-31");
    expect(fdicDate("3/1/2026")).toBe("2026-03-01");
    expect(fdicDate("")).toBeNull();
    expect(fdicDate("yesterday")).toBeNull();
  });
});

describe("parsers", () => {
  it("parses an institution", () => {
    const i = parseInstitution(unwrapFdic<Record<string, string | number>>(INSTITUTIONS).rows[0])!;
    expect(i).toMatchObject({ cert: 3511, state: "SD", zip: "57104", assets: 1_712_000_000, roa: 1.16, offices: 4302, multiState: true, bkClass: "N", active: true, reportDate: "2026-03-31", county: "Minnehaha", lat: 43.5461 });
    expect(parseInstitution({ NAME: "no cert" })).toBeNull();
  });
  it("parses offices, pads a numeric county FIPS, and drops rows without a county", () => {
    const rows = unwrapFdic<Record<string, string | number | null>>(LOCATIONS).rows.map(parseBranch);
    expect(rows[0]).toMatchObject({ cert: 3511, officeNum: 1234, uninum: 200456, office: "CONGRESS AVENUE BRANCH", fips: "48453", serviceType: "11", established: "1998-01-15", lat: 30.2652, lon: -97.7431 });
    expect(rows[1]).toMatchObject({ fips: "01073", lat: 29.4265, established: "1868-01-01", officeNum: 0 });
    expect(rows[2]).toBeNull();
  });
  it("parses Summary of Deposits rows with string numbers", () => {
    const rows = unwrapFdic<Record<string, string | number | null>>(SOD).rows.map(parseSodRow);
    expect(rows[0]).toMatchObject({ cert: 3511, brnum: 1234, uninum: 200456, deposits: 812345, fips: "48453", county: "Travis", state: "TX", year: 2025 });
    expect(rows[2]).toMatchObject({ year: 2025, lat: null });
    expect(parseSodRow({ CERT: 1 })).toBeNull();
  });
  it("parses financials and keeps withheld cells null", () => {
    const rows = unwrapFdic<Record<string, string | number | null>>(FINANCIALS).rows.map(parseFinancialsRow);
    expect(rows[0]).toMatchObject({ reportDate: "2026-03-31", roa: 1.16, noncurrentPct: 0.9, equity: 165_000_000 });
    expect(rows[2]).toMatchObject({ reportDate: "2025-09-30", deposits: null, noncurrentLoans: null, noncurrentPct: null });
    expect(parseFinancialsRow({ REPDTE: "" })).toBeNull();
  });
  it("parses failures and drops rows without a name or date", () => {
    const rows = unwrapFdic<Record<string, string | number>>(FAILURES).rows.map(parseFailure);
    expect(rows[0]).toMatchObject({ name: "First Republic Bank", failDate: "2023-05-01", assets: 229_100_000, cost: 15_600_000, resolution: "PA" });
    expect(rows[2]).toBeNull();
  });
});

describe("query helpers", () => {
  it("builds a single or OR-ed county filter, de-duplicated and sorted", () => {
    expect(countyFilter(["48453"])).toBe("STCNTYBR:48453");
    expect(countyFilter(["48491", "48453", "48453"])).toBe("STCNTYBR:(48453 OR 48491)");
    expect(() => countyFilter([])).toThrow();
    expect(() => countyFilter(["bad"])).toThrow();
  });
  it("chunks counties at 25 per call", () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(48001 + i * 2));
    const groups = chunkCounties([...ids, ids[0], "junk"]);
    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(COUNTIES_PER_CALL);
    expect(groups[1].length).toBe(5);
    expect(groups.flat()).toEqual([...ids].sort());
  });
  it("builds a BankFind URL with json and the page cap by default", () => {
    const u = new URL(fdicUrl("sod", { filters: "STCNTYBR:48453 AND YEAR:2025", fields: "CERT" }));
    expect(u.origin + u.pathname).toBe("https://api.fdic.gov/banks/sod");
    expect(u.searchParams.get("filters")).toBe("STCNTYBR:48453 AND YEAR:2025");
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.get("limit")).toBe("10000");
    expect(new URL(fdicUrl("institutions", { limit: 1 })).searchParams.get("limit")).toBe("1");
  });
  it("tries the current SOD year then the two before", () => {
    expect(sodYears(new Date("2026-09-11T00:00:00Z"))).toEqual([2026, 2025, 2024]);
    expect(sodYears(new Date("2026-01-02T00:00:00Z"), 1)).toEqual([2026, 2025]);
  });
});

// Real /sod responses, copied verbatim from https://api.fdic.gov/banks/sod (2026-10-01) with
// fields=SOD_FIELDS, YEAR:2025, the largest office by deposits in Travis County TX (48453, Austin MSA)
// and in Wilbarger County TX (48487, micropolitan Vernon, outside any MSA).
const SOD_LIVE_TRAVIS = {"meta":{"total":233,"parameters":{"filters":"STCNTYBR:48453 AND YEAR:2025","fields":"CERT,NAMEFULL,BRNUM,UNINUMBR,DEPSUMBR,ASSET,STCNTYBR,CNTYNAMB,STALPBR,YEAR,SIMS_LATITUDE,SIMS_LONGITUDE,MSABR,MSANAMB","limit":"1"},"index":{"name":"sod_1789738734553","createTimestamp":"2026-09-18T13:38:54Z"}},"data":[{"data":{"STALPBR":"TX","MSABR":12420,"UNINUMBR":290600,"ASSET":31631701,"CNTYNAMB":"Travis","SIMS_LONGITUDE":-97.7427049808869,"YEAR":2025,"STCNTYBR":48453,"DEPSUMBR":10226484,"MSANAMB":"Austin-Round Rock-San Marcos, TX","NAMEFULL":"Texas Capital Bank","CERT":34383,"SIMS_LATITUDE":30.262331008102,"BRNUM":7,"ID":"2025_34383_7"},"score":0}],"totals":{"count":233}};
const SOD_LIVE_WILBARGER = {"meta":{"total":6,"parameters":{"filters":"STCNTYBR:48487 AND YEAR:2025","fields":"CERT,NAMEFULL,BRNUM,UNINUMBR,DEPSUMBR,ASSET,STCNTYBR,CNTYNAMB,STALPBR,YEAR,SIMS_LATITUDE,SIMS_LONGITUDE,MSABR,MSANAMB","limit":"1"},"index":{"name":"sod_1789738734553","createTimestamp":"2026-09-18T13:38:54Z"}},"data":[{"data":{"STALPBR":"TX","MSABR":0,"UNINUMBR":3789,"ASSET":328967,"CNTYNAMB":"Wilbarger","SIMS_LONGITUDE":-99.285249001945,"YEAR":2025,"STCNTYBR":48487,"DEPSUMBR":256396,"MSANAMB":"","NAMEFULL":"The Waggoner National Bank of Vernon","CERT":5569,"SIMS_LATITUDE":34.1549189873761,"BRNUM":0,"ID":"2025_5569_0"},"score":0}],"totals":{"count":6}};

describe("BankFind base and SOD metro fields", () => {
  it("requests the current host; the old one answers 301 to it", () => {
    expect(FDIC_BASE).toBe("https://api.fdic.gov/banks");
    expect(fdicUrl("sod", {}).startsWith("https://api.fdic.gov/banks/sod?")).toBe(true);
  });
  it("asks SOD for the office's MSA code and title", () => {
    const fields = SOD_FIELDS.split(",");
    expect(fields).toContain("MSABR");
    expect(fields).toContain("MSANAMB");
  });
  it("a live Travis County office carries its CBSA", () => {
    const [row] = unwrapFdic<Record<string, string | number | null>>(SOD_LIVE_TRAVIS).rows.map(parseSodRow);
    expect(row).toEqual({
      cert: 34383,
      name: "Texas Capital Bank",
      brnum: 7,
      uninum: 290600,
      deposits: 10226484,
      assets: 31631701,
      fips: "48453",
      county: "Travis",
      state: "TX",
      year: 2025,
      lat: 30.262331008102,
      lon: -97.7427049808869,
      cbsa: "12420",
      cbsaName: "Austin-Round Rock-San Marcos, TX",
    });
  });
  it("an office outside any MSA (MSABR 0) has a null CBSA, never 00000", () => {
    const [row] = unwrapFdic<Record<string, string | number | null>>(SOD_LIVE_WILBARGER).rows.map(parseSodRow);
    expect(row).toMatchObject({ cert: 5569, fips: "48487", county: "Wilbarger", cbsa: null, cbsaName: null });
  });
  it("msaCode pads short codes and rejects blanks, zero and junk", () => {
    expect(msaCode(12420)).toBe("12420");
    expect(msaCode("12420")).toBe("12420");
    expect(msaCode(0)).toBeNull();
    expect(msaCode("")).toBeNull();
    expect(msaCode(null)).toBeNull();
    expect(msaCode("n/a")).toBeNull();
  });
});

describe("countyDeposits", () => {
  const rows = unwrapFdic<Record<string, string | number | null>>(SOD)
    .rows.map(parseSodRow)
    .filter((r): r is NonNullable<typeof r> => !!r);
  const d = countyDeposits("48453", 2025, rows, "https://api.fdic.gov/banks/sod?x", "2026-09-11T00:00:00Z");
  it("totals in dollars, counts offices and banks, ranks the top list", () => {
    expect(d.total).toBe(1_500_000_000);
    expect(d.branches).toBe(3);
    expect(d.banks).toBe(2);
    expect(d.top[0]).toMatchObject({ cert: 3511, deposits: 1_000_000_000, branches: 2 });
    expect(d.top[0].sharePct).toBeCloseTo(66.67, 1);
    expect(d.county).toBe("Travis");
    expect(d.state).toBe("TX");
  });
  it("carries an HHI estimate with its formula and two provenance records", () => {
    expect(d.hhi!.value).toBeCloseTo(66.67 ** 2 + 33.33 ** 2, 0);
    expect(d.hhi!.label).toBe("highly concentrated");
    expect(d.provenance.map((p) => p.kind)).toEqual(["published", "estimate"]);
    expect(d.provenance[0].period).toBe("2025-06-30");
    expect(d.provenance[1].method).toBe(d.hhi!.formula);
    expect(d.provenance[0].source.id).toBe("fdic-bankfind");
  });
  it("has no HHI when nothing was published", () => {
    const e = countyDeposits("48453", 2025, [], undefined, "2026-09-11T00:00:00Z");
    expect(e.hhi).toBeNull();
    expect(e.total).toBe(0);
    expect(e.provenance.length).toBe(1);
  });
});

describe("financialsSeries", () => {
  const rows = unwrapFdic<Record<string, string | number | null>>(FINANCIALS)
    .rows.map(parseFinancialsRow)
    .filter((r): r is NonNullable<typeof r> => !!r);
  const series = financialsSeries(3511, "Wells Fargo Bank", rows, "https://x", "2026-09-11T00:00:00Z");
  it("emits one quarterly series per field, oldest first, nulls kept", () => {
    const roa = series.find((s) => s.id === "fdic:financials:3511:roa")!;
    expect(roa.frequency).toBe("quarterly");
    expect(roa.unit).toBe("%");
    expect(roa.points.map((p) => p.v)).toEqual([1.1, 1.12, 1.16]);
    expect(roa.points[0].t).toBe(Date.parse("2025-09-30T00:00:00Z"));
    const dep = series.find((s) => s.id.endsWith(":deposits"))!;
    expect(dep.points[0].v).toBeNull();
    expect(dep.unit).toBe("USD thousands");
    expect(roa.provenance.period).toBe("2026-03-31");
    expect(roa.title).toContain("Wells Fargo Bank");
  });
  it("covers the eight fields the aside and the report read", () => {
    expect(series.map((s) => s.id.split(":").at(-1)).sort()).toEqual(["assets", "deposits", "equity", "netIncome", "netLoans", "noncurrentPct", "roa", "roe"]);
  });
});
