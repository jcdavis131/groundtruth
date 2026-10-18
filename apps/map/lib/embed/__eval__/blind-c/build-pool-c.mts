// Blind set C (writeups/panel-2026-10-18b/gate/PREREG.md): pool the top 8 of four arms for each
// query, then write the judging pool with no arm, rank or score information.
//
//   bm25     Okapi BM25, k1 1.2, b 0.75, the records-eval tokenizer (lib/embed/bm25.ts)
//   hybrid   uncut: RRF (k 60) of bm25 and cosine, each fed at FUSION_DEPTH 50
//   shipped  cosine >= RECORD_TAU (0.5), top 8: the palette's arm before the gated hybrid
//   gated    the frozen gate (lib/embed/gateConfig.ts) through RecordIndex.searchGated, the code the
//            palette calls, over every loaded record of the corpus (one row per distinct text)
//
// All arms rank distinct (card, record text) docs. Pairs are deduplicated on (query id, record
// text): a text is judged once per query and the grade applies to every doc id listed for the pair
// in pool-map.json. Order is deterministic (query id, then text), then shuffled with mulberry32
// seeded from the first 8 hex of the queries' sha256; pair ids are assigned after the shuffle.
//
// The script refuses to run if gateConfig.ts is not the frozen file (GATE_SHA256 below, recorded in
// writeups/panel-2026-10-18b/gate/GATE-FROZEN.md), or if the gated arm is not a filter of the uncut
// hybrid's top 8 (which would mean the palette path and the eval path disagree).
//
// Run from the worktree (so @/ resolves through vitest.config.ts):
//   npx vite-node -c vitest.config.ts lib/embed/__eval__/blind-c/build-pool-c.mts <worktree> <queries.blind.json> <sha256> <outDir>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { queryText } from "@/lib/catalog/recordText";
import { potionNode } from "@/lib/embed/loadNode";
import { RecordIndex } from "@/lib/embed/recordIndex";
import { RECORD_TAU } from "@/lib/embed/recordTau";
import { GATE_CONFIG } from "@/lib/embed/gateConfig";
import { BM25_DEFAULTS, FUSION_DEPTH, RRF_K, distinctDocs, docId, retrievers } from "@/lib/embed/__eval__/retrievers";
import type { LayerFeature } from "@/lib/layers/types";

/** sha256 of lib/embed/gateConfig.ts as frozen in commit af69f6c (GATE-FROZEN.md). */
const GATE_SHA256 = "14b6f73fff980df099028c5589d54f2a5b870db8911ae8412622d0e2658fffe0";
const DEPTH = 8;

const [root, queriesPath, expectSha, outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: build-pool-c.mts <worktree> <queries.blind.json> <sha256> <outDir>");

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const gateRaw = readFileSync(path.join(root, "lib/embed/gateConfig.ts"));
if (sha(gateRaw) !== GATE_SHA256) throw new Error(`gateConfig.ts is not the frozen file: ${sha(gateRaw)}`);
let gateCommit: string | null = null;
try {
  gateCommit = execFileSync("git", ["-C", root, "log", "-1", "--format=%H", "--", "lib/embed/gateConfig.ts"], { encoding: "utf8" }).trim() || null;
} catch {
  gateCommit = null;
}

const qraw = readFileSync(queriesPath);
if (sha(qraw) !== expectSha) throw new Error(`queries file changed: ${sha(qraw)}`);
type Q = { id: string; type?: string; q: string };
const Qs: Q[] = JSON.parse(qraw.toString("utf8")).queries;
if (!Array.isArray(Qs) || !Qs.length) throw new Error("no queries");
if (new Set(Qs.map((q) => q.id)).size !== Qs.length) throw new Error("query ids are not distinct");
if (Qs.some((q) => typeof q.q !== "string")) throw new Error("every query needs a string q");

const corpusPath = path.join(root, "lib/embed/__eval__/records-corpus.json");
const craw = readFileSync(corpusPath);
type Row = { card: string; embedText: string; n: number };
const rows: Row[] = JSON.parse(craw.toString("utf8"));
const docs = distinctDocs(rows);
const byId = new Map(docs.map((d) => [d.id, d]));
const model = potionNode(root);
const r = retrievers(model, docs);

// The palette's index over every loaded record (rows expanded by n), as records-eval.test.ts builds it.
const cardOf = new Map<string, string>();
for (const row of rows) {
  if ((cardOf.get(row.embedText) ?? row.card) !== row.card) throw new Error("a text under two cards: the palette would show it as one row");
  cardOf.set(row.embedText, row.card);
}
const recs = rows.flatMap((row) => Array.from({ length: row.n }, () => row));
const feats = recs.map((row, i) => ({ type: "Feature", geometry: null, properties: { layer: row.card, id: String(i), name: "", extra: { embedText: row.embedText } } }) as unknown as LayerFeature);
const index = new RecordIndex(model);
index.sync(feats);

type Ranked = { id: string; score: number; rrf?: number };
const ARMS = ["bm25", "hybrid", "shipped", "gated"] as const;
type Arm = (typeof ARMS)[number];
const round = (x: number) => Math.round(x * 1e6) / 1e6;

const perQuery = Qs.map((q) => {
  const hybrid = r.hybrid(q.q, DEPTH);
  const t = queryText(q.q);
  const qv = t ? model.embed(t) : null;
  const gated: Ranked[] = t && qv ? index.searchGated(t, qv, GATE_CONFIG, DEPTH).map((h) => ({ id: docId(cardOf.get(h.hybrid!.id)!, h.hybrid!.id), score: h.score, rrf: h.hybrid!.rrf })) : [];
  // The gate only removes rows: gated must be hybrid's top 8 in order, with some taken out.
  let j = 0;
  for (const g of gated) {
    while (j < hybrid.length && hybrid[j].id !== g.id) j++;
    if (j++ >= hybrid.length) throw new Error(`gated arm is not a filter of the uncut hybrid on query ${q.id}`);
  }
  const ranked: Record<Arm, Ranked[]> = {
    bm25: r.bm25(q.q, DEPTH),
    hybrid,
    shipped: r.embed(q.q, DEPTH).filter((h) => h.score >= RECORD_TAU),
    gated,
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
const width = Math.max(4, String(ordered.length).length);
const pairId = new Map<string, string>();
ordered.forEach((p, i) => pairId.set(`${p.queryId}\n${p.text}`, `p${String(i + 1).padStart(width, "0")}`));

// judge/pool.jsonl: raters read this. id, query, text only.
mkdirSync(path.join(outDir, "judge"), { recursive: true });
const lines = ordered.map((p) => JSON.stringify({ id: pairId.get(`${p.queryId}\n${p.text}`), query: p.query, text: p.text }));
writeFileSync(path.join(outDir, "judge", "pool.jsonl"), lines.join("\n") + "\n");

// pool-map.json: raters must not read this.
const pidFor = (qid: string, id: string) => pairId.get(`${qid}\n${byId.get(id)!.text}`)!;
const map = {
  note: "RATERS MUST NOT READ THIS FILE. Pair-to-arm map for blind set C's pool.",
  provenance: {
    builtAt: new Date().toISOString(),
    headCommit: (() => {
      try {
        return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      } catch {
        return null;
      }
    })(),
    queries: { file: path.basename(queriesPath), sha256: expectSha, n: Qs.length },
    corpus: { file: "lib/embed/__eval__/records-corpus.json", sha256: sha(craw), rows: rows.length, records: index.size, distinctDocs: docs.length, cards: new Set(docs.map((d) => d.card)).size },
    depth: DEPTH,
    recordTau: RECORD_TAU,
    bm25: BM25_DEFAULTS,
    rrfK: RRF_K,
    fusionDepth: FUSION_DEPTH,
    gate: { config: GATE_CONFIG, file: "lib/embed/gateConfig.ts", sha256: GATE_SHA256, commit: gateCommit, path: "RecordIndex.searchGated over every record of the corpus" },
    shipped: "cosine over distinct docs (retrievers.ts embedRanker), top 8, kept where >= RECORD_TAU",
    shuffle: { prng: "mulberry32", seed: SEED, seedFrom: "first 8 hex of the queries sha256", order: "sorted by (query id, text) before shuffle" },
    pairKey: "(query id, record text); a grade applies to every docId listed for the pair",
  },
  pairs: Object.fromEntries(ordered.map((p) => [pairId.get(`${p.queryId}\n${p.text}`), { queryId: p.queryId, docIds: p.docIds }])),
  queries: perQuery.map(({ q, ranked }) => ({
    id: q.id,
    type: q.type ?? null,
    arms: Object.fromEntries(
      ARMS.map((a) => [a, ranked[a].map((h, i) => ({ rank: i + 1, pair: pidFor(q.id, h.id), docId: h.id, card: byId.get(h.id)!.card, n: byId.get(h.id)!.n, score: round(h.score), ...(h.rrf != null ? { rrf: round(h.rrf) } : {}) }))]),
    ),
  })),
};
writeFileSync(path.join(outDir, "pool-map.json"), JSON.stringify(map, null, 1) + "\n");

// Counts only (no row content) to stdout.
const perQ = new Map<string, number>();
for (const p of ordered) perQ.set(p.queryId, (perQ.get(p.queryId) ?? 0) + 1);
const armCounts = Object.fromEntries(ARMS.map((a) => [a, { empty: perQuery.filter((x) => !x.ranked[a].length).length, rows: perQuery.reduce((s, x) => s + x.ranked[a].length, 0) }]));
console.log(JSON.stringify({ queries: Qs.length, pairs: ordered.length, multiDocPairs: ordered.filter((p) => p.docIds.length > 1).length, pairsPerQuery: { min: Math.min(...perQ.values()), max: Math.max(...perQ.values()) }, arms: armCounts, provenance: map.provenance }, null, 1));
