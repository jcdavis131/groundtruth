// CelesTrak GP (OMM JSON) proxy. CelesTrak asks for no more than one fetch
// per group every two hours, which is exactly the server-side cache TTL. A
// stale copy is served if CelesTrak is unreachable.
//
//   /api/satellites?group=stations

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

const GROUP_RE = /^[a-z0-9-]{2,32}$/i;
const TTL = 2 * 3600 * 1000;

export async function GET(req: NextRequest) {
  const group = (req.nextUrl.searchParams.get("group") ?? "stations").toLowerCase();
  if (!GROUP_RE.test(group)) return Response.json({ error: "bad group" }, { status: 400 });
  try {
    const r = await cached(`celestrak:${group}`, TTL, () =>
      upstreamJson<unknown[]>(
        "celestrak",
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`,
        { timeoutMs: 40_000 },
      ),
    );
    return proxied(r.value, { source: "celestrak", group, cacheAge: r.age });
  } catch (err) {
    return jsonError(err);
  }
}

// Upstreams here can take tens of seconds (Overpass, Launch Library); keep the
// serverless function alive long enough on Vercel.
export const maxDuration = 60;
