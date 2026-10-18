import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/server/csv";
import type { AreaPoly, JobsRow } from "@/lib/economy/features";
import { buildBranches, buildSpendingAreas } from "./features";
import { countyDeposits } from "./fdic";
import { BANK_SHARE_COLUMNS, BRANCH_COLUMNS, CATEGORY_COLUMNS, FAILURE_COLUMNS, FINANCIALS_COLUMNS, flattenBranches, flattenDeposits, flattenDetail, flattenFailures, flattenFinancials, flattenSpendingAreas, SPENDING_AREA_COLUMNS } from "./flatten";
import type { Branch, SodRow } from "./types";

const branch: Branch = { cert: 3511, officeNum: 1234, uninum: 200456, name: "WELLS FARGO BANK, NATIONAL ASSOCIATION", office: "CONGRESS AVENUE BRANCH", address: "111 Congress Ave", city: "AUSTIN", state: "TX", zip: "78701", fips: "48453", serviceType: "11", established: "1998-01-15", lat: 30.2652, lon: -97.7431 };
const sod: SodRow = { cert: 3511, name: "Wells Fargo Bank, National Association", brnum: 1234, uninum: 200456, deposits: 812_345, assets: null, fips: "48453", county: "Travis", state: "TX", year: 2025, lat: null, lon: null, cbsa: null, cbsaName: null };

describe("flattenBranches", () => {
  it("is one row per office with the pinned columns", () => {
    const rows = flattenBranches(buildBranches([branch, { ...branch, cert: 9, uninum: 9, officeNum: 0, name: "X BANK", office: "X BANK" }], [sod], 2025));
    expect(rows.length).toBe(2);
    expect(Object.keys(rows[0])).toEqual([...BRANCH_COLUMNS]);
    expect(rows[0]).toMatchObject({ cert: 3511, short_name: "Wells Fargo Bank", county_fips: "48453", lon: -97.7431, lat: 30.2652, deposits: 812_345_000, sod_year: 2025, service_type: "11" });
    expect(rows[1]).toMatchObject({ deposits: null, sod_year: null });
    const text = toCsv(rows, [...BRANCH_COLUMNS]);
    expect(text.split("\r\n")[0]).toBe(BRANCH_COLUMNS.join(","));
    expect(text).toContain('"WELLS FARGO BANK, NATIONAL ASSOCIATION"');
  });
});

describe("flattenDeposits", () => {
  it("repeats the county totals on every bank row", () => {
    const d = countyDeposits("48453", 2025, [sod, { ...sod, cert: 9, name: "X", brnum: 0, deposits: 187_655 }], undefined, "2026-09-11T00:00:00Z");
    const rows = flattenDeposits(d);
    expect(rows.length).toBe(2);
    expect(Object.keys(rows[0])).toEqual([...BANK_SHARE_COLUMNS]);
    expect(rows[0]).toMatchObject({ rank: 1, cert: 3511, deposits: 812_345_000, share_pct: 81.23, county_deposits: 1_000_000_000, county_branches: 2, county_banks: 2, hhi_label: "highly concentrated" });
    expect(rows[1].rank).toBe(2);
    expect(rows[0].hhi).toBe(Math.round(d.hhi!.value));
  });
});

describe("flattenFinancials and flattenFailures", () => {
  it("keeps thousands labelled and nulls empty", () => {
    const rows = flattenFinancials(3511, [{ reportDate: "2026-03-31", assets: 1, deposits: null, netIncome: 3, netLoans: 4, noncurrentLoans: 5, noncurrentPct: 0.5, roa: 1.1, roe: 9, equity: 7 }]);
    expect(Object.keys(rows[0])).toEqual([...FINANCIALS_COLUMNS]);
    expect(rows[0]).toMatchObject({ cert: 3511, report_date: "2026-03-31", assets_thousands: 1, deposits_thousands: null, roa: 1.1 });
    expect(toCsv(rows, [...FINANCIALS_COLUMNS]).split("\r\n")[1]).toBe("3511,2026-03-31,1,,3,4,5,0.5,1.1,9,7");
    const f = flattenFailures([{ name: "First Republic Bank", cityState: "San Francisco, CA", failDate: "2023-05-01", assets: 1, deposits: 2, cost: 3, resolution: "PA" }]);
    expect(Object.keys(f[0])).toEqual([...FAILURE_COLUMNS]);
    expect(f[0].city_state).toBe("San Francisco, CA");
  });
});

describe("flattenSpendingAreas", () => {
  it("is one row per area with rounded money and the per-job estimate", () => {
    const poly: AreaPoly = { geoid: "48453", name: "Travis", stusab: "TX", lon: -97.7, lat: 30.3, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    const jobs: JobsRow = { area: "48453", period: "2026 Q1", estabs: 1, emp: 800_000, wages: null, avgWeeklyWage: null, yoy: { estabs: null, emp: null, wages: null, avgWeeklyWage: null }, suppressed: false };
    const features = buildSpendingAreas([poly], "county", {
      obligations: new Map([["48453", { fy: 2025, byGroup: { contracts: 1_000_000_000.129, grants: 250_000_000, loans: null, direct: 0 }, total: 1_250_000_000.129 }]]),
      toDate: new Map([["48453", { fy: 2026, through: "2026-09-11", total: 700_000_000 }]]),
      jobs: new Map([["48453", jobs]]),
      stateNames: new Map([["48453", "Texas"]]),
    });
    const rows = flattenSpendingAreas(features);
    expect(Object.keys(rows[0])).toEqual([...SPENDING_AREA_COLUMNS]);
    expect(rows[0]).toMatchObject({ geoid: "48453", state: "TX", state_name: "Texas", fy: 2025, obligations: 1_250_000_000.13, contracts: 1_000_000_000.13, loans: null, direct_payments: 0, fytd_fy: 2026, fytd_obligations: 700_000_000, emp: 800_000, qcew_suppressed: false, per_job: 1562.5 });
  });
});

describe("flattenDetail", () => {
  it("stacks recipients, agencies, NAICS and the trace under a category column", () => {
    const rows = flattenDetail({
      fips: "48453",
      fy: 2025,
      recipients: [{ name: "UNIVERSITY OF TEXAS AT AUSTIN", amount: 900_000_000, code: null, id: "abc" }],
      agencies: [{ name: "Department of Energy", amount: 100, code: "089", id: "89" }],
      naics: [{ name: "Research and Development", amount: 50, code: "5417", id: null }],
      overTime: [
        { fy: 2024, amount: 1 },
        { fy: 2025, amount: 2 },
      ],
      provenance: [],
    });
    expect(rows.length).toBe(5);
    expect(Object.keys(rows[0])).toEqual([...CATEGORY_COLUMNS]);
    expect(rows.map((r) => r.category)).toEqual(["recipient", "awarding_agency", "naics", "over_time", "over_time"]);
    expect(rows[3]).toMatchObject({ fy: 2024, name: "FY2024", amount: 1, rank: null });
    expect(rows[0]).toMatchObject({ rank: 1, id: "abc", amount: 900_000_000 });
  });
});
