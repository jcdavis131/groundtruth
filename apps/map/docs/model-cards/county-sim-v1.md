# Model card — county-sim-v1

**What it is:** county similarity embeddings — "places like this".
Each county is a point in a small standardized feature space; similarity is
k-nearest neighbours by Euclidean distance. Served on arxiviq.com (market
report panel, MCP `similar_places`).

**Method.** v1 features per county (latest Zillow vintage): 12-month ZHVI
change, 5-year ZHVI change, 10-year ZHVI change, 12-month ZORI rent change.
Standardized across counties (z-scores); distance = Euclidean on the
z-vectors; similarity = 1/(1+distance). No training, no labels — a
deterministic transform, so there is nothing to overfit.

**Data vintage.** Zillow county ZHVI + ZORI (see bundle `source`).
Rebuild: `node scripts/ml-build-county-sim.mjs` (from `apps/map`).
Bundle: `apps/map/lib/ml/data/county_sim_v1.json`. Served by
`apps/map/app/api/ml/route.ts`.

**Validation.** 10 same-metro vs distant pairs spot-checked on real data, all
pass (e.g., Travis↔Williamson 0.50 vs Travis↔Preble 6.43; Manhattan↔Brooklyn
3.52 vs Manhattan↔Preble 7.24). Test: `apps/map/lib/ml/county_sim.test.ts`.

**What would invalidate it.** v1 uses home values + rents only — two counties
can look alike on housing while differing on jobs, wages, or water stress.
**Jobs/wages/water terms are the named v2 extension.** Counties with no Zillow
rent row get the mean rent term (documented in the bundle). Treat similarity
as "similar housing trajectories", not "similar places" in full.

**Limits.** Descriptive, not advice. Distance is in standardized-change
space, not dollars or miles.
