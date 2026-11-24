// POST /api/lineage/eval (SPEC C4 #10, C5). Deterministic five-dimension
// scoring. `use_llm:true` or `use_llm_judge:true` is a 400 with the fixed
// v1 message.
import type { NextRequest } from "next/server";
import { EvalRequestSchema } from "@/lib/lineage/api-schemas";
import { llmNotAvailable, okJson, parseBody } from "@/lib/lineage/http";
import { scoreIdea } from "@/lib/lineage/score";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, EvalRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { idea, use_llm, use_llm_judge } = parsed.data;
  if (use_llm === true) return llmNotAvailable("use_llm");
  if (use_llm_judge === true) return llmNotAvailable("use_llm_judge");
  return okJson(scoreIdea(idea));
}
