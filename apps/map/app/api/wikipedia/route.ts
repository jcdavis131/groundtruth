// Wikipedia proxy. Keyless MediaWiki / Wikimedia APIs; the proxy exists so
// the layers and the fabric enrichment share one code path and one cache.
//
//   /api/wikipedia?lat=30.2672&lon=-97.7431                  geotagged articles within 10 km (op=nearby, the default)
//   /api/wikipedia?op=nearby&lat=30.2672&lon=-97.7431&radius=5000&limit=50
//   /api/wikipedia?op=summary&title=Austin,%20Texas          one article's summary (404 when there is none)
//   /api/wikipedia?op=onthisday&mm=10&dd=12                  dated events, births, deaths and selected entries for a day
//
// Answers are the parsed shapes in lib/wiki/types.ts. Upstream failures are
// honest 502s via jsonError; nothing is invented here.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, num, proxied } from "@/lib/server/upstream";
import { wikiNearby, wikiOnThisDay, wikiSummary } from "@/lib/wiki/client";

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "nearby";
  try {
    if (op === "summary") {
      const title = q.get("title")?.trim();
      if (!title) return bad("title is required: /api/wikipedia?op=summary&title=Austin,%20Texas");
      const r = await cached(`wiki-route:summary:${title.toLowerCase()}`, 6 * 3600_000, () => wikiSummary(title));
      if (!r.value) return Response.json({ error: `no Wikipedia article for "${title}"` }, { status: 404 });
      return proxied(r.value, { source: "Wikipedia", cacheAge: r.age });
    }
    if (op === "onthisday") {
      const mmRaw = q.get("mm");
      const ddRaw = q.get("dd");
      const mm = Number(mmRaw);
      const dd = Number(ddRaw);
      if (!mmRaw || !ddRaw || !Number.isInteger(mm) || !Number.isInteger(dd) || mm < 1 || mm > 12 || dd < 1 || dd > 31)
        return bad("mm (1..12) and dd (1..31) are required: /api/wikipedia?op=onthisday&mm=10&dd=12");
      const r = await cached(`wiki-route:onthisday:${mm}/${dd}`, 6 * 3600_000, () => wikiOnThisDay(mm, dd));
      return proxied(r.value, { source: "Wikipedia", cacheAge: r.age });
    }
    if (op !== "nearby") return bad(`unknown op: nearby | summary | onthisday`);
    const lon = Number(q.get("lon"));
    const lat = Number(q.get("lat"));
    if (!q.get("lon") || !q.get("lat") || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
      return bad("lon and lat are required degrees: /api/wikipedia?lat=30.2672&lon=-97.7431");
    const radius = num(q.get("radius"), 10_000, 500, 10_000);
    const limit = Math.round(num(q.get("limit"), 50, 1, 100));
    const key = `wiki-route:nearby:${lat.toFixed(4)},${lon.toFixed(4)}:${radius}:${limit}`;
    const r = await cached(key, 5 * 60_000, () => wikiNearby(lat, lon, { radiusM: radius, limit }));
    return proxied(r.value, { source: "Wikipedia", cacheAge: r.age });
  } catch (err) {
    return jsonError(err);
  }
}
