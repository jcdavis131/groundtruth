// County similarity embeddings, model "county-sim-v1".
//
// Each county is a point in a small standardized feature space; "places like
// this" is k-nearest neighbours by Euclidean distance. v1 features are all
// Zillow (home values + rents); jobs/wages/water terms are the named v2
// extension (see the model card). Pure functions, CPU-only, zero deps.
//
// The served bundle (apps/map/lib/ml/data/county_sim_v1.json, built by
// scripts/ml-build-county-sim.mjs from the live Zillow files) carries the
// standardized vectors; this module does the lookup.

export const SIM_VERSION = "county-sim-v1";

export interface CountyVector {
  fips: string;
  name: string;
  state: string;
  features: number[];
}

/**
 * [12-month change, 5-year change, 10-year change] from a monthly value
 * history (oldest first). Null when fewer than 121 months are present.
 */
export function trajectoryFeatures(values: (number | null)[]): number[] | null {
  const v = values.filter((x) => x != null) as number[];
  if (v.length < 121) return null;
  const n = v.length;
  const chg = (back: number, span: number) => v[n - 1 - back] / v[n - 1 - back - span] - 1;
  const f = [chg(0, 12), chg(0, 60), chg(0, 120)];
  if (f.some((x) => !Number.isFinite(x) || Math.abs(x) > 10)) return null;
  return f;
}

export function standardize(vecs: CountyVector[]): { mean: number[]; sd: number[] } {
  const p = vecs[0].features.length;
  const mean = new Array(p).fill(0);
  const sd = new Array(p).fill(0);
  for (const v of vecs) for (let j = 0; j < p; j++) mean[j] += v.features[j];
  for (let j = 0; j < p; j++) mean[j] /= vecs.length;
  for (const v of vecs) for (let j = 0; j < p; j++) sd[j] += (v.features[j] - mean[j]) ** 2;
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / vecs.length) || 1;
  return { mean, sd };
}

export function applyStandardize(features: number[], mean: number[], sd: number[]): number[] {
  return features.map((x, j) => (x - mean[j]) / sd[j]);
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2;
  return Math.sqrt(s);
}

export interface Nearest {
  fips: string;
  name: string;
  state: string;
  distance: number;
}

/** k nearest counties to `fips` (excluding itself), smallest distance first. */
export function nearest(z: Map<string, { name: string; state: string; z: number[] }>, fips: string, k: number): Nearest[] {
  const me = z.get(fips);
  if (!me) return [];
  const out: Nearest[] = [];
  for (const [id, c] of z) {
    if (id === fips) continue;
    out.push({ fips: id, name: c.name, state: c.state, distance: euclidean(me.z, c.z) });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, Math.max(0, k));
}

/** Similarity in (0, 1]: 1 = identical. For the ">" assertions in tests. */
export function similarity(distance: number): number {
  return 1 / (1 + distance);
}
