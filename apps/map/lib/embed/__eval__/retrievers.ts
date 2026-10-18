// Retrievers for the blind search evals (writeups/eye-embeddings-2026-10-16/search-eval). Since
// 2026-10-18 BM25 (lib/embed/bm25.ts) and RRF (lib/embed/rrf.ts) live in production code, shared with
// the palette's gated hybrid (lib/embed/gatedHybrid.ts); this file re-exports them unchanged so the
// eval scripts keep their imports.
//
//   embedRanker  cosine of the query vector to each record vector, the palette's arm, but with no
//                tau: the eval pools the top-n and picks tau afterwards on the blind set only.
//   Bm25         Okapi BM25 over the same record text, with the tokenizer the records eval used for
//                its word-overlap arm (DESIGN runs 1-4), so the two lexical arms are comparable.
//   rrf          reciprocal-rank fusion of any ranked lists (the hybrid is rrf([bm25, embed])).
//
// Documents are distinct (card, record text) pairs, as in DESIGN run 3 onwards: thousands of
// loaded records share a text (617 RCRA rows have one), and a pool of top-10 identical texts
// would judge one record ten times. Each doc keeps its loaded count `n` for reporting.
//
// Pure apart from the embedder it is given; no dependency beyond the repo's own embed code.

import { queryText, receivedRecordText } from "@/lib/catalog/recordText";
import { Bm25 } from "@/lib/embed/bm25";
import { FUSION_DEPTH, rrf, type Hit } from "@/lib/embed/rrf";
import { dot, type Embedder } from "@/lib/embed/types";

export { BM25_DEFAULTS, Bm25, STOP, tokenize, type Bm25Params } from "@/lib/embed/bm25";
export { FUSION_DEPTH, RRF_K, rrf, type Hit } from "@/lib/embed/rrf";

export interface Doc {
  /** `${card}\t${text}`: unique per distinct (card, record text). */
  id: string;
  card: string;
  text: string;
  /** How many loaded records carry this text. */
  n: number;
}

export const docId = (card: string, text: string) => `${card}\t${text}`;

/** Collapse corpus rows ({card, embedText, n}) to distinct (card, text) docs, summing n. */
export function distinctDocs(rows: ReadonlyArray<{ card: string; embedText: string; n: number }>): Doc[] {
  const m = new Map<string, Doc>();
  for (const r of rows) {
    const id = docId(r.card, r.embedText);
    const had = m.get(id);
    if (had) had.n += r.n;
    else m.set(id, { id, card: r.card, text: r.embedText, n: r.n });
  }
  return [...m.values()];
}

// ---------------------------------------------------------------- embedding

/**
 * The palette's meaning arm over distinct docs, without tau: every doc is ranked by cosine.
 * Record text goes through receivedRecordText and the query through queryText, as in the palette,
 * so an over-long or empty query returns no hits rather than a different embedding.
 */
export function embedRanker(embedder: Embedder, docs: ReadonlyArray<Doc>) {
  const vecs: Array<{ id: string; v: Float32Array }> = [];
  for (const d of docs) {
    const t = receivedRecordText({ extra: { embedText: d.text } });
    const v = t ? embedder.embed(t) : null;
    if (v) vecs.push({ id: d.id, v });
  }
  return {
    size: vecs.length,
    search(q: string, n: number): Hit[] {
      const t = queryText(q);
      const qv = t ? embedder.embed(t) : null;
      if (!qv) return [];
      return vecs
        .map((e, i) => ({ id: e.id, score: dot(qv, e.v), i }))
        .sort((x, y) => y.score - x.score || x.i - y.i)
        .slice(0, n)
        .map(({ id, score }) => ({ id, score }));
    },
  };
}

// ---------------------------------------------------------------- fusion and pooling

/** The three arms over one corpus, and the judging pool (union of each arm's top `depth`). */
export function retrievers(embedder: Embedder, docs: ReadonlyArray<Doc>) {
  const bm25 = new Bm25(docs);
  const embed = embedRanker(embedder, docs);
  const hybrid = (q: string, n: number) => rrf([bm25.search(q, FUSION_DEPTH), embed.search(q, FUSION_DEPTH)], n);
  return {
    bm25: (q: string, n: number) => bm25.search(q, n),
    embed: (q: string, n: number) => embed.search(q, n),
    hybrid,
    /** Distinct doc ids in any arm's top `depth` (10 for the blind eval), in first-seen order: bm25, embed, hybrid. */
    pool(q: string, depth = 10): string[] {
      const ids = new Set<string>();
      for (const arm of [bm25.search(q, depth), embed.search(q, depth), hybrid(q, depth)]) for (const h of arm) ids.add(h.id);
      return [...ids];
    },
  };
}
