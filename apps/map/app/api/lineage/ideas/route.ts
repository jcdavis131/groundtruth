// POST /api/lineage/ideas (SPEC C4 #10, C5). Deterministic, LLM-free.
// `use_llm:true` is a 400 with the fixed v1 message.
import type { NextRequest } from "next/server";
import { IdeaRequestSchema } from "@/lib/lineage/api-schemas";
import { llmNotAvailable, okJson, parseBody } from "@/lib/lineage/http";
import { generateIdeas } from "@/lib/lineage/score";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, IdeaRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { query, use_llm, exclude_directions, focus_dimension } = parsed.data;
  if (use_llm === true) return llmNotAvailable("use_llm");
  // target_venue / time_horizon / resources are accepted and recorded in
  // the request only; v1 proposals come from graph facts alone.
  const { strategies, ideas } = generateIdeas(
    { excludeDirections: exclude_directions, focusDimension: focus_dimension },
  );
  return okJson({ query, strategies, ideas });
}
