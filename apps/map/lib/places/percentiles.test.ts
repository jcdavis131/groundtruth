// The percentile layer is where a wrong answer is invisible: a rank prints
// with the same confidence whether its cohort was 3,143 counties or the one
// county being looked at. So these tests pin the arithmetic (percentiles come
// from percentileRanks untouched, rank counts strictly-greater values),
// the refusals (too few published values, a cohort that is too small), and
// the degraded path (entitySet resolving with features:[] must not poison an
// hour of cache). Nothing here touches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaPointIn } from "@/lib/screener/entities";
import { buildAreaPoints } from "@/lib/screener/entities";
import { percentileRanks } from "@/lib/screener/engine";
import type { HomeValue, JobsRow } from "@/lib/economy/features";
import type { LayerFeature } from "@/lib/layers/types";
import type { SourceId } from "@/lib/provenance/sources";

const upstream: { features: LayerFeature[]; failed: SourceId[]; calls: number } = { features: [], failed: [], calls: 0 };
const metroMembers: { counties: string[] } = { counties: [] };

vi.mock("@/lib/screener/sets", () => ({
  entitySet: async () => {
    upstream.calls += 1;
    return { features: upstream.features, provenance: [], caveats: [], assembledAt: "2026-08-01T00:00:00.000Z", failed: upstream.failed };
  },
}));

// The metro universe is the only cohort that reads Zillow; it is never reached
// by these tests, but the module-level import must not be the live one.
vi.mock("@/lib/economy/sources", () => ({
  zillow: async () => {
    throw new Error("no egress");
  },
  oewsMsaIndex: () => ({ asOf: "May 2025", source: "fixture", msas: [] }),
}));

vi.mock("@/lib/places/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/places/registry")>();
  return {
    ...real,
    countiesInMetro: (cbsa: string) =>
      metroMembers.counties.map((geoid) => ({ geoid, name: `County ${geoid}`, stusab: "TX", stateFips: geoid.slice(0, 2), stateName: "Texas", lon: -98, lat: 29, cbsa, adj: [] })),
  };
});

import { cacheDelete } from "@/lib/server/cache";
import { cohortTable, peerStats, percentileBasisNote, PEER_MIN_N, type MetricVectors } from "./percentiles";

const AT = "2026-08-01T00:00:00.000Z";

/** A MetricVectors from one column of values, ids "e0".."eN". */
function vectors(cols: Record<string, Array<number | null>>): MetricVectors {
  const keys = Object.keys(cols);
  const n = cols[keys[0]].length;
  const out: MetricVectors = new Map();
  for (let i = 0; i < n; i++) {
    const rec: Record<string, number | null> = {};
    for (const k of keys) rec[k] = cols[k][i];
    out.set(`e${i}`, rec);
  }
  return out;
}

const STATES: Array<[string, string]> = [["48", "TX"], ["06", "CA"], ["36", "NY"], ["12", "FL"]];

/** n county features through the real builder, spread evenly over four states. */
function counties(n: number): LayerFeature[] {
  const points: AreaPointIn[] = [];
  const jobs = new Map<string, JobsRow>();
  const home = new Map<string, HomeValue>();
  for (let i = 0; i < n; i++) {
    const [fips, usps] = STATES[i % STATES.length];
    const geoid = fips + String(Math.floor(i / STATES.length) + 1).padStart(3, "0");
    points.push({ geoid, name: `County ${geoid}`, stusab: usps, lon: -100 + (i % 50), lat: 30 + (i % 20) });
    jobs.set(geoid, {
      area: geoid,
      period: "2026 Q1",
      estabs: 100 + i,
      emp: 1000 + i,
      wages: 2.5e9 + i,
      avgWeeklyWage: 900 + i,
      yoy: { estabs: 1, emp: 2, wages: 3, avgWeeklyWage: 4 },
      suppressed: false,
    });
    home.set(geoid, { id: geoid, name: `County ${geoid}`, sizeRank: i, asOf: "2026-07-31", latest: 100_000 + i * 100, yoyPct: (i % 11) - 5, y5Pct: 20, monthly: [], yearly: [] });
  }
  return buildAreaPoints(points, "county", { jobs, home, rent: new Map(), stateNames: new Map() });
}

beforeEach(() => {
  upstream.calls = 0;
  upstream.features = [];
  upstream.failed = [];
  metroMembers.counties = [];
  for (const k of ["county:us", "county:state:TX", "county:metro:41700", "state:us", "metro:us"]) cacheDelete(`places:pct:${k}`);
});

describe("cohortTable", () => {
  const col = [1, 2, 2, 3, 4, null];
  const t = () => cohortTable(vectors({ "home.latest": col, lonely: [42, null, null, null, null, null], "jobs.wages": [2.5e12, 1, 2, 3, 4, null] }), ["home.latest", "lonely", "jobs.wages"], "county:us", "US counties", AT);
  const stat = (id: string, metric: string) => t().byId.get(id)![metric];

  it("takes its percentiles from percentileRanks untouched", () => {
    const want = percentileRanks(col);
    const table = t();
    col.forEach((_, i) => {
      expect(table.byId.get(`e${i}`)!["home.latest"].pct).toBe(want[i]);
    });
    expect(want.slice(0, 5)).toEqual([0, 37.5, 37.5, 75, 100]);
  });

  it("ranks by counting strictly greater values, so the largest is 1 and ties share the smaller rank", () => {
    expect(col.map((_, i) => stat(`e${i}`, "home.latest").rank)).toEqual([5, 3, 3, 2, 1, null]);
  });

  it("counts published values, not rows, and excludes nulls", () => {
    expect(stat("e0", "home.latest").n).toBe(5);
    expect(stat("e5", "home.latest").pct).toBeNull();
    expect(stat("e5", "home.latest").rank).toBeNull();
    expect(stat("e5", "home.latest").reason).toBe("not published this period");
  });

  it("refuses to rank a lone value rather than calling it the 100th percentile", () => {
    const s = stat("e0", "lonely");
    expect(s.value).toBe(42);
    expect(s.pct).toBeNull();
    expect(s.pct).not.toBe(100);
    expect(s.rank).toBeNull();
    expect(s.n).toBe(1);
    expect(s.reason).toContain("too few to rank");
    expect(s.median).toBeNull();
  });

  it("refuses a whole cohort below PEER_MIN_N published values", () => {
    const four = cohortTable(vectors({ m: [1, 2, 2, 3] }), ["m"], "county:us", "US counties", AT);
    const ranks = [0, 1, 2, 3].map((i) => four.byId.get(`e${i}`)!.m);
    expect(ranks.map((s) => s.pct)).toEqual([null, null, null, null]);
    expect(ranks.map((s) => s.n)).toEqual([4, 4, 4, 4]);
    expect(ranks[3].reason).toContain(`fewer than ${PEER_MIN_N}`);
  });

  it("round-trips a value in the trillions exactly (Float64, not Float32)", () => {
    const s = stat("e0", "jobs.wages");
    expect(s.value).toBe(2.5e12);
    expect(s.max).toBe(2.5e12);
    expect(s.rank).toBe(1);
  });

  it("publishes the cohort quartiles and carries its key and label on every stat", () => {
    const s = stat("e3", "home.latest");
    expect(s).toMatchObject({ value: 3, min: 1, max: 4, median: 2, cohortKey: "county:us", cohortLabel: "US counties" });
    expect(t().metrics).toEqual(["home.latest", "lonely", "jobs.wages"]);
    expect(t().ok).toBe(true);
  });

  it("returns undefined for an entity that is not in the table", () => {
    expect(t().byId.get("e99")).toBeUndefined();
    expect(t().byId.has("e0")).toBe(true);
    expect(t().byId.size).toBe(6);
  });
});

describe("peerStats", () => {
  it("ranks a county against the national cohort and reads the entity set once", async () => {
    upstream.features = counties(3000);
    const p = await peerStats("county", "48001", [{ kind: "national", of: "county" }]);
    const s = p["home.latest"][0];
    expect(s.n).toBe(3000);
    expect(s.value).toBe(100_000);
    expect(s.rank).toBe(3000);
    expect(s.pct).toBe(0);
    expect(s.cohortLabel).toBe("US counties");
    expect(s.reason).toBeUndefined();
    expect(p["jobs.avgWeeklyWage"][0].rank).toBe(3000);
    expect(upstream.calls).toBe(1);
    await peerStats("county", "48001", [{ kind: "national", of: "county" }]);
    expect(upstream.calls).toBe(1);
  });

  it("does not throw when the entity set resolves empty, and names the sources that failed", async () => {
    upstream.features = [];
    upstream.failed = ["bls-qcew", "zillow-zhvi"];
    const p = await peerStats("county", "48001", [{ kind: "national", of: "county" }]);
    const s = p["home.latest"][0];
    expect(s.pct).toBeNull();
    expect(s.rank).toBeNull();
    expect(s.n).toBe(0);
    expect(s.reason).toContain("bls-qcew");
    expect(s.reason).toContain("zillow-zhvi");
    expect(Object.keys(p)).toContain("priceToRent");
  });

  it("evicts an unavailable cohort so the next request retries instead of inheriting the outage", async () => {
    upstream.features = [];
    upstream.failed = ["bls-qcew"];
    await peerStats("county", "48001", [{ kind: "national", of: "county" }]);
    await peerStats("county", "48001", [{ kind: "national", of: "county" }]);
    expect(upstream.calls).toBe(2);
  });

  it("scopes a state cohort by the geoid prefix and names the state", async () => {
    upstream.features = counties(3000);
    const p = await peerStats("county", "48001", [{ kind: "state", usps: "TX" }]);
    const s = p["home.latest"][0];
    expect(s.cohortLabel).toBe("Texas counties");
    expect(s.cohortKey).toBe("county:state:TX");
    expect(s.n).toBe(750);
    expect(s.rank).toBe(750);
  });

  it("refuses a metro cohort the manifest cannot fill", async () => {
    upstream.features = counties(3000);
    metroMembers.counties = ["48001", "48002", "48003"];
    const p = await peerStats("county", "48001", [{ kind: "metro", cbsa: "41700" }]);
    const s = p["home.latest"][0];
    expect(s.pct).toBeNull();
    expect(s.reason).toContain("3 counties");
    expect(s.reason).toContain(`fewer than ${PEER_MIN_N}`);
    expect(s.cohortLabel).toBe("counties in the San Antonio-New Braunfels metro");
    // A refusal is decided from the manifest alone; no upstream is touched.
    expect(upstream.calls).toBe(0);
  });

  it("returns one stat per cohort, in the order asked", async () => {
    upstream.features = counties(3000);
    const p = await peerStats("county", "48001", [{ kind: "national", of: "county" }, { kind: "state", usps: "TX" }]);
    expect(p["home.latest"].map((s) => s.cohortKey)).toEqual(["county:us", "county:state:TX"]);
  });
});

describe("percentileBasisNote", () => {
  it("says 0 is the smallest entity, not the share with none below", () => {
    const note = percentileBasisNote();
    expect(note).toContain("smallest");
    expect(note).toContain("0 means smallest, not none below");
    expect(note).toContain("not the share of entities below");
  });
});
