// The records-by-meaning eval as a regression guard on RECORD_TAU (the palette's "By meaning"
// threshold). It reads three files beside it:
//
//   records-queries.json  hand-written queries and judgements (v3: 89 real queries, 37 controls;
//                         every v2 query unchanged plus queries and controls for bia-lar and
//                         wrc-communities), written by the eval agent before any v3 query was
//                         scored, labelled "not user queries". Its sha256 is pinned below, so
//                         editing it after seeing scores fails the test.
//   records-corpus.json   record text only ({card, embedText, source, retrievedAt, n}): 4,067
//                         real records from the 18 record-vector cards, the captured fixtures
//                         plus the 2026-10-17 keyless pulls, as 1,513 rows with a count (one row
//                         per card, text, source and retrieval time; 1,500 distinct card and text
//                         pairs). No ids or vectors, and no person's name. Since B0 (2026-10-18,
//                         run 5) every text starts with its card's short title and agency, then the
//                         record's published name on the four PUBLIC_NAME_RULE cards (hospitals,
//                         public schools, non-private dams, federal and state PAD-US units), then its place. The
//                         same 4,067 records were rebuilt through the builders, the live ones from
//                         the logged URLs; each matched its run-4 text once B0's segments were taken
//                         out (writeups/panel-2026-10-18b/b0/run5). bia-lar's LARNAME stays embedded
//                         (Cam's call, 2026-10-17), beside its BIA region (DESIGN 7.3a, run 4).
//   records-results.json  the per-query output of the run these numbers come from.
//
// This is a regression guard, not the evidence for lifting ?semantic=1: the same agent wrote the
// queries and chose tau on them, so tau passes by construction. Lifting the flag waits on a blind
// query set judged against the bars in the eval's DESIGN (P >= 0.65, R@8 >= 0.45, empty <= 0.30,
// zero control rows). RECORD_TAU is 0.5 by Cam's call (2026-10-17), which misses two of those bars
// on v3: empty is 0.404, and n30 shows a row. Both are pinned below as accepted, measured exceptions. Cost: the pinned weights plus 4,067 record embeds, about 0.15 s and 150 MB.
//
// When a card joins RECORD_VECTOR_CARDS, the coverage test fails and its message says what to do
// (NEW_CARD_STEPS). The eval's scripts and DESIGN are in the writeups folder named there.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { potionNode } from "@/lib/embed/loadNode";
import { RecordIndex, featureKey } from "@/lib/embed/recordIndex";
import { RECORD_TAU } from "@/lib/embed/recordTau";
import { queryText } from "@/lib/catalog/recordText";
import { RECORD_VECTOR_CARDS } from "@/lib/catalog/embedFields";
import type { LayerFeature } from "@/lib/layers/types";

const DIR = path.join(process.cwd(), "lib/embed/__eval__");
const QUERIES_SHA256 = "28159658766af83f766c9c5ddcd7b6de4202350caea7cbb3c50016e568792a8f";
const RECORDS = 4067;
/** What to do when the corpus and RECORD_VECTOR_CARDS disagree (printed by the coverage test). */
const NEW_CARD_STEPS = [
  "The records eval must be re-run for the new card set (writeups/eye-embeddings-2026-10-16/records-eval, DESIGN.md, latest \"Run N\"):",
  "1. Pull real records for each missing card with the latest pull-records-runN.mts: its captured fixtures (recordFixtures()) plus keyless live boxes through the route's own builder. Save text only.",
  "2. Append them to records-corpus.json as {card, embedText, source, retrievedAt, n} rows (drop the rows of any extra card), and update RECORDS.",
  "3. Write queries.v(N+1).json: every earlier query unchanged, plus collection and value queries and controls for the new card. Write the judgements before scoring, sha256 it, make it read-only, copy it byte for byte to records-queries.json and update QUERIES_SHA256.",
  "4. Re-run the sweep at every tau (run-records-eval-runN.mts). If RECORD_TAU still has no control row and passes the DESIGN 7.2 bars, re-pin MEASURED and records-results.json; if not, report the numbers and change RECORD_TAU only to the lowest step that passes.",
  "5. Append \"Run N+1\" to DESIGN.md.",
].join("\n");
/** RECORD_ROWS in the palette. */
const K = 8;

type Rule = { card: string; field?: string; values?: string[]; prefixes?: string[]; grade: number };
type Query = { id: string; kind: "collection" | "value" | "control"; q: string; judge: Rule[] };
type Row = { card: string; embedText: string; n: number };

const rawQ = readFileSync(path.join(DIR, "records-queries.json"));
const queries: Query[] = JSON.parse(rawQ.toString()).queries;
const corpus: Row[] = JSON.parse(readFileSync(path.join(DIR, "records-corpus.json"), "utf8"));

function fields(t: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of t.split("; ")) {
    const i = part.indexOf(": ");
    if (i > 0 && !m.has(part.slice(0, i))) m.set(part.slice(0, i), part.slice(i + 2));
  }
  return m;
}

/** A record's grade for a query: the highest rule that matches its card and, if given, a published value. */
function grade(q: Query, r: Row): number {
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

// Measured 2026-10-18 on the files above (B0, run 5: the run-4 records with the B0 record text). P is
// precision over the queries that showed anything, R is recall@8 (relevant shown / min(8, relevant))
// over all 89 real queries, empty is the share of real queries that showed nothing. A deliberate
// change to tau, the weights or the record text updates this table. Run 4 (before B0) was
// 0.4: 0.758 / 0.647 / 0.157; 0.5: 0.847 / 0.459 / 0.404; 0.6: 0.863 / 0.222 / 0.652.
const MEASURED: Record<string, { P: number; R: number; empty: number }> = {
  "0.4": { P: 0.763, R: 0.669, empty: 0.112 },
  "0.5": { P: 0.876, R: 0.511, empty: 0.292 },
  "0.6": { P: 0.843, R: 0.264, empty: 0.64 },
};
const TOL = 0.02;

/**
 * DESIGN 7.2 bars that RECORD_TAU misses, each accepted by Cam and keyed to the measured value:
 * the run may not be worse than the value accepted (plus TOL), so a worse rate still fails.
 * Empty (0.404 in run 4, accepted by Cam 2026-10-17) meets its 0.30 bar since B0 (0.292), so it is no longer an exception.
 */
const ACCEPTED_BAR_MISSES: Record<string, { bar: number; accepted: number; decision: string }> = {};
const BARS = { P: 0.65, R: 0.45, empty: 0.3 };

/**
 * Controls allowed to show a row at RECORD_TAU, and the only card each may land on. Any other
 * control showing a row, or one of these landing on any other card, fails.
 */
const KNOWN_CONTROL_LEAKS: Record<string, { card: string; decision: string }> = {
  n30: { card: "bia-lar", decision: "Cam, 2026-10-17: \"Cutoff 0.50\" (run 4: n30 \"Alaska Native corporation lands\" on bia-lar at 0.506)" },
  // B0's head "Wildfire risk to communities" lifts v2's adjacent control n03 from 0.495 to 0.547 on WRC (8 rows).
  n03: { card: "wrc-communities", decision: "Cam, 2026-10-18: \"Accept the leak, merge\" (B0 PR #96: n03 \"wildfire perimeters\" on wrc-communities at 0.547)" },
};

describe("records by meaning (hand-written eval, labelled as such)", () => {
  const model = potionNode();
  const rows = corpus.flatMap((r) => Array.from({ length: r.n }, () => r));
  const feats = rows.map((r, i) => ({ type: "Feature", geometry: null, properties: { layer: r.card, id: String(i), name: "", extra: { embedText: r.embedText } } }) as unknown as LayerFeature);
  const rowOf = new Map(feats.map((f, i) => [featureKey(f), rows[i]]));
  const index = new RecordIndex(model);
  index.sync(feats);

  const run = (q: Query, tau: number) => {
    const text = queryText(q.q);
    const v = text ? model.embed(text) : null;
    const hits = v ? index.search(v, K, tau) : [];
    const rel = hits.filter((h) => grade(q, rowOf.get(featureKey(h.feature))!) === 2).length;
    const nRel = rows.filter((r) => grade(q, r) === 2).length;
    return { shown: hits.length, rel, recall: nRel ? rel / Math.min(K, nRel) : 0 };
  };

  it("the query set is the pre-registered v3 one", () => {
    expect(createHash("sha256").update(rawQ).digest("hex")).toBe(QUERIES_SHA256);
  });

  it("the corpus is every record-vector card, 4,067 records", () => {
    const inCorpus = new Set(corpus.map((r) => r.card));
    const missing = [...RECORD_VECTOR_CARDS].filter((c) => !inCorpus.has(c)).sort();
    const extra = [...inCorpus].filter((c) => !RECORD_VECTOR_CARDS.has(c)).sort();
    expect({ missing, extra }, `records-corpus.json and RECORD_VECTOR_CARDS disagree (missing from the corpus: ${missing.join(", ") || "none"}; in the corpus but no longer record-vector cards: ${extra.join(", ") || "none"}).\n${NEW_CARD_STEPS}`).toEqual({ missing: [], extra: [] });
    expect(rows.length).toBe(RECORDS);
    expect(index.size).toBe(RECORDS);
  });

  it("every real query has a relevant record loaded, and no control has one", () => {
    for (const q of queries) {
      const nRel = rows.filter((r) => grade(q, r) === 2).length;
      if (q.kind === "control") expect(nRel, q.id).toBe(0);
      else expect(nRel, q.id).toBeGreaterThan(0);
    }
  });

  // Run 4 (DESIGN 7.3a) found no tau step that passes. Cam chose 0.5 (2026-10-17): there one control
  // shows a row, n30 "Alaska Native corporation lands" on bia-lar, and it is the only one allowed
  // (KNOWN_CONTROL_LEAKS). Every other control must show nothing, and n30 may land only on bia-lar.
  it("controls (nothing relevant loaded) show no record at RECORD_TAU, except the accepted leaks", () => {
    const leaks = queries
      .filter((q) => q.kind === "control")
      .map((q) => {
        const text = queryText(q.q);
        const v = text ? model.embed(text) : null;
        return { q, hits: v ? index.search(v, K, RECORD_TAU) : [] };
      })
      .filter((x) => x.hits.length > 0)
      .filter(({ q, hits }) => {
        const known = KNOWN_CONTROL_LEAKS[q.id];
        return !known || hits.some((h) => rowOf.get(featureKey(h.feature))!.card !== known.card);
      })
      .map(({ q, hits }) => `${q.id} "${q.q}" -> ${[...new Set(hits.map((h) => rowOf.get(featureKey(h.feature))!.card))].join(", ")} ${hits[0].score.toFixed(3)} (${hits.length} row${hits.length === 1 ? "" : "s"})`);
    expect(leaks, `controls showing a row at RECORD_TAU ${RECORD_TAU} (allowed: ${Object.entries(KNOWN_CONTROL_LEAKS).map(([id, k]) => `${id} on ${k.card}`).join(", ")})`).toEqual([]);
  });

  it("real queries: precision, recall@8 and empty match the measured run at RECORD_TAU", () => {
    const m = MEASURED[String(RECORD_TAU)];
    expect(m, `no measured row for RECORD_TAU ${RECORD_TAU}`).toBeDefined();
    const real = queries.filter((q) => q.kind !== "control").map((q) => run(q, RECORD_TAU));
    const shown = real.filter((r) => r.shown > 0);
    const precision = shown.reduce((s, r) => s + r.rel / r.shown, 0) / shown.length;
    const recall = real.reduce((s, r) => s + r.recall, 0) / real.length;
    const empty = 1 - shown.length / real.length;
    expect(Math.abs(precision - m.P), `P ${precision.toFixed(3)}`).toBeLessThanOrEqual(TOL);
    expect(Math.abs(recall - m.R), `R ${recall.toFixed(3)}`).toBeLessThanOrEqual(TOL);
    expect(Math.abs(empty - m.empty), `empty ${empty.toFixed(3)}`).toBeLessThanOrEqual(TOL);

    // The DESIGN 7.2 bars: met, or missed by no more than an accepted, measured exception.
    const got = { P: precision, R: recall, empty };
    for (const key of ["P", "R"] as const) {
      const miss = ACCEPTED_BAR_MISSES[key];
      const floor = miss ? miss.accepted - TOL : BARS[key];
      expect(got[key], `${key} ${got[key].toFixed(3)} against bar ${BARS[key]}${miss ? ` (accepted ${miss.accepted}: ${miss.decision})` : ""}`).toBeGreaterThanOrEqual(floor);
    }
    const missE = ACCEPTED_BAR_MISSES.empty;
    const ceil = missE ? missE.accepted + TOL : BARS.empty;
    expect(empty, `empty ${empty.toFixed(3)} against bar ${BARS.empty}${missE ? ` (accepted ${missE.accepted}: ${missE.decision})` : ""}`).toBeLessThanOrEqual(ceil);
  });
});
