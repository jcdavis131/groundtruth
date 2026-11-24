// BFS lineage chains over strong edges (SPEC C4 #6).
// evolution: follow edges forward (from -> to); ancestry: follow them
// backward (to -> from); both: undirected. Weak edges never carry a chain.

import { loadLineage, type LineageIndex } from "./load";
import { STRONG_EDGE_TYPES, type LineageEdge, type LineageNode } from "./schema";

export type PathDirection = "evolution" | "ancestry" | "both";

export interface PathStep {
  node: LineageNode;
  edge: LineageEdge | null;
}

export interface PathOutcome {
  from_id: string;
  to_id: string;
  direction: PathDirection;
  found: boolean;
  path: PathStep[];
  depth: number;
}

export function findPath(
  fromId: string,
  toId: string,
  direction: PathDirection = "evolution",
  maxDepth = 10,
  index: LineageIndex = loadLineage(),
): PathOutcome {
  const base = { from_id: fromId, to_id: toId, direction };
  const from = index.nodesById.get(fromId);
  const to = index.nodesById.get(toId);
  if (!from || !to) return { ...base, found: false, path: [], depth: 0 };
  if (fromId === toId) {
    return { ...base, found: true, path: [{ node: from, edge: null }], depth: 0 };
  }

  const isStrong = (e: LineageEdge) =>
    (STRONG_EDGE_TYPES as readonly string[]).includes(e.type);

  // Neighbours of a node in the requested direction, each with the edge used.
  const neighbours = (id: string): { id: string; edge: LineageEdge }[] => {
    const out: { id: string; edge: LineageEdge }[] = [];
    if (direction === "evolution" || direction === "both") {
      for (const e of index.edgesFrom.get(id) ?? []) {
        if (isStrong(e)) out.push({ id: e.to, edge: e });
      }
    }
    if (direction === "ancestry" || direction === "both") {
      for (const e of index.edgesTo.get(id) ?? []) {
        if (isStrong(e)) out.push({ id: e.from, edge: e });
      }
    }
    out.sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : a.edge.id < b.edge.id ? -1 : 1,
    );
    return out;
  };

  const prev = new Map<string, { from: string; edge: LineageEdge }>();
  const depthOf = new Map<string, number>([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depthOf.get(cur)!;
    if (d >= maxDepth) continue;
    for (const { id, edge } of neighbours(cur)) {
      if (depthOf.has(id)) continue;
      depthOf.set(id, d + 1);
      prev.set(id, { from: cur, edge });
      if (id === toId) {
        // Reconstruct.
        const steps: PathStep[] = [];
        let at = toId;
        const chain: { id: string; edge: LineageEdge | null }[] = [];
        while (at !== fromId) {
          const p = prev.get(at)!;
          chain.push({ id: at, edge: p.edge });
          at = p.from;
        }
        chain.reverse();
        steps.push({ node: from, edge: null });
        for (const c of chain) {
          steps.push({ node: index.nodesById.get(c.id)!, edge: c.edge });
        }
        return { ...base, found: true, path: steps, depth: steps.length - 1 };
      }
      queue.push(id);
    }
  }
  return { ...base, found: false, path: [], depth: 0 };
}
