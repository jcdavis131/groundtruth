// GET /api/lineage/methods/{id}/tree (SPEC C4 #9): the parent/child
// granularity tree, rooted at the method's topmost ancestor, with the
// requested method named as the focus.
import type { NextRequest } from "next/server";
import { notFound, okJson } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";
import type { LineageNode } from "@/lib/lineage/schema";

export const runtime = "nodejs";

interface TreeNode {
  id: string;
  name: string;
  year: number;
  children: TreeNode[];
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

  let root = method;
  while (root.parent && index.methodsById.has(root.parent)) {
    root = index.methodsById.get(root.parent)!;
  }
  const childrenOf = new Map<string, LineageNode[]>();
  for (const m of index.methodsById.values()) {
    if (!m.parent) continue;
    const list = childrenOf.get(m.parent) ?? [];
    list.push(m);
    childrenOf.set(m.parent, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.year - b.year || (a.id < b.id ? -1 : 1));
  }
  const build = (node: LineageNode): TreeNode => ({
    id: node.id,
    name: node.name,
    year: node.year,
    children: (childrenOf.get(node.id) ?? []).map(build),
  });
  return okJson({ method, focus: id, tree: build(root) }, true);
}
