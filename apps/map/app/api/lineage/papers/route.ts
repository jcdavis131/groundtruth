// GET /api/lineage/papers (SPEC C4 #8). v1 has no stub nodes and no
// tier3 papers: those filters answer total:0 with a note, never filler.
import type { NextRequest } from "next/server";
import { PapersQuerySchema } from "@/lib/lineage/api-schemas";
import { okJson, parseQuery } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, PapersQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { status, tier, type, offset, limit } = parsed.data;
  if (status === "stub") {
    return okJson(
      { total: 0, offset, limit, papers: [], notes: ["v1 has no stub nodes"] },
      true,
    );
  }
  if (tier === "tier3") {
    return okJson(
      { total: 0, offset, limit, papers: [], notes: ["v1 has no tier3 papers"] },
      true,
    );
  }
  const index = loadLineage();
  let papers = [...index.papersById.values()];
  if (tier !== undefined) {
    papers = papers.filter((p) => p.paper?.tier === tier);
  }
  if (type !== undefined) {
    const t = type.toLowerCase();
    papers = papers.filter((p) => (p.paper?.venue ?? "").toLowerCase().includes(t));
  }
  papers.sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = papers.length;
  return okJson({ total, offset, limit, papers: papers.slice(offset, offset + limit) }, true);
}
