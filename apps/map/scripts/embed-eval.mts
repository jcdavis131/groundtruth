// A report, not a gate: how often a hand-written query (lib/embed/__eval__/
// handwritten-queries.json, written by the build agent, not users) finds an
// expected catalogue card in the top 1 and top 3, by card embedding
// (op=search) and by a plain letter match on card titles (the baseline: the
// number of query words of 3+ letters found in the title). Prints JSON.
//
//   npx vite-node --config vitest.config.ts scripts/embed-eval.mts

import { readFileSync } from "node:fs";
import path from "node:path";
import { rankCards } from "@/lib/catalog/cardIndex";
import { COLLECTIONS } from "@/lib/catalog/collections";
import { queryText } from "@/lib/catalog/recordText";
import { potionNode } from "@/lib/embed/loadNode";

const set = JSON.parse(readFileSync(path.resolve("lib/embed/__eval__/handwritten-queries.json"), "utf8")) as {
  kind: string;
  queries: Array<{ q: string; expect: string[] }>;
};
const model = potionNode();

function lexical(q: string): string[] {
  const words = q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return COLLECTIONS.map((c, i) => ({ id: c.id, i, n: words.filter((w) => c.title.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .filter((x) => x.n > 0)
    .map((x) => x.id);
}

let e1 = 0, e3 = 0, l1 = 0, l3 = 0;
const rows = [];
const hitScores: number[] = [];
const missScores: number[] = [];
for (const { q, expect } of set.queries) {
  const v = model.embed(queryText(q)!);
  const ranked = v ? rankCards(v, 27) : [];
  const emb = ranked.map((h) => h.id);
  const lex = lexical(q);
  const ok = (ids: string[], k: number) => ids.slice(0, k).some((id) => expect.includes(id));
  if (ok(emb, 1)) e1++;
  if (ok(emb, 3)) e3++;
  if (ok(lex, 1)) l1++;
  if (ok(lex, 3)) l3++;
  if (ranked[0]) (expect.includes(ranked[0].id) ? hitScores : missScores).push(ranked[0].score);
  rows.push({ q, expect, embedding: ranked.slice(0, 3).map((h) => `${h.id} ${h.score}`), lexical: lex.slice(0, 3) });
}
const n = set.queries.length;
console.log(
  JSON.stringify(
    {
      set: set.kind,
      n,
      embedding: { top1: e1, top3: e3 },
      lexicalTitle: { top1: l1, top3: l3 },
      top1ScoreWhenRight: hitScores.sort(),
      top1ScoreWhenWrong: missScores.sort(),
      rows,
    },
    null,
    1,
  ),
);
