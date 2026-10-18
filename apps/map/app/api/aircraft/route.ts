// Aircraft proxy. Raw upstream JSON is passed through untouched (normalisation
// happens client-side in lib/layers/aircraft.ts so it stays inspectable).
//
//   /api/aircraft?source=adsblol&lat=..&lon=..&dist=250   adsb.lol point query (no key)
//   /api/aircraft?source=mil                              adsb.lol global military-flagged feed (no key)
//   /api/aircraft?source=opensky&bbox=w,s,e,n             OpenSky bbox (anon: 400 credits/day)
//   /api/aircraft?source=adsbx&lat=..&lon=..&dist=250     ADS-B Exchange via RapidAPI (key required)

import type { NextRequest } from "next/server";
import { snapPointQuery } from "@/lib/layers/pointQuery";
import { cached } from "@/lib/server/cache";
import { jsonError, keyFrom, num, polite, proxied, upstream, upstreamJson } from "@/lib/server/upstream";

const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

async function openskyToken(id: string, secret: string): Promise<string> {
  const { value } = await cached(`opensky:token:${id}`, 25 * 60_000, async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    });
    const res = await upstream("opensky-auth", OPENSKY_TOKEN_URL, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  });
  return value;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const source = q.get("source") ?? "adsblol";
  try {
    if (source === "adsblol" || source === "adsbx") {
      // Snap the query to a 0.1° grid and 10 nm steps so slightly different
      // camera targets share one upstream request (the area watch reads the same snap).
      const { lat, lon, distNm: dist } = snapPointQuery(num(q.get("lat"), 0, -90, 90), num(q.get("lon"), 0, -180, 180), num(q.get("dist"), 250, 1, 250));
      const key = `${source}:${lat.toFixed(1)}:${lon.toFixed(1)}:${dist}`;
      if (source === "adsbx") {
        const rapid = keyFrom(req, "ADSBX_RAPIDAPI_KEY");
        if (!rapid) return Response.json({ error: "ADSBX_RAPIDAPI_KEY not set" }, { status: 400 });
        const r = await cached(key, 8_000, () =>
          upstreamJson(
            "adsbexchange",
            `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${lat}/lon/${lon}/dist/${dist}/`,
            {
              headers: {
                "x-rapidapi-key": rapid,
                "x-rapidapi-host": "adsbexchange-com1.p.rapidapi.com",
              },
            },
          ),
        );
        return proxied(r.value, { source: "adsbexchange", cacheAge: r.age });
      }
      const r = await cached(key, 8_000, () =>
        polite("adsb.lol", 2_000, 20_000,() =>
          upstreamJson("adsb.lol", `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`),
        ),
      );
      return proxied(r.value, { source: "adsb.lol", cacheAge: r.age });
    }

    if (source === "mil") {
      // The global military feed is ~200 KB and adsb.lol rate-limits it much
      // harder than point queries (a 429 here poisons the next point query
      // too), so it is refreshed every two minutes at most.
      const r = await cached("adsblol:mil", 120_000, () =>
        polite("adsb.lol", 2_000, 20_000,() => upstreamJson("adsb.lol", "https://api.adsb.lol/v2/mil")),
      );
      return proxied(r.value, { source: "adsb.lol/mil", cacheAge: r.age });
    }

    if (source === "opensky") {
      const bbox = (q.get("bbox") ?? "").split(",").map(Number);
      const hasBbox = bbox.length === 4 && bbox.every(Number.isFinite);
      const params = hasBbox
        ? `?lamin=${bbox[1]}&lomin=${bbox[0]}&lamax=${bbox[3]}&lomax=${bbox[2]}`
        : "";
      const id = keyFrom(req, "OPENSKY_CLIENT_ID");
      const secret = keyFrom(req, "OPENSKY_CLIENT_SECRET");
      const authed = !!(id && secret);
      // Anonymous users get 400 credits/day and a world query costs 4, so the
      // global view is served from a 90 s server cache. Authenticated: 30 s.
      const ttl = authed ? 30_000 : 90_000;
      const key = `opensky:${authed ? "auth" : "anon"}:${params}`;
      let remaining: string | null = null;
      const r = await cached(key, ttl, async () => {
        const headers: Record<string, string> = {};
        if (authed) headers.authorization = `Bearer ${await openskyToken(id!, secret!)}`;
        const res = await upstream("opensky", `https://opensky-network.org/api/states/all${params}`, {
          headers,
          timeoutMs: 30_000,
        });
        remaining = res.headers.get("x-rate-limit-remaining");
        const json = (await res.json()) as Record<string, unknown>;
        return { ...json, rateRemaining: remaining };
      });
      return proxied(r.value, { source: authed ? "opensky (auth)" : "opensky (anon)", cacheAge: r.age });
    }

    return Response.json({ error: `unknown source ${source}` }, { status: 400 });
  } catch (err) {
    return jsonError(err);
  }
}

// Upstreams here can take tens of seconds (Overpass, Launch Library); keep the
// serverless function alive long enough on Vercel.
export const maxDuration = 60;
