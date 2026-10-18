// Scores the B0 fresh blind set (one rater) from pool-map.json and judge/judgments.a.jsonl.
// Q+ = queries with a judged doc of grade >= 1; Q0 = the rest. nDCG@8 linear gain, ideal from every
// judged doc for the query (a pair counts once per docId), as score.mjs. show0 = share of Q0 showing a
// row. Paired bootstrap (10,000 resamples of Q+, mulberry32 seed 20261018) of hybrid - bm25 nDCG.
//   node lib/embed/__eval__/blind-b0/score-b0-fresh.cjs lib/embed/__eval__/blind-b0
const fs = require("fs");
const path = require("path");
const dir = process.argv[2] || __dirname;
const map = JSON.parse(fs.readFileSync(path.join(dir, "pool-map.json"), "utf8"));
const lines = fs.readFileSync(path.join(dir, "judgments.a.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const g = new Map(lines.map((o) => [o.id, o.grade]));
const ids = Object.keys(map.pairs);
const missing = ids.filter((id) => !g.has(id));
if (missing.length) throw new Error(`${missing.length} pairs ungraded`);
if (g.size !== ids.length) throw new Error("extra or duplicate ids");
const K = 8;
const ideal = new Map();
for (const id of ids) {
  const p = map.pairs[id];
  for (let i = 0; i < p.docIds.length; i++) (ideal.get(p.queryId) || ideal.set(p.queryId, []).get(p.queryId)).push(g.get(id));
}
const qs = map.ranked;
const nrel = (q) => (ideal.get(q) || []).filter((x) => x >= 1).length;
const idcg = (q) => [...(ideal.get(q) || [])].sort((a, b) => b - a).slice(0, K).reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
const qplus = qs.filter((q) => nrel(q.id) > 0);
const q0 = qs.filter((q) => nrel(q.id) === 0);
function m(q, arm) {
  const gs = q.arms[arm].slice(0, K).map((h) => g.get(h.pair));
  const dcg = gs.reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
  const rel = gs.filter((x) => x >= 1).length;
  const I = idcg(q.id);
  return { shown: gs.length, ndcg: I > 0 ? dcg / I : 0, P: gs.length ? rel / gs.length : null, R: nrel(q.id) ? rel / Math.min(K, nrel(q.id)) : 0 };
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const out = { queries: qs.length, pairs: ids.length, grades: { 0: 0, 1: 0, 2: 0 }, qplus: qplus.length, q0: q0.length, q0ByType: {}, qplusByType: {} };
for (const x of g.values()) out.grades[x]++;
for (const q of q0) out.q0ByType[q.type] = (out.q0ByType[q.type] || 0) + 1;
for (const q of qplus) out.qplusByType[q.type] = (out.qplusByType[q.type] || 0) + 1;
for (const arm of ["bm25", "hybrid"]) {
  const ms = qplus.map((q) => m(q, arm));
  out[arm] = {
    ndcg: r4(mean(ms.map((x) => x.ndcg))),
    P: r4(mean(ms.filter((x) => x.shown).map((x) => x.P))),
    R: r4(mean(ms.map((x) => x.R))),
    empty: r4(ms.filter((x) => !x.shown).length / ms.length),
    show0: r4(q0.filter((q) => q.arms[arm].length > 0).length / q0.length),
  };
  out[arm].perType = {};
  for (const t of [...new Set(qplus.map((q) => q.type))]) out[arm].perType[t] = r4(mean(qplus.filter((q) => q.type === t).map((q) => m(q, arm).ndcg)));
}
let s = 20261018 >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const d = qplus.map((q) => m(q, "hybrid").ndcg - m(q, "bm25").ndcg);
const boots = [];
for (let b = 0; b < 10000; b++) {
  let t = 0;
  for (let i = 0; i < d.length; i++) t += d[Math.floor(rand() * d.length)];
  boots.push(t / d.length);
}
boots.sort((a, b) => a - b);
out.hybridMinusBm25 = { diff: r4(mean(d)), ci95: [r4(boots[249]), r4(boots[9749])] };
// embed_uncut is not judged: count how many of its top-8 docs were pooled by bm25/hybrid (judged) anyway.
let judged = 0, all = 0;
for (const q of qs) for (const h of q.arms.embed_uncut) { all++; if (h.pair) judged++; }
out.embedUncutTop8Judged = `${judged} of ${all}`;
fs.writeFileSync(path.join(dir, "scores-b0-fresh.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
