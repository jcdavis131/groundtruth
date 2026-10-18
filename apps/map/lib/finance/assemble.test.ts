// Contract of financeFor with FDIC, USAspending and QCEW replaced by
// fixtures. The property under test is degradation: which upstream failed,
// what the section says instead, and that nothing throws. No network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const up = vi.hoisted(() => ({
  latestSod: vi.fn(),
  obligationsByArea: vi.fn(),
  countySpendingDetail: vi.fn(),
  qcewLatest: vi.fn(),
  stateLookup: vi.fn(),
}));

vi.mock("./fdic", async (orig) => ({ ...(await orig<typeof import("./fdic")>()), latestSod: up.latestSod }));
vi.mock("./usaspending", async (orig) => ({
  ...(await orig<typeof import("./usaspending")>()),
  obligationsByArea: up.obligationsByArea,
  countySpendingDetail: up.countySpendingDetail,
}));
vi.mock("@/lib/economy/sources", () => ({ qcewLatest: up.qcewLatest, stateLookup: up.stateLookup }));

import { financeFor } from "./assemble";
import type { AreaObligations, SodRow, SpendingDetail } from "./types";
import type { JobsRow } from "@/lib/economy/features";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

const FIPS = "48453";
const AT = "2026-03-01T00:00:00Z";
/** FY2025 closed 30 Sep 2025; 1 Mar 2026 is 152 days later, outside the 45-day reporting lag. */
const NOW = new Date("2026-03-01T00:00:00Z");
/** 20 Oct 2025 is 20 days after FY2025 closed, inside the lag. */
const JUST_CLOSED = new Date("2025-10-20T00:00:00Z");

const sodRow = (cert: number, name: string, deposits: number): SodRow => ({ cert, name, brnum: 0, uninum: null, deposits, assets: null, fips: FIPS, county: "Travis", state: "TX", year: 2025, lat: null, lon: null, cbsa: null, cbsaName: null });

const OBLIGATIONS: AreaObligations = { fy: 2025, byGroup: { contracts: 1_000_000_000, grants: 250_000_000, loans: null, direct: 0 }, total: 1_250_000_000 };

const jobsRow = (suppressed: boolean): JobsRow => ({
  area: FIPS,
  period: "2025 Q4",
  estabs: suppressed ? null : 60_000,
  emp: suppressed ? null : 800_000,
  wages: suppressed ? null : 16_000_000_000,
  avgWeeklyWage: suppressed ? null : 1_500,
  yoy: { estabs: null, emp: null, wages: null, avgWeeklyWage: null },
  suppressed,
});

const DETAIL: SpendingDetail = {
  fips: FIPS,
  fy: 2025,
  recipients: [{ name: "UNIVERSITY OF TEXAS AT AUSTIN", amount: 900_000_000, code: null, id: "abc" }],
  agencies: [{ name: "DEPARTMENT OF DEFENSE", amount: 400_000_000, code: "097", id: null }],
  naics: [],
  overTime: [],
  provenance: [provenance(source("usaspending"), { kind: "published", seriesId: `spending_by_category:${FIPS}:FY2025`, period: "FY2025", retrievedAt: AT })],
};

function table(rows: Array<[string, AreaObligations]>) {
  return {
    fy: 2025,
    byArea: new Map(rows),
    failed: [] as string[],
    provenance: provenance(source("usaspending"), { kind: "published", seriesId: "spending_by_geography:county:FY2025", period: "FY2025", retrievedAt: AT }),
  };
}

function qcew(row: JobsRow | null) {
  return { year: 2025, qtr: 4, period: "2025 Q4", counties: row ? new Map([[FIPS, row]]) : new Map(), states: new Map() };
}

/** Everything answers, unless a test overrides one of them. */
function happy() {
  up.latestSod.mockResolvedValue({ year: 2025, rows: [sodRow(1, "Big Bank", 600_000), sodRow(2, "Mid Bank", 400_000)], url: "https://api.fdic.gov/banks/sod?x" });
  up.obligationsByArea.mockResolvedValue(table([[FIPS, OBLIGATIONS]]));
  up.qcewLatest.mockResolvedValue(qcew(jobsRow(false)));
  up.countySpendingDetail.mockResolvedValue(DETAIL);
  up.stateLookup.mockResolvedValue(new Map([["48", { stusab: "TX", name: "Texas" }]]));
}

beforeEach(() => {
  vi.clearAllMocks();
  happy();
});

describe("financeFor", () => {
  it("assembles deposits, obligations, the per-job estimate and the detail in one pass", async () => {
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    expect(r.section.loaded).toBe(true);
    expect(r.section.data.deposits!.year).toBe(2025);
    expect(r.section.data.spending!.total).toBe(1_250_000_000);
    expect(r.section.data.spending!.perJob!.value).toBeGreaterThan(0);
    expect(r.detail!.recipients[0].name).toBe("UNIVERSITY OF TEXAS AT AUSTIN");
    expect(r.section.items.some((i) => i.name === "UNIVERSITY OF TEXAS AT AUSTIN")).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.provenance.some((p) => p.source.id === "usaspending")).toBe(true);
    expect(r.provenance.some((p) => p.source.id === "fdic-bankfind")).toBe(true);
  });

  it("prints the HHI formula rather than an unexplained index", async () => {
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    const hhi = r.section.data.deposits!.hhi!;
    expect(typeof hhi.formula).toBe("string");
    expect(hhi.formula.length).toBeGreaterThan(0);
    expect(r.section.summary).toContain("HHI");
  });

  it("distinguishes FDIC publishing no rows from FDIC not answering", async () => {
    up.latestSod.mockResolvedValue(null);
    const none = await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    expect(none.section.data.deposits).toBeNull();
    expect(none.section.loaded).toBe(true);
    expect(none.section.summary).toContain("FDIC publishes no Summary of Deposits rows for this county");
    expect(none.caveats.join(" ")).not.toContain("FDIC did not answer");
    expect(none.failed).not.toContain("fdic-bankfind");

    up.latestSod.mockRejectedValue(new Error("fdic down"));
    up.obligationsByArea.mockRejectedValue(new Error("usaspending down"));
    const down = await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    expect(down.section.loaded).toBe(false);
    expect(down.section.data.deposits).toBeNull();
    expect(down.caveats).toContain("FDIC did not answer; no deposit figures.");
    expect(down.failed).toContain("fdic-bankfind");
    // The two states must not read the same to a human.
    expect(down.section.summary).not.toBe(none.section.summary);
  });

  it("takes stusab from the caller without a TIGERweb round-trip", async () => {
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT, stusab: "TX" });
    expect(up.stateLookup).not.toHaveBeenCalled();
    expect(up.countySpendingDetail).toHaveBeenCalledWith(FIPS, "TX", 2025);
    expect(r.detail).not.toBeNull();
  });

  it("falls back to stateLookup when the caller has no stusab", async () => {
    await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    expect(up.stateLookup).toHaveBeenCalledTimes(1);
    expect(up.countySpendingDetail).toHaveBeenCalledWith(FIPS, "TX", 2025);
  });

  it("leaves spending undefined and says so when the obligations table does not answer", async () => {
    up.obligationsByArea.mockRejectedValue(new Error("usaspending down"));
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT, stusab: "TX" });
    expect(r.section.data.spending).toBeNull();
    expect(r.caveats).toContain("USAspending did not answer; no obligation figures.");
    expect(r.failed).toContain("usaspending");
    // Deposits still came through: one failure does not take the section down.
    expect(r.section.data.deposits!.total).toBe(1_000_000_000); // DEPSUMBR is $ thousands upstream
  });

  it("withholds the per-job cell rather than printing zero when QCEW suppressed the county", async () => {
    up.qcewLatest.mockResolvedValue(qcew(jobsRow(true)));
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT, stusab: "TX" });
    expect(r.section.data.spending!.perJob).toBeNull();
    expect(r.section.summary).not.toContain("per covered job");
    expect(r.caveats.join(" ")).toContain("BLS withheld the covered-employment cell");
    expect(r.caveats.join(" ")).toContain("blank, not zero");
  });

  it("always states that obligations are commitments by place of performance", async () => {
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT, stusab: "TX" });
    const all = r.caveats.join(" ");
    expect(all).toContain("place of performance");
    expect(all).toContain("not outlays");
    expect(all).toContain("not the recipient's own location");
  });

  it("adds the still-filling-in caveat inside the reporting lag and not outside it", async () => {
    const soon = await financeFor(FIPS, { now: JUST_CLOSED, retrievedAt: AT, stusab: "TX" });
    expect(soon.caveats.join(" ")).toContain("still filling in");
    const later = await financeFor(FIPS, { now: NOW, retrievedAt: AT, stusab: "TX" });
    expect(later.caveats.join(" ")).not.toContain("still filling in");
  });

  it("resolves with an unloaded section when every upstream rejects", async () => {
    up.latestSod.mockRejectedValue(new Error("fdic down"));
    up.obligationsByArea.mockRejectedValue(new Error("usaspending down"));
    up.qcewLatest.mockRejectedValue(new Error("bls down"));
    up.countySpendingDetail.mockRejectedValue(new Error("usaspending down"));
    up.stateLookup.mockRejectedValue(new Error("tiger down"));
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    expect(r.section.loaded).toBe(false);
    expect(r.section.summary).toBe("Finance layers not loaded");
    expect(r.detail).toBeNull();
    expect(r.failed).toEqual(expect.arrayContaining(["census-tigerweb", "fdic-bankfind", "usaspending", "bls-qcew"]));
    expect(r.caveats.length).toBeGreaterThan(3);
  });

  it("does not ask for the detail at all when the state FIPS cannot be resolved", async () => {
    up.stateLookup.mockResolvedValue(new Map());
    const r = await financeFor(FIPS, { now: NOW, retrievedAt: AT });
    expect(up.countySpendingDetail).not.toHaveBeenCalled();
    expect(r.detail).toBeNull();
    expect(r.caveats.join(" ")).toContain("recipients, awarding agencies and NAICS");
  });
});
