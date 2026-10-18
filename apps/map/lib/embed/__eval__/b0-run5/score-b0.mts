// B0 regression check on the judged blind pool (lib/embed/__eval__/blind), plus the 17 real Q0 queries.
//
// Re-runs bm25, embed_uncut and hybrid (retrievers.ts, the pinned potion model) over a corpus, top 8,
// and grades each hit through the pinned qrels. A hit on a rebuilt doc takes the grade its run-4 text
// (prev-map.json) was given for that query; a hit whose run-4 text was never pooled for that query is
// UNJUDGED (scored 0, counted). Ideal DCG per query: every doc of this corpus whose run-4 text was judged
// for the query, at that grade (a judged run-4 text that B0 split into several docs counts once per doc).
// Q+ / Q0 are the pinned qrels' sets. Metrics as score.mjs (linear gain, k 8, lower-grade qrels).
//
//   npx vite-node -c vitest.config.ts <this> <worktree> <corpus.json> <prev-map.json | -> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { potionNode } from "@/lib/embed/loadNode";
import { distinctDocs, retrievers, docId } from "@/lib/embed/__eval__/retrievers";

const [root, corpusPath, prevPath, outPath] = process.argv.slice(2);
const K = 8;
const B = path.join(root, "lib/embed/__eval__/blind");
const qrels = JSON.parse(readFileSync(path.join(B, "qrels.json"), "utf8"));
const map = JSON.parse(readFileSync(path.join(B, "pool-map.json"), "utf8"));
const blind: Array<{ id: string; type: string; q: string }> = JSON.parse(readFileSync(path.join(B, "queries.blind.json"), "utf8")).queries;
const rows = JSON.parse(readFileSync(corpusPath, "utf8"));
const prev: Record<string, string> | null = prevPath === "-" ? null : JSON.parse(readFileSync(prevPath, "utf8"));
const docs = distinctDocs(rows);
const byId = new Map(docs.map((d) => [d.id, d]));
const oldIdOf = (id: string) => {
  if (!prev) return id;
  const d = byId.get(id)!;
  const p = prev[id];
  if (p == null) throw new Error(`no prev text for ${id}`);
  return docId(d.card, p);
};

// (query, run-4 doc id) -> grade
const grade = new Map<string, number>();
for (const [pid, p] of Object.entries(qrels.pairs) as Array<[string, { queryId: string; grade: number }]>) {
  for (const d of map.pairs[pid].docIds as string[]) grade.set(`${p.queryId}\n${d}`, p.grade);
}
const qids = blind.map((q) => q.id);
const ideal = new Map<string, number[]>();
for (const d of docs) {
  const o = oldIdOf(d.id);
  for (const q of qids) {
    const g = grade.get(`${q}\n${o}`);
    if (g != null) (ideal.get(q) ?? ideal.set(q, []).get(q)!).push(g);
  }
}
const q0 = new Set<string>(qrels.q0Ids ?? []);
const best = new Map<string, number>();
for (const [k, g] of grade) {
  const q = k.split("\n")[0];
  best.set(q, Math.max(best.get(q) ?? 0, g));
}
const qplus = qids.filter((q) => (best.get(q) ?? 0) >= 1);
const qzero = qids.filter((q) => (best.get(q) ?? 0) === 0);

const r = retrievers(potionNode(root), docs);
const DEEP = 50;
const SYS = { bm25: (q: string) => r.bm25(q, DEEP), embed_uncut: (q: string) => r.embed(q, DEEP), hybrid: (q: string) => r.hybrid(q, DEEP) };
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const out: Record<string, unknown> = { corpus: corpusPath, docs: docs.length, qplus: qplus.length, q0: qzero.length };
const lists: Record<string, Record<string, string[]>> = {};
for (const [name, run] of Object.entries(SYS)) {
  lists[name] = {};
  let unjudged = 0, hits = 0, unjudgedQplus = 0, hitsQplus = 0;
  const per = qids.map((q) => {
    const text = blind.find((b) => b.id === q)!.q;
    const deep = run(text);
    const hs = deep.slice(0, K);
    lists[name][q] = hs.map((h) => h.id);
    // Condensed list (Sakai 2007): unjudged docs removed, then the top 8 of what is left.
    const cg = deep.map((h) => grade.get(`${q}
${oldIdOf(h.id)}`)).filter((g): g is number => g != null).slice(0, K);
    const cdcg = cg.reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
    const gs = hs.map((h) => grade.get(`${q}\n${oldIdOf(h.id)}`));
    hits += gs.length;
    unjudged += gs.filter((g) => g == null).length;
    if (qplus.includes(q)) { hitsQplus += gs.length; unjudgedQplus += gs.filter((g) => g == null).length; }
    const g0 = gs.map((g) => g ?? 0);
    const dcg = g0.reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
    const id = [...(ideal.get(q) ?? [])].sort((a, b) => b - a);
    const idcg = id.slice(0, K).reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
    const nrel = id.filter((x) => x >= 1).length;
    const relShown = g0.filter((x) => x >= 1).length;
    return { q, shown: hs.length, ndcg: idcg > 0 ? dcg / idcg : null, cndcg: idcg > 0 ? cdcg / idcg : null, prec: hs.length ? relShown / hs.length : null, rec: nrel ? relShown / Math.min(K, nrel) : null };
  });
  const P = per.filter((m) => qplus.includes(m.q));
  out[name] = {
    ndcg: r4(mean(P.map((m) => m.ndcg ?? 0))),
    ndcgCondensed: r4(mean(P.map((m) => m.cndcg ?? 0))),
    P: r4(mean(P.filter((m) => m.shown > 0).map((m) => m.prec!))),
    R: r4(mean(P.map((m) => m.rec ?? 0))),
    empty: r4(P.filter((m) => m.shown === 0).length / P.length),
    show0: r4(per.filter((m) => qzero.includes(m.q) && m.shown > 0).length / qzero.length),
    top8Hits: hits,
    unjudgedHits: unjudged,
    unjudgedHitsOnQplus: `${unjudgedQplus} of ${hitsQplus}`,
  };
}

// The 17 real Q0 queries (B0 diagnosis) and the collection(s) each one asks for.
const Q0_REAL: Record<string, string[]> = {
  b008: ["emef-tri"], b011: ["nces-public-schools"], b013: ["emef-rcra"], b016: ["emef-acres"], b018: ["emef-tri"],
  b019: ["emef-rcra"], b022: ["fuds-properties", "fuds-mrs"], b029: ["wrc-communities"], b035: ["ust-releases-county"],
  b042: ["nwi-wetlands"], b045: ["nces-public-schools"], b052: ["emef-sems", "npl-boundaries"], b078: ["emef-rcra"],
  b088: ["fuds-properties", "fuds-mrs"], b092: ["hifld-hospitals"], b098: ["hifld-hospitals"], b099: ["fuds-mrs", "fuds-properties"],
};
out.q0real = Object.entries(Q0_REAL).map(([q, cards]) => {
  const text = blind.find((b) => b.id === q)!.q;
  const top = lists.bm25[q].map((id) => byId.get(id)!);
  const inCard = top.filter((d) => cards.includes(d.card));
  return { id: q, q: text, wants: cards.join(" | "), bm25Top8FromCollection: inCard.length, bm25Shown: top.length, firstRank: inCard.length ? top.indexOf(inCard[0]) + 1 : null, firstText: inCard[0]?.text.slice(0, 200) ?? null };
});
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
