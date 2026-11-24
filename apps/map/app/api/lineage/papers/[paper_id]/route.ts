// GET /api/lineage/papers/{paper_id} (SPEC C4 #8).
import type { NextRequest } from "next/server";
import { notFound, okJson } from "@/lib/lineage/http";
import { loadLineage, type LineageIndex } from "@/lib/lineage/load";
import type { LineageNode } from "@/lib/lineage/schema";

export const runtime = "nodejs";

/**
 * Find a paper node by node id or arXiv id (with or without the `arxiv:`
 * prefix). A method's defining paper with no paper node of its own is
 * returned as a synthesised paper node, so every defining paper resolves.
 */
export function findPaperNode(id: string, index: LineageIndex): LineageNode | undefined {
  const direct = index.papersById.get(id);
  if (direct) return direct;
  const bare = id.replace(/^arxiv:/i, "");
  for (const p of index.papersById.values()) {
    if (p.paper && (p.paper.arxivId === id || p.paper.arxivId === bare)) return p;
  }
  for (const m of index.methodsById.values()) {
    if (m.paper && (m.paper.arxivId === id || m.paper.arxivId === bare)) {
      return {
        id: `arxiv:${m.paper.arxivId}`,
        kind: "paper",
        name: m.paper.title,
        aliases: [],
        year: m.year,
        paper: m.paper,
      };
    }
  }
  return undefined;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paper_id: string }> },
) {
  const { paper_id } = await params;
  const paper = findPaperNode(decodeURIComponent(paper_id), loadLineage());
  if (!paper) return notFound();
  return okJson({ paper }, true);
}
