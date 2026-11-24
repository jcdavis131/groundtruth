// Parse + index graph.json once per process (SPEC §2, C3.2).
// Server-side only: API routes (Node runtime) read through here, never
// from a client fetch. The graph is validated at build time by validate.mjs;
// this loader re-parses with the zod schema so a bad committed file fails
// loudly instead of serving half a graph.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GraphSchema,
  type LineageEdge,
  type LineageGraph,
  type LineageNode,
} from "./schema";

export interface LineageIndex {
  graph: LineageGraph;
  nodesById: Map<string, LineageNode>;
  methodsById: Map<string, LineageNode>;
  papersById: Map<string, LineageNode>;
  edgesFrom: Map<string, LineageEdge[]>;
  edgesTo: Map<string, LineageEdge[]>;
}

const DEFAULT_PATH = fileURLToPath(new URL("./graph.json", import.meta.url));

let cached: LineageIndex | null = null;

function buildIndex(graph: LineageGraph): LineageIndex {
  const nodesById = new Map<string, LineageNode>();
  const methodsById = new Map<string, LineageNode>();
  const papersById = new Map<string, LineageNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
    if (node.kind === "method") methodsById.set(node.id, node);
    if (node.kind === "paper") papersById.set(node.id, node);
  }
  const edgesFrom = new Map<string, LineageEdge[]>();
  const edgesTo = new Map<string, LineageEdge[]>();
  for (const edge of graph.edges) {
    const from = edgesFrom.get(edge.from) ?? [];
    from.push(edge);
    edgesFrom.set(edge.from, from);
    const to = edgesTo.get(edge.to) ?? [];
    to.push(edge);
    edgesTo.set(edge.to, to);
  }
  return { graph, nodesById, methodsById, papersById, edgesFrom, edgesTo };
}

/**
 * Load and index the seed graph. With no argument the parsed graph is
 * cached for the life of the process; pass an explicit path (tests) to
 * bypass the cache.
 */
export function loadLineage(filePath: string = DEFAULT_PATH): LineageIndex {
  if (!filePath || filePath === DEFAULT_PATH) {
    if (cached) return cached;
    const graph = GraphSchema.parse(
      JSON.parse(readFileSync(DEFAULT_PATH, "utf8")),
    );
    cached = buildIndex(graph);
    return cached;
  }
  const graph = GraphSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  return buildIndex(graph);
}

/** Test hook: drop the process cache so a re-read sees a changed file. */
export function resetLineageCache(): void {
  cached = null;
}

export function getMethod(id: string): LineageNode | undefined {
  return loadLineage().methodsById.get(id);
}

export function getPaper(id: string): LineageNode | undefined {
  return loadLineage().papersById.get(id);
}

export function edgesFrom(id: string): LineageEdge[] {
  return loadLineage().edgesFrom.get(id) ?? [];
}

export function edgesTo(id: string): LineageEdge[] {
  return loadLineage().edgesTo.get(id) ?? [];
}
