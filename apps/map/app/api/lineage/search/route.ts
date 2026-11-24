// POST /api/lineage/search (SPEC C4 #4).
import type { NextRequest } from "next/server";
import { SearchRequestSchema } from "@/lib/lineage/api-schemas";
import { okJson, parseBody } from "@/lib/lineage/http";
import { searchLineage } from "@/lib/lineage/search";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, SearchRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { query, type, limit, include_subgraph } = parsed.data;
  return okJson(
    searchLineage(query, { type, limit, includeSubgraph: include_subgraph }),
  );
}
