// GET /api/lineage/openapi.json (SPEC C4). OpenAPI 3.1.0, generated from
// the same zod schemas the handlers validate against (z.toJSONSchema).
// 20 paths grouped into the 11 endpoint families; nothing from the v1
// non-goals list (no gaps/survey/agent/jobs/chain-comparison/
// visualization/stats-validate/v1-evidence-context).
import { z } from "zod";
import {
  AssistContextRequestSchema,
  EdgesQuerySchema,
  EvalRequestSchema,
  EvolutionQuerySchema,
  IdeaRequestSchema,
  MethodsQuerySchema,
  NeighborhoodQuerySchema,
  PapersQuerySchema,
  PathQuerySchema,
  QueryRequestSchema,
  SearchRequestSchema,
  TimelineQuerySchema,
} from "@/lib/lineage/api-schemas";
import { okJson } from "@/lib/lineage/http";
import { EdgeSchema, NodeSchema } from "@/lib/lineage/schema";

export const runtime = "nodejs";

const FAMILIES = [
  "manifest",
  "health",
  "stats",
  "search",
  "query",
  "path",
  "edges",
  "papers",
  "methods",
  "ideas-eval",
  "assist-context",
] as const;

function queryParams(schema: z.ZodType, exclude: string[] = []) {
  const shape = (schema as unknown as { shape: Record<string, z.ZodType> }).shape;
  const params: Record<string, unknown>[] = [];
  for (const [name, field] of Object.entries(shape)) {
    if (exclude.includes(name)) continue;
    const json = z.toJSONSchema(field) as Record<string, unknown>;
    const def = (field as unknown as { _zod?: { def?: { defaultValue?: unknown } } })._zod?.def;
    params.push({
      name,
      in: "query",
      required: false,
      schema: json,
      ...(def && "defaultValue" in def ? { description: `Default: ${JSON.stringify(def.defaultValue)}` } : {}),
    });
  }
  return params;
}

function op(
  tag: string,
  summary: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    tags: [tag],
    summary,
    responses: {
      "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
      "400": {
        description: "Validation error",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                detail: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      loc: { type: "array", items: { type: "string" } },
                      msg: { type: "string" },
                      type: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "404": {
        description: "Not found",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { detail: { type: "string", const: "not found" } },
            },
          },
        },
      },
    },
    ...extra,
  };
}

export function buildOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Method Lineage API",
      version: "1.0",
      description:
        "A causal map of how AI methods evolve. Deterministic, LLM-free, JSON only. " +
        "All data comes from the curated v1 seed graph; no request leaves the server.",
    },
    servers: [{ url: "/api/lineage" }],
    tags: FAMILIES.map((name) => ({ name })),
    paths: {
      "/api/lineage": {
        get: op("manifest", "API manifest: name, status, defaults, endpoints, examples."),
      },
      "/api/lineage/health": {
        get: op("health", "Service and seed-graph status."),
      },
      "/api/lineage/stats": {
        get: op("stats", "Counts and distributions over the seed graph."),
      },
      "/api/lineage/search": {
        post: op("search", "Deterministic ranked search over methods and papers.", {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SearchRequest" } },
            },
          },
        }),
      },
      "/api/lineage/query": {
        post: op("query", "Bounded evidence subgraph for a query.", {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/QueryRequest" } },
            },
          },
        }),
      },
      "/api/lineage/path": {
        get: op("path", "BFS lineage chain between two nodes over strong edges.", {
          parameters: queryParams(PathQuerySchema),
        }),
      },
      "/api/lineage/edges": {
        get: op("edges", "Filtered edge list; background edges excluded by default.", {
          parameters: queryParams(EdgesQuerySchema),
        }),
      },
      "/api/lineage/papers": {
        get: op("papers", "Paper list (v1 has no stub nodes and no tier3 papers).", {
          parameters: queryParams(PapersQuerySchema),
        }),
      },
      "/api/lineage/papers/{paper_id}": {
        get: op("papers", "One paper, by node id or arXiv id.", {
          parameters: [
            { name: "paper_id", in: "path", required: true, schema: { type: "string" } },
          ],
        }),
      },
      "/api/lineage/papers/{paper_id}/neighborhood": {
        get: op("papers", "Bounded neighbourhood around a paper.", {
          parameters: [
            { name: "paper_id", in: "path", required: true, schema: { type: "string" } },
            ...queryParams(NeighborhoodQuerySchema),
          ],
        }),
      },
      "/api/lineage/methods": {
        get: op("methods", "Method list.", {
          parameters: queryParams(MethodsQuerySchema),
        }),
      },
      "/api/lineage/methods/{method_id}": {
        get: op("methods", "One method with parents, children, and papers.", {
          parameters: [
            { name: "method_id", in: "path", required: true, schema: { type: "string" } },
          ],
        }),
      },
      "/api/lineage/methods/{method_id}/papers": {
        get: op("methods", "Papers attached to a method.", {
          parameters: [
            { name: "method_id", in: "path", required: true, schema: { type: "string" } },
          ],
        }),
      },
      "/api/lineage/methods/{method_id}/evolution": {
        get: op("methods", "Strong-edge evolution chain from a method, ordered by year.", {
          parameters: [
            { name: "method_id", in: "path", required: true, schema: { type: "string" } },
            ...queryParams(EvolutionQuerySchema),
          ],
        }),
      },
      "/api/lineage/methods/{method_id}/tree": {
        get: op("methods", "Parent/child granularity tree rooted at the topmost ancestor.", {
          parameters: [
            { name: "method_id", in: "path", required: true, schema: { type: "string" } },
          ],
        }),
      },
      "/api/lineage/ideas": {
        post: op("ideas-eval", "Deterministic idea generation (four strategies, LLM-free).", {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IdeaRequest" } },
            },
          },
        }),
      },
      "/api/lineage/eval": {
        post: op("ideas-eval", "Deterministic five-dimension idea eval (LLM-free).", {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EvalRequest" } },
            },
          },
        }),
      },
      "/api/lineage/assist/context": {
        post: op("assist-context", "Bounded verbatim-evidence context pack for a query.", {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AssistContextRequest" } },
            },
          },
        }),
      },
      "/api/lineage/timeline": {
        get: op("methods", "Methods grouped by year.", {
          parameters: queryParams(TimelineQuerySchema),
        }),
      },
      "/api/lineage/openapi.json": {
        get: op("manifest", "This OpenAPI document."),
      },
    },
    components: {
      schemas: {
        Node: z.toJSONSchema(NodeSchema),
        Edge: z.toJSONSchema(EdgeSchema),
        SearchRequest: z.toJSONSchema(SearchRequestSchema),
        QueryRequest: z.toJSONSchema(QueryRequestSchema),
        IdeaRequest: z.toJSONSchema(IdeaRequestSchema),
        EvalRequest: z.toJSONSchema(EvalRequestSchema),
        AssistContextRequest: z.toJSONSchema(AssistContextRequestSchema),
      },
    },
  };
}

export async function GET() {
  return okJson(buildOpenApi(), true);
}
