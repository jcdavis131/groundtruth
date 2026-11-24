// Parse + index graph.json once per process (SPEC §2, C3.2).
// Server-side only: API routes (Node runtime) read through here, never
// from a client fetch. The graph is validated at build time by validate.mjs;
// this loader re-parses with the zod schema so a bad committed file fails
// loudly instead of serving half a graph.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

// Default graph path, resolved LAZILY on first load — never at module
// scope. The old module-scope `fileURLToPath(new URL(...))` threw during
// `next build` page-data collection: Turbopack evaluates the module in a
// worker whose URL objects come from a different realm, so Node's
// fileURLToPath rejects them with ERR_INVALID_ARG_TYPE ("Received an
// instance of URL", load.ts:25), failing the build for every page importing
// this module. The resolver below tries, in order:
//   1. LINEAGE_GRAPH_PATH (explicit override, honoured everywhere);
//   2. fileURLToPath(new URL(...)) — plain Node (vitest, validate.mjs,
//      `next start` workers) where the realm check passes;
//   3. the URL's pathname as a plain string — same location, no realm
//      check, for the Turbopack worker;
//   4. process.cwd()-scoped paths — `next build` / dev / start all run
//      from apps/map, so lib/lineage/graph.json resolves there even when
//      import.meta.url points at a bundled chunk.
// The first candidate that exists wins; if none exists the first candidate
// is returned so the read fails with the real ENOENT path.
let defaultPath: string | null = null;

function resolveDefaultPath(): string {
  if (defaultPath) return defaultPath;
  if (process.env.LINEAGE_GRAPH_PATH) {
    defaultPath = process.env.LINEAGE_GRAPH_PATH;
    return defaultPath;
  }
  const candidates: string[] = [];
  try {
    candidates.push(fileURLToPath(new URL("./graph.json", import.meta.url)));
  } catch {
    // Cross-realm URL (Turbopack worker): fall through to the candidates below.
  }
  try {
    candidates.push(
      decodeURIComponent(new URL("./graph.json", import.meta.url).pathname),
    );
  } catch {
    // No usable import.meta.url: fall through to the cwd candidates below.
  }
  candidates.push(join(process.cwd(), "lib", "lineage", "graph.json"));
  candidates.push(join(process.cwd(), "apps", "map", "lib", "lineage", "graph.json"));
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      defaultPath = candidate;
      return defaultPath;
    }
  }
  defaultPath =
    candidates[0] ?? join(process.cwd(), "lib", "lineage", "graph.json");
  return defaultPath;
}

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
export function loadLineage(filePath?: string): LineageIndex {
  const resolved = filePath ?? resolveDefaultPath();
  if (!filePath || filePath === resolveDefaultPath()) {
    if (cached) return cached;
    const graph = GraphSchema.parse(
      JSON.parse(readFileSync(resolved, "utf8")),
    );
    cached = buildIndex(graph);
    return cached;
  }
  const graph = GraphSchema.parse(JSON.parse(readFileSync(resolved, "utf8")));
  return buildIndex(graph);
}

/** Test hook: drop the process cache so a re-read sees a changed file. */
export function resetLineageCache(): void {
  cached = null;
  defaultPath = null;
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
