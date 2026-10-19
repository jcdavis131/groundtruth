// Gate design on DEV data only (writeups/panel-2026-10-18b/gate/PREREG.md). Sweeps the gate rules in
// lib/embed/gatedHybrid.ts over two dev sets and prints, for each config and for the baselines, the
// PREREG's four measures. Nothing here reads blind-b0 or set C.
//
//   hand   the handwritten records eval: records-queries.json (89 real queries, 37 controls with
//          nothing relevant loaded), graded by its rules over records-corpus.json. Gain = rule grade
//          (0/1/2); ideal from every distinct text's grade.
//   blind  the original blind set (blind/queries.blind.json, 100 queries) with its two raters' grades
//          (qrels.json a and b). Grades key on run-4 (pre-B0) text, so each current doc is re-matched
//          through B0's prev-map.json (current doc -> the run-4 text it was rebuilt from), and only
//          judged pairs that re-match count. Gain = mean of the two grades, relevant at mean >= 1, as
//          the PREREG grades set C. A hit with no grade is unjudged: 0 in nDCG, and dropped in the
//          condensed nDCG (Sakai 2007) reported beside it.
//
// Arms over the distinct record texts, through RecordIndex (the palette's code): bm25 (top 8, score
// > 0), hybrid (uncut, rankHybrid top 8), shipped (cosine >= RECORD_TAU, top 8) and every gate config.
//
// Measures, per set, as the PREREG states them for set C: nDCG@8 on Q+ (queries with a relevant
// record), empty on Q+, shows a row on Q0, and gated - shipped nDCG@8 on Q+, paired, with a 95%
// bootstrap CI over queries (10,000 resamples, mulberry32 seed 1).
//
//   npx vite-node -c vitest.config.ts lib/embed/__eval__/gate-dev/gate-dev.mts <worktree> <prev-map.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { queryText } from "@/lib/catalog/recordText";
import { potionNode } from "@/lib/embed/loadNode";
import { RecordIndex } from "@/lib/embed/recordIndex";
import { RECORD_TAU } from "@/lib/embed/recordTau";
import { applyGate, rankHybrid, type GateConfig, type HybridRanking } from "@/lib/embed/gatedHybrid";
import { distinctDocs, docId, retrievers } from "@/lib/embed/__eval__/retrievers";
import type { LayerFeature } from "@/lib/layers/types";

const [root, prevPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error("usage: gate-dev.mts <worktree> <prev-map.json> <out.json>");
const K = 8;
const E = path.join(root, "lib/embed/__eval__");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// ------------------------------------------------------------ corpus through the palette's index
type Row = { card: string; embedText: string; n: number };
const rows: Row[] = read(path.join(E, "records-corpus.json"));
const model = potionNode(root);
const recs = rows.flatMap((r) => Array.from({ length: r.n }, () => r));
const feats = recs.map((r, i) => ({ type: "Feature", geometry: null, properties: { layer: r.card, id: String(i), name: "", extra: { embedText: r.embedText } } }) as unknown as LayerFeature);
const index = new RecordIndex(model);
index.sync(feats);
const cardOf = new Map<string, string>();
for (const r of rows) {
  const had = cardOf.get(r.embedText);
  if (had && had !== r.card) throw new Error("a text under two cards: the palette's one-row-per-text would merge them");
  cardOf.set(r.embedText, r.card);
}
if (index.texts !== cardOf.size) throw new Error(`index holds ${index.texts} texts, corpus ${cardOf.size}`);

// Sanity: rankHybrid over the index ranks exactly as the eval's hybrid over distinct docs.
const docs = distinctDocs(rows);
const evalArms = retrievers(model, docs);

type Q = { id: string; set: "hand" | "blind"; q: string; plus: boolean };
type Run = { ranking: HybridRanking; bm25: string[]; shipped: string[] };
function run(q: string): Run {
  const t = queryText(q);
  const qv = t ? model.embed(t) : null;
  if (!t || !qv) return { ranking: { hits: [], maxCosine: -Infinity, maxCoverage: { terms: 0, idf: 0 }, terms: 0 }, bm25: [], shipped: [] };
  const ranking = rankHybrid(index.hybrid, t, qv);
  const want = evalArms.hybrid(q, K).map((h) => h.id);
  const got = ranking.hits.slice(0, K).map((h) => docId(cardOf.get(h.id)!, h.id));
  if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`rankHybrid differs from the eval hybrid on "${q}"`);
  return {
    ranking,
    bm25: index.hybrid.bm25.search(t, K).map((h) => h.id),
    shipped: index.hybrid.embedRank(qv).filter((h) => h.score >= RECORD_TAU).slice(0, K).map((h) => h.id),
  };
}

// ------------------------------------------------------------ hand: grades from the rules
type Rule = { card: string; field?: string; values?: string[]; prefixes?: string[]; grade: number };
type HQ = { id: string; kind: string; q: string; judge: Rule[] };
const hand: HQ[] = read(path.join(E, "records-queries.json")).queries;
function fields(t: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of t.split("; ")) {
    const i = part.indexOf(": ");
    if (i > 0 && !m.has(part.slice(0, i))) m.set(part.slice(0, i), part.slice(i + 2));
  }
  return m;
}
function handGrade(q: HQ, text: string): number {
  let g = 0;
  const card = cardOf.get(text)!;
  const f = fields(text);
  for (const rule of q.judge) {
    if (rule.card !== card) continue;
    if (rule.field) {
      const v = f.get(rule.field);
      if (v == null || !(rule.values?.includes(v) || rule.prefixes?.some((p) => v.startsWith(p)))) continue;
    }
    g = Math.max(g, rule.grade);
  }
  return g;
}

// ------------------------------------------------------------ blind: re-matched mean grades
const B = path.join(E, "blind");
const qrels = read(path.join(B, "qrels.json"));
const pmap = read(path.join(B, "pool-map.json"));
const prev: Record<string, string> = read(prevPath);
const blindQs: Array<{ id: string; type: string; q: string }> = read(path.join(B, "queries.blind.json")).queries;
const oldGrade = new Map<string, { g: number; pid: string }>(); // `${qid}\n${run-4 doc id}` -> mean grade
for (const [pid, p] of Object.entries(qrels.pairs) as Array<[string, { queryId: string; a: number; b: number }]>)
  for (const d of pmap.pairs[pid].docIds as string[]) oldGrade.set(`${p.queryId}\n${d}`, { g: (p.a + p.b) / 2, pid });
const oldIdOf = (text: string) => {
  const id = docId(cardOf.get(text)!, text);
  const p = prev[id];
  if (p == null) throw new Error(`no prev text for ${id}`);
  return docId(cardOf.get(text)!, p);
};
const blindGrade = (qid: string, text: string) => oldGrade.get(`${qid}\n${oldIdOf(text)}`)?.g;
const rematched = new Set<string>();
for (const text of cardOf.keys()) for (const q of blindQs) {
  const hit = oldGrade.get(`${q.id}\n${oldIdOf(text)}`);
  if (hit) rematched.add(hit.pid);
}

// ------------------------------------------------------------ queries, ideals, runs
const texts = [...cardOf.keys()];
type Prep = Q & { run: Run; grade: (text: string) => number | undefined; idcg: number };
const dcg = (gs: number[]) => gs.slice(0, K).reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
const preps: Prep[] = [];
for (const q of hand) {
  const gs = texts.map((t) => handGrade(q, t)).sort((a, b) => b - a);
  const real = q.kind !== "control";
  if (real !== gs[0] >= 2) throw new Error(`${q.id}: real queries need a grade-2 record and controls none`);
  preps.push({ id: q.id, set: "hand", q: q.q, plus: real, run: run(q.q), grade: (t) => handGrade(q, t), idcg: dcg(gs) });
}
for (const q of blindQs) {
  const gs = texts.map((t) => blindGrade(q.id, t)).filter((g): g is number => g != null).sort((a, b) => b - a);
  preps.push({ id: q.id, set: "blind", q: q.q, plus: (gs[0] ?? 0) >= 1, run: run(q.q), grade: (t) => blindGrade(q.id, t), idcg: dcg(gs) });
}

// ------------------------------------------------------------ measures
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootCI(d: number[]): [number, number] {
  const rand = mulberry32(1);
  const means: number[] = [];
  for (let r = 0; r < 10_000; r++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[Math.floor(rand() * d.length)];
    means.push(s / d.length);
  }
  means.sort((a, b) => a - b);
  return [means[249], means[9_749]];
}
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

type Arm = (p: Prep) => string[];
const ndcgOf = (p: Prep, shown: string[]) => (p.idcg > 0 ? dcg(shown.map((t) => p.grade(t) ?? 0)) / p.idcg : 0);
const cndcgOf = (p: Prep, shown: string[]) => (p.idcg > 0 ? dcg(shown.map((t) => p.grade(t)).filter((g): g is number => g != null)) / p.idcg : 0);
const shippedArm: Arm = (p) => p.run.shipped;

function measure(set: "hand" | "blind", arm: Arm) {
  const ps = preps.filter((p) => p.set === set);
  const plus = ps.filter((p) => p.plus);
  const zero = ps.filter((p) => !p.plus);
  const nd = plus.map((p) => ndcgOf(p, arm(p)));
  const diff = plus.map((p, i) => nd[i] - ndcgOf(p, shippedArm(p)));
  const [lo, hi] = bootCI(diff);
  const shown = ps.reduce((s, p) => s + arm(p).length, 0);
  const unjudged = ps.reduce((s, p) => s + arm(p).filter((t) => p.grade(t) == null).length, 0);
  return {
    ndcg: r4(mean(nd)),
    ndcgCondensed: r4(mean(plus.map((p) => cndcgOf(p, arm(p))))),
    emptyPlus: r4(plus.filter((p) => !arm(p).length).length / plus.length),
    showZero: r4(zero.filter((p) => arm(p).length).length / zero.length),
    vsShipped: { mean: r4(mean(diff)), lo: r4(lo), hi: r4(hi) },
    rowsShown: shown,
    ...(set === "blind" ? { unjudgedShown: unjudged } : {}),
  };
}
const bars = (m: ReturnType<typeof measure>) => ({ b1: m.ndcg >= 0.75, b2: m.emptyPlus <= 0.15, b3: m.showZero <= 0.25, b4: m.vsShipped.lo > 0 });

// ------------------------------------------------------------ the grid
// c 2 = coverage never opens the gate (cosine only). "both" is tried around the list gate's best region.
const T = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const C = [0.5, 0.6, 0.67, 0.75, 0.8, 1, 2];
const configs: GateConfig[] = [];
for (const coverage of ["terms", "idf"] as const) {
  for (const rule of ["per-hit", "list"] as const) for (const t of T) for (const c of C) if (c !== 2 || coverage === "terms") configs.push({ rule, coverage, t, c });
  for (const t of [0.4, 0.45, 0.5]) for (const c of [0.67, 0.75, 1]) for (const tHit of [0.3, 0.35]) for (const cHit of [0.5, 0.67]) configs.push({ rule: "both", coverage, t, c, tHit, cHit });
}
const name = (g: GateConfig) => `${g.rule} ${g.coverage} t${g.t} c${g.c === 2 ? "-" : g.c}${g.rule === "both" ? ` | hit t${g.tHit} c${g.cHit}` : ""}`;

const arms: Array<{ name: string; arm: Arm; config?: GateConfig }> = [
  { name: "bm25", arm: (p) => p.run.bm25 },
  { name: "hybrid (uncut)", arm: (p) => p.run.ranking.hits.slice(0, K).map((h) => h.id) },
  { name: `shipped (embed >= ${RECORD_TAU})`, arm: shippedArm },
  ...configs.map((g) => ({ name: name(g), config: g, arm: (p: Prep) => applyGate(p.run.ranking, g, K).map((h) => h.id) })),
];
const table = arms.map((a) => {
  const hand = measure("hand", a.arm);
  const blind = measure("blind", a.arm);
  return { name: a.name, config: a.config ?? null, hand, blind, barsHand: bars(hand), barsBlind: bars(blind) };
});

// Selection rule v1, written before this grid was run: a config must pass all four bars on hand (the
// clean dev set: its controls are queries with nothing relevant loaded) and bar 4 on blind. Among
// those, most blind bars 1-3 passed; then lowest blind empty + blind shows-on-Q0; then highest mean
// nDCG over the two sets; then the simpler rule (list, per-hit, both; terms, idf).
//
// Selection rule v2 (2026-10-18, after v1's pick, still dev only; before the set C pool was built and before
// the builder saw any set C query; writer 1's queries already existed, unread, per the verifier). v1 picked
// list terms t0.45 c0.6, which passes hand empty by 0.004 (0.146 against 0.15), and its tie-break
// paid 0.09 of blind empty for blind Q0 rows that are mostly not true negatives: blind Q0 is 17
// negatives plus 17 collection queries whose specific item the raters found missing, and t0.45 and
// t0.40 show rows on 2 and 3 of the 17 negatives. v2: every hand bar passed by at least 0.03, and
// blind bar 4; then most blind bars 1-2 passed; then lowest blind empty; then highest mean nDCG; then
// the simpler rule. Blind bar 3 is reported, not used.
const ruleOrder = (g: GateConfig) => ["list", "per-hit", "both"].indexOf(g.rule) * 2 + (g.coverage === "idf" ? 1 : 0);
const sumNdcg = (r: (typeof table)[number]) => r.hand.ndcg + r.blind.ndcg;
const eligibleV1 = table
  .filter((r) => r.config && Object.values(r.barsHand).every(Boolean) && r.barsBlind.b4)
  .sort((x, y) => {
    const nb = (r: typeof x) => [r.barsBlind.b1, r.barsBlind.b2, r.barsBlind.b3].filter(Boolean).length;
    return nb(y) - nb(x) || x.blind.emptyPlus + x.blind.showZero - (y.blind.emptyPlus + y.blind.showZero) || sumNdcg(y) - sumNdcg(x) || ruleOrder(x.config!) - ruleOrder(y.config!);
  });
const MARGIN = 0.03;
const eligible = table
  .filter((r) => r.config && r.hand.ndcg >= 0.75 + MARGIN && r.hand.emptyPlus <= 0.15 - MARGIN && r.hand.showZero <= 0.25 - MARGIN && r.hand.vsShipped.lo > MARGIN && r.barsBlind.b4)
  .sort((x, y) => {
    const nb = (r: typeof x) => [r.barsBlind.b1, r.barsBlind.b2].filter(Boolean).length;
    return nb(y) - nb(x) || x.blind.emptyPlus - y.blind.emptyPlus || sumNdcg(y) - sumNdcg(x) || ruleOrder(x.config!) - ruleOrder(y.config!);
  });
const count = (set: "hand" | "blind", plus: boolean) => preps.filter((p) => p.set === set && p.plus === plus).length;
const out = {
  note: "Gate design on dev data only (PREREG.md). hand = records-queries.json; blind = original blind set, re-matched through B0's prev-map.json.",
  builtAt: new Date().toISOString(),
  corpus: { records: index.size, distinctTexts: index.texts },
  queries: { hand: { plus: count("hand", true), zero: count("hand", false) }, blind: { plus: count("blind", true), zero: count("blind", false) } },
  blindPairs: { judged: Object.keys(qrels.pairs).length, rematched: rematched.size },
  table,
  selectionV1: { eligible: eligibleV1.map((r) => r.name), pick: eligibleV1[0]?.name ?? null },
  eligible: eligible.map((r) => r.name),
  chosen: eligible[0]?.name ?? null,
  /** Per query: the gate's inputs (best cosine, best BM25 coverage, terms) and the uncut top 8 with grades (null = unjudged). */
  perQuery: preps.map((p) => ({
    id: p.id,
    set: p.set,
    q: p.q,
    plus: p.plus,
    terms: p.run.ranking.terms,
    maxCosine: r4(p.run.ranking.maxCosine),
    maxCoverage: { terms: r4(p.run.ranking.maxCoverage.terms), idf: r4(p.run.ranking.maxCoverage.idf) },
    top: p.run.ranking.hits.slice(0, K).map((h) => ({ cos: r4(h.cosine), cov: r4(h.coverage.terms), covIdf: r4(h.coverage.idf), g: p.grade(h.id) ?? null })),
  })),
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
const fmt = (m: ReturnType<typeof measure>) => `${m.ndcg.toFixed(3)} ${m.ndcgCondensed.toFixed(3)} ${m.emptyPlus.toFixed(3)} ${m.showZero.toFixed(3)} ${m.vsShipped.mean.toFixed(3)} [${m.vsShipped.lo.toFixed(3)},${m.vsShipped.hi.toFixed(3)}]`;
console.log(JSON.stringify({ corpus: out.corpus, queries: out.queries, blindPairs: out.blindPairs }));
console.log("arm | hand: ndcg cndcg emptyQ+ showQ0 d-shipped [ci] | blind: same");
const show = process.env.GATE_DEV_ALL ? table : [...table.slice(0, 3), ...eligible];
for (const r of show) console.log(`${r.name.padEnd(40)} | ${fmt(r.hand)} | ${fmt(r.blind)}`);
console.log(`v1 pick: ${out.selectionV1.pick}; v2 eligible ${eligible.length} of ${configs.length}; chosen (v2): ${out.chosen}`);
