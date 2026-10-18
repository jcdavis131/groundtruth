// The catalogue cards by meaning: their committed vectors
// (lib/catalog/data/card-vectors.json, from scripts/embed-catalog.mts), the
// ranking a query vector gets against them, and each card's nearest cards
// ("related collections"). Pure; the query is embedded by the caller.
//
// Scores are cosines between text embeddings of our card descriptions: they
// say two descriptions read alike, not that the collections' data agree.

import data from "./data/card-vectors.json";
import { POTION_ID } from "@/lib/embed/pins";
import { assertSameSpace, dot } from "@/lib/embed/types";
import { COLLECTIONS, collection, type Collection } from "./collections";

export interface CardVectors {
  embedder: { id: string; model: string; commit: string; tableSha256: string };
  cards: Array<{ id: string; textSha256: string; vector: number[] }>;
}

export const CARD_VECTORS = data as CardVectors;
assertSameSpace(CARD_VECTORS.embedder, { id: POTION_ID });

export interface CardHit {
  id: string;
  title: string;
  layer: Collection["layer"];
  /** Cosine to the query, 4 decimals. */
  score: number;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Cards ranked by cosine to an L2-normalised query vector, best first. */
export function rankCards(q: ArrayLike<number>, limit = 5): CardHit[] {
  return CARD_VECTORS.cards
    .map((c) => ({ c, s: dot(q, c.vector) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(0, limit))
    .map(({ c, s }) => {
      const card = collection(c.id)!;
      return { id: c.id, title: card.title, layer: card.layer, score: round(s) };
    });
}

/** A card's k nearest other cards by the same vectors. */
export function relatedCards(id: string, k = 3): CardHit[] {
  const me = CARD_VECTORS.cards.find((c) => c.id === id);
  if (!me) return [];
  return rankCards(me.vector, COLLECTIONS.length)
    .filter((h) => h.id !== id)
    .slice(0, k);
}
