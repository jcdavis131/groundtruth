// GET /api/lineage/methods (SPEC C4 #9).
import type { NextRequest } from "next/server";
import { MethodsQuerySchema } from "@/lib/lineage/api-schemas";
import { okJson, parseQuery } from "@/lib/lineage/http";
import { loadLineage } from "@/lib/lineage/load";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const parsed = parseQuery(req.nextUrl.searchParams, MethodsQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { q, parent, offset, limit } = parsed.data;
  const index = loadLineage();
  let methods = [...index.methodsById.values()];
  if (q !== undefined) {
    const needle = q.toLowerCase();
    methods = methods.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) ||
        m.aliases.some((a) => a.toLowerCase().includes(needle)),
    );
  }
  if (parent !== undefined) {
    methods = methods.filter((m) => m.parent === parent);
  }
  methods.sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = methods.length;
  return okJson({ total, offset, limit, methods: methods.slice(offset, offset + limit) }, true);
}
