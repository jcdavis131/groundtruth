// GET /api/lineage/stats (SPEC C4 #3). Distributions are computed from the
// seed graph and are never empty in v1 (theirs are {} live).
import { loadLineage } from "@/lib/lineage/load";
import { okJson } from "@/lib/lineage/http";

export const runtime = "nodejs";

export async function GET() {
  const index = loadLineage();
  const papers = [...index.papersById.values()];
  const methods = [...index.methodsById.values()];
  const year_distribution: Record<string, number> = {};
  for (const p of papers) {
    year_distribution[String(p.year)] = (year_distribution[String(p.year)] ?? 0) + 1;
  }
  const edge_type_distribution: Record<string, number> = {};
  for (const e of index.graph.edges) {
    edge_type_distribution[e.type] = (edge_type_distribution[e.type] ?? 0) + 1;
  }
  const dimension_distribution: Record<string, number> = {};
  for (const e of index.graph.edges) {
    dimension_distribution[e.axis] = (dimension_distribution[e.axis] ?? 0) + 1;
  }
  const paper_type_distribution = { tier1: 0, tier2: 0 };
  for (const p of papers) {
    if (p.paper) paper_type_distribution[p.paper.tier]++;
  }
  return okJson(
    {
      total_papers: papers.length,
      full_papers: papers.length,
      stub_papers: 0,
      total_edges: index.graph.edges.length,
      total_methods: methods.length,
      year_distribution,
      edge_type_distribution,
      dimension_distribution,
      paper_type_distribution,
    },
    true,
  );
}
