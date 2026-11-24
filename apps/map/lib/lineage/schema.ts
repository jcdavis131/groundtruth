// Method Lineage seed graph — zod schemas (SPEC C3.2, C3.3).
// No new dependencies: zod is already in apps/map/package.json.
// The serialised form lives in graph.json; load.ts parses it with GraphSchema.

import { z } from "zod";

/**
 * Edge types (SPEC C3.3). Definitions are the contract — do not reword silently.
 * - extends: adds capability, keeps the mechanism.
 * - improves: same goal, better on a stated metric.
 * - replaces: supersedes; later work uses the new one instead.
 * - adapts: ports to a new domain/modality.
 * - uses_component: incorporates as a part.
 * - compares: empirical comparison, no causal claim.
 * - background: context only.
 */
export const EdgeTypeSchema = z.enum([
  "extends",
  "improves",
  "replaces",
  "adapts",
  "uses_component",
  "compares",
  "background",
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

/** Strong edge types (SPEC C3.2). A strong edge must carry bottleneck + mechanism quotes. */
export const STRONG_EDGE_TYPES: readonly EdgeType[] = [
  "extends",
  "improves",
  "replaces",
  "adapts",
];

/**
 * Bottleneck axes (SPEC C3.2). The 14 axis names are copied from the
 * Intern-Atlas paper arXiv:2604.28158 (HTML v2, Table 4). An edge carries
 * exactly one axis.
 */
export const BottleneckAxisSchema = z.enum([
  "computational complexity",
  "memory efficiency",
  "parallelization",
  "accuracy",
  "generalization",
  "scalability",
  "data efficiency",
  "training stability",
  "inference speed",
  "expressiveness",
  "simplicity",
  "robustness",
  "hyperparameter sensitivity",
  "training complexity",
]);
export type BottleneckAxis = z.infer<typeof BottleneckAxisSchema>;

export const StrengthSchema = z.enum(["strong", "weak"]);
export type Strength = z.infer<typeof StrengthSchema>;

export const TierSchema = z.enum(["tier1", "tier2"]);
export type Tier = z.infer<typeof TierSchema>;

/** tier1 = NeurIPS/ICML/ICLR/ACL/CVPR/JMLR publication of record; tier2 = anything else. */
export const ProvenanceSchema = z.object({
  publisher: z.literal("arXiv.org e-Print archive"),
  retrievedAt: z.string(),
  releasedAt: z.string(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const PaperSchema = z.object({
  arxivId: z.string(),
  doi: z.string().optional(),
  title: z.string(),
  authors: z.array(z.string()),
  venue: z.string().optional(),
  tier: TierSchema,
  url: z.string(),
  abstract: z.string(),
  provenance: ProvenanceSchema,
});
export type Paper = z.infer<typeof PaperSchema>;

export const NodeKindSchema = z.enum(["method", "paper"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/**
 * A node is a method or a paper. Method nodes embed their defining paper;
 * paper nodes carry it directly. `year` is the method's origin year for
 * method nodes (e.g. SGD is 1951, Robbins-Monro, even though its defining
 * paper here is the 2016 Ruder overview — see CURATION.md) and the paper's
 * publication year for paper nodes.
 */
export const NodeSchema = z
  .object({
    id: z.string(),
    kind: NodeKindSchema,
    name: z.string(),
    aliases: z.array(z.string()),
    year: z.number().int(),
    paper: PaperSchema.optional(),
    parent: z.string().optional(),
  })
  .refine((n) => n.kind !== "paper" || n.paper !== undefined, {
    message: "paper nodes must carry a paper object",
  });
export type LineageNode = z.infer<typeof NodeSchema>;

/** A verbatim quote. `sourceId` is the node id of the paper quoted; `locator` says where. */
export const QuoteSchema = z.object({
  text: z.string(),
  sourceId: z.string(),
  locator: z.enum(["abstract", "title"]),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const EvidenceSchema = z.object({
  bottleneck: QuoteSchema,
  mechanism: QuoteSchema,
  tradeoff: QuoteSchema.nullable(),
  confidence: z.number().min(0).max(1),
  confidenceBasis: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: EdgeTypeSchema,
  strength: StrengthSchema,
  evidence: EvidenceSchema,
  axis: BottleneckAxisSchema,
});
export type LineageEdge = z.infer<typeof EdgeSchema>;

export const GraphSchema = z.object({
  version: z.literal("1.0"),
  builtAt: z.string(),
  source: z.object({
    kind: z.literal("curated"),
    curator: z.literal("scout"),
    reviewedBy: z.null(),
  }),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
export type LineageGraph = z.infer<typeof GraphSchema>;
