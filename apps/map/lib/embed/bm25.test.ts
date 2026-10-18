// Parity: lib/embed/bm25.ts must rank exactly as the eval's Bm25 did before it moved out of
// lib/embed/__eval__/retrievers.ts (2026-10-18). The expected values below were printed by the old
// implementation (retrievers.ts at origin/master 2774531) over the same inputs, before the move:
// [index into the doc list, score] for each hit, best first.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Bm25, Bm25Index, queryTerms, tokenize } from "./bm25";
import { Bm25 as EvalBm25, distinctDocs, docId, tokenize as evalTokenize } from "./__eval__/retrievers";

type Pinned = Record<string, Array<[number, number]>>;

const OLD_CORPUS: Pinned = {
  "dams with high hazard potential": [[326, 9.555547678269575], [340, 9.555547678269575], [341, 9.555547678269575], [348, 9.555547678269575], [500, 9.386818370677046], [305, 9.243211190506344], [308, 9.243211190506344], [313, 9.243211190506344]],
  "hospitals in central montana": [[865, 15.533501312901812], [878, 11.069519494766132], [873, 10.68457782024168], [8, 10.244195092785404], [920, 4.508830891755807], [1127, 4.508830891755807], [936, 4.4603905854019805], [940, 4.4129800458439625]],
  "superfund sites": [[123, 8.199816782369313], [87, 8.054989587231441], [93, 7.795740908961498], [95, 7.795740908961498], [99, 7.795740908961498], [102, 7.795740908961498], [111, 7.795740908961498], [118, 7.795740908961498]],
  "wind turbines": [[1473, 7.629397522611944]],
};

const FIXTURE = [
  "dam type: Earth; hazard potential: High",
  "dam type: Earth; hazard potential: Low",
  "hospital type: General Acute Care; helipad: Yes; state: Texas; trauma center level: Level I extra extra extra",
  "hospital type: Critical Access; state: Texas",
].map((text, i) => ({ id: docId(i < 2 ? "a" : "b", text), text }));

const OLD_FIXTURE: Pinned = {
  "high hazard dam": [[0, 2.915556530408791], [1, 1.5603871413535513]],
  "hospital texas": [[3, 1.5603871413535513], [2, 1.0386477875882774]],
  type: [[0, 0.1185918362288092], [1, 0.1185918362288092], [3, 0.1185918362288092], [2, 0.07893883835663772]],
  "earth texas dam": [[0, 1.5603871413535513], [1, 1.5603871413535513], [3, 0.7801935706767756], [2, 0.5193238937941387]],
};

const asPinned = (docs: ReadonlyArray<{ id: string }>, hits: ReadonlyArray<{ id: string; score: number }>) => hits.map((h) => [docs.findIndex((d) => d.id === h.id), h.score]);

describe("bm25 parity with the eval's old implementation", () => {
  it("the eval module re-exports this one", () => {
    expect(EvalBm25).toBe(Bm25);
    expect(evalTokenize).toBe(tokenize);
  });

  it("fixture: same docs, order and scores", () => {
    const bm = new Bm25(FIXTURE);
    for (const [q, want] of Object.entries(OLD_FIXTURE)) expect(asPinned(FIXTURE, bm.search(q, 4)), q).toEqual(want);
  });

  it("records corpus (1,500 distinct docs): same top 8, order and scores", () => {
    const rows = JSON.parse(readFileSync(path.join(process.cwd(), "lib/embed/__eval__/records-corpus.json"), "utf8"));
    const docs = distinctDocs(rows);
    const bm = new Bm25(docs);
    for (const [q, want] of Object.entries(OLD_CORPUS)) expect(asPinned(docs, bm.search(q, 8)), q).toEqual(want);
  });
});

describe("Bm25Index", () => {
  it("adding and removing documents gives what a rebuild gives", () => {
    const idx = new Bm25Index();
    idx.add("x", "wind farm turbines; state: Texas");
    for (const d of FIXTURE) idx.add(d.id, d.text);
    idx.remove("x");
    const rebuilt = new Bm25(FIXTURE);
    for (const q of Object.keys(OLD_FIXTURE)) expect(idx.search(q, 4), q).toEqual(rebuilt.search(q, 4));
    expect(idx.size).toBe(4);
    expect(idx.search("wind", 4)).toEqual([]);
  });

  it("reports how many distinct query terms each hit contains", () => {
    const bm = new Bm25(FIXTURE);
    const hits = bm.searchDetailed("high hazard dam in texas", 4);
    expect(hits[0]).toMatchObject({ id: FIXTURE[0].id, matched: 3, terms: 4 });
    expect(hits.find((h) => h.id === FIXTURE[3].id)).toMatchObject({ matched: 1, terms: 4 });
    expect(bm.matched(FIXTURE[0].id, queryTerms("high hazard dam in texas"))).toBe(3);
    expect(bm.matched("nope", ["dam"])).toBe(0);
  });

  it("queryTerms is tokenize without repeats", () => {
    expect(queryTerms("dams and more dams of the dam")).toEqual(["dam", "more"]);
    expect(queryTerms("of the and")).toEqual([]);
  });
});
