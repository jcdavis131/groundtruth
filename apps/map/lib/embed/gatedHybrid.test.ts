// The gated hybrid on small hand-made corpora: hand-set unit vectors stand in for the embedder, so
// every cosine is known. The real-model checks are the records eval and gate-dev.mts.
import { describe, expect, it } from "vitest";
import { Bm25 } from "./bm25";
import { GATED_ROWS, HybridCorpus, applyGate, gatedHybrid, rankHybrid, type GateConfig } from "./gatedHybrid";
import { RecordIndex, featureKey } from "./recordIndex";
import { FUSION_DEPTH, rrf } from "./rrf";
import type { Embedder, EmbedInput } from "./types";
import type { LayerFeature } from "@/lib/layers/types";

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs);
  return Float32Array.from(xs.map((x) => x / n));
};
/** A vector at cosine `c` to Q (Q = x axis). */
const at = (c: number) => unit(c, Math.sqrt(1 - c * c), 0);
const Q = unit(1, 0, 0);

const DOCS: Array<[string, number]> = [
  ["dam type: Earth; hazard potential: High; state: Texas", 0.62],
  ["dam type: Gravity; hazard potential: Low; state: Ohio", 0.55],
  ["hospital type: Critical Access; state: Texas", 0.3],
  ["school level: High; state: Texas", 0.2],
  ["wind river; state: Wyoming", 0.1],
];
const corpus = () => {
  const c = new HybridCorpus();
  for (const [t, cos] of DOCS) c.add(t, t, at(cos));
  return c;
};

describe("rankHybrid", () => {
  it("is RRF of BM25's and the embedding's top FUSION_DEPTH, with each hit's signals", () => {
    const c = corpus();
    const q = "high hazard dams";
    const r = rankHybrid(c, q, Q);
    const bm = new Bm25(DOCS.map(([t]) => ({ id: t, text: t })));
    const emb = c.embedRank(Q);
    expect(r.hits.map((h) => h.id)).toEqual(rrf([bm.search(q, FUSION_DEPTH), emb.slice(0, FUSION_DEPTH)], Infinity).map((h) => h.id));
    expect(r.hits[0]).toMatchObject({ id: DOCS[0][0], coverage: { terms: 1, idf: 1 } });
    expect(r.hits[0].cosine).toBeCloseTo(0.62, 5);
    expect(r.maxCosine).toBeCloseTo(0.62, 5);
    expect(r.maxCoverage.terms).toBe(1);
    expect(r.terms).toBe(3);
    // A doc only the embedding found has no BM25 score.
    expect(r.hits.find((h) => h.id === DOCS[4][0])).toMatchObject({ bm25: null, coverage: { terms: 0, idf: 0 } });
  });

  it("weighs a word no loaded record has most under idf coverage", () => {
    const r = rankHybrid(corpus(), "wind turbines", Q);
    const wind = r.hits.find((h) => h.id === DOCS[4][0])!;
    expect(wind.coverage.terms).toBe(0.5);
    expect(wind.coverage.idf).toBeLessThan(0.5);
  });
});

describe("applyGate", () => {
  const list: GateConfig = { rule: "list", t: 0.7, c: 0.6 };
  const perHit: GateConfig = { rule: "per-hit", t: 0.5, c: 0.6 };

  it("list: shows nothing when neither the best cosine nor the best coverage clears its bar", () => {
    expect(gatedHybrid(corpus(), "wind turbines", Q, list)).toEqual([]);
    expect(gatedHybrid(corpus(), "volcano ash", Q, list)).toEqual([]);
  });

  it("list: shows the fused top k unchanged when coverage opens it", () => {
    const c = corpus();
    const r = rankHybrid(c, "high hazard dams", Q);
    expect(applyGate(r, list).map((h) => h.id)).toEqual(r.hits.slice(0, GATED_ROWS).map((h) => h.id));
  });

  it("list: cosine alone can open it, as for a query that is all stop words", () => {
    const shown = gatedHybrid(corpus(), "of the", Q, { rule: "list", t: 0.6, c: 0.6 });
    expect(shown.length).toBe(DOCS.length);
    expect(gatedHybrid(corpus(), "of the", Q, { rule: "list", t: 0.65, c: 0 })).toEqual([]);
  });

  it("per-hit: keeps hits by their own cosine or coverage, in fused order", () => {
    const shown = gatedHybrid(corpus(), "texas dams", Q, perHit).map((h) => h.id);
    // Both dams pass on cosine (0.62, 0.55); the hospital and school match "texas" only (0.5 < 0.6).
    expect(shown).toEqual([DOCS[0][0], DOCS[1][0]]);
  });

  it("both: the list gate, then the per-hit gate", () => {
    const cfg: GateConfig = { rule: "both", t: 0.6, c: 2, tHit: 0.5, cHit: 2 };
    expect(gatedHybrid(corpus(), "texas", Q, cfg).map((h) => h.id).sort()).toEqual([DOCS[0][0], DOCS[1][0]].sort());
    expect(gatedHybrid(corpus(), "texas", Q, { ...cfg, t: 0.63 })).toEqual([]);
  });

  it("shows at most 8", () => {
    const c = new HybridCorpus();
    for (let i = 0; i < 12; i++) c.add(`d${i}`, `dam number ${i}`, at(0.9 - i * 0.01));
    expect(gatedHybrid(c, "dam", Q, { rule: "per-hit", t: 0, c: 0 })).toHaveLength(8);
    expect(GATED_ROWS).toBe(8);
  });

  it("skips excluded docs before ranking", () => {
    const shown = gatedHybrid(corpus(), "high hazard dams", Q, { rule: "list", t: 0, c: 0 }, { skip: (id) => id === DOCS[0][0] });
    expect(shown.map((h) => h.id)).not.toContain(DOCS[0][0]);
    expect(shown.length).toBe(DOCS.length - 1);
  });

  it("idf coverage is used when the config says so", () => {
    const r = rankHybrid(corpus(), "wind turbines", Q);
    expect(applyGate(r, { rule: "list", coverage: "terms", t: 0.9, c: 0.5 }).length).toBeGreaterThan(0);
    expect(applyGate(r, { rule: "list", coverage: "idf", t: 0.9, c: 0.5 })).toEqual([]);
  });
});

describe("RecordIndex.searchGated", () => {
  // A fake embedder: the text's vector is looked up from DOCS (cosine to Q as given there).
  const cos = new Map(DOCS);
  let embeds = 0;
  const embedder = {
    id: "fake",
    dim: 3,
    embed: (t: EmbedInput) => {
      embeds++;
      return cos.has(t) ? at(cos.get(t)!) : null;
    },
  } as unknown as Embedder;
  const feat = (layer: string, id: string, text: string) => ({ type: "Feature", geometry: null, properties: { layer, id, name: "", extra: { embedText: text } } }) as unknown as LayerFeature;
  // Two loaded records share the first dam's text.
  const texts = [DOCS[0][0], DOCS[0][0], ...DOCS.slice(1).map(([t]) => t)];
  const feats = texts.map((t, i) => (i < 2 ? feat("dams", String(i + 1), t) : feat("x", String(i), t)));
  const cfg: GateConfig = { rule: "list", t: 0.6, c: 0.6 };

  it("shows one row per distinct text and embeds each text once", () => {
    embeds = 0;
    const idx = new RecordIndex(embedder);
    idx.sync(feats);
    expect(embeds).toBe(DOCS.length);
    expect(idx.size).toBe(feats.length);
    expect(idx.texts).toBe(DOCS.length);
    const hits = idx.searchGated("high hazard dams", Q, cfg);
    const firstKey = new Map<string, string>();
    feats.forEach((f, i) => firstKey.has(texts[i]) || firstKey.set(texts[i], featureKey(f)));
    expect(hits.map((h) => featureKey(h.feature))).toEqual(rankHybrid(idx.hybrid, "high hazard dams", Q).hits.map((h) => firstKey.get(h.id)));
    expect(hits[0].score).toBeCloseTo(0.62, 5);
  });

  it("an excluded record gives way to another with the same text; a text with every record excluded is skipped", () => {
    const idx = new RecordIndex(embedder);
    idx.sync(feats);
    const one = idx.searchGated("high hazard dams", Q, cfg, 8, new Set(["dams:1"]));
    expect(featureKey(one[0].feature)).toBe("dams:2");
    const both = idx.searchGated("high hazard dams", Q, cfg, 8, new Set(["dams:1", "dams:2"]));
    expect(both.map((h) => h.hybrid!.id)).not.toContain(DOCS[0][0]);
  });

  it("keeps the BM25 index in step when records leave", () => {
    const idx = new RecordIndex(embedder);
    idx.sync(feats);
    idx.sync(feats.slice(1));
    expect(idx.texts).toBe(DOCS.length);
    idx.sync(feats.slice(2));
    expect(idx.texts).toBe(DOCS.length - 1);
    expect(idx.hybrid.bm25.size).toBe(DOCS.length - 1);
    expect(idx.searchGated("hazard", Q, { rule: "list", t: 0, c: 0 }).map((h) => h.hybrid!.id)).not.toContain(DOCS[0][0]);
  });
});
