// Method Lineage SEO + deterministic seed-graph reads (SPEC C1, C2, C7).
//
// Canonical origin for every /lineage* page. Do NOT change SITE_URL in
// lib/seo/base.ts: that would move the Embedding Atlas canonicals. Lineage
// canonicals are built from LINEAGE_ORIGIN instead (SPEC C7).
//
// Graph reads: this module reads lib/lineage/graph.json directly and parses
// it with the zod schema from ./schema. It deliberately does NOT import
// ./load — load.ts resolves its path with
// fileURLToPath(new URL("./graph.json", import.meta.url)) at module scope,
// and that call throws during `next build` page-data collection
// ("The \"path\" argument must be of type string or an instance of URL.
// Received an instance of URL", lib/lineage/load.ts:25), which fails the
// whole build for every page that imports it. The path here is resolved
// from process.cwd() (apps/map, where build and start run) with a repo-root
// fallback, and honours LINEAGE_GRAPH_PATH. Slice A owns the load.ts fix;
// until it lands, this module is the frontend's reader. The ranking and
// graph ops below are the single implementation of the SPEC's deterministic
// ranking (C4 #4: exact alias match > title substring > abstract token
// overlap). The landing developer block (C1) and the explorer (C2.1) both
// render from searchSeedGraph, so the example response on /lineage is the
// true response of the ranking the API slice must reuse — never pasted JSON.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GraphSchema, STRONG_EDGE_TYPES, type LineageEdge, type LineageGraph, type LineageNode } from "./schema";

export const LINEAGE_ORIGIN = "https://www.arxiviq.com";

/** Absolute arxiviq URL for a /lineage* path. */
export function lineageUrl(path: string): string {
  const base = LINEAGE_ORIGIN.replace(/\/+$/, "");
  if (path === "" || path === "/") return `${base}/`;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

/** Canonical URL for a /lineage* page. */
export function lineageCanonical(path: string): string {
  return lineageUrl(path);
}

export interface LineageIndex {
  graph: LineageGraph;
  nodesById: Map<string, LineageNode>;
  methodsById: Map<string, LineageNode>;
  papersById: Map<string, LineageNode>;
  edgesFrom: Map<string, LineageEdge[]>;
  edgesTo: Map<string, LineageEdge[]>;
}

function resolveGraphPath(): string {
  // Statically scoped segments (not one "lib/lineage/graph.json" string)
  // so Turbopack traces only lib/lineage instead of the whole project.
  // Build and start both run from apps/map, so process.cwd() is apps/map.
  if (process.env.LINEAGE_GRAPH_PATH) return process.env.LINEAGE_GRAPH_PATH;
  return join(process.cwd(), "lib", "lineage", "graph.json");
}

let cached: LineageIndex | null = null;

/** Parse + index the seed graph once per process (server-side only). */
export function loadSeedGraph(): LineageIndex {
  if (cached) return cached;
  const graph = GraphSchema.parse(JSON.parse(readFileSync(resolveGraphPath(), "utf8")));
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
  cached = { graph, nodesById, methodsById, papersById, edgesFrom, edgesTo };
  return cached;
}

export function getMethod(id: string): LineageNode | undefined {
  return loadSeedGraph().methodsById.get(id);
}

export function getNode(id: string): LineageNode | undefined {
  return loadSeedGraph().nodesById.get(id);
}

export function edgesFromId(id: string): LineageEdge[] {
  return loadSeedGraph().edgesFrom.get(id) ?? [];
}

export function edgesToId(id: string): LineageEdge[] {
  return loadSeedGraph().edgesTo.get(id) ?? [];
}

export interface LineageCounters {
  methods: number;
  papers: number;
  causalEdges: number;
  edges: number;
  minYear: number;
  maxYear: number;
  /** Whole years spanned: maxYear - minYear. */
  spanYears: number;
  span: string;
}

/** Counters computed from the seed graph at build/render time, never hardcoded. */
export function lineageCounters(): LineageCounters {
  const { graph } = loadSeedGraph();
  const methods = graph.nodes.filter((n) => n.kind === "method").length;
  const papers = graph.nodes.filter((n) => n.kind === "paper").length;
  const causalEdges = graph.edges.filter((e) =>
    (STRONG_EDGE_TYPES as readonly string[]).includes(e.type),
  ).length;
  const years = graph.nodes.map((n) => n.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  return {
    methods,
    papers,
    causalEdges,
    edges: graph.edges.length,
    minYear,
    maxYear,
    spanYears: maxYear - minYear,
    span: `${minYear}–${maxYear}`,
  };
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export interface SearchHit {
  id: string;
  kind: "method" | "paper";
  name: string;
  year: number;
  score: number;
  snippet: string;
}

function snippetFor(node: LineageNode): string {
  if (node.paper) return node.paper.title;
  return node.aliases.length > 0 ? `Also known as ${node.aliases.join(", ")}.` : node.name;
}

/**
 * Deterministic search over the seed graph (SPEC C4 #4 ranking).
 * Tier 3: query equals the node name or an alias (case-insensitive).
 * Tier 2: query is a substring of the node name or paper title.
 * Tier 1: abstract token overlap (> 0 shared tokens).
 * `type` narrows the match: auto (all tiers, methods and papers),
 * keyword (tier 1 only), title (tier 2 only), method (method nodes only),
 * paper_id (arXiv id match only). Ties break by year, then id, so the
 * order is stable across runs.
 */
export function searchSeedGraph(
  query: string,
  type: "auto" | "keyword" | "title" | "method" | "paper_id" = "auto",
  limit = 20,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const { graph } = loadSeedGraph();
  const qTokens = tokens(q);
  const hits: Array<SearchHit & { tier: number; overlap: number }> = [];
  for (const node of graph.nodes) {
    if (type === "method" && node.kind !== "method") continue;
    if (type === "paper_id") {
      const arxivId = node.paper?.arxivId.toLowerCase() ?? "";
      if (node.id.toLowerCase() === q || arxivId === q || `arxiv:${arxivId}` === q) {
        hits.push({ id: node.id, kind: node.kind, name: node.name, year: node.year, score: 1, snippet: snippetFor(node), tier: 3, overlap: 0 });
      }
      continue;
    }
    const name = node.name.toLowerCase();
    const aliases = node.aliases.map((a) => a.toLowerCase());
    const title = node.paper?.title.toLowerCase() ?? "";
    const abstract = node.paper?.abstract.toLowerCase() ?? "";
    const overlap = qTokens.filter((t) => abstract.includes(t) || name.includes(t) || aliases.some((a) => a.includes(t))).length;
    let tier = 0;
    let score = 0;
    if (name === q || aliases.includes(q)) {
      tier = 3;
      score = 1;
    } else if ((name.includes(q) || title.includes(q)) && type !== "keyword") {
      tier = 2;
      score = 0.75 + Math.min(0.2, overlap * 0.01);
    } else if (overlap > 0 && type !== "title") {
      tier = 1;
      score = (overlap / qTokens.length) * 0.5;
    } else {
      continue;
    }
    if (type === "keyword" && tier !== 1) continue;
    if (type === "title" && tier !== 2) continue;
    hits.push({ id: node.id, kind: node.kind, name: node.name, year: node.year, score, snippet: snippetFor(node), tier, overlap });
  }
  hits.sort((a, b) => b.tier - a.tier || b.overlap - a.overlap || a.year - b.year || (a.id < b.id ? -1 : 1));
  return hits.slice(0, Math.max(1, Math.min(100, limit))).map(({ tier: _tier, overlap: _overlap, ...hit }) => hit);
}

/** BFS chain between two method ids over strong edges (SPEC C4 #6). */
export function lineagePath(
  fromId: string,
  toId: string,
  direction: "evolution" | "ancestry" | "both" = "evolution",
  maxDepth = 10,
): { found: boolean; nodes: LineageNode[]; edges: LineageEdge[]; depth: number } {
  const { nodesById, edgesFrom, edgesTo } = loadSeedGraph();
  const strong = new Set<string>(STRONG_EDGE_TYPES as readonly string[]);
  const empty = { found: false, nodes: [], edges: [], depth: 0 };
  if (!nodesById.has(fromId) || !nodesById.has(toId)) return empty;
  const cap = Math.max(1, Math.min(12, maxDepth));
  // BFS from `fromId`; evolution follows edges forward, ancestry backward, both undirected.
  const queue: string[][] = [[fromId]];
  const seen = new Set<string>([fromId]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    if (last === toId) {
      const nodes = path.map((id) => nodesById.get(id)!);
      const edges: LineageEdge[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        const e =
          edgesFrom.get(path[i])?.find((x) => x.to === path[i + 1] && strong.has(x.type)) ??
          edgesTo.get(path[i])?.find((x) => x.from === path[i + 1] && strong.has(x.type));
        if (e) edges.push(e);
      }
      return { found: true, nodes, edges, depth: path.length - 1 };
    }
    if (path.length - 1 >= cap) continue;
    const next: string[] = [];
    if (direction === "evolution" || direction === "both") {
      for (const e of edgesFrom.get(last) ?? []) if (strong.has(e.type)) next.push(e.to);
    }
    if (direction === "ancestry" || direction === "both") {
      for (const e of edgesTo.get(last) ?? []) if (strong.has(e.type)) next.push(e.from);
    }
    for (const id of next) {
      if (!seen.has(id)) {
        seen.add(id);
        queue.push([...path, id]);
      }
    }
  }
  return empty;
}

/** Methods grouped by year, years ascending, methods sorted by year then name. */
export function timelineYears(yearStart: number, yearEnd: number): Array<{ year: number; methods: LineageNode[] }> {
  const { graph } = loadSeedGraph();
  const lo = Math.min(yearStart, yearEnd);
  const hi = Math.max(yearStart, yearEnd);
  const byYear = new Map<number, LineageNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "method" || node.year < lo || node.year > hi) continue;
    const list = byYear.get(node.year) ?? [];
    list.push(node);
    byYear.set(node.year, list);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, methods]) => ({
      year,
      methods: methods.sort((a, b) => a.year - b.year || (a.name < b.name ? -1 : 1)),
    }));
}

export interface Neighbourhood {
  center: LineageNode;
  nodes: LineageNode[];
  edges: LineageEdge[];
  truncated: boolean;
  truncatedCount: number;
}

/**
 * Neighbourhood around a node (SPEC C4 #8). A paper centre also pulls in
 * the method(s) whose defining paper it is — paper nodes carry no edges of
 * their own — then expands `depth` hops over all edges. Cut by degree to
 * `limit` (max 300); the server reports `truncated` when it cuts.
 */
export function neighbourhood(id: string, depth = 1, limit = 100): Neighbourhood | null {
  const { nodesById, edgesFrom, edgesTo, graph } = loadSeedGraph();
  const center = nodesById.get(id);
  if (!center) return null;
  const cap = Math.max(10, Math.min(300, limit));
  const seeds = new Set<string>([id]);
  if (center.kind === "paper") {
    const arxivId = center.paper?.arxivId;
    for (const node of graph.nodes) {
      if (node.kind === "method" && node.paper?.arxivId === arxivId) seeds.add(node.id);
    }
  }
  const nodeIds = new Set<string>(seeds);
  const edgeIds = new Set<string>();
  let frontier = [...seeds];
  for (let d = 0; d < Math.max(0, Math.min(4, depth)); d++) {
    const next: string[] = [];
    for (const nid of frontier) {
      for (const e of [...(edgesFrom.get(nid) ?? []), ...(edgesTo.get(nid) ?? [])]) {
        edgeIds.add(e.id);
        for (const other of [e.from, e.to]) {
          if (!nodeIds.has(other)) {
            nodeIds.add(other);
            next.push(other);
          }
        }
      }
    }
    frontier = next;
  }
  let nodes = [...nodeIds].map((nid) => nodesById.get(nid)!).filter(Boolean);
  const edges = [...edgeIds]
    .map((eid) => graph.edges.find((e) => e.id === eid)!)
    .filter(Boolean)
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  let truncated = false;
  let truncatedCount = 0;
  if (nodes.length > cap) {
    // Keep the centre and its seeds, then cut by degree (most-connected first).
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const keep = new Set<string>(seeds);
    const rest = nodes
      .filter((n) => !keep.has(n.id))
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.year - b.year);
    for (const n of rest) {
      if (keep.size >= cap) break;
      keep.add(n.id);
    }
    truncatedCount = nodes.length - keep.size;
    truncated = truncatedCount > 0;
    nodes = nodes.filter((n) => keep.has(n.id));
  }
  return { center, nodes, edges: edges.filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)), truncated, truncatedCount };
}
