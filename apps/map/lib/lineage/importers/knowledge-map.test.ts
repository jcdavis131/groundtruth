// Unit test for the idle knowledge-map importer (SPEC C3.1).
// 2-entry fixture, per the SPEC. The importer is never run in the build.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importKnowledgeMap } from "./knowledge-map.mjs";

function withTmpDir(run: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "km-test-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("importKnowledgeMap (2-entry fixture)", () => {
  it("imports a Markdown directory: methods only, paper skipped without metadata", () => {
    withTmpDir((dir) => {
      writeFileSync(
        path.join(dir, "flash-attention.md"),
        `---\nid: flash-attention\nyear: 2022\narxivId: 2205.14135\n---\n# FlashAttention\n`,
      );
      writeFileSync(
        path.join(dir, "sparse.md"),
        `---\nid: sparse-transformer\nyear: 2019\n---\n# Sparse Transformer\n`,
      );
      const { nodes, edges, skipped } = importKnowledgeMap(dir, new Date("2026-11-24T00:00:00.000Z"));
      expect(nodes.filter((n) => n.kind === "method")).toHaveLength(2);
      expect(nodes.filter((n) => n.kind === "paper")).toHaveLength(0);
      expect(edges).toHaveLength(0);
      expect(skipped).toHaveLength(1);
      expect(skipped[0].id).toBe("flash-attention");
      expect(nodes[0].paper).toBeUndefined();
    });
  });

  it("imports a JSON array: method + paper nodes, typed edges, deterministic confidence", () => {
    withTmpDir((dir) => {
      const file = path.join(dir, "entries.json");
      writeFileSync(
        file,
        JSON.stringify([
          {
            id: "mha",
            name: "Multi-head attention",
            year: 2017,
            arxivId: "1706.03762",
            paper: {
              title: "Attention Is All You Need",
              authors: ["Ashish Vaswani"],
              venue: "NeurIPS 2017",
              tier: "tier1",
              abstract: "We propose a new simple network architecture, the Transformer.",
              releasedAt: "2017-06-12T00:00:00.000Z",
            },
            edges: [
              {
                to: "gqa",
                type: "improves",
                axis: "memory efficiency",
                bottleneck: "the keys and values are shared",
                mechanism: "grouped-query attention",
                tradeoff: "quality close to multi-head attention",
              },
            ],
          },
          {
            id: "gqa",
            name: "Grouped-query attention",
            year: 2023,
            arxivId: "2305.13245",
            paper: {
              title: "GQA: Training Generalized Multi-Query Transformer Models",
              authors: ["Joshua Ainslie"],
              venue: "EMNLP 2023",
              tier: "tier2",
              abstract: "We introduce grouped-query attention (GQA).",
              releasedAt: "2023-05-18T00:00:00.000Z",
            },
            edges: [
              {
                to: "mha",
                type: "compares",
                axis: "accuracy",
                bottleneck: "quality degradation",
                mechanism: "grouped-query attention",
              },
            ],
          },
        ]),
      );
      const { nodes, edges, skipped } = importKnowledgeMap(file, new Date("2026-11-24T00:00:00.000Z"));
      expect(skipped).toHaveLength(0);
      expect(nodes.filter((n) => n.kind === "method")).toHaveLength(2);
      expect(nodes.filter((n) => n.kind === "paper")).toHaveLength(2);
      expect(nodes.find((n) => n.id === "arxiv:1706.03762")?.paper?.provenance.publisher).toBe(
        "arXiv.org e-Print archive",
      );
      expect(edges).toHaveLength(2);
      const strong = edges.find((e) => e.id === "mha--gqa");
      expect(strong?.strength).toBe("strong");
      expect(strong?.evidence.confidence).toBe(1.0);
      const weak = edges.find((e) => e.id === "gqa--mha");
      expect(weak?.strength).toBe("weak");
      expect(weak?.evidence.tradeoff).toBeNull();
      expect(weak?.evidence.confidence).toBe(0.8);
    });
  });

  it("rejects an unknown edge type", () => {
    withTmpDir((dir) => {
      const file = path.join(dir, "bad.json");
      writeFileSync(
        file,
        JSON.stringify([
          { id: "a", name: "A", year: 2020, edges: [{ to: "b", type: "evolves", axis: "accuracy", bottleneck: "x", mechanism: "y" }] },
          { id: "b", name: "B", year: 2021 },
        ]),
      );
      expect(() => importKnowledgeMap(file)).toThrow(/unknown edge type/);
    });
  });
});
