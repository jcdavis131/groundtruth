// GET /api/lineage/methods/{id} (SPEC C4 #9): the method, its parent
// chain, its children, and its papers.
import type { NextRequest } from "next/server";
import { notFound, okJson } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import type { LineageNode } from "@/lib/lineage/schema";
import { findPaperNode } from "../../papers/[paper_id]/route";

export const runtime = "nodejs";

/** Papers attached to a method: its defining paper plus adjacent paper nodes. */
export function papersForMethod(id: string): LineageNode[] {
  const index = loadLineage();
  const method = index.methodsById.get(id);
  if (!method) return [];
  const out = new Map<string, LineageNode>();
  if (method.paper) {
    const defining = findPaperNode(`arxiv:${method.paper.arxivId}`, index);
    if (defining) out.set(defining.id, defining);
  }
  for (const e of [...(index.edgesFrom.get(id) ?? []), ...(index.edgesTo.get(id) ?? [])]) {
    for (const other of [e.from, e.to]) {
      const node = index.nodesById.get(other);
      if (node?.kind === "paper") out.set(node.id, node);
    }
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ method_id: string }> },
) {
  const { method_id } = await params;
  const id = decodeURIComponent(method_id);
  const index = loadLineage();
  const method = index.methodsById.get(id);
  if (!method) return notFound();
  const parents: LineageNode[] = [];
  let cur = method;
  while (cur.parent && index.methodsById.has(cur.parent)) {
    cur = index.methodsById.get(cur.parent)!;
    parents.push(cur);
  }
  const children = [...index.methodsById.values()]
    .filter((m) => m.parent === id)
    .sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1));
  return okJson({ method, parents, children, papers: papersForMethod(id) }, true);
}
