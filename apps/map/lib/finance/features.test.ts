import { describe, expect, it } from "vitest";
import type { AreaPoly, JobsRow } from "@/lib/economy/features";
import { buildBranches, buildSpendingAreas, indexSod, PER_JOB_STOPS, perJobFill, serviceTypeLabel, shortBankName, sodKey, type BranchExtra, type SpendingExtra } from "./features";
import type { AreaObligations, Branch, SodRow } from "./types";

describe("shortBankName", () => {
  it("drops charter suffixes and title-cases", () => {
    expect(shortBankName("JPMORGAN CHASE BANK, NATIONAL ASSOCIATION")).toBe("JPMorgan Chase Bank");
    expect(shortBankName("WELLS FARGO BANK, N.A.")).toBe("Wells Fargo Bank");
    expect(shortBankName("PNC BANK, NATIONAL ASSOCIATION")).toBe("PNC Bank");
    expect(shortBankName("BANK OF AMERICA, NATIONAL ASSOCIATION")).toBe("Bank of America");
    expect(shortBankName("THE FIRST NATIONAL BANK OF OMAHA")).toBe("First National Bank of Omaha");
    expect(shortBankName("TD BANK, N.A.")).toBe("TD Bank");
    expect(shortBankName("AUSTIN CAPITAL BANK SSB")).toBe("Austin Capital Bank SSB");
    expect(shortBankName("Frost Bank")).toBe("Frost Bank");
  });
  it("leaves words that merely end in NA alone", () => {
    expect(shortBankName("MONTANA STATE BANK")).toBe("Montana State Bank");
    expect(shortBankName("BANK OF INDIANA")).toBe("Bank of Indiana");
  });
  it("labels service types", () => {
    expect(serviceTypeLabel("11")).toBe("full service, brick and mortar");
    expect(serviceTypeLabel("99")).toBe("service type 99");
    expect(serviceTypeLabel(null)).toBeUndefined();
  });
});

function branch(over: Partial<Branch>): Branch {
  return { cert: 3511, officeNum: 1234, uninum: 200456, name: "WELLS FARGO BANK, NATIONAL ASSOCIATION", office: "CONGRESS AVENUE BRANCH", address: "111 Congress Ave", city: "AUSTIN", state: "TX", zip: "78701", fips: "48453", serviceType: "11", established: "1998-01-15", lat: 30.2652, lon: -97.7431, ...over };
}
function sod(over: Partial<SodRow>): SodRow {
  return { cert: 3511, name: "Wells Fargo Bank, National Association", brnum: 1234, uninum: 200456, deposits: 812_345, assets: null, fips: "48453", county: "Travis", state: "TX", year: 2025, lat: null, lon: null, cbsa: null, cbsaName: null, ...over };
}

describe("buildBranches", () => {
  const branches = [
    branch({}),
    branch({ cert: 9999, officeNum: 0, uninum: 100001, name: "FROST BANK", office: "FROST BANK", city: "SAN ANTONIO", fips: "48029", lat: 29.4265, lon: -98.4917 }),
    branch({ cert: 7, officeNum: null, uninum: 555, name: "SMALL BANK", office: "SMALL BANK", lat: 30.1, lon: -97.9 }),
    branch({ cert: 8, officeNum: 2, uninum: 556, name: "NO COORDS", lat: null, lon: null }),
    branch({ cert: 9, officeNum: 3, uninum: 557, name: "NOT IN SOD", office: "NOT IN SOD", lat: 30.2, lon: -97.8 }),
  ];
  const rows = [sod({}), sod({ cert: 9999, brnum: 0, uninum: 100001, deposits: 5_000_000, name: "Frost Bank" }), sod({ cert: 7, brnum: 99, uninum: 555, deposits: 10_000, name: "Small Bank" })];
  const features = buildBranches(branches, rows, 2025, 2);
  const x = (i: number) => features[i].properties.extra as BranchExtra;

  it("joins deposits by CERT+office number, then by FDIC office id, and drops offices without coordinates", () => {
    expect(features.length).toBe(4);
    expect(x(0).deposits).toBe(812_345_000);
    expect(x(1).deposits).toBe(5_000_000_000);
    expect(x(2).deposits).toBe(10_000_000);
    expect(x(3).deposits).toBeNull();
    expect(features[3].properties.details!.deposits).toBe("not in the Summary of Deposits");
    expect(features[3].properties.source).toBe("FDIC BankFind");
    expect(features[0].properties.source).toContain("Summary of Deposits");
  });
  it("carries the basics every feature needs", () => {
    const f = features[0];
    expect(f.properties).toMatchObject({ id: "branch:3511:200456", layer: "banks", kind: "branch", name: "Wells Fargo Bank · CONGRESS AVENUE BRANCH" });
    expect(f.geometry.coordinates).toEqual([-97.7431, 30.2652, 0]);
    expect(f.properties.details).toMatchObject({ bank: "WELLS FARGO BANK, NATIONAL ASSOCIATION", office: "CONGRESS AVENUE BRANCH", address: "111 Congress Ave, AUSTIN, TX 78701", deposits: "$812.3 m (SOD 2025)", service: "full service, brick and mortar", "FDIC cert": 3511 });
    expect(x(0).shortName).toBe("Wells Fargo Bank");
    expect(features[1].properties.name).toBe("Frost Bank");
  });
  it("labels only the largest offices by deposits", () => {
    expect(features.filter((f) => (f.properties.extra as BranchExtra).labelled).map((f) => (f.properties.extra as BranchExtra).cert)).toEqual([3511, 9999]);
  });
  it("de-duplicates repeated offices", () => {
    expect(buildBranches([branch({}), branch({})], [], null).length).toBe(1);
  });
  it("indexes SOD rows both ways", () => {
    const idx = indexSod(rows);
    expect(idx.byOffice.get(sodKey(3511, 1234))?.deposits).toBe(812_345);
    expect(idx.byUninum.get(555)?.cert).toBe(7);
    expect(sodKey(1, null)).toBe("1:0");
  });
});

function poly(geoid: string, name: string, stusab?: string): AreaPoly {
  return { geoid, name, stusab, lon: -97.7, lat: 30.3, geometry: { type: "Polygon", coordinates: [[[-98, 30], [-97, 30], [-97, 31], [-98, 31], [-98, 30]]] } };
}
function jobs(area: string, emp: number | null, suppressed = false): JobsRow {
  return { area, period: "2026 Q1", estabs: 1000, emp, wages: null, avgWeeklyWage: null, yoy: { estabs: null, emp: null, wages: null, avgWeeklyWage: null }, suppressed };
}
const ob = (fy: number, contracts: number | null, grants: number | null): AreaObligations => {
  const present = [contracts, grants].filter((v): v is number => v != null);
  return { fy, byGroup: { contracts, grants, loans: null, direct: null }, total: present.length ? present.reduce((a, b) => a + b, 0) : null };
};

describe("buildSpendingAreas", () => {
  const polys = [poly("48453", "Travis"), poly("48491", "Williamson"), poly("48021", "Bastrop"), poly("48055", "Caldwell")];
  const features = buildSpendingAreas(polys, "county", {
    obligations: new Map([
      ["48453", ob(2025, 1_000_000_000, 250_000_000)],
      ["48491", ob(2025, 50_000_000, null)],
      ["48055", ob(2025, 1_000_000, 0)],
    ]),
    toDate: new Map([["48453", { fy: 2026, through: "2026-09-11", total: 700_000_000 }]]),
    jobs: new Map([
      ["48453", jobs("48453", 800_000)],
      ["48491", jobs("48491", null, true)],
    ]),
    stateNames: new Map([["48453", "Texas"]]),
  });
  const x = (i: number) => features[i].properties.extra as SpendingExtra;

  it("skips areas with no obligations row", () => {
    expect(features.map((f) => (f.properties.extra as SpendingExtra).geoid)).toEqual(["48453", "48491", "48055"]);
  });
  it("computes per-job where QCEW published employment and prints it in the details", () => {
    expect(x(0).perJob!.value).toBe(1_562.5);
    expect(features[0].properties.details).toMatchObject({ "FY2025 obligations": "$1.3 bn", contracts: "$1.0 bn", grants: "$250.0 m", loans: "did not answer", "per job": "$1,563 (estimate)", "covered jobs": "800,000 (QCEW 2026 Q1)", "FY2026 to date": "$700.0 m (through 2026-09-11)" });
    expect(features[0].properties.source).toContain("BLS QCEW");
    expect(x(0).stateName).toBe("Texas");
  });
  it("has no per-job figure where BLS withheld the cell or there is no row", () => {
    expect(x(1).perJob).toBeNull();
    expect(x(1).jobs?.suppressed).toBe(true);
    expect(features[1].properties.details!["covered jobs"]).toBe("withheld by BLS");
    expect(x(2).perJob).toBeNull();
    expect(x(2).jobs).toBeUndefined();
    expect(features[2].properties.source).not.toContain("QCEW");
  });
  it("carries level, ids and anchors", () => {
    expect(features[0].properties).toMatchObject({ id: "county:48453", layer: "spending", kind: "county", name: "Travis", anchor: [-97.7, 30.3] });
    const st = buildSpendingAreas([poly("48", "Texas", "TX")], "state", { obligations: new Map([["48", ob(2025, 1, 1)]]), jobs: new Map() });
    expect(st[0].properties).toMatchObject({ id: "state:48", kind: "state", name: "Texas" });
    expect((st[0].properties.extra as SpendingExtra).stateName).toBe("Texas");
  });
  it("labels the largest areas by total", () => {
    expect(x(0).labelled).toBe(true);
  });
});

describe("perJobFill", () => {
  it("is grey without a figure and climbs the ramp with it", () => {
    expect(perJobFill(null)[0]).toBe("#6E7F8C");
    expect(perJobFill(500)[0]).toBe(PER_JOB_STOPS[0][1]);
    expect(perJobFill(20_000)[0]).toBe(PER_JOB_STOPS[4][1]);
    expect(perJobFill(1e9)[0]).toBe(PER_JOB_STOPS[5][1]);
    expect(perJobFill(20_000)[1]).toBeGreaterThan(perJobFill(500)[1]);
  });
});
