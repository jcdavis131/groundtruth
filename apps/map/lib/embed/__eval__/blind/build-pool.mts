// Blind search eval, steps 4-5: pool the top-10 of four arms for each blind query, then write
// the judging pool with no system or rank information.
//
//   embed_uncut  cosine over distinct (card, record text) docs, no tau (retrievers.ts embedRanker)
//   embed_tau    embed_uncut's top-10 kept only where score >= RECORD_TAU (what the palette shows)
//   bm25         Okapi BM25, k1 1.2, b 0.75, the records-eval tokenizer
//   hybrid       RRF (k 60) of bm25 and embed_uncut, each fed at FUSION_DEPTH
//
// Pairs are deduplicated on (query id, record text): the same text under two cards is shown to
// the judges once and the grade applies to every doc id listed for that pair in pool-map.json.
// Order is deterministic, then shuffled with a seeded mulberry32; pair ids are assigned after the
// shuffle, so id order is file order and says nothing about rank or system.
//
// Run from the worktree (so @/ resolves through vitest.config.ts):
//   npx vite-node -c vitest.config.ts <this file> <worktree> <queries.blind.json> <sha256> <outDir>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { potionNode } from "@/lib/embed/loadNode";
import { RECORD_TAU } from "@/lib/embed/recordTau";
import { BM25_DEFAULTS, FUSION_DEPTH, RRF_K, distinctDocs, retrievers, type Hit } from "@/lib/embed/__eval__/retrievers";

const [root, queriesPath, expectSha, outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: build-pool.mts <worktree> <queries.blind.json> <sha256> <outDir>");
const DEPTH = 10;

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const qraw = readFileSync(queriesPath);
if (sha(qraw) !== expectSha) throw new Error(`queries.blind.json changed: ${sha(qraw)}`);
type Q = { id: string; type: string; q: string };
const Qs: Q[] = JSON.parse(qraw.toString("utf8")).queries;
if (Qs.length !== 100 || new Set(Qs.map((q) => q.id)).size !== 100) throw new Error("expected 100 distinct queries");

const corpusPath = path.join(root, "lib/embed/__eval__/records-corpus.json");
const craw = readFileSync(corpusPath);
const rows = JSON.parse(craw.toString("utf8"));
const docs = distinctDocs(rows);
const byId = new Map(docs.map((d) => [d.id, d]));
const r = retrievers(potionNode(root), docs);

const ARMS = ["embed_uncut", "embed_tau", "bm25", "hybrid"] as const;
type Arm = (typeof ARMS)[number];
const round = (x: number) => Math.round(x * 1e6) / 1e6;

const perQuery = Qs.map((q) => {
  const uncut = r.embed(q.q, DEPTH);
  const ranked: Record<Arm, Hit[]> = {
    embed_uncut: uncut,
    embed_tau: uncut.filter((h) => h.score >= RECORD_TAU),
    bm25: r.bm25(q.q, DEPTH),
    hybrid: r.hybrid(q.q, DEPTH),
  };
  return { q, ranked };
});

// Pairs keyed on (query id, text).
type Pair = { queryId: string; query: string; text: string; docIds: string[] };
const pairs = new Map<string, Pair>();
for (const { q, ranked } of perQuery)
  for (const arm of ARMS)
    for (const h of ranked[arm]) {
      const d = byId.get(h.id)!;
      const key = `${q.id}\n${d.text}`;
      const p = pairs.get(key) ?? { queryId: q.id, query: q.q, text: d.text, docIds: [] };
      if (!p.docIds.includes(d.id)) p.docIds.push(d.id);
      pairs.set(key, p);
    }

const ordered = [...pairs.values()].sort((a, b) => (a.queryId < b.queryId ? -1 : a.queryId > b.queryId ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
const SEED = parseInt(expectSha.slice(0, 8), 16) >>> 0;
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
for (let i = ordered.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
}
const width = String(ordered.length).length < 4 ? 4 : String(ordered.length).length;
const pairId = new Map<string, string>();
ordered.forEach((p, i) => pairId.set(`${p.queryId}\n${p.text}`, `p${String(i + 1).padStart(width, "0")}`));

// pool.jsonl: judges read this. id, query, text only.
const lines = ordered.map((p) => JSON.stringify({ id: pairId.get(`${p.queryId}\n${p.text}`), query: p.query, text: p.text }));
writeFileSync(path.join(outDir, "pool.jsonl"), lines.join("\n") + "\n");

// pool-map.json: judges must not read this.
const pidFor = (qid: string, docId: string) => pairId.get(`${qid}\n${byId.get(docId)!.text}`)!;
const map = {
  note: "JUDGES MUST NOT READ THIS FILE. Pair-to-system map for the blind search eval pool.",
  provenance: {
    builtAt: new Date().toISOString(),
    retrieversCommit: process.env.RETRIEVERS_COMMIT ?? null,
    originMaster: process.env.ORIGIN_MASTER ?? null,
    queries: { file: "blind/queries.blind.json", sha256: expectSha, n: Qs.length },
    corpus: { file: "lib/embed/__eval__/records-corpus.json", sha256: sha(craw), rows: rows.length, records: docs.reduce((s, d) => s + d.n, 0), distinctDocs: docs.length, cards: new Set(docs.map((d) => d.card)).size },
    depth: DEPTH,
    recordTau: RECORD_TAU,
    bm25: BM25_DEFAULTS,
    rrfK: RRF_K,
    fusionDepth: FUSION_DEPTH,
    shuffle: { prng: "mulberry32", seed: SEED, seedFrom: "first 8 hex of the queries sha256", order: "sorted by (query id, text) before shuffle" },
    pairKey: "(query id, record text); a grade applies to every docId listed for the pair",
  },
  pairs: Object.fromEntries(ordered.map((p) => [pairId.get(`${p.queryId}\n${p.text}`), { queryId: p.queryId, docIds: p.docIds }])),
  queries: perQuery.map(({ q, ranked }) => ({
    id: q.id,
    type: q.type,
    arms: Object.fromEntries(ARMS.map((a) => [a, ranked[a].map((h, i) => ({ rank: i + 1, pair: pidFor(q.id, h.id), docId: h.id, card: byId.get(h.id)!.card, n: byId.get(h.id)!.n, score: round(h.score) }))])),
  })),
};
writeFileSync(path.join(outDir, "pool-map.json"), JSON.stringify(map, null, 1) + "\n");

// Counts only (no row content) to stdout.
const perQ = new Map<string, number>();
for (const p of ordered) perQ.set(p.queryId, (perQ.get(p.queryId) ?? 0) + 1);
const byType: Record<string, { queries: number; pairs: number; min: number; max: number; bm25Empty: number; tauEmpty: number; tauRows: number }> = {};
for (const { q, ranked } of perQuery) {
  const t = (byType[q.type] ??= { queries: 0, pairs: 0, min: Infinity, max: 0, bm25Empty: 0, tauEmpty: 0, tauRows: 0 });
  const n = perQ.get(q.id) ?? 0;
  t.queries++;
  t.pairs += n;
  t.min = Math.min(t.min, n);
  t.max = Math.max(t.max, n);
  if (!ranked.bm25.length) t.bm25Empty++;
  if (!ranked.embed_tau.length) t.tauEmpty++;
  t.tauRows += ranked.embed_tau.length;
}
console.log(JSON.stringify({ pairs: ordered.length, multiDocPairs: ordered.filter((p) => p.docIds.length > 1).length, byType, provenance: map.provenance }, null, 1));
