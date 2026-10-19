// Serves public/openapi.json at /api/openapi with CORS open, so a client
// generator or a notebook can read the description from the same origin as
// the API. The document is bundled at build time (JSON import), not read
// from disk per request; edit public/openapi.json and redeploy.

import { NextResponse } from "next/server";
import { CORS, options } from "@/lib/server/respond";
import spec from "@/public/openapi.json";

export const OPTIONS = options;

export function GET() {
  return NextResponse.json(spec, {
    headers: { ...CORS, "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600" },
  });
}
