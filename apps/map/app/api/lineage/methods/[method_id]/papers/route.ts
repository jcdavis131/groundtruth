// GET /api/lineage/methods/{id}/papers (SPEC C4 #9).
import type { NextRequest } from "next/server";
import { notFound, okJson } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { papersForMethod } from "../route";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ method_id: string }> },
) {
  const { method_id } = await params;
  const id = decodeURIComponent(method_id);
  if (!loadLineage().methodsById.has(id)) return notFound();
  return okJson({ method: id, papers: papersForMethod(id) }, true);
}
