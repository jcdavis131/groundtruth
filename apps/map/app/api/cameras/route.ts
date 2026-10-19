// Public camera lists. Only transport and road agencies that publish their
// cameras as open data, each added after reading its terms (lib/cameras/
// agencies.ts has the terms, quoted): no private webcams, no aggregators, no
// aggregation of people.
//
//   /api/cameras?source=tfl          Transport for London JamCams (~900, open data)
//   /api/cameras?source=nyc          NYC DOT traffic cameras (~900, public API)
//   /api/cameras?source=caltrans     Caltrans CWWP2 CCTV, 12 districts (public domain)
//   /api/cameras?source=drivebc      DriveBC HighwayCams (Open Government Licence - BC)
//   /api/cameras?source=digitraffic  Fintraffic road weather cameras (CC BY 4.0)
//   /api/cameras?source=lta          LTA Singapore traffic images (Singapore Open Data Licence)
//   /api/cameras?source=windy&lat&lon&radius   Windy Webcams v3 (operator key required)
//
// TfL's raw payload is 1.1 MB of nested "additionalProperties" and Caltrans's
// District 7 file alone is 1.8 MB; both are trimmed to the fields the layer
// uses. Positions are the agency's; no camera's bearing is drawn.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, keyFrom, num, polite, upstream, upstreamJson } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { retrying } from "@/lib/server/net";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";
import {
  CALTRANS_DISTRICTS,
  caltransUrl,
  DIGITRAFFIC_STATIONS,
  DRIVEBC_CSV,
  LTA_IMAGES,
  parseCaltrans,
  parseDigitraffic,
  parseDriveBc,
  parseLta,
  type AgencyCam,
} from "@/lib/cameras/agencies";

export const maxDuration = 60;
export const OPTIONS = options;

interface TflPlace {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  additionalProperties: Array<{ key: string; value: string; modified: string }>;
}

export interface TrimmedCam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  imageUrl?: string;
  videoUrl?: string;
  available?: boolean;
  view?: string;
  area?: string;
  updated?: string;
}

interface NycCam {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  area: string;
  isOnline: string;
  imageUrl: string;
}

const fetchedAt = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();
const CAMERA_CAVEAT = "Positions are the operator's; no camera's bearing is drawn. Images are live stills the operator refreshes; nothing is recorded here.";

function answer(cams: unknown[], id: SourceId, label: string, upstreamUrl: string, age: number, ttlS: number, extra: Partial<Provenance> = {}, caveats: string[] = []) {
  return ok(cams, {
    meta: { source: label, count: cams.length, cacheAge: age, trimmed: true },
    provenance: [provenance(source(id), { kind: "snapshot", upstreamUrl, retrievedAt: fetchedAt(age), ...extra })],
    caveats: [CAMERA_CAVEAT, ...caveats],
    ttlS,
  });
}

/**
 * Every Caltrans district, one polite request each, each cached on its own for an hour:
 * a district that fails is named and not stored, so the next caller re-asks only it
 * while the rest still answer from the cache.
 */
async function caltrans(): Promise<{ cams: AgencyCam[]; failed: number[]; age: number }> {
  const parts = await Promise.all(
    CALTRANS_DISTRICTS.map(async (d) => {
      try {
        const r = await cached(
          `cams:caltrans:d${d}`,
          60 * 60_000,
          async () => parseCaltrans(await retrying(() => polite("caltrans-cwwp2", 150, 30_000, () => upstreamJson<Parameters<typeof parseCaltrans>[0]>("caltrans-cwwp2", caltransUrl(d), { timeoutMs: 25_000 })), 2)),
          { deadlineMs: 45_000 },
        );
        return { d, cams: r.value, age: r.age };
      } catch {
        return { d, cams: null, age: 0 };
      }
    }),
  );
  const failed = parts.filter((p) => !p.cams).map((p) => p.d);
  if (failed.length === parts.length) throw new Error("Caltrans CWWP2: no district file answered");
  return { cams: parts.flatMap((p) => p.cams ?? []), failed, age: Math.max(...parts.filter((p) => p.cams).map((p) => p.age)) };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const src = q.get("source") ?? "tfl";
  try {
    switch (src) {
      case "tfl": {
        const r = await cached("cams:tfl", 10 * 60_000, async () => {
          const places = await upstreamJson<TflPlace[]>("tfl", "https://api.tfl.gov.uk/Place/Type/JamCam", { timeoutMs: 40_000 });
          return places.map((p): TrimmedCam => {
            const props = Object.fromEntries(p.additionalProperties.map((a) => [a.key, a.value]));
            const modified = p.additionalProperties.find((a) => a.key === "imageUrl")?.modified;
            return { id: p.id, name: p.commonName, lat: p.lat, lon: p.lon, imageUrl: props.imageUrl, videoUrl: props.videoUrl, available: props.available === "true", view: props.view, updated: modified };
          });
        });
        return answer(r.value, "tfl-jamcams", "tfl", "https://api.tfl.gov.uk/Place/Type/JamCam", r.age, 300);
      }
      case "nyc": {
        const r = await cached("cams:nyc", 10 * 60_000, async () => {
          const cams = await upstreamJson<NycCam[]>("nyctmc", "https://webcams.nyctmc.org/api/cameras", { timeoutMs: 40_000 });
          return cams.map((c): TrimmedCam => ({ id: c.id, name: c.name, lat: c.latitude, lon: c.longitude, imageUrl: c.imageUrl, available: c.isOnline === "true", area: c.area }));
        });
        return answer(r.value, "nyc-dot-cameras", "nyc", "https://webcams.nyctmc.org/api/cameras", r.age, 300);
      }
      case "caltrans": {
        const r = await caltrans();
        return answer(
          r.cams,
          "caltrans-cwwp2",
          "caltrans",
          "https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm",
          r.age,
          r.failed.length ? 600 : 1800,
          { seriesId: "cctvStatusD01.json to cctvStatusD12.json", notes: ["12 district files, e.g. https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json"] },
          r.failed.length ? [`Caltrans district file${r.failed.length === 1 ? "" : "s"} ${r.failed.join(", ")} did not answer; those cameras are missing, not absent.`] : [],
        );
      }
      case "drivebc": {
        const r = await cached("cams:drivebc", 6 * 60 * 60_000, async () => {
          const res = await retrying(() => polite("bc-data-catalogue", 250, 30_000, () => upstream("drivebc-highwaycams", DRIVEBC_CSV, { timeoutMs: 25_000, headers: { accept: "text/csv" } })), 2);
          return parseDriveBc(await res.text());
        });
        return answer(r.value, "drivebc-highwaycams", "drivebc", DRIVEBC_CSV, r.age, 3600, { notes: ["Contains information licensed under the Open Government Licence – British Columbia."] }, [
          "Ministry cameras from the BC Data Catalogue's HighwayCams dataset; each still comes from DriveBC's own image service for that camera id.",
        ]);
      }
      case "digitraffic": {
        const r = await cached("cams:digitraffic", 30 * 60_000, async () => {
          const j = await retrying(
            () =>
              polite("digitraffic-weathercam", 250, 30_000, () =>
                upstreamJson<Parameters<typeof parseDigitraffic>[0]>("digitraffic-weathercam", DIGITRAFFIC_STATIONS, {
                  timeoutMs: 25_000,
                  headers: { "accept-encoding": "gzip", "digitraffic-user": "embedding-atlas/0.1 (open-source globe)" },
                }),
              ),
            2,
          );
          return parseDigitraffic(j);
        });
        return answer(r.value, "digitraffic-weathercam", "digitraffic", DIGITRAFFIC_STATIONS, r.age, 900, { notes: ["Fintraffic / digitraffic.fi, CC BY 4.0"] }, ["Road weather cameras, most of them pointed at the road surface."]);
      }
      case "lta": {
        const r = await cached("cams:lta", 2 * 60_000, async () => {
          const j = await retrying(() => polite("data-gov-sg", 500, 60_000, () => upstreamJson<Parameters<typeof parseLta>[0]>("lta-traffic-images", LTA_IMAGES, { timeoutMs: 20_000 })), 2);
          return parseLta(j);
        });
        return answer(r.value, "lta-traffic-images", "lta", LTA_IMAGES, r.age, 120, {
          notes: [`Contains information from Traffic Images accessed on ${fetchedAt(r.age).slice(0, 10)} from data.gov.sg, made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence)`],
        });
      }
      case "windy": {
        const key = keyFrom(req, "WINDY_WEBCAMS_KEY");
        if (!key) return badRequest("WINDY_WEBCAMS_KEY not set");
        const lat = num(q.get("lat"), 0, -90, 90);
        const lon = num(q.get("lon"), 0, -180, 180);
        const radius = num(q.get("radius"), 100, 1, 250);
        const ck = `cams:windy:${lat.toFixed(1)}:${lon.toFixed(1)}:${Math.round(radius)}`;
        const url = `https://api.windy.com/webcams/api/v3/webcams?lang=en&limit=50&nearby=${lat},${lon},${radius}&include=images,location,player,urls`;
        const r = await cached(ck, 5 * 60_000, () => upstreamJson("windy", url, { headers: { "x-windy-api-key": key } }));
        // The key never reaches the cache line or the provenance: the URL carries no key.
        return ok(r.value, {
          meta: { source: "windy", cacheAge: r.age },
          provenance: [provenance(source("windy-webcams"), { kind: "snapshot", upstreamUrl: url, retrievedAt: fetchedAt(r.age) })],
          caveats: [CAMERA_CAVEAT],
          ttlS: 0,
        });
      }
      default:
        return badRequest(`unknown source ${src}: tfl | nyc | caltrans | drivebc | digitraffic | lta | windy`);
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
