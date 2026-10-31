// Play-mode API: the server-side lookups the two game modes need.
//
//   /api/play?op=county&lon=-97.74&lat=30.27
//       The county a point is in (TIGERweb, cached 30 days by the point).
//       { county: { geoid, name, basename, state } | null }. A null county
//       is open water, not an error — the caller says "no bite".

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { countyAt } from "@/lib/parcels/sources";

function num(q: string | null): number | null {
  if (q == null || q === "") return null;
  const n = Number(q);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  if (op !== "county") {
    return NextResponse.json({ error: "unknown op: county" }, { status: 400 });
  }
  const lon = num(q.get("lon"));
  const lat = num(q.get("lat"));
  if (lon == null || lat == null || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return NextResponse.json({ error: "lon=-180..180 and lat=-90..90 are required" }, { status: 400 });
  }
  try {
    const county = await countyAt(lon, lat);
    return NextResponse.json({ county });
  } catch (err) {
    const message = err instanceof Error ? err.message : "county lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
