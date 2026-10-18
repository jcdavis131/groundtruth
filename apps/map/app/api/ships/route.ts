// Ships proxy.
//
//   /api/ships?source=digitraffic      Finnish Transport Agency AIS (Baltic Sea), no key.
//                                      Requires gzip + a Digitraffic-User header, which
//                                      browsers cannot set — hence the proxy.
//
// AISStream (global, free key) is a websocket the browser opens directly;
// see lib/layers/ships.ts.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

const DT_HEADERS = {
  "accept-encoding": "gzip",
  "digitraffic-user": "embedding-atlas/0.1 (open-source globe)",
};

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") ?? "digitraffic";
  try {
    if (source === "digitraffic") {
      const [loc, meta] = await Promise.all([
        cached("digitraffic:locations", 20_000, () =>
          upstreamJson("digitraffic", "https://meri.digitraffic.fi/api/ais/v1/locations", {
            headers: DT_HEADERS,
            timeoutMs: 30_000,
          }),
        ),
        cached("digitraffic:vessels", 10 * 60_000, () =>
          upstreamJson("digitraffic", "https://meri.digitraffic.fi/api/ais/v1/vessels", {
            headers: DT_HEADERS,
            timeoutMs: 30_000,
          }),
        ),
      ]);
      return proxied({ locations: loc.value, vessels: meta.value }, { source: "digitraffic", cacheAge: loc.age });
    }
    return Response.json({ error: `unknown source ${source}` }, { status: 400 });
  } catch (err) {
    return jsonError(err);
  }
}

// Upstreams here can take tens of seconds (Overpass, Launch Library); keep the
// serverless function alive long enough on Vercel.
export const maxDuration = 60;
