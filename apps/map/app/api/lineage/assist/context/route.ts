// POST /api/lineage/assist/context (SPEC C4 #11). A bounded pack of
// verbatim graph evidence for a query. `use_mcts` is accepted and ignored:
// v1 uses deterministic BFS chains, never MCTS.
import type { NextRequest } from "next/server";
import { AssistContextRequestSchema } from "@/lib/lineage/api-schemas";
import { okJson, parseBody } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import { searchLineage } from "@/lib/lineage/search";
import { STRONG_EDGE_TYPES, type LineageEdge } from "@/lib/lineage/schema";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, AssistContextRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { query, max_seeds, max_edges, budget, token_budget } = parsed.data;
  const index = loadLineage();
  const hits = searchLineage(query, { type: "auto", limit: max_seeds }, index);
  const seeds = hits.results;
  const seedIds = seeds.map((s) => s.id);

  // Deterministic BFS chains from the seeds over strong edges, both
  // directions, ordered by seed order, hop, then edge id.
  const isStrong = (e: LineageEdge) =>
    (STRONG_EDGE_TYPES as readonly string[]).includes(e.type);
  const seenEdges = new Map<string, LineageEdge>();
  const visited = new Set<string>(seedIds);
  let frontier = [...seedIds];
  for (let hop = 0; hop < 3 && frontier.length > 0; hop++) {
    const next: string[] = [];
    const hopEdges: LineageEdge[] = [];
    for (const id of frontier) {
      for (const e of [...(index.edgesFrom.get(id) ?? []), ...(index.edgesTo.get(id) ?? [])]) {
        if (!isStrong(e) || seenEdges.has(e.id)) continue;
        hopEdges.push(e);
        const other = e.from === id ? e.to : e.from;
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    hopEdges.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const e of hopEdges) {
      if (seenEdges.size >= max_edges) break;
      seenEdges.set(e.id, e);
    }
    if (seenEdges.size >= max_edges) break;
    frontier = next;
  }
  const edges = [...seenEdges.values()].sort((a, b) => (a.id < b.id ? -1 : 1));

  const maxChars = Math.floor(token_budget / 4);
  const lines: string[] = [`# Context: ${query}`, "", "## Seeds"];
  for (const s of seeds) {
    lines.push(`- ${s.name} (\`${s.id}\`, ${s.kind}, ${s.year})`);
  }
  lines.push("", "## Evidence chains");
  if (edges.length === 0) {
    lines.push("- No strong-edge evidence chains connect these seeds in v1.");
  }
  for (const e of edges) {
    const from = index.nodesById.get(e.from)?.name ?? e.from;
    const to = index.nodesById.get(e.to)?.name ?? e.to;
    lines.push(
      `- ${from} --${e.type}--> ${to} (${e.axis}; confidence ${e.evidence.confidence}):`,
      `  - bottleneck: "${e.evidence.bottleneck.text}" (${e.evidence.bottleneck.sourceId}, ${e.evidence.bottleneck.locator})`,
      `  - mechanism: "${e.evidence.mechanism.text}" (${e.evidence.mechanism.sourceId}, ${e.evidence.mechanism.locator})`,
    );
    if (e.evidence.tradeoff) {
      lines.push(
        `  - trade-off: "${e.evidence.tradeoff.text}" (${e.evidence.tradeoff.sourceId}, ${e.evidence.tradeoff.locator})`,
      );
    }
  }
  let context_markdown = lines.join("\n");
  if (context_markdown.length > maxChars) {
    context_markdown =
      context_markdown.slice(0, Math.max(0, maxChars - 40)) +
      "\n\n[truncated to the token budget]";
  }
  return okJson({
    query,
    budget,
    seeds,
    edges,
    context_markdown,
    notes: ["use_mcts accepted and ignored: v1 uses deterministic BFS chains"],
  });
}
