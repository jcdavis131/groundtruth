// GET /api/lineage/edges (SPEC C4 #7). Background edges are excluded by
// default; `edge_type=background` includes them (and only them).
import type { NextRequest } from "next/server";
import { EdgesQuerySchema } from "@/lib/lineage/api-schemas";
import { okJson, parseQuery, validationError } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { EdgeTypeSchema } from "@/lib/lineage/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, EdgesQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { paper_id, edge_type, method, year_from, year_to, offset, limit } = parsed.data;
  if (edge_type !== undefined && !EdgeTypeSchema.safeParse(edge_type).success) {
    return validationError([
      {
        loc: ["query", "edge_type"],
        msg: `Invalid enum value. Expected one of ${EdgeTypeSchema.options.join(", ")}`,
        type: "enum",
      },
    ]);
  }
  const index = loadLineage();
  let edges = [...index.graph.edges];
  if (edge_type === "background") {
    edges = edges.filter((e) => e.type === "background");
  } else {
    edges = edges.filter((e) => e.type !== "background");
    if (edge_type !== undefined) edges = edges.filter((e) => e.type === edge_type);
  }
  if (paper_id !== undefined) {
    edges = edges.filter((e) => e.from === paper_id || e.to === paper_id);
  }
  if (method !== undefined) {
    edges = edges.filter((e) => e.from === method || e.to === method);
  }
  if (year_from !== undefined || year_to !== undefined) {
    edges = edges.filter((e) => {
      const fromYear = index.nodesById.get(e.from)?.year;
      const toYear = index.nodesById.get(e.to)?.year;
      if (fromYear === undefined || toYear === undefined) return false;
      if (year_from !== undefined && fromYear < year_from) return false;
      if (year_to !== undefined && toYear > year_to) return false;
      return true;
    });
  }
  edges.sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = edges.length;
  return okJson({ total, offset, limit, edges: edges.slice(offset, offset + limit) }, true);
}
