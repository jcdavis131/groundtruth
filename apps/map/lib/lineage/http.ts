// Shared HTTP helpers for the Method Lineage API (SPEC C4).
// Every handler: Node runtime, JSON only, 400 on validation with
// { detail: [{ loc, msg, type }] } (HTTPValidationError shape),
// 404 { detail: "not found" }. GETs are cacheable.

import { NextResponse } from "next/server";
import { z } from "zod";

export const CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400";

export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export function validationError(issues: ValidationIssue[]): NextResponse {
  return NextResponse.json({ detail: issues }, { status: 400 });
}

export function notFound(): NextResponse {
  return NextResponse.json({ detail: "not found" }, { status: 404 });
}

export function okJson(data: unknown, cacheable = false): NextResponse {
  const res = NextResponse.json(data);
  if (cacheable) res.headers.set("Cache-Control", CACHE_CONTROL);
  return res;
}

/** Map a zod issue list to the HTTPValidationError `detail` shape. */
export function zodIssues(
  issues: z.core.$ZodIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((i) => ({
    loc: [prefix, ...i.path.map((p) => String(p))],
    msg: i.message,
    type: i.code,
  }));
}

/**
 * Parse a GET query string against a zod schema. Only parameters present
 * in the URL are passed in, so zod defaults apply to absent ones.
 * Returns the parsed data or a 400 response.
 */
export function parseQuery<T extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: T,
): { ok: true; data: z.infer<T> } | { ok: false; response: NextResponse } {
  const input: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) input[k] = v;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      response: validationError(zodIssues(parsed.error.issues, "query")),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Parse a POST JSON body against a zod schema. Malformed JSON is a 400.
 * Returns the parsed data or a 400 response.
 */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: validationError([
        { loc: ["body"], msg: "Request body must be valid JSON", type: "invalid_json" },
      ]),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: validationError(zodIssues(parsed.error.issues, "body")),
    };
  }
  return { ok: true, data: parsed.data };
}

/** The fixed 400 for any LLM request in v1 (SPEC C4 #10, C5, §3). */
export function llmNotAvailable(loc: string): NextResponse {
  return validationError([
    {
      loc: ["body", loc],
      msg: "LLM assistance is not available in v1",
      type: "value_error",
    },
  ]);
}
