// Blind search eval, steps 6-8: agreement, qrels, scores, the tau sweep and the decision.
//
//   node lib/embed/__eval__/blind/score.mjs [dir]      (dir defaults to this file's folder)
//
// Reads only pinned files (sha256 checked): pool.jsonl, pool-map.json, judge-task.md,
// queries.blind.json, judgments.a.jsonl, judgments.b.jsonl. Writes qrels.json and scores.json
// next to them. No embedder runs here: every arm's top 10 and its scores are stored in pool-map,
// so every top-8 doc of every arm below is judged (pool depth 10 >= 8, no holes).
//
// ---------------------------------------------------------------- PRE-REGISTERED (written before any score was computed)
//
// Qrels. A pair's grade applies to every docId pool-map lists for it. Disagreements between rater A
// and rater B take the LOWER grade (judge-task.md: "when unsure between two grades, pick the lower
// one"). Sensitivity: higher grade, A alone, B alone.
//
// Query sets, from the qrels, not from the writer's type label:
//   Q+  queries with at least one judged doc of grade >= 1.   nDCG, MRR, P, R, empty are over Q+.
//   Q0  queries with no judged doc of grade >= 1.             Only "shows a row" is measured.
//
// Metrics, k = 8 (the palette's RECORD_ROWS):
//   nDCG@8   linear gain (grade 0/1/2), log2(rank + 1) discount, ideal DCG from every judged doc for
//            the query. An empty list scores 0. Sensitivity: exponential gain 2^g - 1.
//   MRR@8    1 / rank of the first doc of grade 2 (primary), and of grade >= 1; 0 if none in top 8.
//   P        rows of grade >= 1 / rows shown, over Q+ queries that show a row (the DESIGN's P).
//   R@8      rows of grade >= 1 shown / min(8, judged docs of grade >= 1).
//   empty    share of Q+ queries that show no row.
//   show0    share of Q0 queries that show any row (the DESIGN's "controls showing a row").
//
// Systems:
//   bm25          Okapi BM25 top 8 (empty when no query token is in the corpus).
//   embed_uncut   cosine top 8, no cutoff.
//   embed@t       embed_uncut top 8 kept where cosine >= t. embed@0.50 is the palette today.
//   hybrid        RRF (k 60, fusion depth 50) of bm25 and embed, top 8, no cutoff.
//   hybrid|gate@t hybrid top 8, shown only when the embed top-1 cosine >= t (the whole group is
//                 gated by meaning, so a query nothing means shows nothing). The only hybrid variant this pool can score without unjudged docs. Re-fusing at
//                 another k or depth would surface docs nobody judged, so it is not run.
//
// Bootstrap: 10,000 resamples of queries (mulberry32, seed 20261017). 95% percentile intervals.
// Kappa: Cohen's unweighted and quadratic-weighted, over all 1,597 pairs; CI by resampling queries
// (pairs are nested in queries), not pairs.
//
// The tau rule. Grid 0.30 to 0.70 in 0.025 steps. tau* is the step with the highest mean nDCG@8 on
// Q+ among steps where show0 <= 0.10 (at most 1 in 10 nothing-relevant queries shows a row); ties
// go to the higher tau. The same rule picks the gate for hybrid|gate. Reported next to it: the
// DESIGN 7.2 bars (P >= 0.65, R@8 >= 0.45, empty <= 0.30, show0 = 0), and a 5-fold cross-validated
// nDCG (tau picked on 4 folds by the rule, scored on the fifth; folds stratified by writer type),
// because tau picked and scored on one set is in-sample.
//
// "Beats BM25": the paired bootstrap 95% CI of mean(system - bm25) nDCG@8 over Q+ lies above 0,
// AND the system's show0 is no higher than bm25's. Lift ?semantic=1 only if the system the palette
// would show (embed@tau* or hybrid|gate@tau*) beats BM25 by that rule.
// ----------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url));
const PINS = {
  "pool.jsonl": "c8122c7d1b8fa68686deaffb03d436398bb95d6f998fce2dd91019a2e107e8be",
  "pool-map.json": "5139057994ed29b225757068091303904d91d1c81555736c1cfa85f870beb3a2",
  "judge-task.md": "9afd08c75a5c96da9b547bd7195cdd351831fbf7197a09d2b5be0f029467d384",
  "queries.blind.json": "af4f319e4830945b46a550e4d9e5b17061803591660f264d43b6f07cbf526a27",
  "judgments.a.jsonl": null,
  "judgments.b.jsonl": null,
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const raw = {};
const shas = {};
for (const [f, want] of Object.entries(PINS)) {
  raw[f] = readFileSync(path.join(dir, f));
  shas[f] = sha(raw[f]);
  if (want && shas[f] !== want) throw new Error(`${f} sha256 ${shas[f]} != pinned ${want}`);
}
const jsonl = (b) => b.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));

const pool = jsonl(raw["pool.jsonl"]);
const map = JSON.parse(raw["pool-map.json"].toString("utf8"));
const blind = JSON.parse(raw["queries.blind.json"].toString("utf8")).queries;
const K = 8;
const B_RESAMPLES = 10000;
const SEED = 20261017;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x);

// ---------------------------------------------------------------- judgments and agreement

const poolIds = new Set(pool.map((p) => p.id));
function loadRater(f) {
  const m = new Map();
  for (const o of jsonl(raw[f])) {
    if (!poolIds.has(o.id)) throw new Error(`${f}: unknown id ${o.id}`);
    if (m.has(o.id)) throw new Error(`${f}: duplicate ${o.id}`);
    if (![0, 1, 2].includes(o.grade)) throw new Error(`${f}: bad grade ${o.id}`);
    m.set(o.id, o.grade);
  }
  if (m.size !== poolIds.size) throw new Error(`${f}: ${m.size} of ${poolIds.size} graded`);
  return m;
}
const A = loadRater("judgments.a.jsonl");
const Bm = loadRater("judgments.b.jsonl");
const pairIds = [...poolIds];
const pairQuery = new Map(pairIds.map((id) => [id, map.pairs[id].queryId]));

function kappa(ids) {
  const n = ids.length;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const id of ids) c[A.get(id)][Bm.get(id)]++;
  const ra = [0, 1, 2].map((i) => c[i].reduce((s, x) => s + x, 0) / n);
  const rb = [0, 1, 2].map((j) => (c[0][j] + c[1][j] + c[2][j]) / n);
  let po = 0, pe = 0, wo = 0, we = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const w = ((i - j) / 2) ** 2;
      if (i === j) { po += c[i][j] / n; pe += ra[i] * rb[j]; }
      wo += (w * c[i][j]) / n;
      we += w * ra[i] * rb[j];
    }
  return { n, confusion: c, agree: po, unweighted: (po - pe) / (1 - pe), quadratic: 1 - wo / we };
}
const pairsByQuery = new Map();
for (const id of pairIds) {
  const q = pairQuery.get(id);
  if (!pairsByQuery.has(q)) pairsByQuery.set(q, []);
  pairsByQuery.get(q).push(id);
}
const qids = blind.map((q) => q.id);
const kAll = kappa(pairIds);
{
  const rand = mulberry32(SEED);
  const ku = [], kq = [];
  for (let b = 0; b < B_RESAMPLES; b++) {
    const ids = [];
    for (let i = 0; i < qids.length; i++) ids.push(...(pairsByQuery.get(qids[Math.floor(rand() * qids.length)]) ?? []));
    const k = kappa(ids);
    ku.push(k.unweighted);
    kq.push(k.quadratic);
  }
  kAll.unweightedCI = [pct(ku, 0.025), pct(ku, 0.975)];
  kAll.quadraticCI = [pct(kq, 0.025), pct(kq, 0.975)];
}

// ---------------------------------------------------------------- qrels

const RULES = {
  lower: (a, b) => Math.min(a, b),
  higher: (a, b) => Math.max(a, b),
  a: (a) => a,
  b: (_a, b) => b,
};
const disagreements = pairIds.filter((id) => A.get(id) !== Bm.get(id)).sort();
const pairGrade = (rule) => new Map(pairIds.map((id) => [id, RULES[rule](A.get(id), Bm.get(id))]));

// ---------------------------------------------------------------- systems

const byQ = new Map(map.queries.map((q) => [q.id, q]));
const typeOf = new Map(blind.map((q) => [q.id, q.type]));
const TAUS = [];
for (let t = 0.3; t <= 0.7001; t += 0.025) TAUS.push(Math.round(t * 1000) / 1000);

/** Ranked pair ids (top K) for a system on a query. */
function ranked(sys, qid) {
  const arms = byQ.get(qid).arms;
  const top1 = arms.embed_uncut[0]?.score ?? -Infinity;
  if (sys === "bm25") return arms.bm25.slice(0, K).map((h) => h.pair);
  if (sys === "embed_uncut") return arms.embed_uncut.slice(0, K).map((h) => h.pair);
  if (sys === "hybrid") return arms.hybrid.slice(0, K).map((h) => h.pair);
  let m = /^embed@(.+)$/.exec(sys);
  if (m) return arms.embed_uncut.slice(0, K).filter((h) => h.score >= +m[1]).map((h) => h.pair);
  if (sys === "hybrid|bm25gate") return arms.bm25.length ? arms.hybrid.slice(0, K).map((h) => h.pair) : [];
  m = /^hybrid\|margin@(.+)$/.exec(sys);
  if (m) {
    const e = arms.embed_uncut;
    const margin = e.length >= K ? e[0].score - e[K - 1].score : -Infinity;
    return margin >= +m[1] ? arms.hybrid.slice(0, K).map((h) => h.pair) : [];
  }
  m = /^hybrid\|gate@(.+)$/.exec(sys);
  if (m) return top1 >= +m[1] ? arms.hybrid.slice(0, K).map((h) => h.pair) : [];
  throw new Error(sys);
}

/** Per-query metrics under one qrels rule. */
function evaluate(rule, gain = "linear") {
  const g = pairGrade(rule);
  const gf = gain === "linear" ? (x) => x : (x) => 2 ** x - 1;
  // Ideal: every judged doc (a pair counts once per docId it stands for).
  const ideal = new Map();
  for (const id of pairIds) {
    const q = pairQuery.get(id);
    if (!ideal.has(q)) ideal.set(q, []);
    for (let i = 0; i < map.pairs[id].docIds.length; i++) ideal.get(q).push(g.get(id));
  }
  const idcg = new Map();
  const nrel = new Map();
  for (const q of qids) {
    const gs = (ideal.get(q) ?? []).sort((x, y) => y - x);
    nrel.set(q, gs.filter((x) => x >= 1).length);
    idcg.set(q, gs.slice(0, K).reduce((s, x, i) => s + gf(x) / Math.log2(i + 2), 0));
  }
  const qplus = qids.filter((q) => nrel.get(q) > 0);
  const q0 = qids.filter((q) => nrel.get(q) === 0);
  const metric = (sys, q) => {
    const list = ranked(sys, q);
    const gs = list.map((p) => g.get(p));
    const dcg = gs.reduce((s, x, i) => s + gf(x) / Math.log2(i + 2), 0);
    const i2 = gs.findIndex((x) => x === 2);
    const i1 = gs.findIndex((x) => x >= 1);
    const relShown = gs.filter((x) => x >= 1).length;
    return {
      shown: list.length,
      ndcg: idcg.get(q) > 0 ? dcg / idcg.get(q) : null,
      mrr2: i2 < 0 ? 0 : 1 / (i2 + 1),
      mrr1: i1 < 0 ? 0 : 1 / (i1 + 1),
      prec: list.length ? relShown / list.length : null,
      rec: nrel.get(q) > 0 ? relShown / Math.min(K, nrel.get(q)) : null,
    };
  };
  return { g, qplus, q0, nrel, metric };
}

function summary(ev, sys, qs = ev.qplus, q0 = ev.q0) {
  const ms = qs.map((q) => ev.metric(sys, q));
  const shownMs = ms.filter((m) => m.shown > 0);
  return {
    n: qs.length,
    ndcg: mean(ms.map((m) => m.ndcg)),
    mrr2: mean(ms.map((m) => m.mrr2)),
    mrr1: mean(ms.map((m) => m.mrr1)),
    P: mean(shownMs.map((m) => m.prec)),
    R: mean(ms.map((m) => m.rec)),
    empty: ms.filter((m) => m.shown === 0).length / Math.max(1, qs.length),
    n0: q0.length,
    show0: q0.filter((q) => ev.metric(sys, q).shown > 0).length / Math.max(1, q0.length),
    show0n: q0.filter((q) => ev.metric(sys, q).shown > 0).length,
  };
}

function bootCI(qs, f, seed = SEED) {
  const rand = mulberry32(seed);
  const vals = qs.map(f);
  const out = [];
  for (let b = 0; b < B_RESAMPLES; b++) {
    let s = 0;
    for (let i = 0; i < vals.length; i++) s += vals[Math.floor(rand() * vals.length)];
    out.push(s / vals.length);
  }
  return { mean: mean(vals), ci: [pct(out, 0.025), pct(out, 0.975)], pAboveZero: out.filter((x) => x > 0).length / B_RESAMPLES };
}

function pickTau(ev, family, qs, q0) {
  let best = null;
  for (const t of TAUS) {
    const sys = `${family}@${t}`;
    const n = mean(qs.map((q) => ev.metric(sys, q).ndcg));
    const s0 = q0.filter((q) => ev.metric(sys, q).shown > 0).length / Math.max(1, q0.length);
    if (s0 > 0.1) continue;
    if (!best || n >= best.ndcg) best = { tau: t, ndcg: n, show0: s0 };
  }
  return best;
}

function crossValidated(ev, family) {
  // 5 folds over all 100 queries, stratified by writer type, deterministic (query id order).
  const folds = [[], [], [], [], []];
  const byType = {};
  for (const q of blind) (byType[q.type] ??= []).push(q.id);
  for (const t of Object.keys(byType).sort()) byType[t].forEach((q, i) => folds[i % 5].push(q));
  const per = new Map();
  const picks = [];
  let shown0 = 0;
  folds.forEach((test) => {
    const train = qids.filter((q) => !test.includes(q));
    const pick = pickTau(ev, family, train.filter((q) => ev.qplus.includes(q)), train.filter((q) => ev.q0.includes(q)));
    picks.push(pick?.tau ?? null);
    for (const q of test) {
      if (!pick) continue;
      const m = ev.metric(`${family}@${pick.tau}`, q);
      if (ev.qplus.includes(q)) per.set(q, m.ndcg);
      else if (m.shown > 0) shown0++;
    }
  });
  const vals = ev.qplus.map((q) => per.get(q) ?? 0);
  return { picks, ndcg: mean(vals), show0: shown0 / Math.max(1, ev.q0.length), perQuery: per };
}

// ---------------------------------------------------------------- run

const ev = evaluate("lower");
const fam = { embed: "embed", hybrid: "hybrid|gate" };
const tauEmbed = pickTau(ev, fam.embed, ev.qplus, ev.q0);
const tauHybrid = pickTau(ev, fam.hybrid, ev.qplus, ev.q0);
const SYSTEMS = ["bm25", "embed_uncut", "hybrid", "embed@0.5", `embed@${tauEmbed.tau}`, `hybrid|gate@${tauHybrid.tau}`];
const uniq = [...new Set(SYSTEMS)];

const headline = Object.fromEntries(
  uniq.map((s) => {
    const sm = summary(ev, s);
    const ci = bootCI(ev.qplus, (q) => ev.metric(s, q).ndcg);
    const ciM = bootCI(ev.qplus, (q) => ev.metric(s, q).mrr2);
    const d = bootCI(ev.qplus, (q) => ev.metric(s, q).ndcg - ev.metric("bm25", q).ndcg);
    return [s, { ...sm, ndcgCI: ci.ci, mrr2CI: ciM.ci, vsBm25: { diff: d.mean, ci: d.ci, pAboveZero: d.pAboveZero } }];
  }),
);

const TYPES = ["known-item", "topical", "attribute", "place", "negative"];
const perType = {};
for (const t of TYPES) {
  const qs = ev.qplus.filter((q) => typeOf.get(q) === t);
  const q0 = ev.q0.filter((q) => typeOf.get(q) === t);
  perType[t] = { qplus: qs.length, q0: q0.length };
  for (const s of uniq) {
    const sm = summary(ev, s, qs, q0);
    const ci = qs.length ? bootCI(qs, (q) => ev.metric(s, q).ndcg).ci : null;
    const d = qs.length ? bootCI(qs, (q) => ev.metric(s, q).ndcg - ev.metric("bm25", q).ndcg) : null;
    perType[t][s] = { ndcg: sm.ndcg, ndcgCI: ci, mrr2: sm.mrr2, empty: sm.empty, show0n: sm.show0n, vsBm25: d && { diff: d.mean, ci: d.ci } };
  }
}

const sweep = TAUS.map((t) => {
  const e = summary(ev, `embed@${t}`);
  const h = summary(ev, `hybrid|gate@${t}`);
  return { tau: t, embed: { ndcg: e.ndcg, P: e.P, R: e.R, empty: e.empty, show0: e.show0, show0n: e.show0n }, hybridGate: { ndcg: h.ndcg, empty: h.empty, show0: h.show0, show0n: h.show0n } };
});

const cv = { embed: crossValidated(ev, fam.embed), hybrid: crossValidated(ev, fam.hybrid) };
const cvVsBm25 = Object.fromEntries(
  Object.entries(cv).map(([k, c]) => [k, bootCI(ev.qplus, (q) => (c.perQuery.get(q) ?? 0) - ev.metric("bm25", q).ndcg)]),
);

const sensitivity = {};
for (const rule of ["lower", "higher", "a", "b"])
  for (const gain of ["linear", "exp"]) {
    const e = evaluate(rule, gain);
    sensitivity[`${rule}/${gain}`] = {
      qplus: e.qplus.length,
      ...Object.fromEntries(
        uniq.map((s) => {
          const d = bootCI(e.qplus, (q) => e.metric(s, q).ndcg - e.metric("bm25", q).ndcg);
          return [s, { ndcg: summary(e, s).ndcg, vsBm25: d.mean, ci: d.ci }];
        }),
      ),
    };
  }

const beats = (s) => headline[s].vsBm25.ci[0] > 0 && headline[s].show0 <= headline.bm25.show0;
const decision = {
  tauEmbed,
  tauHybridGate: tauHybrid,
  embedAtTauBeatsBm25: beats(`embed@${tauEmbed.tau}`),
  hybridGateBeatsBm25: beats(`hybrid|gate@${tauHybrid.tau}`),
  palette050BeatsBm25: beats("embed@0.5"),
  bars72: Object.fromEntries(
    [`embed@${tauEmbed.tau}`, "embed@0.5"].map((s) => {
      const h = headline[s];
      return [s, { P: h.P >= 0.65, R: h.R >= 0.45, empty: h.empty <= 0.3, show0zero: h.show0n === 0 }];
    }),
  ),
};

// POST HOC (added after the pre-registered run above, and labelled so in RESULTS.md): the 0.10
// show0 cap is stricter than bm25 itself (bm25 shows a row on 14 of 34 Q0). Match bm25 instead:
// for each family, the highest-nDCG step whose show0 is no higher than bm25's, with its paired CI.
const bm25Show0 = headline.bm25.show0;
const posthoc = {};
for (const f of [fam.embed, fam.hybrid]) {
  let best = null;
  for (const t of TAUS) {
    const s = `${f}@${t}`;
    const sm = summary(ev, s);
    if (sm.show0 > bm25Show0) continue;
    if (!best || sm.ndcg > best.ndcg) best = { sys: s, tau: t, ndcg: sm.ndcg, show0n: sm.show0n, empty: sm.empty, P: sm.P, R: sm.R };
  }
  const d = bootCI(ev.qplus, (q) => ev.metric(best.sys, q).ndcg - ev.metric("bm25", q).ndcg);
  posthoc[f] = { ...best, vsBm25: { diff: d.mean, ci: d.ci, pAboveZero: d.pAboveZero } };
}

// POST HOC, second pass (RESULTS.md section 3): two abstain rules scorable from the pool alone.
//   hybrid|bm25gate   hybrid top 8, shown only when bm25 returns anything (same Q0 rate as bm25).
//   hybrid|margin@m   hybrid top 8, shown only when embed top-1 minus top-8 cosine >= m.
const posthoc2 = {};
{
  const s = "hybrid|bm25gate";
  const sm = summary(ev, s);
  const d = bootCI(ev.qplus, (q) => ev.metric(s, q).ndcg - ev.metric("bm25", q).ndcg);
  const ci = bootCI(ev.qplus, (q) => ev.metric(s, q).ndcg);
  posthoc2[s] = { ...sm, ndcgCI: ci.ci, vsBm25: { diff: d.mean, ci: d.ci, pAboveZero: d.pAboveZero } };
  const margins = [];
  for (let m = 0; m <= 0.2001; m += 0.01) margins.push(Math.round(m * 1000) / 1000);
  posthoc2.marginSweep = margins.map((m) => {
    const sys = `hybrid|margin@${m}`;
    const x = summary(ev, sys);
    const dd = bootCI(ev.qplus, (q) => ev.metric(sys, q).ndcg - ev.metric("bm25", q).ndcg);
    return { margin: m, ndcg: x.ndcg, empty: x.empty, show0n: x.show0n, vsBm25: dd.mean, ci: dd.ci };
  });
}

const qrels = {
  note: "Adjudicated qrels for the blind search eval: lower of rater A and rater B. grade applies to every docId.",
  rule: "lower",
  shas,
  pairs: Object.fromEntries(pairIds.sort().map((id) => [id, { queryId: pairQuery.get(id), a: A.get(id), b: Bm.get(id), grade: ev.g.get(id), docIds: map.pairs[id].docIds.length }])),
};
writeFileSync(path.join(dir, "qrels.json"), JSON.stringify(qrels, null, 1) + "\n");

const round = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "number" ? r4(v) : v instanceof Map ? undefined : v)));
const out = round({
  shas,
  config: { K, B_RESAMPLES, SEED, taus: TAUS, adjudication: "lower", gain: "linear" },
  kappa: { ...kAll, disagreements: disagreements.length, disagreementIds: disagreements },
  sets: { qplus: ev.qplus.length, q0: ev.q0.length, q0ByType: Object.fromEntries(TYPES.map((t) => [t, ev.q0.filter((q) => typeOf.get(q) === t).length])), q0Ids: ev.q0 },
  headline,
  perType,
  sweep,
  cv: { embed: { picks: cv.embed.picks, ndcg: cv.embed.ndcg, show0: cv.embed.show0, vsBm25: cvVsBm25.embed }, hybrid: { picks: cv.hybrid.picks, ndcg: cv.hybrid.ndcg, show0: cv.hybrid.show0, vsBm25: cvVsBm25.hybrid } },
  sensitivity,
  decision,
  posthoc,
  posthoc2,
});
writeFileSync(path.join(dir, "scores.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ kappa: out.kappa.unweighted, kappaCI: out.kappa.unweightedCI, quadratic: out.kappa.quadratic, sets: out.sets, decision: out.decision }, null, 1));
