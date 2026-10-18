// OpenStreetMap road network for the traffic *simulation*, via the public
// Overpass API. Bounding boxes are clamped to a city-sized window so the
// query stays under Overpass's 25 s budget; results are cached 30 min.
//
//   /api/roads?bbox=w,s,e,n

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstream } from "@/lib/server/upstream";

const MAX_SPAN_DEG = 0.3;

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (raw.length !== 4 || !raw.every(Number.isFinite)) {
    return Response.json({ error: "bbox=w,s,e,n required" }, { status: 400 });
  }
  let [w, s, e, n] = raw;
  // Clamp to a window around the centre so nobody can request a continent.
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - MAX_SPAN_DEG / 2);
  e = Math.min(e, cx + MAX_SPAN_DEG / 2);
  s = Math.max(s, cy - MAX_SPAN_DEG / 2);
  n = Math.min(n, cy + MAX_SPAN_DEG / 2);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const key = `roads:${r2(w)},${r2(s)},${r2(e)},${r2(n)}`;
  const query = `[out:json][timeout:25];way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary|tertiary)$"](${s},${w},${n},${e});out geom;`;
  try {
    const r = await cached(key, 30 * 60_000, async () => {
      const res = await upstream("overpass", "https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        timeoutMs: 45_000,
      });
      const json = (await res.json()) as { elements?: OverpassWay[] };
      // Overpass returns every tag and a verbose geometry; keep only what the
      // simulation reads. Cuts the payload ~10x.
      const elements = (json.elements ?? [])
        .filter((el) => el.type === "way" && el.geometry && el.geometry.length > 1)
        .map((el) => ({
          type: "way" as const,
          id: el.id,
          tags: {
            highway: el.tags?.highway,
            oneway: el.tags?.oneway,
            name: el.tags?.name,
            maxspeed: el.tags?.maxspeed,
            lanes: el.tags?.lanes,
          },
          geometry: el.geometry!.map((g) => ({ lat: g.lat, lon: g.lon })),
        }));
      return { elements };
    });
    return proxied(r.value, { source: "overpass", bbox: [w, s, e, n], cacheAge: r.age, trimmed: true });
  } catch (err) {
    return jsonError(err);
  }
}

// Upstreams here can take tens of seconds (Overpass, Launch Library); keep the
// serverless function alive long enough on Vercel.
export const maxDuration = 60;
