// The one interface every text embedder goes through, so a second model
// (MiniLM through onnxruntime, say) is another implementation rather than a
// rewrite. Every vector index records the embedder's id, and comparing vectors
// from two ids is a hard error, never a silent cosine across two spaces.

declare const embedInputBrand: unique symbol;

/**
 * Text that may be embedded. Only the constructors in lib/catalog/recordText.ts
 * make one (recordText, cardText, queryText), so a record's denied fields cannot
 * reach an embedder by accident: a raw string does not compile.
 */
export type EmbedInput = string & { readonly [embedInputBrand]: "EmbedInput" };

export interface Embedder {
  /** e.g. "potion-base-8M@bf8b0566-int8". */
  id: string;
  dims: number;
  /** An L2-normalised vector, or null when no token of the text is in the vocabulary (never a zero or NaN vector). */
  embed(text: EmbedInput): Float32Array | null;
}

/** Cosine of two L2-normalised vectors (their dot product). */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Throws unless a stored vector set was made by this embedder. */
export function assertSameSpace(stored: { id: string }, embedder: { id: string }): void {
  if (stored.id !== embedder.id) throw new Error(`vectors are from ${stored.id}, the embedder is ${embedder.id}`);
}
