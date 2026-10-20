# breaks/1: committed breaks

The cut points a styled layer bins against, one file per layer and measure, each with where it came from. A break computed from the features in view moves when the camera does, so none is: the map reads these files, and `lib/globe/invariance.test.ts` checks that a feature gets the same class in any two views.

| Folder | Files | Input | Read by |
|---|---|---|---|
| `health/` | 40, one per CDC PLACES county measure | `inputs/health/<MEASURE>.json`: the county pull the app itself asks for, with the url, retrieval time, last-modified and sha256 of the body CDC sent | the health layer (counties and tracts), the `/api/civic?op=health` reply, the legend |
| `npl-status/`, `ust-releases-county/`, `ust-facilities-county/`, `fuds-properties/` | 1 each, the export's headline measure (`npl_active` at 2025, `ust_release_count`, `ust_facility_count`, `fuds_properties`) | the committed export in `lib/catalog/data/`, whose meta lists the publisher layer, its fetch time and the sha256 of every page fetched | nothing yet: no styled layer draws a place export |

`breaks.schema.json` is the schema. `lib/breaks/index.ts` is the one reader (`placesBreaks(measure)`, `scaleOf(file)`, `tractCaveat(file)`).

## Commands (from `apps/map`)

```
node scripts/export-breaks.mjs                       # fetch the 40 PLACES pulls (one request per 1.1 s), rewrite inputs and breaks
node scripts/export-breaks.mjs --offline             # rewrite every file from the committed inputs; prints which bytes changed
node scripts/export-breaks.mjs --offline --check     # the same in memory; exit 1 if any file differs
node scripts/export-breaks.mjs --recompute DIABETES  # refetch the URL the file cites, compare sha256 and breaks, exit 1 on a difference
```

`lib/breaks/breaks.test.ts` runs the offline rule in CI: it rebuilds all 44 files from the committed inputs and compares bytes, and recomputes every file's breaks again with code that is neither the script's nor the app's.

## Methods

- `quintile-nearest-rank` (PLACES): sort the published county values; `breaks[i] = sorted[min(n-1, floor(q*n))]` for q = 0.2, 0.4, 0.6, 0.8. This is `quintiles()` in `lib/civic/places.ts`, the function the app has always used. A value's bin is the number of breaks it is at or above (`binOf`).
- `zero-bin-quartile-nearest-rank` (place exports): counts are mostly 0, so 0 is its own bin; the breaks are the smallest nonzero value and the nearest-rank quartiles of the nonzero values, a repeated cut point dropped.

## What the files do not say

- PLACES tracts are CDC's crude prevalence and the breaks are cut from age-adjusted county values. A tract is binned on its counties' breaks anyway; the legend says so (`tractCaveat`).
- `n` counts units with a value; `nNull` counts units of the universe with none. Those take no bin and are drawn "not published", never 0.
- The place exports' breaks are for the headline measure only. Another feature of the same export needs its own file.
