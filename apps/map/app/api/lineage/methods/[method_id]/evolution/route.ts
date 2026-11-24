// GET /api/lineage/methods/{id}/evolution (SPEC C4 #9): the strong-edge
// lineage forward from the method, ordered by year (non-decreasing).
import type { NextRequest } from "next/server";
import { EvolutionQuerySchema } from "@/lib/lineage/api-schemas";
import { notFound, okJson, parseQuery } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { STRONG_EDGE_TYPES, type LineageEdge } from "@/lib/lineage/schema";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ method_id: string }> },
) {
  const parsed = parseQuery(req.nextUrl.searchParams, EvolutionQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { method_id } = await params;
  const id = decodeURIComponent(method_id);
  const index = loadLineage();
  const method = index.methodsById.get(id);
  if (!method) return notFound();

  // BFS forward over strong edges; first-reached edge is the chain link.
  const reached = new Map<string, LineageEdge | null>([[id, null]]);
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const next = (index.edgesFrom.get(cur) ?? [])
      .filter((e) => (STRONG_EDGE_TYPES as readonly string[]).includes(e.type))
      .sort((a, b) => {
        const ya = index.nodesById.get(a.to)?.year ?? 0;
        const yb = index.nodesById.get(b.to)?.year ?? 0;
        return ya - yb || (a.to < b.to ? -1 : 1);
      });
    for (const e of next) {
      if (!reached.has(e.to)) {
        reached.set(e.to, e);
        queue.push(e.to);
      }
    }
  }
  const chain = [...reached.entries()]
    .map(([nodeId, edge]) => ({
      node: index.nodesById.get(nodeId)!,
      edge,
    }))
    .filter((c) => c.node)
    .sort(
      (a, b) =>
        a.node.year - b.node.year || (a.node.id < b.node.id ? -1 : 1),
    )
    .slice(0, parsed.data.limit);
  return okJson({ method, chain }, true);
}
