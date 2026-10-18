// An in-memory vector index of the records loaded on the globe, built on
// demand in the browser from each feature's record text
// (properties.extra.embedText, written by recordText in the route builders).
// Features without record text are skipped. Nothing is persisted: the index
// is rebuilt per session from what is loaded, so it can never outlive the
// records' freshness. Pure apart from the embedder it is given.
//
// Records that share a text share one vector, and each distinct text is one
// document of a BM25 index kept in step with the same features (`hybrid`), so
// searchGated can rank by the gated hybrid (lib/embed/gatedHybrid.ts) with one
// row per distinct text.

import { receivedRecordText } from "@/lib/catalog/recordText";
import type { LayerFeature } from "@/lib/layers/types";
import { GATED_ROWS, HybridCorpus, gatedHybrid, type GateConfig, type HybridHit } from "./gatedHybrid";
import { dot, type Embedder } from "./types";

/**
 * At most this many record vectors (1 KB each, so about 20 MB). Chosen, not measured: real
 * loaded-feature counts per session have not been recorded. Past it, the oldest entries go.
 */
export const RECORD_INDEX_CAP = 20_000;

export const featureKey = (f: LayerFeature) => `${f.properties.layer}:${f.properties.id}`;

export interface RecordHit {
  feature: LayerFeature;
  /** Cosine of the query to the record's text. */
  score: number;
  /** The gated hybrid's signals for this row (searchGated only). */
  hybrid?: HybridHit;
}

export class RecordIndex {
  private readonly vecs = new Map<string, { text: string; v: Float32Array; f: LayerFeature }>();
  /** Distinct text -> keys of the loaded records carrying it, in load order. */
  private readonly groups = new Map<string, Set<string>>();
  /** One document per distinct text (id = the text), for the gated hybrid. */
  readonly hybrid = new HybridCorpus();

  constructor(
    readonly embedder: Embedder,
    private readonly cap = RECORD_INDEX_CAP,
  ) {}

  get size(): number {
    return this.vecs.size;
  }

  /** Distinct record texts held. */
  get texts(): number {
    return this.groups.size;
  }

  private drop(k: string): void {
    const e = this.vecs.get(k);
    if (!e) return;
    this.vecs.delete(k);
    const g = this.groups.get(e.text)!;
    g.delete(k);
    if (!g.size) {
      this.groups.delete(e.text);
      this.hybrid.remove(e.text);
    }
  }

  private put(k: string, text: string, v: Float32Array, f: LayerFeature): void {
    this.drop(k);
    this.vecs.set(k, { text, v, f });
    let g = this.groups.get(text);
    if (!g) {
      g = new Set();
      this.groups.set(text, g);
      this.hybrid.add(text, text, v);
    }
    g.add(k);
  }

  /** Make the index hold exactly the given features' record vectors (embedding only texts it does not hold yet). */
  sync(features: Iterable<LayerFeature>): void {
    const seen = new Set<string>();
    for (const f of features) {
      const text = receivedRecordText(f.properties);
      if (!text) continue;
      const k = featureKey(f);
      seen.add(k);
      const had = this.vecs.get(k);
      if (had && had.text === text) {
        had.f = f;
        continue;
      }
      const v = this.hybrid.vector(text) ?? this.embedder.embed(text);
      if (!v) continue;
      this.put(k, text, v, f);
      if (this.vecs.size > this.cap) this.drop(this.vecs.keys().next().value!);
    }
    for (const k of [...this.vecs.keys()]) if (!seen.has(k)) this.drop(k);
  }

  /** Records with cosine >= tau to the query vector, best first, skipping `exclude` keys. */
  search(q: Float32Array, k: number, tau: number, exclude: ReadonlySet<string> = new Set()): RecordHit[] {
    const hits: RecordHit[] = [];
    for (const [key, e] of this.vecs) {
      if (exclude.has(key)) continue;
      const s = dot(q, e.v);
      if (s >= tau) hits.push({ feature: e.f, score: s });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /**
   * The gated hybrid over the loaded records: one row per distinct text, at most `k`. A text whose
   * every record is in `exclude` is skipped; otherwise its row is its first loaded record not in
   * `exclude`. `q` is the query text (queryText), `qv` its vector.
   */
  searchGated(q: string, qv: Float32Array, cfg: GateConfig, k: number = GATED_ROWS, exclude: ReadonlySet<string> = new Set()): RecordHit[] {
    const pick = (text: string) => {
      for (const key of this.groups.get(text) ?? []) if (!exclude.has(key)) return key;
      return null;
    };
    const skip = exclude.size ? (text: string) => pick(text) == null : undefined;
    return gatedHybrid(this.hybrid, q, qv, cfg, { k, skip }).map((h) => ({ feature: this.vecs.get(pick(h.id)!)!.f, score: h.cosine, hybrid: h }));
  }
}
