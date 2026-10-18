import { describe, expect, it } from "vitest";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { perJob } from "./estimates";
import { countyDeposits } from "./fdic";
import { financeSection, financeSectionText } from "./report";
import type { SodRow } from "./types";

const AT = "2026-09-11T00:00:00Z";
const sod = (cert: number, name: string, deposits: number): SodRow => ({ cert, name, brnum: 0, uninum: null, deposits, assets: null, fips: "48453", county: "Travis", state: "TX", year: 2025, lat: null, lon: null, cbsa: null, cbsaName: null });
const deposits = countyDeposits("48453", 2025, [sod(1, "Big Bank", 600_000), sod(2, "Mid Bank", 300_000), sod(3, "Small Bank", 100_000), sod(4, "Tiny Bank", 1)], "https://api.fdic.gov/banks/sod?x", AT);
const usa = provenance(source("usaspending"), { kind: "published", seriesId: "spending_by_geography:county:FY2025", period: "FY2025", retrievedAt: AT });
const spending = {
  obligations: { fy: 2025, byGroup: { contracts: 1_000_000_000, grants: 250_000_000, loans: null, direct: 0 }, total: 1_250_000_000 },
  toDate: { fy: 2026, through: "2026-09-11", total: 700_000_000 },
  perJob: perJob(1_250_000_000, 800_000, "2026 Q1", 2025),
  provenance: [usa],
};

describe("financeSection", () => {
  it("summarises deposits, HHI, obligations and per-job, with the top three banks and the top recipient as items", () => {
    const s = financeSection("48453", { deposits, spending, topRecipient: { name: "UNIVERSITY OF TEXAS AT AUSTIN", amount: 900_000_000, code: null, id: "abc" }, areaName: "Travis County, TX", retrievedAt: AT });
    expect(s.title).toBe("Banks & federal dollars");
    expect(s.loaded).toBe(true);
    expect(s.summary).toContain("$1.0 bn in deposits at 4 offices of 4 banks (SOD June 2025)");
    expect(s.summary).toContain("HHI 4,600, highly concentrated");
    expect(s.summary).toContain("$1.3 bn federal obligations in FY2025 (contracts $1.0 bn, grants $250.0 m), $1,563 per covered job; FY2026 to date $700.0 m");
    expect(s.items.map((i) => [i.layer, i.name])).toEqual([
      ["banks", "Big Bank"],
      ["banks", "Mid Bank"],
      ["banks", "Small Bank"],
      ["spending", "Travis County, TX"],
      ["spending", "UNIVERSITY OF TEXAS AT AUSTIN"],
    ]);
    expect(s.items[0].value).toContain("60.0% share");
    expect(s.items[3].flag).toBe("ok");
    expect(s.data.deposits!.hhi!.value).toBeCloseTo(4600, 0);
    expect(s.data.spending!.perJob!.value).toBe(1562.5);
    expect(s.data.spending!.topRecipient!.name).toBe("UNIVERSITY OF TEXAS AT AUSTIN");
  });
  it("carries provenance from both sources plus the per-job estimate, de-duplicated", () => {
    const s = financeSection("48453", { deposits, spending, retrievedAt: AT });
    const ids = s.provenance.map((p) => `${p.source.id}:${p.kind}`);
    expect(ids).toEqual(["fdic-bankfind:published", "fdic-bankfind:estimate", "usaspending:published", "usaspending:estimate"]);
    expect(s.provenance[3].method).toBe(spending.perJob!.formula);
    const twice = financeSection("48453", { deposits, spending: { ...spending, provenance: [usa, usa] }, retrievedAt: AT });
    expect(twice.provenance.length).toBe(4);
  });
  it("says what is missing without inventing numbers", () => {
    const none = financeSection("48453");
    expect(none.loaded).toBe(false);
    expect(none.summary).toBe("Finance layers not loaded");
    expect(none.items).toEqual([]);
    expect(none.data).toEqual({ fips: "48453", deposits: null, spending: null });
    const empty = financeSection("48453", { deposits: null, spending: null });
    expect(empty.loaded).toBe(true);
    expect(empty.summary).toContain("no Summary of Deposits rows");
    expect(empty.summary).toContain("no place-of-performance row");
    expect(empty.provenance).toEqual([]);
  });
  it("flags very high per-job figures and handles a county with no jobs figure", () => {
    const hot = financeSection("48453", { spending: { ...spending, perJob: perJob(1_250_000_000, 10_000, "2026 Q1", 2025) } });
    expect(hot.items[0].flag).toBe("watch");
    const noJobs = financeSection("48453", { spending: { ...spending, perJob: null, toDate: null } });
    expect(noJobs.items[0].flag).toBeUndefined();
    expect(noJobs.summary).not.toContain("per covered job");
    expect(noJobs.summary).not.toContain("to date");
    expect(noJobs.items[0].name).toBe("county 48453");
  });
  it("renders text lines with the formulas", () => {
    const lines = financeSectionText(financeSection("48453", { deposits, spending, retrievedAt: AT }));
    expect(lines[0]).toMatch(/^BANKS & FEDERAL DOLLARS: /);
    expect(lines.some((l) => l.includes("per job = FY2025"))).toBe(true);
    expect(lines.some((l) => l.includes("HHI = Σ"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^ {2}basis: /);
  });
});
