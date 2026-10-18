// Place search via OpenStreetMap Nominatim (no key). Browsers cannot set the
// User-Agent Nominatim's usage policy requires, hence the proxy. Cached 1 h
// per query and never called more than once per second from this server.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

interface NominatimHit {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  category?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
}

let lastCall = 0;

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return proxied([]);
  try {
    const r = await cached(`geocode:${q.toLowerCase()}`, 3_600_000, async () => {
      const wait = Math.max(0, 1100 - (Date.now() - lastCall));
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      lastCall = Date.now();
      const hits = await upstreamJson<NominatimHit[]>(
        "nominatim",
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
      );
      return hits.map((h) => ({
        name: h.display_name,
        lat: Number(h.lat),
        lon: Number(h.lon),
        type: h.addresstype ?? h.type,
        bbox: h.boundingbox
          ? ([Number(h.boundingbox[2]), Number(h.boundingbox[0]), Number(h.boundingbox[3]), Number(h.boundingbox[1])] as [
              number,
              number,
              number,
              number,
            ])
          : undefined,
      }));
    });
    return proxied(r.value, { source: "nominatim", cacheAge: r.age });
  } catch (err) {
    return jsonError(err);
  }
}
