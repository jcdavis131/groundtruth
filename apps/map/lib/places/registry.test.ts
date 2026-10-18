import { describe, expect, it } from "vitest";
import {
  MANIFEST,
  allCbsa,
  allCountyFips,
  allUsps,
  countiesInMetro,
  countiesInState,
  countyByFips,
  countyLabel,
  isKnownStateFips,
  metroByCbsa,
  metroForCounty,
  metrosInState,
  neighbours,
  stateByFips,
  stateByUsps,
} from "./registry";

// The US bounding box including Alaska, Hawaii and Puerto Rico. Loose on
// purpose: the point of the assertion is to catch a swapped lon/lat or a
// transcription slip, not to fence a centroid.
const WEST = -180;
const EAST = -64;
const SOUTH = 17;
const NORTH = 72;

describe("states table", () => {
  const usps = allUsps();

  it("carries every state, DC and Puerto Rico", () => {
    expect(usps.length).toBeGreaterThanOrEqual(52);
    expect(MANIFEST.stateCount).toBe(usps.length);
    expect(new Set(usps).size).toBe(usps.length);
    for (const u of usps) expect(u).toMatch(/^[A-Z]{2}$/);
    expect(usps).toContain("TX");
    expect(usps).toContain("DC");
    expect(usps).toContain("PR");
  });

  it("has a unique two-digit FIPS and a point inside the US for every state", () => {
    const seen = new Set<string>();
    for (const u of usps) {
      const s = stateByUsps(u);
      expect(s, u).not.toBeNull();
      if (!s) continue;
      expect(s.fips).toMatch(/^[0-9]{2}$/);
      expect(seen.has(s.fips), s.fips).toBe(false);
      seen.add(s.fips);
      expect(stateByFips(s.fips)?.usps).toBe(u);
      expect(isKnownStateFips(s.fips)).toBe(true);
      expect(Number.isFinite(s.lon) && Number.isFinite(s.lat), u).toBe(true);
      expect(s.lon, u).toBeGreaterThan(WEST);
      expect(s.lon, u).toBeLessThan(EAST);
      expect(s.lat, u).toBeGreaterThan(SOUTH);
      expect(s.lat, u).toBeLessThan(NORTH);
      expect(s.name.length).toBeGreaterThan(3);
    }
  });

  it("rejects a FIPS prefix that is not a state", () => {
    expect(isKnownStateFips("99")).toBe(false);
    expect(isKnownStateFips("03")).toBe(false);
    expect(stateByUsps("ZZ")).toBeNull();
  });

  it("looks a state up case-insensitively", () => {
    expect(stateByUsps("tx")?.fips).toBe("48");
  });
});

describe("metros table", () => {
  const cbsas = allCbsa();

  it("is complete at the 393 OEWS metropolitan areas", () => {
    expect(MANIFEST.metrosComplete).toBe(true);
    expect(cbsas.length).toBe(393);
    expect(MANIFEST.metroCount).toBe(393);
    expect(new Set(cbsas).size).toBe(393);
  });

  it("gives every metro a five-digit CBSA, a point and states that resolve", () => {
    for (const cbsa of cbsas) {
      const m = metroByCbsa(cbsa);
      expect(m, cbsa).not.toBeNull();
      if (!m) continue;
      expect(m.cbsa).toMatch(/^[0-9]{5}$/);
      expect(m.name.length).toBeGreaterThan(2);
      expect(m.short).toMatch(/^[^|]+\|[A-Z]{2}$/);
      expect(m.states.length, m.name).toBeGreaterThan(0);
      for (const u of m.states) expect(stateByUsps(u), `${m.name} -> ${u}`).not.toBeNull();
      expect(Number.isFinite(m.lon) && Number.isFinite(m.lat), m.name).toBe(true);
      expect(m.lon, m.name).toBeGreaterThan(WEST);
      expect(m.lon, m.name).toBeLessThan(EAST);
      expect(m.lat, m.name).toBeGreaterThan(SOUTH);
      expect(m.lat, m.name).toBeLessThan(NORTH);
      expect(["exact", "short", "counties", null]).toContain(m.zillowMatchedBy);
      if (m.zillowMatchedBy) expect(m.zillowRegionId, m.name).toMatch(/^[0-9]+$/);
      else expect(m.zillowRegionId, m.name).toBeNull();
    }
  });

  it("indexes metros by state", () => {
    const tx = metrosInState("TX").map((m) => m.cbsa);
    expect(tx).toContain("41700");
    expect(tx.length).toBeGreaterThan(10);
    // "Kansas City, MO-KS" is a member of both of its states.
    expect(metrosInState("MO").map((m) => m.cbsa)).toContain("28140");
    expect(metrosInState("KS").map((m) => m.cbsa)).toContain("28140");
  });

  it("returns null for a CBSA that is not published", () => {
    expect(metroByCbsa("99999")).toBeNull();
  });
});

describe("counties table", () => {
  const fips = allCountyFips();

  it("reports its own completeness honestly", () => {
    expect(typeof MANIFEST.countiesComplete).toBe("boolean");
    expect(MANIFEST.countyCount).toBe(fips.length);
    expect(MANIFEST.cbsaMethod.length).toBeGreaterThan(0);
    if (!MANIFEST.countiesComplete) expect(MANIFEST.pulled).toBeNull();
  });

  it("gives every row a resolvable state and a point", () => {
    for (const g of fips) {
      const c = countyByFips(g);
      expect(c, g).not.toBeNull();
      if (!c) continue;
      expect(c.geoid).toMatch(/^[0-9]{5}$/);
      expect(c.geoid.slice(2)).not.toBe("000");
      const state = stateByFips(c.stateFips);
      expect(state, g).not.toBeNull();
      expect(state?.usps).toBe(c.stusab);
      expect(c.stateName).toBe(state?.name);
      expect(c.stateFips).toBe(c.geoid.slice(0, 2));
      expect(Number.isFinite(c.lon) && Number.isFinite(c.lat), g).toBe(true);
    }
  });

  it("labels a county the way a breadcrumb wants it", () => {
    const travis = countyByFips("48453");
    expect(travis).not.toBeNull();
    if (travis) expect(countyLabel(travis)).toBe("Travis County, TX");
  });

  it("indexes the rows it has by state", () => {
    expect(countiesInState("TX").map((c) => c.geoid)).toContain("48453");
    expect(countiesInState("tx").map((c) => c.geoid)).toContain("48453");
  });

  // Everything below is only meaningful once scripts/places-data.mjs has run
  // against a host with egress; a seed build has no adjacency and no CBSA.
  it("holds every county with symmetric adjacency once pulled", () => {
    if (!MANIFEST.countiesComplete) {
      expect(fips.length).toBeGreaterThan(0);
      return;
    }
    // A range, not a count: Connecticut's planning regions moved the list and
    // will move it again.
    expect(fips.length).toBeGreaterThanOrEqual(3100);
    expect(fips.length).toBeLessThanOrEqual(3300);
    for (const g of fips) {
      const c = countyByFips(g);
      if (!c) continue;
      for (const n of c.adj) {
        const other = countyByFips(n);
        expect(other, `${g} -> ${n}`).not.toBeNull();
        expect(other?.adj, `${n} -> ${g}`).toContain(g);
      }
    }
    expect(neighbours("48453").length).toBeGreaterThan(0);
  });

  it("agrees with the metro table about membership once pulled", () => {
    if (!MANIFEST.countiesComplete) return;
    for (const cbsa of allCbsa()) {
      const m = metroByCbsa(cbsa);
      if (!m) continue;
      // Every one of the 393 OMB metros has member counties, and each of them
      // points back at the metro.
      expect(m.counties.length, cbsa).toBeGreaterThan(0);
      for (const g of m.counties) {
        expect(countyByFips(g), `${cbsa} -> ${g}`).not.toBeNull();
        expect(countyByFips(g)?.cbsa, `${g} -> ${cbsa}`).toBe(cbsa);
      }
    }
    // Travis is Austin (12420), not San Antonio (41700); Bexar is San Antonio.
    expect(countiesInMetro("12420").map((c) => c.geoid).sort()).toEqual(["48021", "48055", "48209", "48453", "48491"]);
    expect(countiesInMetro("41700").map((c) => c.geoid)).toContain("48029");
    expect(countiesInMetro("31080").map((c) => c.geoid)).toContain("06037");
    expect(metroForCounty("48453")?.cbsa).toBe("12420");
    expect(metroForCounty("48029")?.cbsa).toBe("41700");
    expect(metroForCounty("06037")?.cbsa).toBe("31080");
  });

  it("is the full 2023 county-equivalent universe, Connecticut as planning regions", () => {
    if (!MANIFEST.countiesComplete) return;
    // 3,144 county equivalents in the 50 states and DC, plus 78 Puerto Rico
    // municipios. The island areas are not in the state table.
    expect(fips.length).toBe(3222);
    expect(countiesInState("PR")).toHaveLength(78);
    expect(fips.filter((g) => g.slice(0, 2) !== "72")).toHaveLength(3144);
    expect(countiesInState("CT").map((c) => c.geoid).sort()).toEqual(["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"]);
    expect(countyByFips("09001")).toBeNull();
    expect(MANIFEST.pulled).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it("carries micropolitan membership without inventing a metro for it", () => {
    if (!MANIFEST.countiesComplete) return;
    const assigned = fips.map((g) => countyByFips(g)!).filter((c) => c.cbsa);
    // OMB July 2023: 1,252 metropolitan and 663 micropolitan counties.
    expect(assigned).toHaveLength(1915);
    expect(assigned.filter((c) => metroByCbsa(c.cbsa!))).toHaveLength(1252);
    // Brown County, SD is the Aberdeen micropolitan area: a CBSA, not a metro.
    expect(countyByFips("46013")?.cbsa).toBe("10100");
    expect(metroByCbsa("10100")).toBeNull();
    expect(metroForCounty("46013")).toBeNull();
    // Blanco County, TX is outside every CBSA.
    expect(countyByFips("48031")?.cbsa).toBeNull();
    expect(metroForCounty("48031")).toBeNull();
  });
});
