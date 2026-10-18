// Air quality API: AirNow's hourly monitor observations (US, Canada, Mexico
// and US embassy monitors), PRELIMINARY as AirNow requires, each site credited
// to the agency that reported it.
//
//   /api/air?op=sites&bbox=w,s,e,n   active monitoring sites in a box with AirNow's NowCast
//                                    AQI (ozone, PM2.5, PM10), its 1-hour NO2 AQI and the
//                                    raw concentrations each agency sent, for the newest
//                                    published hour, as rows (see `columns`)
//
// Answers 404 while AIRNOW_ENABLED is off (lib/air/airnow.ts): AirNow's guidelines
// ask each data user to return a contact form, and the operator has not decided to.
//
// AirNow writes each hour's HourlyAQObs file under a dated folder once the hour
// is in; the newest one that answers is used (the current hour's file does not
// exist yet, so the route tries the three hours before it). One 1 MB file every
// 20 minutes, parsed once, filtered per request.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, polite, upstream } from "@/lib/server/upstream";
import { badRequest, notFound, ok, options, withCors } from "@/lib/server/respond";
import { retrying } from "@/lib/server/net";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { AIR_PRELIMINARY, AIRNOW_ENABLED, AIRNOW_OFF_MESSAGE, hourlyAqObsUrl, parseHourlyAqObs, siteRow, SITE_COLUMNS, type ParsedAqObs } from "@/lib/air/airnow";

export const maxDuration = 60;
export const OPTIONS = options;

const HOUR = 3600_000;

interface HourFile extends ParsedAqObs {
  url: string;
  hourUtc: string;
  lastModified?: string;
}

/** The newest HourlyAQObs file that answers, trying the three hours before now (UTC). */
async function newestHour(): Promise<HourFile> {
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  let last: unknown;
  for (let back = 1; back <= 3; back++) {
    const t = now - back * HOUR;
    const url = hourlyAqObsUrl(t);
    try {
      const res = await retrying(() => polite("airnow", 250, 60_000, () => upstream("epa-airnow", url, { timeoutMs: 20_000, headers: { accept: "text/plain,*/*" } })), 2);
      const parsed = parseHourlyAqObs(await res.text());
      return { ...parsed, url, hourUtc: new Date(t).toISOString(), lastModified: res.headers.get("last-modified") ?? undefined };
    } catch (err) {
      // A missing hour answers 404 (S3 NoSuchKey); an hour that fails some other way is also
      // passed over for the one before, so an older file still answers. The last error is kept.
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("AirNow: no hourly observations file answered");
}

function parseBbox(raw: string | null): [number, number, number, number] | null {
  const v = (raw ?? "").split(",").map((x) => (x.trim() === "" ? NaN : Number(x)));
  if (v.length !== 4 || !v.every(Number.isFinite) || v[0] >= v[2] || v[1] >= v[3]) return null;
  return [Math.max(-180, v[0]), Math.max(-90, v[1]), Math.min(180, v[2]), Math.min(90, v[3])];
}

export async function GET(req: NextRequest) {
  // Nothing is fetched from AirNow until the operator turns it on.
  if (!AIRNOW_ENABLED) return notFound(AIRNOW_OFF_MESSAGE);
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "sites": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return badRequest("bbox=w,s,e,n required, e.g. bbox=-99,29,-98,30 (the whole world is -180,-90,180,90)");
        const r = await cached("airnow:hourly", 20 * 60_000, newestHour, { deadlineMs: 45_000, coolMs: 60_000 });
        const f = r.value;
        const rows = f.sites.filter((s) => s.lon >= b[0] && s.lon <= b[2] && s.lat >= b[1] && s.lat <= b[3]).map(siteRow);
        return ok(rows, {
          meta: {
            source: "EPA AirNow HourlyAQObs (preliminary)",
            columns: SITE_COLUMNS,
            hourUtc: f.hourUtc,
            bbox: b,
            count: rows.length,
            sitesInFile: f.sites.length,
            inactiveLeftOut: f.inactive,
            withoutPositionLeftOut: f.noPosition,
            preliminary: true,
            cacheAge: r.age,
          },
          provenance: [
            provenance(source("epa-airnow"), {
              kind: "published",
              seriesId: f.url.replace(/^.*\//, ""),
              upstreamUrl: f.url,
              period: f.hourUtc,
              releasedAt: f.lastModified ? new Date(f.lastModified).toISOString() : undefined,
              retrievedAt: new Date(Date.now() - r.age).toISOString(),
              revision: "preliminary: not fully verified or validated, subject to change",
              notes: ["credit the reporting agency named on each site, then the EPA AirNow program"],
            }),
          ],
          caveats: [
            `${AIR_PRELIMINARY}. Validated data are in EPA's AQS archive, not here.`,
            "AirNow's guidelines: these data \"should not be used to formulate or support regulation, ascertain trends, act as guidance, or support any other government or public decision-making\".",
            "ozoneAqi, pm25Aqi and pm10Aqi are AirNow's NowCast AQI (weighted over the last 12 hours) and no2Aqi its 1-hour AQI, computed by AirNow from the concentrations each agency sent; `concentrations` are the raw hourly values. All are as AirNow published them. A site's colour is its highest pollutant AQI in EPA's category colours, and a site with no AQI this hour is not rated.",
          ],
          ttlS: 600,
        });
      }
      default:
        return badRequest("unknown op: sites");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
