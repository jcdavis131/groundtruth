// GET /api/lineage/health (SPEC C4 #2).
import { loadLineage } from "@/lib/lineage/load";
import { okJson } from "@/lib/lineage/http";

export const runtime = "nodejs";

export async function GET() {
  const { graph } = loadLineage();
  return okJson(
    {
      status: "ok",
      service: "method-lineage-api",
      graph: {
        version: graph.version,
        builtAt: graph.builtAt,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      },
    },
    true,
  );
}
