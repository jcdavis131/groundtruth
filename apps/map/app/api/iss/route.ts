// ISS position proxy. wheretheiss.at is keyless; the proxy exists so the
// layer has one code path with the other live layers and a 10 s shared cache.
//
//   /api/iss    live position of the ISS (NORAD 25544)

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

export async function GET(_req: NextRequest) {
  try {
    const r = await cached("iss:25544", 10_000, () =>
      upstreamJson("wheretheiss", "https://api.wheretheiss.at/v1/satellites/25544"),
    );
    return proxied(r.value, { source: "wheretheiss.at", cacheAge: r.age });
  } catch (err) {
    return jsonError(err);
  }
}
