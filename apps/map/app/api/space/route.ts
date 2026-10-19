// Space API: the space-weather panel and the ISS live stream. CORS open and
// edge-cached like the other data routes, with the shared envelope
// (lib/server/respond.ts).
//
//   /api/space?op=weather      GFZ Kp for the last 3 days (preliminary values marked),
//                              NASA DONKI solar flares (7 days) and notifications (3 days)
//   /api/space?op=iss-stream   NASA's ISS stream id, confirmed through YouTube's
//                              oEmbed endpoint to be embeddable, on NASA's channel
//                              and titled as the Space Station stream;
//                              { available: false, reason } otherwise

import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4 } from "@/lib/server/net";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { ISS_STREAM_ID, issStream, spaceWeather } from "@/lib/space/sources";
import { DONKI_DISCLAIMER } from "@/lib/space/weather";

export const maxDuration = 60;
export const OPTIONS = options;

// Same IPv6 reset exposure as the other new routes (lib/server/net.ts).
preferIpv4();

const TTL_S = 900;

/** When a value `ageMs` old was fetched. */
const fetchedAt = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

async function weather() {
  const r = await spaceWeather();
  const w = r.value;
  const retrievedAt = fetchedAt(r.age);
  const prov: Provenance[] = [];
  if (!w.failed.includes("GFZ Kp")) {
    const pre = w.kp.filter((k) => k.status === "pre").length;
    prov.push(
      provenance(source("gfz-kp"), {
        kind: "published",
        seriesId: "Kp",
        period: w.kp.length ? `${w.kp[0].time}/${w.kp[w.kp.length - 1].time}` : undefined,
        retrievedAt,
        revision: pre ? "preliminary" : "definitive",
        notes: pre ? [`${pre} of ${w.kp.length} values are preliminary (GFZ status "pre"); GFZ replaces them with definitive values later`] : undefined,
      }),
    );
  }
  if (w.flares != null) prov.push(provenance(source("nasa-donki"), { kind: "published", seriesId: "FLR", period: `${w.flaresFrom}/${retrievedAt.slice(0, 10)}`, retrievedAt }));
  if (w.notices != null) prov.push(provenance(source("nasa-donki"), { kind: "published", seriesId: "notifications", period: `${w.noticesFrom}/${retrievedAt.slice(0, 10)}`, retrievedAt }));
  const caveats = [
    "NOAA's Space Weather Prediction Center (https://www.swpc.noaa.gov/) is the official US source for space-weather forecasts and alerts.",
    `DONKI: ${DONKI_DISCLAIMER}`,
  ];
  for (const f of w.failed) caveats.push(`${f} did not answer; its values are missing, not absent.`);
  return ok(w, { meta: { source: "GFZ Potsdam Kp (CC BY 4.0) + NASA CCMC DONKI", cacheAge: r.age }, provenance: prov, caveats, ttlS: w.failed.length ? 120 : TTL_S });
}

async function issStreamOp() {
  const r = await issStream();
  return ok(r.value, {
    meta: { source: "NASA's ISS stream on YouTube, checked through YouTube oEmbed", cacheAge: r.age },
    provenance: [
      provenance(source("youtube-oembed"), {
        kind: "snapshot",
        seriesId: ISS_STREAM_ID,
        upstreamUrl: `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ISS_STREAM_ID}`)}&format=json`,
        retrievedAt: new Date(r.value.checkedAt).toISOString(),
      }),
    ],
    caveats: r.value.available ? undefined : [`Not shown: ${r.value.reason ?? "the oEmbed check did not pass"}.`],
    ttlS: TTL_S,
  });
}

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get("op") ?? "";
  try {
    switch (op) {
      case "weather":
        return await weather();
      case "iss-stream":
        return await issStreamOp();
      default:
        return badRequest("unknown op: weather | iss-stream");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
