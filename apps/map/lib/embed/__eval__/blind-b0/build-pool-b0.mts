// B0 fresh blind set: pool the top 8 of bm25 and hybrid (retrievers.ts, pinned potion model) for each
// of the 60 frozen queries on the B0 corpus, dedupe on (query id, record text), shuffle (mulberry32,
// seed = first 8 hex of the queries sha256), and write:
//   judge/pool.jsonl      id, query, text only (what the rater reads)
//   pool-map.json         pair -> query and doc ids, and each arm's ranked list (the rater never reads it)
//
//   npx vite-node -c vitest.config.ts <this> <worktree> <queries.blind.json> <sha256> <outDir>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { potionNode } from "@/lib/embed/loadNode";
import { distinctDocs, retrievers, type Hit } from "@/lib/embed/__eval__/retrievers";

const [root, qPath, expectSha, outDir] = process.argv.slice(2);
const K = 8;
const qraw = readFileSync(qPath);
const sha = createHash("sha256").update(qraw).digest("hex");
if (sha !== expectSha) throw new Error(`queries changed: ${sha}`);
const Qs: Array<{ id: string; type: string; q: string }> = JSON.parse(qraw.toString("utf8")).queries;
const craw = readFileSync(path.join(root, "lib/embed/__eval__/records-corpus.json"));
const docs = distinctDocs(JSON.parse(craw.toString("utf8")));
const byId = new Map(docs.map((d) => [d.id, d]));
const r = retrievers(potionNode(root), docs);
const ARMS = ["bm25", "hybrid", "embed_uncut"] as const;
const per = Qs.map((q) => ({ q, ranked: { bm25: r.bm25(q.q, K), hybrid: r.hybrid(q.q, K), embed_uncut: r.embed(q.q, K) } as Record<(typeof ARMS)[number], Hit[]> }));
// Only bm25 and hybrid are pooled (one rater); embed_uncut is stored for reference, not judged.
const POOLED = ["bm25", "hybrid"] as const;
const pairs = new Map<string, { queryId: string; query: string; text: string; docIds: string[] }>();
for (const { q, ranked } of per)
  for (const arm of POOLED)
    for (const h of ranked[arm]) {
      const d = byId.get(h.id)!;
      const k = `${q.id}\n${d.text}`;
      const p = pairs.get(k) ?? { queryId: q.id, query: q.q, text: d.text, docIds: [] };
      if (!p.docIds.includes(d.id)) p.docIds.push(d.id);
      pairs.set(k, p);
    }
const ordered = [...pairs.values()].sort((a, b) => (a.queryId < b.queryId ? -1 : a.queryId > b.queryId ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
let s = parseInt(expectSha.slice(0, 8), 16) >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
for (let i = ordered.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
}
const pid = new Map(ordered.map((p, i) => [`${p.queryId}\n${p.text}`, `p${String(i + 1).padStart(4, "0")}`]));
mkdirSync(path.join(outDir, "judge"), { recursive: true });
writeFileSync(path.join(outDir, "judge/pool.jsonl"), ordered.map((p) => JSON.stringify({ id: pid.get(`${p.queryId}\n${p.text}`), query: p.query, text: p.text })).join("\n") + "\n");
const pairOf = (qid: string, docId: string) => pid.get(`${qid}\n${byId.get(docId)!.text}`) ?? null;
writeFileSync(
  path.join(outDir, "pool-map.json"),
  JSON.stringify(
    {
      note: "RATERS MUST NOT READ THIS FILE.",
      queries: { sha256: sha, n: Qs.length },
      corpus: { sha256: createHash("sha256").update(craw).digest("hex"), distinctDocs: docs.length },
      pooled: POOLED,
      k: K,
      pairs: Object.fromEntries(ordered.map((p) => [pid.get(`${p.queryId}\n${p.text}`), { queryId: p.queryId, docIds: p.docIds }])),
      ranked: per.map(({ q, ranked }) => ({ id: q.id, type: q.type, arms: Object.fromEntries(ARMS.map((a) => [a, ranked[a].map((h) => ({ docId: h.id, card: byId.get(h.id)!.card, pair: pairOf(q.id, h.id), score: Math.round(h.score * 1e6) / 1e6 }))])) })),
    },
    null,
    1,
  ) + "\n",
);
console.log(JSON.stringify({ queries: Qs.length, pairs: ordered.length, bm25Empty: per.filter((p) => !p.ranked.bm25.length).length }));
