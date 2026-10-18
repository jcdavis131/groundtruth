// The gated hybrid: record search by meaning that ranks like the eval's uncut hybrid (RRF of BM25
// and embedding cosine, each fed at FUSION_DEPTH) and then shows only what a gate lets through, so
// a query with nothing relevant loaded shows nothing, or fewer rows.
//
// Documents are distinct record texts. The palette groups loaded records by text (RecordIndex) and
// shows one row per text; the evals feed distinct texts directly. Both call rankHybrid and applyGate
// below, so the same loaded texts give the same rows in both. Ties go by insertion order.
//
// A doc's coverage of a query is the share of the query's distinct non-stop terms (bm25.ts tokenize)
// it contains, counted one of two ways:
//   terms  matched terms / query terms.
//   idf    the matched terms' idf / all query terms' idf. Rare words weigh more, and a word in no
//          loaded record weighs most, so "wind turbines" matching only "wind" covers little.
//
// Gate rules (lib/embed/gateConfig.ts freezes which one ships, and its numbers):
//   per-hit  keep a fused hit if its cosine >= t, or its coverage >= c.
//   list     show the fused top k only if the best cosine anywhere >= t, or the best coverage among
//            BM25's top FUSION_DEPTH >= c; else show nothing.
//   both     the list gate (t, c), then the per-hit gate (tHit, cHit) on what it shows.
// A query that is all stop words has no terms, so only cosine can open the gate for it.
//
// Pure; no React.

import { Bm25Index, queryTerms } from "./bm25";
import { FUSION_DEPTH, RRF_K, rrf } from "./rrf";
import { dot } from "./types";

export type GateRule = "per-hit" | "list" | "both";
export type CoverageMode = "terms" | "idf";

export interface GateConfig {
  rule: GateRule;
  /** How coverage is counted (default "terms"). */
  coverage?: CoverageMode;
  /** Cosine threshold (per-hit: the hit's own; list and both: the best cosine for the query). */
  t: number;
  /** Coverage threshold, 0..1 (above 1 means coverage never opens the gate). */
  c: number;
  /** "both" only: the per-hit cosine threshold applied after the list gate. */
  tHit?: number;
  /** "both" only: the per-hit coverage threshold applied after the list gate. */
  cHit?: number;
}

/** Rows shown (RECORD_ROWS in the palette). */
export const GATED_ROWS = 8;

export interface HybridHit {
  id: string;
  /** RRF score, the ranking key. */
  rrf: number;
  /** Cosine of the query vector to the doc's vector. */
  cosine: number;
  /** BM25 score, or null when the doc is not in BM25's top FUSION_DEPTH. */
  bm25: number | null;
  /** Coverage of the query, both ways (0 when the query has no terms). */
  coverage: Record<CoverageMode, number>;
}

export interface HybridRanking {
  /** Fused list, best first, excluded docs already removed. */
  hits: HybridHit[];
  /** Best cosine over every non-excluded doc (-Infinity when there are none). */
  maxCosine: number;
  /** Best coverage among BM25's top FUSION_DEPTH, both ways (0 when BM25 matched nothing). */
  maxCoverage: Record<CoverageMode, number>;
  terms: number;
}

/** Distinct record texts with their vectors and a BM25 index, kept in step one text at a time. */
export class HybridCorpus {
  readonly bm25 = new Bm25Index();
  private readonly vecs = new Map<string, Float32Array>();

  get size(): number {
    return this.vecs.size;
  }

  has(id: string): boolean {
    return this.vecs.has(id);
  }

  add(id: string, text: string, v: Float32Array): void {
    this.vecs.delete(id);
    this.vecs.set(id, v);
    this.bm25.add(id, text);
  }

  remove(id: string): void {
    this.vecs.delete(id);
    this.bm25.remove(id);
  }

  vector(id: string): Float32Array | undefined {
    return this.vecs.get(id);
  }

  /** Every doc by cosine, best first, ties by insertion order. */
  embedRank(qv: Float32Array, skip?: (id: string) => boolean): Array<{ id: string; score: number }> {
    const out: Array<{ id: string; score: number; i: number }> = [];
    let i = 0;
    for (const [id, v] of this.vecs) {
      if (!skip?.(id)) out.push({ id, score: dot(qv, v), i });
      i++;
    }
    return out.sort((x, y) => y.score - x.score || x.i - y.i).map(({ id, score }) => ({ id, score }));
  }
}

/**
 * The uncut hybrid over a corpus: RRF (k RRF_K) of BM25's and the embedding's top FUSION_DEPTH,
 * excluded docs dropped from each list before it is cut, as the eval's `hybrid` ranks (retrievers.ts).
 * `q` should already be the palette's queryText.
 */
export function rankHybrid(corpus: HybridCorpus, q: string, qv: Float32Array, skip?: (id: string) => boolean): HybridRanking {
  const terms = queryTerms(q);
  const idf = new Map(terms.map((t) => [t, corpus.bm25.idf(t)]));
  const idfAll = terms.reduce((s, t) => s + idf.get(t)!, 0);
  const cover = (id: string): Record<CoverageMode, number> => {
    if (!terms.length) return { terms: 0, idf: 0 };
    const m = corpus.bm25.matchedTerms(id, terms);
    return { terms: m.length / terms.length, idf: m.reduce((s, t) => s + idf.get(t)!, 0) / idfAll };
  };
  const lex = corpus.bm25
    .search(q, Infinity)
    .filter((h) => !skip?.(h.id))
    .slice(0, FUSION_DEPTH);
  const all = corpus.embedRank(qv, skip);
  const sem = all.slice(0, FUSION_DEPTH);

  const lexScore = new Map(lex.map((h) => [h.id, h.score]));
  const hits = rrf([lex, sem], Infinity, RRF_K).map(({ id, score }) => ({ id, rrf: score, cosine: dot(qv, corpus.vector(id)!), bm25: lexScore.get(id) ?? null, coverage: cover(id) }));
  const lexCover = lex.map((h) => cover(h.id));
  return {
    hits,
    maxCosine: all.length ? all[0].score : -Infinity,
    maxCoverage: { terms: Math.max(0, ...lexCover.map((x) => x.terms)), idf: Math.max(0, ...lexCover.map((x) => x.idf)) },
    terms: terms.length,
  };
}

/** Apply a gate to a ranking: at most `k` hits, in fused order. */
export function applyGate(r: HybridRanking, cfg: GateConfig, k: number = GATED_ROWS): HybridHit[] {
  const mode = cfg.coverage ?? "terms";
  const opens = (cos: number, cov: number, t: number, c: number) => cos >= t || (cov > 0 && cov >= c);
  const top = r.hits.slice(0, k);
  const hitGate = (t: number, c: number) => top.filter((h) => opens(h.cosine, h.coverage[mode], t, c));
  const listOpen = opens(r.maxCosine, r.maxCoverage[mode], cfg.t, cfg.c);
  switch (cfg.rule) {
    case "per-hit":
      return hitGate(cfg.t, cfg.c);
    case "list":
      return listOpen ? top : [];
    case "both":
      return listOpen ? hitGate(cfg.tHit ?? cfg.t, cfg.cHit ?? cfg.c) : [];
  }
}

/** Rank and gate in one call: what the palette shows for a query, as doc ids with their signals. */
export function gatedHybrid(corpus: HybridCorpus, q: string, qv: Float32Array, cfg: GateConfig, opts: { k?: number; skip?: (id: string) => boolean } = {}): HybridHit[] {
  return applyGate(rankHybrid(corpus, q, qv, opts.skip), cfg, opts.k ?? GATED_ROWS);
}
