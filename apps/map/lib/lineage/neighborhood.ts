// Bounded neighbourhood expansion (SPEC C4 #8, §3).
// BFS out to `depth` hops over all edges; when the candidate set exceeds
// `limit`, nodes are cut by degree (lowest degree first: the most
// peripheral nodes are kept, the cut falls on the highest-degree nodes).
// `truncated` + `truncated_count` say so.

import { loadLineage, type LineageIndex } from "./load";
import type { LineageEdge, LineageNode } from "./schema";

export interface NeighborhoodOutcome {
  center: string;
  depth: number;
  nodes: LineageNode[];
  edges: LineageEdge[];
  truncated: boolean;
  truncated_count: number;
}

export function neighborhood(
  centerId: string,
  depth = 1,
  limit = 100,
  index: LineageIndex = loadLineage(),
): NeighborhoodOutcome | null {
  const center = index.nodesById.get(centerId);
  if (!center) return null;

  const degree = (id: string) =>
    (index.edgesFrom.get(id)?.length ?? 0) + (index.edgesTo.get(id)?.length ?? 0);

  // BFS hop by hop; record hop distance for every reached node.
  const hop = new Map<string, number>([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = hop.get(cur)!;
    if (d >= depth) continue;
    const next = new Set<string>();
    for (const e of index.edgesFrom.get(cur) ?? []) next.add(e.to);
    for (const e of index.edgesTo.get(cur) ?? []) next.add(e.from);
    for (const id of [...next].sort()) {
      if (!hop.has(id)) {
        hop.set(id, d + 1);
        queue.push(id);
      }
    }
  }

  // Cut by degree: keep the centre, then lowest hop, then lowest degree,
  // then id — deterministic. The cut falls on the highest-degree nodes.
  const candidates = [...hop.keys()].sort((a, b) => {
    const ha = hop.get(a)!;
    const hb = hop.get(b)!;
    if (ha !== hb) return ha - hb;
    const da = degree(a);
    const db = degree(b);
    if (da !== db) return da - db;
    return a < b ? -1 : 1;
  });
  const kept = candidates.slice(0, limit);
  const keptSet = new Set(kept);
  const nodes = kept
    .map((id) => index.nodesById.get(id)!)
    .filter(Boolean);
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

  return {
    center: centerId,
    depth,
    nodes,
    edges,
    truncated: candidates.length > limit,
    truncated_count: Math.max(0, candidates.length - limit),
  };
}
