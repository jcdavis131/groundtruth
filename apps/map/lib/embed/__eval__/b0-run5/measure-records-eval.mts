// Re-measures records-eval.test.ts's MEASURED table and its control leaks on the current corpus, with
// the test's own logic (v3 queries, judge rules, K 8), at tau 0.4 / 0.5 / 0.6.
//   npx vite-node -c vitest.config.ts <this>     (run from the worktree)
import { readFileSync } from "node:fs";
import path from "node:path";
import { potionNode } from "@/lib/embed/loadNode";
import { RecordIndex, featureKey } from "@/lib/embed/recordIndex";
import { queryText } from "@/lib/catalog/recordText";
import type { LayerFeature } from "@/lib/layers/types";

const DIR = path.join(process.cwd(), "lib/embed/__eval__");
type Rule = { card: string; field?: string; values?: string[]; prefixes?: string[]; grade: number };
type Query = { id: string; kind: string; q: string; judge: Rule[] };
type Row = { card: string; embedText: string; n: number };
const queries: Query[] = JSON.parse(readFileSync(path.join(DIR, "records-queries.json"), "utf8")).queries;
const corpus: Row[] = JSON.parse(readFileSync(path.join(DIR, "records-corpus.json"), "utf8"));
function fields(t: string) {
  const m = new Map<string, string>();
  for (const part of t.split("; ")) {
    const i = part.indexOf(": ");
    if (i > 0 && !m.has(part.slice(0, i))) m.set(part.slice(0, i), part.slice(i + 2));
  }
  return m;
}
function grade(q: Query, r: Row) {
  let g = 0;
  const f = fields(r.embedText);
  for (const rule of q.judge) {
    if (rule.card !== r.card) continue;
    if (rule.field) {
      const v = f.get(rule.field);
      if (v == null || !(rule.values?.includes(v) || rule.prefixes?.some((p) => v.startsWith(p)))) continue;
    }
    g = Math.max(g, rule.grade);
  }
  return g;
}
const model = potionNode();
const rows = corpus.flatMap((r) => Array.from({ length: r.n }, () => r));
const feats = rows.map((r, i) => ({ type: "Feature", geometry: null, properties: { layer: r.card, id: String(i), name: "", extra: { embedText: r.embedText } } }) as unknown as LayerFeature);
const rowOf = new Map(feats.map((f, i) => [featureKey(f), rows[i]]));
const index = new RecordIndex(model);
index.sync(feats);
for (const tau of [0.4, 0.45, 0.5, 0.55, 0.6]) {
  const real = queries.filter((q) => q.kind !== "control").map((q) => {
    const t = queryText(q.q);
    const v = t ? model.embed(t) : null;
    const hits = v ? index.search(v, 8, tau) : [];
    const rel = hits.filter((h) => grade(q, rowOf.get(featureKey(h.feature))!) === 2).length;
    const nRel = rows.filter((r) => grade(q, r) === 2).length;
    return { shown: hits.length, rel, recall: nRel ? rel / Math.min(8, nRel) : 0 };
  });
  const shown = real.filter((r) => r.shown > 0);
  const P = shown.reduce((s, r) => s + r.rel / r.shown, 0) / shown.length;
  const R = real.reduce((s, r) => s + r.recall, 0) / real.length;
  const empty = 1 - shown.length / real.length;
  const leaks = queries.filter((q) => q.kind === "control").map((q) => {
    const t = queryText(q.q);
    const v = t ? model.embed(t) : null;
    const hits = v ? index.search(v, 8, tau) : [];
    return hits.length ? `${q.id} "${q.q}" -> ${[...new Set(hits.map((h) => rowOf.get(featureKey(h.feature))!.card))].join(",")} ${hits[0].score.toFixed(3)} (${hits.length})` : null;
  }).filter(Boolean);
  console.log(JSON.stringify({ tau, P: +P.toFixed(3), R: +R.toFixed(3), empty: +empty.toFixed(3), leaks }));
}
