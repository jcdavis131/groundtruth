// POST /api/lineage/query (SPEC C4 #5). Seeds = top-5 search hits, expand
// 1 hop, cut by degree to max_nodes.
import type { NextRequest } from "next/server";
import { QueryRequestSchema } from "@/lib/lineage/api-schemas";
import { okJson, parseBody } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { searchLineage } from "@/lib/lineage/search";
import type { LineageEdge } from "@/lib/lineage/schema";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, QueryRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { query, max_nodes } = parsed.data;
  const index = loadLineage();
  const hits = searchLineage(query, { type: "auto", limit: 5 }, index);
  const seeds = hits.results.map((r) => r.id);

  // 1-hop expansion; candidates ordered by degree (lowest first), then id.
  const degree = (id: string) =>
    (index.edgesFrom.get(id)?.length ?? 0) + (index.edgesTo.get(id)?.length ?? 0);
  const candidateIds = new Set<string>(seeds);
  for (const id of seeds) {
    for (const e of index.edgesFrom.get(id) ?? []) candidateIds.add(e.to);
    for (const e of index.edgesTo.get(id) ?? []) candidateIds.add(e.from);
  }
  const ordered = [...candidateIds].sort((a, b) => {
    const seedA = seeds.includes(a) ? 0 : 1;
    const seedB = seeds.includes(b) ? 0 : 1;
    if (seedA !== seedB) return seedA - seedB;
    const da = degree(a);
    const db = degree(b);
    if (da !== db) return da - db;
    return a < b ? -1 : 1;
  });
  const kept = ordered.slice(0, max_nodes);
  const keptSet = new Set(kept);
  const nodes = kept.map((id) => index.nodesById.get(id)!).filter(Boolean);
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  for (const id of kept) {
    for (const e of [...(index.edgesFrom.get(id) ?? []), ...(index.edgesTo.get(id) ?? [])]) {
      if (!seen.has(e.id) && keptSet.has(e.from) && keptSet.has(e.to)) {
        seen.add(e.id);
        edges.push(e);
      }
    }
  }
  edges.sort((a, b) => (a.id < b.id ? -1 : 1));
  return okJson({
    query,
    seeds,
    nodes,
    edges,
    truncated: ordered.length > max_nodes,
    truncated_count: Math.max(0, ordered.length - max_nodes),
  });
}
