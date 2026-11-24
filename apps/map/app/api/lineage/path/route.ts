// GET /api/lineage/path (SPEC C4 #6). 404 if either id is unknown.
import type { NextRequest } from "next/server";
import { PathQuerySchema } from "@/lib/lineage/api-schemas";
import { notFound, okJson, parseQuery } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { findPath } from "@/lib/lineage/path";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, PathQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { from_id, to_id, direction, max_depth } = parsed.data;
  const index = loadLineage();
  if (!index.nodesById.has(from_id) || !index.nodesById.has(to_id)) {
    return notFound();
  }
  return okJson(findPath(from_id, to_id, direction, max_depth, index), true);
}
