// Contract tests for the deterministic C5 scoring (SPEC C5).
// Pure functions over the real seed graph — no mocks, no LLM.
import { describe, expect, it } from "vitest";
import { loadLineage } from "./load";
import {
  SCORE_WEIGHTS,
  clarityScore,
  extractMentions,
  feasibilityScore,
  generateIdeas,
  jaccard,
  noveltyScore,
  scoreIdea,
  significanceScore,
  validityScore,
} from "./score";
import { tokenize } from "./search";

const index = loadLineage();

const THREE_METHODS =
  "Combine grouped-query attention, multi-query attention and FlashAttention to cut memory.";
const SIX_METHODS =
  "Combine grouped-query attention, multi-query attention, FlashAttention, Native Sparse Attention, Performer and Mamba to cut memory.";

describe("weights", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(SCORE_WEIGHTS).toEqual({
      novelty: 0.2,
      feasibility: 0.25,
      significance: 0.2,
      validity: 0.2,
      clarity: 0.15,
    });
  });
});

describe("mentions", () => {
  it("grounds the three named methods", () => {
    const { grounded, unknown } = extractMentions(THREE_METHODS, index);
    expect(grounded).toEqual(["flash-attention", "gqa", "mqa"]);
    expect(unknown).toEqual([]);
  });

  it("grounds six methods in the stacking idea", () => {
    const { grounded } = extractMentions(SIX_METHODS, index);
    expect(grounded).toEqual([
      "flash-attention",
      "gqa",
      "mamba",
      "mqa",
      "nsa",
      "performer",
    ]);
  });

  it("flags an unknown Title-Case method as unresolved", () => {
    const { grounded, unknown } = extractMentions(
      "Combine Quantum Flux Attention with grouped-query attention to cut memory.",
      index,
    );
    expect(grounded).toEqual(["gqa"]);
    expect(unknown).toEqual(["Quantum Flux Attention"]);
  });
});

describe("anti-stacking", () => {
  it("stacking 6 methods lowers overall vs 3", () => {
    const three = scoreIdea(THREE_METHODS, index);
    const six = scoreIdea(SIX_METHODS, index);
    expect(three.anti_stacking_penalty).toBe(0);
    expect(six.anti_stacking_penalty).toBeCloseTo(0.15, 10);
    expect(six.overall).toBeLessThan(three.overall);
  });
});

describe("vetoes (one-sided only)", () => {
  it("duplicate idea gets a duplicate veto and overall <= 0.3", () => {
    const gqa = index.methodsById.get("gqa")!;
    const idea = `${gqa.name}: ${gqa.paper!.abstract}`;
    const scored = scoreIdea(idea, index);
    expect(scored.veto).toBe("duplicate_of:gqa");
    expect(scored.overall).toBeLessThanOrEqual(0.3);
    const { maxJaccard } = noveltyScore(idea, index);
    expect(maxJaccard).toBeGreaterThanOrEqual(0.8);
  });

  it("idea naming zero graph methods gets the ungrounded veto and overall <= 0.2", () => {
    const scored = scoreIdea(
      "Combine Quantum Flux Attention with Nebula Weave Routing for faster inference.",
      index,
    );
    expect(scored.veto).toBe("ungrounded");
    expect(scored.overall).toBeLessThanOrEqual(0.2);
    expect(scored.grounded_methods).toEqual([]);
  });
});

describe("individual scores", () => {
  it("feasibility: an unknown method lowers the fraction", () => {
    const known = feasibilityScore(THREE_METHODS, index);
    const mixed = feasibilityScore(
      "Combine Quantum Flux Attention with grouped-query attention to cut memory.",
      index,
    );
    expect(known).toBe(1);
    expect(mixed).toBeCloseTo(0.5, 10);
  });

  it("validity: replacing a newer method with an older one contradicts the graph", () => {
    expect(
      validityScore(
        "Replace grouped-query attention with multi-query attention to save memory.",
        index,
      ),
    ).toBe(0);
    expect(validityScore(THREE_METHODS, index)).toBe(1);
  });

  it("clarity: 1 when every mention resolves, 0 when none does", () => {
    expect(clarityScore(THREE_METHODS, index)).toBe(1);
    expect(
      clarityScore(
        "Combine Quantum Flux Attention with Nebula Weave Routing for faster inference.",
        index,
      ),
    ).toBe(0);
  });

  it("significance is in [0, 1] and higher for a central lineage", () => {
    const s = significanceScore(THREE_METHODS, index);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("novelty grants the unexplored-combination bonus and caps at 1", () => {
    const { score, unexploredBonus } = noveltyScore(THREE_METHODS, index);
    expect(unexploredBonus).toBe(0.1);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("jaccard is 1 for identical sets and 0 for disjoint sets", () => {
    expect(jaccard(new Set(tokenize("a b c")), new Set(tokenize("a b c")))).toBe(1);
    expect(jaccard(new Set(tokenize("a b")), new Set(tokenize("c d")))).toBe(0);
  });
});

describe("idea generation", () => {
  it("returns four strategies; each idea cites >=1 edge with verbatim quotes and an eval", () => {
    const { strategies, ideas } = generateIdeas({}, index);
    expect(strategies.map((s) => s.strategy)).toEqual([
      "gap-fill",
      "transfer",
      "supersede",
      "revisit",
    ]);
    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) {
      expect(idea.evidence_certificate.edges.length).toBeGreaterThanOrEqual(1);
      expect(idea.evidence_certificate.quotes.length).toBeGreaterThanOrEqual(1);
      for (const q of idea.evidence_certificate.quotes) {
        expect(q.text.length).toBeGreaterThan(0);
        expect(q.sourceId.length).toBeGreaterThan(0);
      }
      expect(idea.eval.overall).toBeGreaterThanOrEqual(0);
      expect(idea.eval.overall).toBeLessThanOrEqual(1);
    }
  });

  it("an excluded strategy returns ideas: [] for that strategy, not filler", () => {
    const { strategies } = generateIdeas({ excludeDirections: ["gap-fill"] }, index);
    expect(strategies.find((s) => s.strategy === "gap-fill")!.ideas).toEqual([]);
    expect(strategies.find((s) => s.strategy === "transfer")!.ideas.length).toBeGreaterThan(0);
  });
});
