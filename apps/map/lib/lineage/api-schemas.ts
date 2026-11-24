// Request schemas for the Method Lineage API (SPEC C4).
// Parameter names and defaults are exactly as in the C4 table, so a client
// written against the Intern-Atlas surface works unchanged except for the
// base path. The OpenAPI document is generated from these same schemas.

import { z } from "zod";

export const SearchTypeSchema = z.enum([
  "auto",
  "keyword",
  "title",
  "direction",
  "paper_id",
]);

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  type: SearchTypeSchema.default("auto"),
  limit: z.number().int().min(1).max(100).default(20),
  include_subgraph: z.boolean().default(false),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const QueryRequestSchema = z.object({
  query: z.string().min(1).max(500),
  max_nodes: z.number().int().min(1).max(300).default(30),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export const PathDirectionSchema = z.enum(["evolution", "ancestry", "both"]);

export const PathQuerySchema = z.object({
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  direction: PathDirectionSchema.default("evolution"),
  max_depth: z.coerce.number().int().min(1).max(12).default(10),
});

export const EdgesQuerySchema = z.object({
  paper_id: z.string().min(1).max(200).optional(),
  edge_type: z.string().min(1).max(50).optional(),
  method: z.string().min(1).max(120).optional(),
  year_from: z.coerce.number().int().min(1900).max(2100).optional(),
  year_to: z.coerce.number().int().min(1900).max(2100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const PapersQuerySchema = z.object({
  status: z.enum(["stub", "full"]).optional(),
  tier: z.enum(["tier1", "tier2", "tier3"]).optional(),
  type: z.string().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const NeighborhoodQuerySchema = z.object({
  depth: z.coerce.number().int().min(0).max(4).default(1),
  limit: z.coerce.number().int().min(10).max(300).default(100),
});

export const MethodsQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  parent: z.string().min(1).max(120).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const EvolutionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

export const TimelineQuerySchema = z.object({
  year_start: z.coerce.number().int().min(1900).max(2100).optional(),
  year_end: z.coerce.number().int().min(1900).max(2100).optional(),
  limit: z.coerce.number().int().min(10).max(1000).default(300),
});

export const IdeaRequestSchema = z.object({
  query: z.string().min(1).max(500),
  target_venue: z.string().min(1).max(200).optional(),
  time_horizon: z.string().min(1).max(100).optional(),
  exclude_directions: z.array(z.string().min(1).max(50)).default([]),
  focus_dimension: z.string().min(1).max(100).optional(),
  resources: z.string().min(1).max(1000).optional(),
  use_llm: z.boolean().default(false),
});
export type IdeaRequest = z.infer<typeof IdeaRequestSchema>;

export const EvalRequestSchema = z.object({
  idea: z.string().min(10).max(5000),
  use_llm: z.boolean().default(false),
  use_llm_judge: z.boolean().default(false),
});
export type EvalRequest = z.infer<typeof EvalRequestSchema>;

export const AssistContextRequestSchema = z.object({
  query: z.string().min(1).max(500),
  max_seeds: z.number().int().min(1).max(30).default(10),
  max_edges: z.number().int().min(0).max(200).default(80),
  budget: z.enum(["light", "balanced", "deep"]).default("balanced"),
  use_mcts: z.boolean().default(true),
  token_budget: z.number().int().min(2000).max(15000).default(8000),
});
export type AssistContextRequest = z.infer<typeof AssistContextRequestSchema>;
