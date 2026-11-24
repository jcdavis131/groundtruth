// GET /api/lineage — manifest (SPEC C4 #1). The 11 endpoint families.
import type { NextRequest } from "next/server";
import { okJson } from "@/lib/lineage/http";

export const runtime = "nodejs";

const ENDPOINTS = [
  { id: "manifest", method: "GET", path: "/api/lineage", description: "This manifest: name, status, defaults, endpoints, examples." },
  { id: "health", method: "GET", path: "/api/lineage/health", description: "Service and seed-graph status." },
  { id: "stats", method: "GET", path: "/api/lineage/stats", description: "Counts and distributions over the seed graph." },
  { id: "search", method: "POST", path: "/api/lineage/search", description: "Deterministic ranked search over methods and papers." },
  { id: "query", method: "POST", path: "/api/lineage/query", description: "Bounded evidence subgraph for a query." },
  { id: "path", method: "GET", path: "/api/lineage/path", description: "BFS lineage chain between two nodes over strong edges." },
  { id: "edges", method: "GET", path: "/api/lineage/edges", description: "Filtered edge list; background edges excluded by default." },
  { id: "papers", method: "GET", path: "/api/lineage/papers", description: "Paper list, single paper, and paper neighbourhood." },
  { id: "methods", method: "GET", path: "/api/lineage/methods", description: "Method list, single method, papers, evolution chain, tree, and timeline." },
  {
    id: "ideas-eval",
    method: "POST",
    path: "/api/lineage/ideas",
    paths: ["/api/lineage/ideas", "/api/lineage/eval"],
    description: "Deterministic idea generation and five-dimension eval (LLM-free).",
  },
  { id: "assist-context", method: "POST", path: "/api/lineage/assist/context", description: "Bounded verbatim-evidence context pack for a query." },
];

export function buildManifest(baseUrl: string) {
  return {
    name: "Method Lineage API",
    status: "live",
    version: "1.0",
    base_url: baseUrl,
    docs: { openapi: "/api/lineage/openapi.json" },
    defaults: {
      pagination: {
        default_limit: 50,
        max_papers_limit: 200,
        max_edges_limit: 1000,
        max_graph_nodes: 300,
      },
      path: {
        default_direction: "evolution",
        directions: ["evolution", "ancestry", "both"],
        max_depth: 12,
      },
    },
    llm: null,
    endpoints: ENDPOINTS,
    examples: {
      search: {
        request: { query: "grouped-query attention", type: "auto", limit: 5 },
        path: "/api/lineage/search",
      },
      query: {
        request: { query: "efficient attention", max_nodes: 30 },
        path: "/api/lineage/query",
      },
      path: {
        request: "?from_id=attention-2017&to_id=gqa",
        path: "/api/lineage/path",
      },
      assist_context: {
        request: { query: "efficient long-context attention", budget: "balanced" },
        path: "/api/lineage/assist/context",
      },
    },
  };
}

export async function GET(req: NextRequest) {
  return okJson(buildManifest(`${req.nextUrl.origin}/api/lineage`), true);
}
