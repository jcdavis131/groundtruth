// Deterministic search over the seed graph (SPEC C4 #4).
// Ranking: exact alias match > title substring > abstract token overlap
// (deterministic BM25-lite, no embeddings, no upstream calls).

import { loadLineage, type LineageIndex } from "./load";
import type { LineageEdge, LineageNode } from "./schema";

export interface SearchResult {
  id: string;
  kind: string;
  name: string;
  year: number;
  score: number;
  snippet: string;
}

export type SearchType = "auto" | "keyword" | "title" | "direction" | "paper_id";

export interface SearchOptions {
  type?: SearchType;
  limit?: number;
  includeSubgraph?: boolean;
}

export interface SearchOutcome {
  query: string;
  type: SearchType;
  results: SearchResult[];
  subgraph?: { nodes: LineageNode[]; edges: LineageEdge[] };
}

/** Lowercase alphanumeric tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function snippetFor(node: LineageNode): string {
  const abstract = node.paper?.abstract ?? "";
  if (abstract) {
    const s = abstract.slice(0, 200);
    return abstract.length > 200 ? `${s}…` : s;
  }
  const aliases = node.aliases.length > 0 ? ` (${node.aliases.join(", ")})` : "";
  return `${node.name}${aliases}`;
}

/**
 * BM25-lite token score, mapped into [0, 40): below the title-substring
 * band (50–60) and the exact-match band (100), so the ranking order in
 * the SPEC holds for any query length.
 */
function tokenScore(
  queryTokens: string[],
  node: LineageNode,
  docFreq: Map<string, number>,
  totalDocs: number,
): number {
  const haystack = [
    node.name,
    ...node.aliases,
    node.paper?.title ?? "",
    node.paper?.abstract ?? "",
  ].join(" ");
  const hayTokens = tokenize(haystack);
  const tf = new Map<string, number>();
  for (const t of hayTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const nameTokens = new Set(tokenize(node.name));
  let raw = 0;
  for (const t of new Set(queryTokens)) {
    const f = tf.get(t) ?? 0;
    if (f === 0) continue;
    const df = docFreq.get(t) ?? 1;
    const idf = Math.log(1 + totalDocs / df);
    raw += (f / (f + 1)) * idf;
    if (nameTokens.has(t)) raw += 2;
  }
  if (raw === 0) return 0;
  return (raw / (1 + raw)) * 40;
}

function docFrequencies(index: LineageIndex): Map<string, number> {
  const df = new Map<string, number>();
  for (const node of index.graph.nodes) {
    const hay = [node.name, ...node.aliases, node.paper?.abstract ?? ""].join(" ");
    for (const t of new Set(tokenize(hay))) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return df;
}

export function searchLineage(
  query: string,
  options: SearchOptions = {},
  index: LineageIndex = loadLineage(),
): SearchOutcome {
  const type = options.type ?? "auto";
  const limit = options.limit ?? 20;
  const q = query.trim().toLowerCase();
  const queryTokens = tokenize(query);
  const df = docFrequencies(index);
  const totalDocs = index.graph.nodes.length;

  const scored: SearchResult[] = [];
  for (const node of index.graph.nodes) {
    const nameLower = node.name.toLowerCase();
    const aliasLower = node.aliases.map((a) => a.toLowerCase());
    let score = 0;

    if (type === "paper_id") {
      const arxivId = node.paper?.arxivId.toLowerCase() ?? "";
      if (node.id.toLowerCase() === q || arxivId === q) score = 100;
      else if (node.id.toLowerCase().includes(q) || (arxivId && arxivId.includes(q)))
        score = 50;
      else continue;
    } else if (type === "title") {
      if (nameLower.includes(q)) {
        score = 50 + 10 * (queryTokens.filter((t) => nameLower.includes(t)).length /
          Math.max(1, queryTokens.length));
      } else {
        continue;
      }
    } else if (type === "keyword" || type === "direction") {
      // "direction" is not a text field in v1; it ranks like keyword.
      score = tokenScore(queryTokens, node, df, totalDocs);
      if (score === 0) continue;
    } else {
      // auto: exact alias/name match > title substring > token overlap.
      if (nameLower === q || aliasLower.includes(q)) {
        score = 100;
      } else if (nameLower.includes(q)) {
        score = 50 + 10 * (queryTokens.filter((t) => nameLower.includes(t)).length /
          Math.max(1, queryTokens.length));
      } else {
        score = tokenScore(queryTokens, node, df, totalDocs);
        if (score === 0) continue;
      }
    }

    scored.push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      year: node.year,
      score: Math.round(score * 10000) / 10000,
      snippet: snippetFor(node),
    });
  }

  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const results = scored.slice(0, limit);

  const outcome: SearchOutcome = { query, type, results };
  if (options.includeSubgraph) {
    const seedIds = new Set(results.map((r) => r.id));
    const nodeIds = new Set<string>(seedIds);
    const edges: LineageEdge[] = [];
    const seenEdges = new Set<string>();
    for (const id of seedIds) {
      for (const e of [...(index.edgesFrom.get(id) ?? []), ...(index.edgesTo.get(id) ?? [])]) {
        if (seenEdges.has(e.id)) continue;
        seenEdges.add(e.id);
        edges.push(e);
        nodeIds.add(e.from);
        nodeIds.add(e.to);
      }
    }
    edges.sort((a, b) => (a.id < b.id ? -1 : 1));
    const nodes = [...nodeIds]
      .map((id) => index.nodesById.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    outcome.subgraph = { nodes, edges };
  }
  return outcome;
}
