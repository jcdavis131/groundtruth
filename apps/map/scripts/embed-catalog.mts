// Embed every catalogue card's own prose (lib/catalog/cardText.ts) with the
// pinned potion-base-8M and write lib/catalog/data/card-vectors.json. Rerun
// whenever a card's title, what, recordIs or shelf changes; the test in
// lib/catalog/cardIndex.test.ts fails while the file is stale. Only our own
// card prose is embedded; no record is.
//
//   npx vite-node --config vitest.config.ts scripts/embed-catalog.mts

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allCardTexts } from "@/lib/catalog/cardText";
import { POTION } from "@/lib/embed/pins";
import { potionNode } from "@/lib/embed/loadNode";

const model = potionNode();
const cards = allCardTexts().map(({ id, text }) => {
  const v = model.embed(text);
  if (!v) throw new Error(`${id}: no vector`);
  return { id, textSha256: createHash("sha256").update(text).digest("hex"), vector: Array.from(v, (x) => Number(x.toFixed(6))) };
});
const out = path.resolve("lib/catalog/data/card-vectors.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    embedder: { id: model.id, model: POTION.model, commit: POTION.commit, tableSha256: POTION.derived["table.i8"] },
    what: "each catalogue card's title, what, recordIs and shelf (lib/catalog/cardText.ts), embedded; our own prose, no record",
    generatedBy: "scripts/embed-catalog.mts",
    cards,
  }) + "\n",
);
console.log(`wrote ${cards.length} card vectors to ${out}`);
