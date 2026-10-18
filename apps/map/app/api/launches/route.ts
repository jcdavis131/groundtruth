// Launch Library 2 proxy (The Space Devs). Anonymous quota is 15 requests
// per hour, so both lists are cached for 15 minutes server-side.
//
//   /api/launches?which=upcoming   next 30 launches, detailed
//   /api/launches?which=previous   last 12 launches

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

export async function GET(req: NextRequest) {
  const which = req.nextUrl.searchParams.get("which") === "previous" ? "previous" : "upcoming";
  const url =
    which === "upcoming"
      ? "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=30&mode=detailed&hide_recent_previous=false"
      : "https://ll.thespacedevs.com/2.3.0/launches/previous/?limit=12&mode=detailed";
  try {
    const r = await cached(`ll2:${which}`, 15 * 60_000, () => upstreamJson("launchlibrary", url, { timeoutMs: 40_000 }));
    return proxied(r.value, { source: "launchlibrary2", which, cacheAge: r.age });
  } catch (err) {
    return jsonError(err);
  }
}

// Upstreams here can take tens of seconds (Overpass, Launch Library); keep the
// serverless function alive long enough on Vercel.
export const maxDuration = 60;
