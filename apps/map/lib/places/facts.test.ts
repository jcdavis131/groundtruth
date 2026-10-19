// The contract these tests defend is "never blank, never a 500": placeFacts
// resolves for every scope the URL grammar accepted, and every section that
// could not be filled says so in words. The upstreams are mocked because the
// sandbox has no egress and because the interesting cases are the failures.
//
// The process cache is mocked too, with the same semantics as the real one
// plus a reset, so each test gets its own memo table: a value stored by one
// test must not answer another test's producer.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import type { AreaJoins, HomeValue, JobsRow } from "@/lib/economy/features";
import { buildAreaPoints } from "@/lib/screener/entities";
import type { CountyRef, MetroRef, StateRef } from "./registry";
import type { PlaceScope } from "./scope";

vi.mock("@/lib/server/cache", () => {
  const store = new Map<string, { value: unknown; expires: number; storedAt: number }>();
  return {
    __store: store,
    cached: async <T,>(key: string, ttlMs: number, produce: () => Promise<T>) => {
      const now = Date.now();
      const hit = store.get(key) as { value: T; expires: number; storedAt: number } | undefined;
      if (hit && hit.expires > now) return { value: hit.value, age: now - hit.storedAt, hit: true };
      try {
        const value = await produce();
        store.set(key, { value, expires: Date.now() + ttlMs, storedAt: Date.now() });
        return { value, age: 0, hit: false };
      } catch (err) {
        if (hit) return { value: hit.value, age: now - hit.storedAt, hit: true };
        throw err;
      }
    },
    cacheDelete: (k: string) => void store.delete(k),
    cacheStats: () => ({ entries: store.size, inflight: 0 }),
  };
});

vi.mock("@/lib/economy/assemble", () => ({
  marketReportForCounty: vi.fn(),
  marketReportForState: vi.fn(),
}));
vi.mock("@/lib/water/assemble", () => ({ waterReportAt: vi.fn() }));
vi.mock("@/lib/finance/assemble", () => ({ financeFor: vi.fn() }));
vi.mock("@/lib/places/percentiles", () => ({ peerStats: vi.fn(), PEER_MIN_N: 5 }));
vi.mock("@/lib/indicators/service", () => ({ getIndicators: vi.fn() }));
vi.mock("@/lib/screener/sets", async (orig) => ({ ...(await orig<object>()), entitySet: vi.fn() }));
vi.mock("@/lib/companies/section", () => ({ companiesSection: vi.fn(), bundleProvenance: () => [], BUNDLE_CAVEATS: ["positions are ZIP centroids"] }));
vi.mock("@/lib/economy/sources", () => ({ zillow: vi.fn(), qcewLatest: vi.fn() }));
vi.mock("@/lib/places/registry", async (orig) => ({
  ...(await orig<object>()),
  countiesInMetro: vi.fn(() => []),
  metroForCounty: vi.fn(() => null),
  metrosInState: vi.fn(() => []),
}));

const { marketReportForCounty, marketReportForState } = await import("@/lib/economy/assemble");
const { waterReportAt } = await import("@/lib/water/assemble");
const { financeFor } = await import("@/lib/finance/assemble");
const { peerStats } = await import("@/lib/places/percentiles");
const { getIndicators } = await import("@/lib/indicators/service");
const { entitySet } = await import("@/lib/screener/sets");
const { companiesSection } = await import("@/lib/companies/section");
const { zillow, qcewLatest } = await import("@/lib/economy/sources");
const registry = await import("@/lib/places/registry");
const cache = (await import("@/lib/server/cache")) as unknown as { __store: Map<string, unknown> };
const { placeFacts, placeFactsShell } = await import("./facts");

const FETCHERS = [marketReportForCounty, marketReportForState, waterReportAt, financeFor, peerStats, getIndicators, entitySet, companiesSection, zillow, qcewLatest] as unknown as Array<{ mock: { calls: unknown[] } }>;

const NOW = Date.UTC(2026, 8, 15);

// ------------------------------------------------------------------ fixtures

function countyRef(over: Partial<CountyRef> = {}): CountyRef {
  return { geoid: "48453", name: "Travis County", stusab: "TX", stateFips: "48", stateName: "Texas", lon: -97.78, lat: 30.33, cbsa: null, adj: [], ...over };
}

function countyScope(over: Partial<CountyRef> = {}): PlaceScope {
  const ref = countyRef(over);
  return { kind: "county", id: ref.geoid, ref, provisional: false };
}

function metroRef(over: Partial<MetroRef> = {}): MetroRef {
  return { cbsa: "41700", name: "San Antonio-New Braunfels, TX", short: "san antonio|TX", states: ["TX"], counties: [], lon: -98.5, lat: 29.4, zillowRegionId: null, zillowMatchedBy: null, ...over };
}

function stateRef(over: Partial<StateRef> = {}): StateRef {
  return { fips: "48", usps: "TX", name: "Texas", lon: -99.3, lat: 31.5, ...over };
}

function homeRow(id: string, latest: number, asOf: string, months: Array<[string, number]>): HomeValue {
  return { id, name: id, sizeRank: 1, asOf, latest, yoyPct: 3.2, y5Pct: 40, monthly: months, yearly: [] };
}

/** A disclosure-code-N row nulls every value, exactly as the QCEW loader leaves it. */
function jobsRow(area: string, emp: number | null, suppressed = false): JobsRow {
  return {
    area,
    period: "2026 Q1",
    estabs: suppressed ? null : 2000,
    emp: suppressed ? null : emp,
    wages: suppressed || emp == null ? null : emp * 1500 * 13,
    avgWeeklyWage: suppressed ? null : 1500,
    yoy: { estabs: suppressed ? null : 1, emp: suppressed ? null : 0.9, wages: suppressed ? null : 2, avgWeeklyWage: suppressed ? null : 1.5 },
    suppressed,
  };
}

/** Two counties so the "newest file column" is a property of the set, not of one row. */
function countySetFeatures(opts: { targetHomeAsOf?: string; targetMonths?: Array<[string, number]>; suppressed?: boolean } = {}): LayerFeature[] {
  const targetAsOf = opts.targetHomeAsOf ?? "2026-07-31";
  const targetMonths = opts.targetMonths ?? [
    ["2026-06-30", 500_000],
    ["2026-07-31", 505_000],
  ];
  const joins: AreaJoins = {
    jobs: new Map([
      ["48453", jobsRow("48453", 780_000, opts.suppressed)],
      ["06037", jobsRow("06037", 4_400_000)],
    ]),
    home: new Map([
      ["48453", homeRow("48453", 505_000, targetAsOf, targetMonths)],
      [
        "06037",
        homeRow("06037", 900_000, "2026-07-31", [
          ["2026-06-30", 890_000],
          ["2026-07-31", 900_000],
        ]),
      ],
    ]),
    rent: new Map([
      [
        "48453",
        homeRow("48453", 1_800, "2026-07-31", [
          ["2026-06-30", 1_780],
          ["2026-07-31", 1_800],
        ]),
      ],
    ]),
    stateNames: new Map([
      ["48", "Texas"],
      ["06", "California"],
    ]),
  };
  return buildAreaPoints(
    [
      { geoid: "48453", name: "Travis County", stusab: "TX", lon: -97.78, lat: 30.33 },
      { geoid: "06037", name: "Los Angeles County", stusab: "CA", lon: -118.23, lat: 34.31 },
    ],
    "county",
    joins,
  );
}

function setOf(features: LayerFeature[]) {
  return { features, provenance: [], caveats: [], assembledAt: "2026-09-15T00:00:00.000Z", failed: [] };
}

function market(over: Record<string, unknown> = {}) {
  return {
    report: {
      lon: -97.78,
      lat: 30.33,
      generatedAt: NOW,
      area: { level: "county", geoid: "48453", name: "Travis County" },
      jobs: { title: "Jobs", loaded: true, summary: "", basis: "", provenance: [], items: [], data: { period: "2026 Q1", emp: 780_000, estabs: 2000, avgWeeklyWage: 1500, yoyEmp: 0.9, yoyWage: 1.5, sectors: [] } },
      caveats: [],
      provenance: [],
      citations: [],
    },
    area: null,
    provenance: [],
    caveats: [],
    failed: [],
    asOf: { qcew: "2026 Q1", zhvi: "2026-07-31" },
    retrievedAt: "2026-09-15T00:00:00.000Z",
    ...over,
  };
}

const STRESS_CAVEAT = "Stress uses 3 of 4 terms (drought, reservoirs, quality); missing terms are left out, not assumed.";

function water(caveats: string[] = [STRESS_CAVEAT]) {
  return { report: { lon: -97.78, lat: 30.33, generatedAt: NOW, caveats, provenance: [], citations: [] }, bbox: [-98, 30, -97, 31], provenance: [], caveats, retrievedAt: "2026-09-15T00:00:00.000Z" };
}

function finance(detail: unknown = null) {
  return { section: { title: "Money", loaded: true, summary: "", basis: "", provenance: [], items: [], data: {} }, detail, provenance: [], caveats: [], failed: [] };
}

function companies() {
  return { title: "Public companies", loaded: true, summary: "", basis: "", provenance: [], items: [], data: { n: 3, withFacts: 0, bundlePulled: null, sectorExposure: [] } };
}

const anyFn = (f: unknown) => f as unknown as { mockResolvedValue: (v: unknown) => void; mockRejectedValue: (v: unknown) => void; mockReturnValue: (v: unknown) => void; mockImplementation: (f: (...a: never[]) => unknown) => void };

beforeEach(() => {
  vi.clearAllMocks();
  cache.__store.clear();
  anyFn(registry.countiesInMetro).mockReturnValue([]);
  anyFn(registry.metroForCounty).mockReturnValue(null);
  anyFn(registry.metrosInState).mockReturnValue([]);
});

// ------------------------------------------------------------------ tests

describe("placeFacts, total upstream failure", () => {
  it("resolves, and every section carries a reason rather than a blank", async () => {
    anyFn(registry.metroForCounty).mockReturnValue(metroRef({ cbsa: "99999" }));
    anyFn(marketReportForCounty).mockRejectedValue(new Error("TIGERweb refused the connection"));
    anyFn(waterReportAt).mockRejectedValue(new Error("USGS refused the connection"));
    anyFn(financeFor).mockRejectedValue(new Error("FDIC refused the connection"));
    anyFn(entitySet).mockRejectedValue(new Error("the county table is unreachable"));
    anyFn(peerStats).mockRejectedValue(new Error("no cohort"));
    anyFn(getIndicators).mockRejectedValue(new Error("no indicators"));
    anyFn(companiesSection).mockImplementation(() => {
      throw new Error("the bundle could not be read");
    });

    const f = await placeFacts(countyScope(), { now: NOW });

    expect(f.name).toBe("Travis County, TX");
    for (const [label, state] of [
      ["market", f.market.state],
      ["water", f.water.state],
      ["finance", f.finance.state],
      ["spending", f.spending.state],
      ["companies", f.companies.state],
      ["occupations", f.occupations.state],
      ["indicators", f.indicators.state],
    ] as const) {
      expect(state.status, label).toBe("unavailable");
      expect(state.reason ?? "", label).not.toHaveLength(0);
    }
    expect(f.market.report).toBeNull();
    expect(f.water.report).toBeNull();
    expect(typeof f.values).toBe("object");
    expect(f.peers).toEqual({});
    expect(f.releases.length).toBeGreaterThan(0);
  });
});

describe("placeFacts, mixed success", () => {
  it("marks each section independently", async () => {
    anyFn(marketReportForCounty).mockResolvedValue(market());
    anyFn(waterReportAt).mockRejectedValue(new Error("USGS did not answer"));
    anyFn(financeFor).mockResolvedValue(finance(null));
    anyFn(entitySet).mockResolvedValue(setOf(countySetFeatures()));
    anyFn(peerStats).mockResolvedValue({ "home.latest": [] });
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "2026-09-15T00:00:00.000Z" });
    anyFn(companiesSection).mockReturnValue(companies());

    const f = await placeFacts(countyScope(), { now: NOW, indicatorCategory: undefined });

    expect(f.market.state.status).toBe("fresh");
    expect(f.market.state.asOf).toBe("2026 Q1");
    expect(f.water.state.status).toBe("unavailable");
    expect(f.water.state.reason).toContain("USGS did not answer");
    expect(f.finance.state.status).toBe("fresh");
    expect(f.spending.state.status).toBe("unavailable");
    expect(f.companies.state.status).toBe("fresh");
    expect(f.companies.section?.data.n).toBe(3);
  });

  it("prints buildWaterReport's own stress caveat verbatim", async () => {
    anyFn(marketReportForCounty).mockResolvedValue(market());
    anyFn(waterReportAt).mockResolvedValue(water());
    anyFn(financeFor).mockResolvedValue(finance());
    anyFn(entitySet).mockResolvedValue(setOf(countySetFeatures()));
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });
    anyFn(companiesSection).mockReturnValue(null);

    const f = await placeFacts(countyScope(), { now: NOW });
    expect(f.caveats).toContain(STRESS_CAVEAT);
    expect(f.caveats.some((c) => c.includes("75 km"))).toBe(true);
  });
});

describe("placeFacts values", () => {
  async function travis(over: Parameters<typeof countySetFeatures>[0] = {}) {
    anyFn(marketReportForCounty).mockResolvedValue(market());
    anyFn(waterReportAt).mockResolvedValue(water());
    anyFn(financeFor).mockResolvedValue(finance());
    anyFn(entitySet).mockResolvedValue(setOf(countySetFeatures(over)));
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });
    anyFn(companiesSection).mockReturnValue(null);
    return placeFacts(countyScope(), { now: NOW });
  }

  it("never assigns a string into values", async () => {
    const f = await travis();
    const entries = Object.entries(f.values);
    expect(entries.length).toBeGreaterThan(10);
    for (const [k, v] of entries) expect(v === null || typeof v === "number", `${k} = ${String(v)}`).toBe(true);
    expect(f.values).not.toHaveProperty("name");
    expect(f.values).not.toHaveProperty("geoid");
    expect(f.values["home.latest"]).toBe(505_000);
  });

  it("has provenance for every non-null numeric value", async () => {
    const f = await travis();
    for (const [k, v] of Object.entries(f.values)) {
      if (v == null) continue;
      expect(f.metricProvenance[k], k).toBeDefined();
      expect(f.metricProvenance[k].length, k).toBeGreaterThan(0);
    }
  });

  it("computes month-over-month from the file's newest two columns", async () => {
    const f = await travis();
    expect(f.values["home.momPct"]).toBeCloseTo(1, 5);
    expect(f.previous["home.latest"]).toBe(500_000);
    expect(f.periods.previous["home.latest"]).toBe("2026-06");
    expect(f.skipped).not.toContain("home.momPct");
  });

  it("skips a row whose newest two months are not the file's newest two", async () => {
    const f = await travis({
      targetHomeAsOf: "2026-06-30",
      targetMonths: [
        ["2026-05-31", 498_000],
        ["2026-06-30", 500_000],
      ],
    });
    expect(f.values["home.momPct"]).toBeNull();
    expect(f.skipped).toContain("home.momPct");
    expect(f.skipped).toContain("home.latest");
    expect(f.previous["home.latest"]).toBeUndefined();
  });

  it("lists the jobs metrics as suppressed when BLS withheld the cell", async () => {
    const f = await travis({ suppressed: true });
    expect(f.suppressed).toContain("jobs.emp");
    expect(f.values["jobs.emp"]).toBeNull();
  });

  it("keeps every value when rank context is unavailable", async () => {
    anyFn(marketReportForCounty).mockResolvedValue(market());
    anyFn(waterReportAt).mockResolvedValue(water());
    anyFn(financeFor).mockResolvedValue(finance());
    anyFn(entitySet).mockResolvedValue(setOf(countySetFeatures()));
    anyFn(peerStats).mockRejectedValue(new Error("every cohort is down"));
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });
    anyFn(companiesSection).mockReturnValue(null);

    const f = await placeFacts(countyScope(), { now: NOW });
    expect(f.peers).toEqual({});
    expect(f.values["home.latest"]).toBe(505_000);
    expect(f.values["jobs.emp"]).toBe(780_000);
  });
});

describe("placeFacts, metro", () => {
  it("names the withheld counties and never sums them as zero", async () => {
    const member: CountyRef[] = [
      countyRef({ geoid: "48029", name: "Bexar County" }),
      countyRef({ geoid: "48091", name: "Comal County" }),
      countyRef({ geoid: "48187", name: "Guadalupe County" }),
      countyRef({ geoid: "48493", name: "Wilson County" }),
      countyRef({ geoid: "48013", name: "Atascosa County" }),
    ];
    anyFn(registry.countiesInMetro).mockReturnValue(member);
    anyFn(qcewLatest).mockResolvedValue({
      year: 2026,
      qtr: 1,
      period: "2026 Q1",
      counties: new Map([
        ["48029", jobsRow("48029", 900_000)],
        ["48091", jobsRow("48091", 200_000)],
        ["48187", jobsRow("48187", 134_567)],
        ["48493", jobsRow("48493", null, true)],
        ["48013", jobsRow("48013", null, true)],
      ]),
      states: new Map(),
    });
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });

    const scope: PlaceScope = { kind: "metro", id: "41700", ref: metroRef() };
    const f = await placeFacts(scope, { now: NOW });

    expect(f.rollup).not.toBeNull();
    expect(f.rollup!.counties).toBe(3);
    expect(f.rollup!.jobs).toBe(1_234_567);
    expect(f.rollup!.suppressed).toHaveLength(2);
    expect(f.rollup!.suppressed.join(" ")).toContain("Wilson County");
    expect(f.rollup!.suppressed.join(" ")).toContain("Atascosa County");
    expect(f.rollup!.formula.join(" ")).toContain("withheld");
    expect(f.rollup!.formula.join(" ")).toContain("1,234,567 = 900,000 + 200,000 + 134,567");
    expect(f.values["jobs.emp"]).toBe(1_234_567);
    expect(f.market.state.status).toBe("not-applicable");
  });

  it("says why the housing rows are missing when the manifest has no Zillow RegionID", async () => {
    anyFn(qcewLatest).mockResolvedValue({ year: 2026, qtr: 1, period: "2026 Q1", counties: new Map(), states: new Map() });
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });

    const f = await placeFacts({ kind: "metro", id: "41700", ref: metroRef() }, { now: NOW });
    expect(f.housing?.state.status).toBe("unavailable");
    expect(f.housing?.state.reason).toContain("RegionID");
    expect(zillow).not.toHaveBeenCalled();
  });

  it("says when the Zillow row was matched by its counties rather than by name", async () => {
    // Wildwood-The Villages, FL (48680) is Zillow's "The Villages, FL": the
    // 2023 title no longer names Zillow's row, Sumter County ties them.
    const row = homeRow("395153", 410_000, "2026-08-31", [["2026-08-31", 410_000]]);
    const table = { kind: "zhviMetro", asOf: "2026-08-31", rows: new Map([["395153", row]]), byName: new Map(), byShort: new Map() };
    anyFn(zillow).mockResolvedValue(table);
    anyFn(qcewLatest).mockResolvedValue({ year: 2026, qtr: 1, period: "2026 Q1", counties: new Map(), states: new Map() });
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });

    const ref = metroRef({ cbsa: "48680", name: "Wildwood-The Villages, FL", short: "wildwood|FL", states: ["FL"], zillowRegionId: "395153", zillowMatchedBy: "counties" });
    const f = await placeFacts({ kind: "metro", id: "48680", ref }, { now: NOW });
    expect(f.housing?.matchedBy).toBe("counties");
    expect(f.housing?.home?.latest).toBe(410_000);
    const said = f.caveats.join(" ");
    expect(said).toContain("BY ITS COUNTIES");
    expect(said).toContain("395153");
    expect(said).not.toContain("BY NAME");
  });
});

describe("placeFacts, rank cohorts", () => {
  function cohortsOf(call: unknown[]): Array<{ kind: string; cbsa?: string }> {
    return call[2] as Array<{ kind: string; cbsa?: string }>;
  }
  async function rank(scope: PlaceScope) {
    anyFn(marketReportForCounty).mockResolvedValue(market());
    anyFn(waterReportAt).mockResolvedValue(water());
    anyFn(financeFor).mockResolvedValue(finance());
    anyFn(entitySet).mockResolvedValue(setOf([]));
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });
    anyFn(companiesSection).mockReturnValue(null);
    await placeFacts(scope, { now: NOW });
    const calls = (peerStats as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    return cohortsOf(calls[0]);
  }

  it("ranks a metropolitan county inside its metro", async () => {
    const cohorts = await rank(countyScope({ cbsa: "12420" }));
    expect(cohorts.map((c) => c.kind)).toEqual(["national", "state", "metro"]);
    expect(cohorts[2].cbsa).toBe("12420");
  });

  it("never offers a metro cohort for a micropolitan county, which has no metro page", async () => {
    // Brown County, SD carries the Aberdeen micropolitan code 10100.
    const cohorts = await rank(countyScope({ geoid: "46013", name: "Brown County", stusab: "SD", stateFips: "46", stateName: "South Dakota", cbsa: "10100" }));
    expect(cohorts.map((c) => c.kind)).toEqual(["national", "state"]);
  });
});

describe("placeFacts, state", () => {
  it("omits the water section rather than reporting a 75 km disc", async () => {
    anyFn(marketReportForState).mockResolvedValue(market({ asOf: { qcew: "2026 Q1" } }));
    anyFn(entitySet).mockResolvedValue(setOf([]));
    anyFn(peerStats).mockResolvedValue({});
    anyFn(getIndicators).mockResolvedValue({ items: [], generatedAt: "x" });
    anyFn(companiesSection).mockReturnValue(null);

    const f = await placeFacts({ kind: "state", id: "TX", ref: stateRef() }, { now: NOW });

    expect(f.water.report).toBeNull();
    expect(f.water.state.status).toBe("not-applicable");
    expect(f.water.state.reason).toContain("75 km");
    expect(waterReportAt).not.toHaveBeenCalled();
    expect(f.market.state.status).toBe("fresh");
  });
});

describe("placeFactsShell", () => {
  it("fetches nothing and still names the place and its occupation mix", () => {
    const real = registry.metroByCbsa("41700");
    expect(real).not.toBeNull();
    const f = placeFactsShell({ kind: "metro", id: "41700", ref: real! }, { now: NOW });

    expect(f.name).toBe(real!.name);
    expect(f.occupations.state.status).toBe("fresh");
    expect(f.occupations.jobs?.top.length).toBeGreaterThan(20);
    expect(f.occupations.jobs?.major.length).toBeGreaterThan(20);
    expect(f.market.state.reason ?? "").not.toHaveLength(0);
    expect(f.indicators.state.status).toBe("unavailable");
    expect(f.indicators.state.reason).toBe("not fetched");
    for (const fetcher of FETCHERS) expect(fetcher.mock.calls).toHaveLength(0);
  });

  it("reports a provisional county honestly and fetches nothing", () => {
    const f = placeFactsShell({ kind: "county", id: "48999", ref: null, provisional: true }, { now: NOW });
    expect(f.lon).toBeNull();
    expect(f.caveats.join(" ")).toContain("not in the offline place manifest");
    expect(f.market.state.status).toBe("unavailable");
    for (const fetcher of FETCHERS) expect(fetcher.mock.calls).toHaveLength(0);
  });
});
