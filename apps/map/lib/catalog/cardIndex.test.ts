// The committed card vectors must be today's: a card whose prose changed
// without rerunning scripts/embed-catalog.mts fails here, so stale vectors
// cannot ship. Also the ranking and related-collections helpers.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { potionNode } from "@/lib/embed/loadNode";
import { POTION, POTION_ID } from "@/lib/embed/pins";
import { dot } from "@/lib/embed/types";
import { CARD_VECTORS, rankCards, relatedCards } from "./cardIndex";
import { allCardTexts } from "./cardText";
import { COLLECTIONS } from "./collections";
import { queryText } from "./recordText";

describe("the card index", () => {
  it("holds one vector per card, from the pinned embedder, matching today's card text", () => {
    expect(CARD_VECTORS.embedder).toMatchObject({ id: POTION_ID, commit: POTION.commit, tableSha256: POTION.derived["table.i8"] });
    const model = potionNode();
    const texts = allCardTexts();
    expect(CARD_VECTORS.cards.map((c) => c.id)).toEqual(texts.map((t) => t.id));
    for (const [i, { id, text }] of texts.entries()) {
      const stored = CARD_VECTORS.cards[i];
      expect(stored.textSha256, `${id}: card text changed; rerun scripts/embed-catalog.mts`).toBe(createHash("sha256").update(text).digest("hex"));
      expect(dot(model.embed(text)!, stored.vector), id).toBeGreaterThanOrEqual(0.9999);
    }
  });

  it("ranks cards best first with rounded scores, and relates a card to others only", () => {
    const v = potionNode().embed(queryText("leaking underground fuel tanks")!)!;
    const hits = rankCards(v, 5);
    expect(hits).toHaveLength(5);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    for (const h of hits) expect(COLLECTIONS.map((c) => c.id)).toContain(h.id);
    const rel = relatedCards("fuds-properties", 3);
    expect(rel).toHaveLength(3);
    expect(rel.map((r) => r.id)).not.toContain("fuds-properties");
    expect(relatedCards("nope")).toEqual([]);
  });
});
