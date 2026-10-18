// Okapi BM25 over record text, shared by the palette's "By meaning" group (lib/embed/gatedHybrid.ts,
// through RecordIndex) and the search evals (lib/embed/__eval__/retrievers.ts re-exports it). Moved
// here unchanged from retrievers.ts on 2026-10-18 so production and the evals rank with one
// implementation; the parity test (bm25.test.ts) pins the old eval's results.
//
// Bm25Index can add and remove documents one at a time, so the browser can keep it in step with the
// loaded records without rebuilding. Bm25 is the same index built once from a list, as the evals use it.
// Pure; no dependencies.

/** The records eval's stop list (run-records-eval-run3.mts), unchanged so BM25 matches the word-overlap arm. */
export const STOP: ReadonlySet<string> = new Set(
  "a an and the of in on to for or with at by from is are be that this still need needs no yes".split(" "),
);

/**
 * Lower case, split on anything not a-z or 0-9, drop one-letter tokens and STOP words, fold one
 * trailing "s". Note what this cannot do: "no" and "yes" are stop words, so "helipad: No" and
 * "helipad: Yes" tokenize alike, and BM25 is as blind to that polarity as word overlap was.
 */
export function tokenize(s: string, stop: ReadonlySet<string> = STOP): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !stop.has(w))
    .map((w) => w.replace(/s$/, ""));
}

/** The distinct query terms BM25 scores on, in first-seen order. */
export const queryTerms = (q: string): string[] => [...new Set(tokenize(q))];

export interface Bm25Params {
  /** Term-frequency saturation. 1.2 is the usual default; not tuned here. */
  k1: number;
  /** Length normalisation. 0.75 is the usual default; not tuned here. */
  b: number;
}

export const BM25_DEFAULTS: Bm25Params = { k1: 1.2, b: 0.75 };

export interface Bm25Hit {
  id: string;
  score: number;
}

/** A BM25 hit with how many of the query's distinct terms the document contains. */
export interface Bm25DetailedHit extends Bm25Hit {
  matched: number;
  /** Distinct query terms (after tokenize); 0 when the query is all stop words. */
  terms: number;
}

interface Entry {
  id: string;
  seq: number;
  tf: Map<string, number>;
  len: number;
}

/**
 * Okapi BM25 with the Lucene idf, log(1 + (N - df + 0.5) / (df + 0.5)), which stays positive for
 * terms in more than half the docs (field labels such as "state" are in most of a card's texts).
 * Scores are only comparable within one query. idf and the mean length are read at query time, so
 * adding or removing a document changes them for the next search, as a rebuild would.
 */
export class Bm25Index {
  private readonly entries = new Map<string, Entry>();
  private readonly postings = new Map<string, Set<Entry>>();
  private totalLen = 0;
  private seq = 0;

  constructor(readonly params: Bm25Params = BM25_DEFAULTS) {}

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Add a document; an id already present is replaced (and goes to the back of the tie order). */
  add(id: string, text: string): void {
    if (this.entries.has(id)) this.remove(id);
    const tf = new Map<string, number>();
    for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const len = [...tf.values()].reduce((s, x) => s + x, 0);
    const e: Entry = { id, seq: this.seq++, tf, len };
    this.entries.set(id, e);
    this.totalLen += len;
    for (const t of tf.keys()) {
      const p = this.postings.get(t);
      if (p) p.add(e);
      else this.postings.set(t, new Set([e]));
    }
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    this.totalLen -= e.len;
    for (const t of e.tf.keys()) {
      const p = this.postings.get(t)!;
      p.delete(e);
      if (!p.size) this.postings.delete(t);
    }
  }

  /** Docs with score > 0, best first, at most `n`; ties broken by insertion order (stable). */
  search(q: string, n: number): Bm25Hit[] {
    return this.searchDetailed(q, n).map(({ id, score }) => ({ id, score }));
  }

  /** As search, with each hit's count of matched query terms. */
  searchDetailed(q: string, n: number): Bm25DetailedHit[] {
    const { k1, b } = this.params;
    const terms = queryTerms(q);
    const N = this.entries.size;
    const avgLen = this.totalLen / Math.max(1, N);
    const score = new Map<Entry, { s: number; m: number }>();
    for (const t of terms) {
      const p = this.postings.get(t);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
      for (const e of p) {
        const f = e.tf.get(t)!;
        const s = (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * e.len) / avgLen));
        const had = score.get(e);
        if (had) {
          had.s += s;
          had.m++;
        } else score.set(e, { s, m: 1 });
      }
    }
    return [...score]
      .sort((x, y) => y[1].s - x[1].s || x[0].seq - y[0].seq)
      .slice(0, n)
      .map(([e, v]) => ({ id: e.id, score: v.s, matched: v.m, terms: terms.length }));
  }

  /** A term's idf now; a term in no document gets the largest idf possible (df 0). */
  idf(term: string): number {
    const N = this.entries.size;
    const df = this.postings.get(term)?.size ?? 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }

  /** The query terms a document contains (empty for an unknown id). */
  matchedTerms(id: string, terms: ReadonlyArray<string>): string[] {
    const e = this.entries.get(id);
    return e ? terms.filter((t) => e.tf.has(t)) : [];
  }

  /** How many of the query's distinct terms a document contains (0 for an unknown id). */
  matched(id: string, terms: ReadonlyArray<string>): number {
    const e = this.entries.get(id);
    return e ? terms.filter((t) => e.tf.has(t)).length : 0;
  }
}

/** A Bm25Index built once over a list of documents, in list order (the evals' form). */
export class Bm25 extends Bm25Index {
  constructor(
    readonly docs: ReadonlyArray<{ id: string; text: string }>,
    params: Bm25Params = BM25_DEFAULTS,
  ) {
    super(params);
    for (const d of docs) this.add(d.id, d.text);
  }
}
