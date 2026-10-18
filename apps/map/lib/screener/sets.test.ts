// Entity set assembly with every upstream reader replaced by fixtures: the
// degraded path (a set that succeeds with nothing in it) must resolve, say
// which sources failed, and NOT stay in the hourly cache.
import { describe, expect, it, vi } from "vitest";
import { countyJoins, COUNTY_POINTS } from "@/lib/screener/fixtures";

const state = { fail: false, calls: 0 };

vi.mock("@/lib/economy/sources", () => {
  const joins = countyJoins();
  const down = (what: string) => async () => {
    throw new Error(`${what} down`);
  };
  return {
    WPI: { source: "fixture", pulled: "2026-01-01", ports: [] },
    COUNTRIES: { source: "fixture", pulled: "2026-01-01", features: [] },
    tigerCountyPoints: async () => {
      state.calls += 1;
      return COUNTY_POINTS;
    },
    tigerStates: async () => [],
    stateLookup: async () => new Map([["48", { stusab: "TX", name: "Texas" }], ["06", { stusab: "CA", name: "California" }], ["36", { stusab: "NY", name: "New York" }], ["38", { stusab: "ND", name: "North Dakota" }]]),
    qcewLatest: async () => {
      if (state.fail) return down("bls")();
      return { year: 2026, qtr: 1, period: "2026 Q1", counties: joins.jobs, states: new Map() };
    },
    zillow: async (kind: string) => {
      if (state.fail) return down("zillow")();
      return { kind, asOf: "2026-07-31", rows: kind === "zoriCounty" ? joins.rent : joins.home, byName: new Map(), byShort: new Map() };
    },
    btsPortStats: down("bts"),
    borderCrossings: async () => ({ asOf: "2026-06", rows: [] }),
    worldBank: async () => ({ stats: new Map(), failed: [] }),
  };
});

import { areaSet, entitySet, featureFor } from "./sets";
import { cached, cacheDelete } from "@/lib/server/cache";

describe("areaSet", () => {
  it("builds county features with provenance and nothing failed", async () => {
    state.fail = false;
    const set = await areaSet("county");
    // The Aleutians fixture has neither jobs nor a home value and is dropped.
    expect(set.features).toHaveLength(5);
    expect(set.features.map((f) => f.properties.id)).toContain("county:48453");
    expect(set.provenance.length).toBeGreaterThan(0);
    expect(set.failed).toEqual([]);
    expect(set.caveats).toEqual([]);
    expect(typeof set.assembledAt).toBe("string");
  });

  it("resolves with an empty set when the joins fail, naming each source", async () => {
    state.fail = true;
    const set = await areaSet("county");
    expect(set.features).toEqual([]);
    expect(set.failed).toEqual(["bls-qcew", "zillow-zhvi", "zillow-zori"]);
    for (const id of ["bls-qcew", "zillow-zhvi", "zillow-zori"]) {
      expect(set.caveats.some((c) => c.includes(id))).toBe(true);
    }
    state.fail = false;
  });
});

describe("entitySet", () => {
  it("caches a non-empty set but evicts an empty one", async () => {
    state.fail = true;
    state.calls = 0;
    expect((await entitySet("county")).features).toEqual([]);
    expect((await entitySet("county")).features).toEqual([]);
    // Empty means degraded, not answered: the second call re-produced.
    expect(state.calls).toBe(2);

    state.fail = false;
    state.calls = 0;
    expect((await entitySet("county")).features).toHaveLength(5);
    expect((await entitySet("county")).features).toHaveLength(5);
    expect(state.calls).toBe(1);
  });
});

describe("featureFor", () => {
  it("finds a feature by layer id and returns undefined for a miss", async () => {
    state.fail = false;
    const set = await areaSet("county");
    expect(featureFor(set, "county:06037")?.properties.name).toBe("Los Angeles County, CA");
    expect(featureFor(set, "county:99999")).toBeUndefined();
  });
});

describe("cacheDelete", () => {
  it("removes an entry so the next cached() call re-produces", async () => {
    let n = 0;
    const produce = async () => ++n;
    expect((await cached("sets.test:delete", 60_000, produce)).value).toBe(1);
    expect((await cached("sets.test:delete", 60_000, produce)).value).toBe(1);
    cacheDelete("sets.test:delete");
    expect((await cached("sets.test:delete", 60_000, produce)).value).toBe(2);
  });
});
