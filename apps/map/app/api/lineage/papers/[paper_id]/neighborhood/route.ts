// GET /api/lineage/papers/{paper_id}/neighborhood (SPEC C4 #8, C2.5).
import type { NextRequest } from "next/server";
import { NeighborhoodQuerySchema } from "@/lib/lineage/api-schemas";
import { notFound, okJson, parseQuery } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { neighborhood } from "@/lib/lineage/neighborhood";
import { findPaperNode } from "../route";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ paper_id: string }> },
) {
  const parsed = parseQuery(req.nextUrl.searchParams, NeighborhoodQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { paper_id } = await params;
  const id = decodeURIComponent(paper_id);
  const index = loadLineage();
  // The centre is a paper, but any known node id resolves the same way.
  const centre = findPaperNode(id, index) ?? index.nodesById.get(id);
  if (!centre) return notFound();
  const result = neighborhood(centre.id, parsed.data.depth, parsed.data.limit, index);
  return okJson(result, true);
}
