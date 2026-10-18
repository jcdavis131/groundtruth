// Reciprocal-rank fusion, shared by the palette's gated hybrid (lib/embed/gatedHybrid.ts) and the
// search evals (lib/embed/__eval__/retrievers.ts re-exports it). Moved here unchanged on 2026-10-18.

export interface Hit {
  id: string;
  score: number;
}

/** The usual RRF constant (Cormack et al. 2009); not tuned here. */
export const RRF_K = 60;

/** Depth each arm feeds into RRF before fusion. */
export const FUSION_DEPTH = 50;

/**
 * Reciprocal-rank fusion: each doc scores sum over lists of 1 / (k + rank), rank from 1. A doc
 * missing from a list gets nothing from it. Ties broken by first appearance across the lists.
 */
export function rrf(lists: ReadonlyArray<ReadonlyArray<Hit>>, n: number, k: number = RRF_K): Hit[] {
  const score = new Map<string, number>();
  const first = new Map<string, number>();
  let seq = 0;
  for (const list of lists)
    list.forEach((h, r) => {
      score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + r + 1));
      if (!first.has(h.id)) first.set(h.id, seq++);
    });
  return [...score]
    .sort((x, y) => y[1] - x[1] || first.get(x[0])! - first.get(y[0])!)
    .slice(0, n)
    .map(([id, s]) => ({ id, score: s }));
}
