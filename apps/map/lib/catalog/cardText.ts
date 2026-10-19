// A catalogue card's own prose as embeddable text, for the card index
// (lib/catalog/data/card-vectors.json, /api/catalog?op=search, the palette's
// Collections group and /catalog's related collections). With recordText and
// queryText (lib/catalog/recordText.ts), one of the three constructors of an
// EmbedInput.

import type { EmbedInput } from "@/lib/embed/types";
import { COLLECTIONS, SHELVES, type Collection } from "./collections";

/**
 * A card's own prose: title, what it holds, what a record is, and its shelf. Not its
 * sensitivity line, caveats or exclusions (they are about the data's limits and would pull
 * "personal data" toward every card) and not its source ids.
 */
export function cardText(c: Collection): EmbedInput {
  const shelf = SHELVES.find((s) => s.layers.includes(c.layer));
  return `${c.title}. ${c.what} ${c.recordIs}${shelf ? ` Shelf: ${shelf.title}.` : ""}` as EmbedInput;
}

/** Every card's text, in catalogue order (the input to scripts/embed-catalog). */
export function allCardTexts(): Array<{ id: string; text: EmbedInput }> {
  return COLLECTIONS.map((c) => ({ id: c.id, text: cardText(c) }));
}
