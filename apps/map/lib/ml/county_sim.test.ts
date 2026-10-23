// Evidence contract for SPEC-1.2 (county-sim-v1).
// Fixture is REAL Zillow county ZHVI (lib/ml/fixtures/zhvi_counties.json,
// captured 2026-10-23) — the pairs below were verified on that data before
// being written here. Network-free.
import { describe, expect, it } from "vitest";
import {
  applyStandardize,
  euclidean,
  nearest,
  similarity,
  standardize,
  trajectoryFeatures,
  type CountyVector,
} from "./county_sim";
import fixture from "./fixtures/zhvi_counties.json";

interface FixtureCounty {
  fips: string;
  name: string;
  state: string;
  months: string[];
  values: (number | null)[];
}

function buildSpace(): Map<string, { name: string; state: string; z: number[] }> {
  const vecs: CountyVector[] = [];
  for (const c of fixture as FixtureCounty[]) {
    const f = trajectoryFeatures(c.values);
    if (f) vecs.push({ fips: c.fips, name: c.name, state: c.state, features: f });
  }
  const { mean, sd } = standardize(vecs);
  const z = new Map<string, { name: string; state: string; z: number[] }>();
  for (const v of vecs) z.set(v.fips, { name: v.name, state: v.state, z: applyStandardize(v.features, mean, sd) });
  return z;
}

// [anchor, near (same metro), far] — same-metro must be strictly more similar.
const PAIRS: Array<[string, string, string, string]> = [
  ["48453", "48491", "39135", "Travis↔Williamson (Austin) beats Travis↔Preble (rural OH)"],
  ["36061", "36047", "39135", "Manhattan↔Brooklyn beats Manhattan↔Preble"],
  ["17031", "17043", "39135", "Cook↔DuPage (Chicago) beats Cook↔Preble"],
  ["08031", "08005", "39135", "Denver↔Arapahoe beats Denver↔Preble"],
  ["12086", "12011", "39135", "Miami-Dade↔Broward beats Miami-Dade↔Preble"],
  ["48085", "48121", "39135", "Collin↔Denton (DFW) beats Collin↔Preble"],
  ["36103", "36059", "39135", "Suffolk↔Nassau (Long Island) beats Suffolk↔Preble"],
  ["53033", "53061", "39135", "King↔Snohomish (Seattle) beats King↔Preble"],
  ["13121", "13135", "39135", "Fulton↔Gwinnett (Atlanta) beats Fulton↔Preble"],
  ["39035", "39153", "48453", "Cuyahoga↔Summit (Cleveland) beats Cuyahoga↔Travis"],
];

describe("county_sim", () => {
  it("same-metro counties are more similar than distant ones (10 spot-checked pairs)", () => {
    const z = buildSpace();
    for (const [a, b, c, label] of PAIRS) {
      const za = z.get(a)!.z;
      const dab = euclidean(za, z.get(b)!.z);
      const dac = euclidean(za, z.get(c)!.z);
      expect(similarity(dab), label).toBeGreaterThan(similarity(dac));
    }
  });

  it("Travis TX ↔ Williamson TX is more similar than Travis TX ↔ Loving-like rural (SPEC example shape)", () => {
    const z = buildSpace();
    const dNear = euclidean(z.get("48453")!.z, z.get("48491")!.z);
    const dFar = euclidean(z.get("48453")!.z, z.get("39135")!.z);
    expect(dNear).toBeLessThan(dFar);
  });

  it("nearest() returns k neighbours, smallest distance first, excluding self", () => {
    const z = buildSpace();
    const res = nearest(z, "48453", 5);
    expect(res).toHaveLength(5);
    expect(res.every((r) => r.fips !== "48453")).toBe(true);
    for (let i = 1; i < res.length; i++) expect(res[i].distance).toBeGreaterThanOrEqual(res[i - 1].distance);
    // Williamson County (Austin metro) should be the single nearest to Travis.
    expect(res[0].fips).toBe("48491");
  });

  it("unknown fips returns [] (honest, never invented)", () => {
    expect(nearest(buildSpace(), "99999", 5)).toEqual([]);
  });
});
