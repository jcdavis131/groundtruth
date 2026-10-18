// The gate the palette's "By meaning" group uses (lib/embed/gatedHybrid.ts), frozen before blind
// set C's pool is built (writeups/panel-2026-10-18b/gate/PREREG.md). Do not change it after set C
// is seen: a change needs a new blind set.
//
// Chosen 2026-10-18 on DEV data only, by lib/embed/__eval__/gate-dev/gate-dev.mts (output beside it
// in dev-results.json):
//   - the handwritten records eval: records-queries.json over records-corpus.json (89 real queries,
//     37 controls with nothing relevant loaded);
//   - the original blind set, lib/embed/__eval__/blind/ (100 queries: 66 with a relevant record,
//     34 without), its grades re-matched to the B0 record text through B0's prev-map.json (all
//     1,597 judged pairs re-match), gain the mean of the two raters.
// blind-b0 and set C were not used.
//
// Rule: "list". Show the uncut hybrid's top 8 (RRF of BM25 and cosine) when either
//   - the best cosine of any loaded record to the query is >= 0.40, or
//   - some record in BM25's top 50 contains more than half of the query's distinct words (stop
//     words dropped, one trailing "s" folded): share >= 0.6, so 2 of 2, 2 of 3, 3 of 4, 3 of 5;
// otherwise show nothing.
//
// Dev numbers (nDCG@8 on queries with a relevant record / empty there / shows a row on queries
// with nothing relevant / nDCG gain over the shipped arm, 95% CI):
//   hand   0.802 / 0.079 / 0.189 (7 of 37) / +0.260 [0.190, 0.333]
//   blind  0.579 / 0.197 / 0.471 (16 of 34) / +0.175 [0.092, 0.263]
// The shipped arm (cosine >= 0.5) there: hand 0.542 / 0.292 / 0.054; blind 0.404 / 0.424 / 0.265.
// The uncut hybrid: hand 0.861 / 0 / 1; blind 0.671 / 0 / 1.

import type { GateConfig } from "./gatedHybrid";

export const GATE_CONFIG: Readonly<GateConfig> = Object.freeze({ rule: "list", coverage: "terms", t: 0.4, c: 0.6 });
