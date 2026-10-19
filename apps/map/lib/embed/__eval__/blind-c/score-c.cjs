// Scores blind set C as writeups/panel-2026-10-18b/gate/PREREG.md says. Plain node, no deps.
//   node lib/embed/__eval__/blind-c/score-c.cjs <dir> [outFile]
// <dir> holds pool-map.json and the two raters' files, either in <dir>/judge/ or in <dir> itself:
// judgments.a.jsonl and judgments.b.jsonl, one {"id","grade"} per line, grade 0/1/2.
//
// - Every pair in pool-map.json must be graded by both raters, once each, with no extra ids.
// - Grade of a pair = mean of the two raters. Relevant = mean >= 1. Linear gain = the mean grade.
// - A pair's grade applies to every docId listed for it; ideal DCG is built from every graded doc of
//   the query (a pair counts once per docId), sorted, top 8.
// - Q+ = queries with at least one relevant doc; Q0 = the rest.
// - Per arm (bm25, hybrid, shipped, gated): nDCG@8 on Q+, top-1 relevant on Q+ (empty counts as
//   not relevant), empty share on Q+, show share on Q0. Also per query type.
// - Quadratic-weighted Cohen's kappa between raters over all pairs.
// - The four PREREG bars for the gated arm at the point estimate, each with a 95% percentile
//   bootstrap CI over queries: 10,000 resamples, mulberry32 seeded 20261018, reseeded per statistic
//   so each CI does not depend on the order statistics are computed in. Bars 1, 2 and 4 resample
//   Q+; bar 3 resamples Q0. Bar 4 is the paired gated-minus-shipped nDCG@8 difference on Q+ and
//   passes only if its CI lower bound > 0.
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
if (!dir) throw new Error("usage: score-c.cjs <dir> [outFile]");
const outFile = process.argv[3] || path.join(dir, "scores-c.json");
const K = 8;
const ARMS = ["bm25", "hybrid", "shipped", "gated"];
const SEED = 20261018;
const B = 10000;
const BARS = { ndcg: 0.75, emptyQplus: 0.15, showQ0: 0.25 };
const KAPPA_FLOOR = 0.4;

const find = (name) => {
  for (const p of [path.join(dir, "judge", name), path.join(dir, name)]) if (fs.existsSync(p)) return p;
  throw new Error(`missing ${name} in ${dir} or ${path.join(dir, "judge")}`);
};
const map = JSON.parse(fs.readFileSync(find("pool-map.json"), "utf8"));
function readRater(r) {
  const text = fs.readFileSync(find(`judgments.${r}.jsonl`), "utf8");
  const m = new Map();
  text.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    const o = JSON.parse(l);
    if (typeof o.id !== "string" || ![0, 1, 2].includes(o.grade)) throw new Error(`rater ${r} line ${i + 1}: bad row`);
    if (m.has(o.id)) throw new Error(`rater ${r}: ${o.id} graded twice`);
    m.set(o.id, o.grade);
  });
  return m;
}
const ga = readRater("a");
const gb = readRater("b");
const ids = Object.keys(map.pairs).sort();
for (const [r, g] of [["a", ga], ["b", gb]]) {
  const missing = ids.filter((id) => !g.has(id));
  if (missing.length) throw new Error(`rater ${r}: ${missing.length} pairs ungraded (first ${missing[0]})`);
  const extra = [...g.keys()].filter((id) => !(id in map.pairs));
  if (extra.length) throw new Error(`rater ${r}: ${extra.length} ids not in the pool (first ${extra[0]})`);
}
const grade = new Map(ids.map((id) => [id, (ga.get(id) + gb.get(id)) / 2]));

// Quadratic-weighted kappa, categories 0..2.
function qwk() {
  const n = ids.length;
  const O = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const ra = [0, 0, 0];
  const rb = [0, 0, 0];
  for (const id of ids) {
    const a = ga.get(id), b = gb.get(id);
    O[a][b]++;
    ra[a]++;
    rb[b]++;
  }
  let num = 0, den = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const w = ((i - j) * (i - j)) / 4;
      num += w * O[i][j];
      den += (w * ra[i] * rb[j]) / n;
    }
  const exact = ids.filter((id) => ga.get(id) === gb.get(id)).length;
  return { kappa: den > 0 ? 1 - num / den : null, exactAgreement: exact / n, confusion: { rowsA_colsB: O }, a: ra, b: rb };
}

const qs = [...map.queries].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
const qIds = new Set(qs.map((q) => q.id));
const pool = new Map(qs.map((q) => [q.id, []]));
for (const id of ids) {
  const p = map.pairs[id];
  if (!qIds.has(p.queryId)) throw new Error(`pair ${id} names unknown query ${p.queryId}`);
  for (let i = 0; i < p.docIds.length; i++) pool.get(p.queryId).push(grade.get(id));
}
for (const q of qs)
  for (const arm of ARMS) {
    if (!Array.isArray(q.arms[arm])) throw new Error(`query ${q.id}: no ${arm} arm`);
    for (const h of q.arms[arm]) {
      if (!grade.has(h.pair)) throw new Error(`query ${q.id} ${arm}: hit pair ${h.pair} not in pool`);
      if (map.pairs[h.pair].queryId !== q.id) throw new Error(`query ${q.id} ${arm}: hit pair ${h.pair} belongs to ${map.pairs[h.pair].queryId}`);
    }
  }
// If the kept query file sits beside pool-map.json, its sha256 must be the one the pool was built from.
{
  const kept = path.join(dir, "queries.kept.json");
  const want = map.provenance && map.provenance.queries && map.provenance.queries.sha256;
  if (fs.existsSync(kept) && want) {
    const got = require("crypto").createHash("sha256").update(fs.readFileSync(kept)).digest("hex");
    if (got !== want) throw new Error(`queries.kept.json sha256 ${got} != pool-map provenance ${want}`);
  }
}

const dcg = (gs) => gs.reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
const idcg = new Map(qs.map((q) => [q.id, dcg([...pool.get(q.id)].sort((a, b) => b - a).slice(0, K))]));
const isPlus = (q) => pool.get(q.id).some((x) => x >= 1);
const qplus = qs.filter(isPlus);
const q0 = qs.filter((q) => !isPlus(q));

function per(q, arm) {
  const gs = q.arms[arm].slice(0, K).map((h) => grade.get(h.pair));
  const I = idcg.get(q.id);
  return { shown: gs.length, ndcg: I > 0 ? dcg(gs) / I : 0, top1: gs.length > 0 && gs[0] >= 1 ? 1 : 0 };
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);

function armStats(plus, zero, arm) {
  const ms = plus.map((q) => per(q, arm));
  return {
    ndcg8: r4(mean(ms.map((x) => x.ndcg))),
    top1Relevant: r4(mean(ms.map((x) => x.top1))),
    emptyQplus: r4(mean(ms.map((x) => (x.shown ? 0 : 1)))),
    showQ0: r4(mean(zero.map((q) => (q.arms[arm].length ? 1 : 0)))),
    nQplus: plus.length,
    nQ0: zero.length,
  };
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootCI(xs) {
  if (!xs.length) return null;
  const rand = mulberry32(SEED >>> 0);
  const bs = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let t = 0;
    for (let i = 0; i < xs.length; i++) t += xs[Math.floor(rand() * xs.length)];
    bs[b] = t / xs.length;
  }
  bs.sort();
  // Same indices as the earlier blind scorers: 249 and 9749 of 10,000.
  return [r4(bs[Math.round(0.025 * B) - 1]), r4(bs[Math.round(0.975 * B) - 1])];
}

const out = {
  prereg: "writeups/panel-2026-10-18b/gate/PREREG.md",
  provenance: map.provenance || null,
  queries: qs.length,
  pairs: ids.length,
  qplus: qplus.length,
  q0: q0.length,
  meanGradeCounts: {},
  raters: qwk(),
  arms: {},
  byType: {},
};
for (const id of ids) {
  const k = String(grade.get(id));
  out.meanGradeCounts[k] = (out.meanGradeCounts[k] || 0) + 1;
}
out.raters.kappa = r4(out.raters.kappa);
out.raters.exactAgreement = r4(out.raters.exactAgreement);
out.raters.reliable = out.raters.kappa != null && out.raters.kappa >= KAPPA_FLOOR;
for (const arm of ARMS) out.arms[arm] = armStats(qplus, q0, arm);
const types = [...new Set(qs.map((q) => q.type == null ? "untyped" : q.type))].sort();
for (const t of types) {
  const tp = qplus.filter((q) => (q.type == null ? "untyped" : q.type) === t);
  const tz = q0.filter((q) => (q.type == null ? "untyped" : q.type) === t);
  out.byType[t] = Object.fromEntries(ARMS.map((arm) => [arm, armStats(tp, tz, arm)]));
  const d = tp.map((q) => per(q, "gated").ndcg - per(q, "shipped").ndcg);
  out.byType[t].gatedMinusShippedNdcg = r4(mean(d));
}

const gN = qplus.map((q) => per(q, "gated").ndcg);
const gE = qplus.map((q) => (per(q, "gated").shown ? 0 : 1));
const gS = q0.map((q) => (q.arms.gated.length ? 1 : 0));
const diff = qplus.map((q) => per(q, "gated").ndcg - per(q, "shipped").ndcg);
const bar = (name, rule, est, ci, pass) => ({ name, rule, estimate: r4(est), ci95: ci, pass });
const e1 = mean(gN), e2 = mean(gE), e3 = mean(gS), e4 = mean(diff);
const c4 = bootCI(diff);
out.bars = [
  bar("1 nDCG@8 on Q+", ">= 0.75", e1, bootCI(gN), e1 != null && e1 >= BARS.ndcg),
  bar("2 empty on Q+", "<= 0.15", e2, bootCI(gE), e2 != null && e2 <= BARS.emptyQplus),
  bar("3 shows a row on Q0", "<= 0.25", e3, bootCI(gS), e3 != null && e3 <= BARS.showQ0),
  bar("4 gated - shipped nDCG@8 on Q+, paired", "CI lower > 0", e4, c4, c4 != null && c4[0] > 0),
];
const failed = out.bars.filter((b) => !b.pass).map((b) => b.name);
out.verdict = {
  allFourPass: failed.length === 0,
  failed,
  kappaReliable: out.raters.reliable,
  text: !out.raters.reliable
    ? `UNRELIABLE: kappa ${out.raters.kappa} < ${KAPPA_FLOOR}; the flag decision waits`
    : failed.length === 0
      ? "ALL FOUR PASS"
      : `FAILED: ${failed.join("; ")}`,
};
out.bootstrap = { resamples: B, prng: "mulberry32", seed: SEED, reseededPerStatistic: true, interval: "percentile 2.5/97.5" };

const json = JSON.stringify(out, null, 1) + "\n";
fs.writeFileSync(outFile, json);
process.stdout.write(json);
