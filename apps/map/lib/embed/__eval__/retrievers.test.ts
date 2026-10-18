// Unit checks for the blind search eval's test-only retrievers (retrievers.ts), plus one smoke run
// of all three arms over the records corpus. No scores are pinned here: the blind query set,
// its judgements and the nDCG report live in writeups/eye-embeddings-2026-10-16/search-eval.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { potionNode } from "@/lib/embed/loadNode";
import { Bm25, distinctDocs, docId, rrf, retrievers, tokenize, type Doc } from "./retrievers";

const doc = (card: string, text: string, n = 1): Doc => ({ id: docId(card, text), card, text, n });

describe("tokenize", () => {
  it("matches the records eval's word-overlap tokenizer", () => {
    expect(tokenize("Hazard potential: High; dams of the Year 1963")).toEqual(["hazard", "potential", "high", "dam", "year", "1963"]);
    expect(tokenize("helipad: No")).toEqual(["helipad"]);
  });
});

describe("Bm25", () => {
  const docs = [
    doc("a", "dam type: Earth; hazard potential: High"),
    doc("a", "dam type: Earth; hazard potential: Low"),
    doc("b", "hospital type: General Acute Care; helipad: Yes; state: Texas; trauma center level: Level I extra extra extra"),
    doc("b", "hospital type: Critical Access; state: Texas"),
  ];
  const bm = new Bm25(docs);

  it("ranks the doc with the rarer matching term first", () => {
    const hits = bm.search("high hazard dam", 4);
    expect(hits[0].id).toBe(docs[0].id);
    expect(hits.map((h) => h.id)).not.toContain(docs[2].id);
  });

  it("normalises for length: the shorter of two otherwise equal matches wins", () => {
    const hits = bm.search("hospital texas", 4);
    expect(hits.map((h) => h.id)).toEqual([docs[3].id, docs[2].id]);
  });

  it("returns nothing when no term matches, and respects n", () => {
    expect(bm.search("wind turbines", 10)).toEqual([]);
    expect(bm.search("type", 1)).toHaveLength(1);
  });

  it("keeps idf positive for a term in every doc (Lucene idf)", () => {
    expect(bm.search("type", 4).every((h) => h.score > 0)).toBe(true);
  });
});

describe("rrf", () => {
  it("sums 1/(k + rank) across lists", () => {
    const out = rrf(
      [
        [{ id: "x", score: 9 }, { id: "y", score: 8 }],
        [{ id: "y", score: 0.9 }, { id: "z", score: 0.8 }],
      ],
      3,
      60,
    );
    expect(out.map((h) => h.id)).toEqual(["y", "x", "z"]);
    expect(out[0].score).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(out[1].score).toBeCloseTo(1 / 61, 12);
  });
});

describe("distinctDocs", () => {
  it("collapses rows with the same card and text and sums n", () => {
    const d = distinctDocs([
      { card: "a", embedText: "t", n: 2 },
      { card: "a", embedText: "t", n: 3 },
      { card: "b", embedText: "t", n: 1 },
    ]);
    expect(d.map((x) => [x.card, x.n])).toEqual([
      ["a", 5],
      ["b", 1],
    ]);
  });
});

describe("the three arms on the records corpus (smoke)", () => {
  const rows = JSON.parse(readFileSync(path.join(process.cwd(), "lib/embed/__eval__/records-corpus.json"), "utf8"));
  const docs = distinctDocs(rows);
  const r = retrievers(potionNode(), docs);

  it("covers every loaded record once per distinct text", () => {
    expect(docs.reduce((s, d) => s + d.n, 0)).toBe(4067);
    // 1,500 since B0 (2026-10-18): public names and places split texts that were shared (1,132 before).
    expect(docs.length).toBe(1500);
  });

  it("each arm returns at most n distinct docs, and the pool is their union", () => {
    const q = "dams with high hazard potential";
    const arms = [r.bm25(q, 10), r.embed(q, 10), r.hybrid(q, 10)];
    for (const a of arms) {
      expect(a.length).toBeLessThanOrEqual(10);
      expect(new Set(a.map((h) => h.id)).size).toBe(a.length);
    }
    const pool = r.pool(q, 10);
    expect(new Set(pool).size).toBe(pool.length);
    expect(new Set(pool)).toEqual(new Set(arms.flat().map((h) => h.id)));
    expect(r.bm25(q, 1)[0].id.startsWith("nid-dams\t")).toBe(true);
  });

  it("the embedding arm has no tau: it ranks something even for a query with no relevant record", () => {
    expect(r.embed("wind turbines", 10)).toHaveLength(10);
    expect(r.bm25("zzzz qqqq", 10)).toEqual([]);
  });
});
