// USGS real-time earthquake feed proxy. USGS already allows CORS; the proxy
// exists so the layer has one code path and a 60 s shared cache.
//
//   /api/earthquakes?feed=all_day   (all_hour | all_day | all_week | 2.5_day | 4.5_week ...)

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

const FEED_RE = /^(all|1\.0|2\.5|4\.5|significant)_(hour|day|week|month)$/;

export async function GET(req: NextRequest) {
  const feed = req.nextUrl.searchParams.get("feed") ?? "all_day";
  if (!FEED_RE.test(feed)) return Response.json({ error: "bad feed" }, { status: 400 });
  try {
    const r = await cached(`usgs:${feed}`, 60_000, () =>
      upstreamJson("usgs", `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`),
    );
    return proxied(r.value, { source: "usgs", feed, cacheAge: r.age });
  } catch (err) {
    return jsonError(err);
  }
}
