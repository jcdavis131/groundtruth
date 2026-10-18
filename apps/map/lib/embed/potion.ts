// potion-base-8M (MinishLab Model2Vec, MIT) as plain TypeScript. A static
// model: tokenise, look up one row per token, average, L2-normalise. No
// onnxruntime, no transformers.js; the same code runs in the browser, in the
// Node route and in vitest.
//
// Matches model2vec 0.10.0's StaticModel.encode with its defaults, checked
// against its output in potion.test.ts: the text cut to 512 x the
// vocabulary's median token length in characters, tokenized without special
// tokens and truncated to 512 tokens, [UNK] ids then dropped, mean of the
// rows, normalised (config.json normalize: true). A text with no known token
// is null here (model2vec returns a zero vector).
//
// The shipped table is int8 with one fp32 scale per row (row = int8 x scale);
// scripts/build-embed-weights.mjs makes it from the fp32 safetensors.

import { tokenize, vocabFromList, type WordPieceVocab } from "./tokenizer";
import type { EmbedInput, Embedder } from "./types";

export interface PotionParts {
  id: string;
  /** Tokens in id order. */
  vocab: readonly string[];
  dims: number;
  /** rows x dims, row-major. Int8Array with `scales`, or Float32Array (the reference path in tests). */
  table: Int8Array | Float32Array;
  /** One per row when `table` is int8. */
  scales?: Float32Array;
  maxTokens?: number;
}

/** model2vec: int(np.median([len(token) for token in tokens])). */
export function medianTokenLength(vocab: readonly string[]): number {
  const lens = vocab.map((t) => Array.from(t).length).sort((a, b) => a - b);
  const n = lens.length;
  const m = n % 2 ? lens[(n - 1) / 2] : (lens[n / 2 - 1] + lens[n / 2]) / 2;
  return Math.trunc(m);
}

export class Potion implements Embedder {
  readonly id: string;
  readonly dims: number;
  private readonly v: WordPieceVocab;
  private readonly table: Int8Array | Float32Array;
  private readonly scales: Float32Array | null;
  private readonly maxTokens: number;
  private readonly maxChars: number;

  constructor(p: PotionParts) {
    const rows = p.vocab.length;
    if (p.table.length !== rows * p.dims) throw new Error(`table has ${p.table.length} values, expected ${rows} x ${p.dims}`);
    if (p.table instanceof Int8Array && (!p.scales || p.scales.length !== rows)) throw new Error("an int8 table needs one scale per row");
    this.id = p.id;
    this.dims = p.dims;
    this.v = vocabFromList(p.vocab);
    this.table = p.table;
    this.scales = p.table instanceof Int8Array ? p.scales! : null;
    this.maxTokens = p.maxTokens ?? 512;
    this.maxChars = this.maxTokens * medianTokenLength(p.vocab);
  }

  /** The ids model2vec embeds: no special tokens, [UNK] dropped, truncated. */
  ids(text: string): number[] {
    const cut = Array.from(text).slice(0, this.maxChars).join("");
    // The tokenizer truncates (enable_truncation) before model2vec drops [UNK].
    return tokenize(cut, this.v)
      .slice(0, this.maxTokens)
      .filter((id) => id !== this.v.unkId);
  }

  embed(text: EmbedInput): Float32Array | null {
    return this.embedIds(this.ids(text));
  }

  embedIds(ids: readonly number[]): Float32Array | null {
    if (!ids.length) return null;
    const d = this.dims;
    const acc = new Float64Array(d);
    for (const id of ids) {
      const off = id * d;
      const s = this.scales ? this.scales[id] : 1;
      for (let j = 0; j < d; j++) acc[j] += this.table[off + j] * s;
    }
    // The mean's 1/n cancels in the normalisation.
    let norm = 0;
    for (let j = 0; j < d; j++) norm += acc[j] * acc[j];
    norm = Math.sqrt(norm);
    if (!(norm > 0)) return null;
    const out = new Float32Array(d);
    for (let j = 0; j < d; j++) out[j] = acc[j] / norm;
    return out;
  }
}
