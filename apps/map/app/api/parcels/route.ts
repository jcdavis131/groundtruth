// Parcels API: the parcel at a point, as its county or state publishes it,
// and parcel outlines in a small box. CORS open and edge-cached like the
// other routes, with the shared envelope (lib/server/respond.ts).
//
//   /api/parcels?lon=..&lat=..                 mode=identify (the default): the county
//                                              (TIGERweb), the adapter for it, the parcel
//                                              record(s) at the point with owner, site and
//                                              mailing address, values, use, area, last
//                                              sale and legal text as the source publishes
//                                              them, the source's own record link, NAD
//                                              address points and the BLM PLSS section.
//   /api/parcels?mode=outlines&bbox=w,s,e,n    parcel outlines with their id and use class
//                                              only, never an owner. Box at most 0.01
//                                              degrees, snapped to a 0.002 degree grid.
//   /api/parcels?mode=addresses&lon=..&lat=..  NAD address points on the parcel at the
//                                              point, waiting longer than identify does.
//
// There is no name parameter and no way to add one: the route takes a point
// or a box. `owner`, `name`, `q`, `where` and `search` are refused outright.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4 } from "@/lib/server/net";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import {
  adapterRef,
  countiesIn,
  IDENTIFY_TTL_MS,
  nadNear,
  NAD_URL,
  OUTLINE_TTL_MS,
  outlinesFor,
  parcelsAt,
  PLSS_STATES,
  PLSS_URL,
  plssAt,
  TIGER_COUNTIES,
  type ParcelsAt,
  type Used,
} from "@/lib/parcels/sources";
import { adapterFor, type ParcelAdapter } from "@/lib/parcels/adapters";
import type { CountyRef, NadAddress, ParcelIdentify, PlssDescription } from "@/lib/parcels/types";
import type { LayerFeature } from "@/lib/layers/types";

export const maxDuration = 60;
export const OPTIONS = options;

preferIpv4();

/** How long identify waits for NAD before answering without it (mode=addresses waits longer). */
const NAD_INLINE_MS = 2_500;
const NAD_ADDRESSES_MS = 30_000;
const PLSS_MS = 8_000;
/** Adapters asked per outline box at most (a box on a four-county corner). */
const MAX_OUTLINE_ADAPTERS = 4;
/**
 * Response budget for one outline box: Vercel refuses function bodies over
 * 4.5 MB, and one downtown box was 1.5 MB from a single service (Minneapolis
 * condominiums), so a box where several services meet is capped here.
 */
const OUTLINE_MAX_BYTES = 3_500_000;

const fetchedAt = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

/** Said on every parcel answer. */
const RECORD_CAVEATS = [
  "Each record is relayed as its county or state publishes it, with nothing added or joined from another source; the source's own record (linked where it publishes one) is the authority, and it may be newer.",
  "A parcel outline is a tax map, not a survey: it is not a boundary determination and can be metres off.",
  "This route takes a point or a box, never a name: there is no search from an owner to what they own.",
];
const NAD_CAVEAT = "NAD address points: USDOT's licence says the database is not intended for use as a mailing list and is subject to state laws that prohibit its use as one.";

type Bbox = [number, number, number, number];

function snapBbox(v: Bbox, span: number, grid: number): Bbox {
  let [w, s, e, n] = v;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - span / 2, -180);
  e = Math.min(e, cx + span / 2, 180);
  s = Math.max(s, cy - span / 2, -90);
  n = Math.min(n, cy + span / 2, 90);
  const f = (x: number) => Number((Math.floor(x / grid) * grid).toFixed(4));
  const c = (x: number) => Number((Math.ceil(x / grid) * grid).toFixed(4));
  return [f(w), f(s), c(e), c(n)];
}

function parseBbox(raw: string | null): Bbox | null {
  const v = (raw ?? "").split(",").map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  if (v[0] >= v[2] || v[1] >= v[3]) return null;
  return snapBbox(v as Bbox, OUTLINE_MAX_DEG, OUTLINE_GRID);
}

/** Outline boxes: at most 0.01 degrees (about 1.1 km) across, snapped outward to 0.002 degrees. */
const OUTLINE_MAX_DEG = 0.01;
const OUTLINE_GRID = 0.002;

/** A query parameter as a finite number; a missing or blank one is null, never 0 (Number(null) is 0). */
function numParam(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function point(q: URLSearchParams): { lon: number; lat: number } | null {
  const lon = numParam(q.get("lon"));
  const lat = numParam(q.get("lat"));
  if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // One cache entry per ~1 m: nearby clicks on the same spot share it.
  return { lon: Number(lon.toFixed(5)), lat: Number(lat.toFixed(5)) };
}

function prov(u: Used, retrievedAt: string, notes?: string[]): Provenance {
  return provenance(source(u.sourceId), { kind: "published", seriesId: u.seriesId, upstreamUrl: u.url, retrievedAt, ...(notes?.length ? { notes } : {}) });
}

/** One provenance record per distinct upstream series. */
function provenanceOf(used: Used[], retrievedAt: string): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const u of used) {
    const key = `${u.sourceId}|${u.seriesId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prov(u, retrievedAt, u.note ? [u.note] : undefined));
  }
  return out;
}

async function identifyCached(lon: number, lat: number) {
  return cached<ParcelsAt>(`parcels-identify:${lon},${lat}`, IDENTIFY_TTL_MS, () => parcelsAt(lon, lat), { deadlineMs: 45_000 });
}

async function plssFor(county: CountyRef | null, lon: number, lat: number): Promise<PlssDescription | null | undefined> {
  if (!county || !PLSS_STATES.has(county.state)) return undefined;
  try {
    return (await plssAt(lon, lat, PLSS_MS)).value;
  } catch {
    return null;
  }
}

async function opIdentify(lon: number, lat: number) {
  const r = await identifyCached(lon, lat);
  const at = r.value;
  const stale = r.age > IDENTIFY_TTL_MS;
  const geometry = at.parcels[0]?.geometry ?? null;
  const [plss, addresses] = await Promise.all([
    plssFor(at.county, lon, lat),
    at.county ? nadNear(lon, lat, geometry, NAD_INLINE_MS).then((x) => x.value).catch(() => null) : Promise.resolve([] as NadAddress[]),
  ]);
  const data: ParcelIdentify = {
    point: { lon, lat },
    county: at.county,
    adapter: at.adapter ? adapterRef(at.adapter) : null,
    parcels: at.parcels,
    addresses,
    ...(plss !== undefined ? { plss } : {}),
    notes: at.notes,
  };
  const retrievedAt = fetchedAt(r.age);
  const provs = provenanceOf(at.used, retrievedAt);
  if (addresses) provs.push(prov({ sourceId: "usdot-nad", url: NAD_URL, seriesId: "NAD address points view, layer 0" }, new Date().toISOString()));
  if (plss) provs.push(prov({ sourceId: "blm-plss", url: PLSS_URL, seriesId: "layers 1 (township) and 2 (section)" }, new Date().toISOString()));
  const caveats = [...RECORD_CAVEATS];
  if (at.adapter?.caveat) caveats.push(at.adapter.caveat);
  if (addresses?.length) caveats.push(NAD_CAVEAT);
  if (addresses === null) caveats.push(`NAD address points did not answer within ${NAD_INLINE_MS / 1000} s; mode=addresses asks again and waits longer.`);
  if (plss === null) caveats.push("BLM's PLSS service did not answer, so the township and section are missing this time.");
  if (stale) caveats.push("The parcel source did not answer; this is the last answer it gave, older than a day (see cacheAge).");
  return ok(data, {
    meta: { source: at.adapter?.name ?? null, mode: "identify", cacheAge: r.age, stale },
    provenance: provs,
    caveats,
    ttlS: at.parcels.length ? 3600 : 600,
  });
}

async function opAddresses(lon: number, lat: number) {
  const r = await identifyCached(lon, lat);
  const geometry = r.value.parcels[0]?.geometry ?? null;
  const nad = await nadNear(lon, lat, geometry, NAD_ADDRESSES_MS);
  return ok(
    // parcelOutline: whether a parcel outline was found to test the points against.
    { point: { lon, lat }, parcelOutline: !!geometry, addresses: nad.value },
    {
      meta: { source: "USDOT National Address Database", mode: "addresses", cacheAge: nad.age },
      provenance: [prov({ sourceId: "usdot-nad", url: NAD_URL, seriesId: "NAD address points view, layer 0" }, fetchedAt(nad.age))],
      caveats: [NAD_CAVEAT, "NAD covers the states and tribes that contribute to it; no address point here is not proof that there is no address."],
      ttlS: 3600,
    },
  );
}

async function opOutlines(bbox: Bbox) {
  const counties = await countiesIn(bbox);
  // One request per distinct service: a statewide adapter covers every county of its state in one query.
  const groups = new Map<string, { adapter: ParcelAdapter; county: CountyRef }>();
  const uncovered: string[] = [];
  const clickOnly = new Map<string, string>();
  for (const c of counties) {
    const a = adapterFor(c);
    if (!a) {
      uncovered.push(c.name);
      continue;
    }
    if (a.noOutlines) {
      clickOnly.set(a.id, a.noOutlines);
      continue;
    }
    const key = `${a.id}|${a.url(c)}`;
    if (!groups.has(key)) groups.set(key, { adapter: a, county: c });
  }
  const asked = [...groups.values()].slice(0, MAX_OUTLINE_ADAPTERS);
  const settled = await Promise.allSettled(asked.map((g) => outlinesFor(g.adapter, g.county, bbox)));
  const features: LayerFeature[] = [];
  const sources: Array<{ id: string; name: string; count: number; truncated: boolean }> = [];
  const failed: Array<{ id: string; name: string; error: string }> = [];
  const provs: Provenance[] = [prov({ sourceId: "census-tigerweb", url: TIGER_COUNTIES, seriesId: "tigerWMS_Current layer 82 (counties)" }, new Date().toISOString())];
  let oldest = 0;
  settled.forEach((s, i) => {
    const { adapter } = asked[i];
    if (s.status === "fulfilled") {
      features.push(...s.value.value.features);
      sources.push({ id: adapter.id, name: adapter.name, count: s.value.value.features.length, truncated: s.value.value.truncated });
      oldest = Math.max(oldest, s.value.age);
      provs.push(
        prov(
          { sourceId: adapter.sourceId, url: adapter.url(asked[i].county), seriesId: adapter.kind === "identify" ? "MapServer identify over the box, layer 0" : "layer query over the box" },
          fetchedAt(s.value.age),
          [`bbox ${bbox.join(",")}`, "outline, parcel id and use class only"],
        ),
      );
    } else {
      failed.push({ id: adapter.id, name: adapter.name, error: s.reason instanceof Error ? s.reason.message.slice(0, 160) : "failed" });
    }
  });
  if (asked.length && !sources.length) throw settled.find((s) => s.status === "rejected")?.reason ?? new Error("every parcel source failed");
  // Keep whole outlines, in source order, until the response budget is spent.
  let bytes = 0;
  let kept = features.length;
  for (let i = 0; i < features.length; i++) {
    bytes += JSON.stringify(features[i]).length + 1;
    if (bytes > OUTLINE_MAX_BYTES) {
      kept = i;
      break;
    }
  }
  const cutForSize = kept < features.length;
  if (cutForSize) features.length = kept;
  const identifyOnly = [...clickOnly.entries()].map(([id, reason]) => ({ id, reason }));
  const truncatedAny = cutForSize || sources.some((s) => s.truncated);
  const caveats = [
    "Outlines carry the parcel id and use class only; click one (the identify mode) for the record its source publishes.",
    "A parcel outline is a tax map, not a survey.",
    "Only the returned `bbox` was loaded; outside it nothing is loaded, which is not the same as no parcel being there.",
  ];
  if (sources.some((s) => s.truncated)) caveats.push("A source's record limit was hit; ask for a smaller box for every parcel.");
  if (cutForSize) caveats.push(`Outlines past ${(OUTLINE_MAX_BYTES / 1e6).toFixed(1)} MB were left out to stay under the platform's response limit; ask for a smaller box for every parcel.`);
  if (uncovered.length) caveats.push(`No keyless parcel service is wired for ${uncovered.join(", ")}.`);
  for (const c of identifyOnly) caveats.push(`${c.reason}; click the map there for a parcel's record.`);
  if (failed.length) caveats.push(`Did not answer this time: ${failed.map((f) => f.name).join(", ")}.`);
  if (groups.size > asked.length) caveats.push(`Only ${asked.length} of ${groups.size} parcel services were asked for this box.`);
  return ok(
    { type: "FeatureCollection", features },
    {
      meta: { mode: "outlines", bbox, sources, failed, uncovered, identifyOnly, truncated: truncatedAny, cutForSize, cacheAge: oldest, maxAgeS: OUTLINE_TTL_MS / 1000 },
      provenance: provs,
      caveats,
      ttlS: failed.length ? 600 : 6 * 3600,
    },
  );
}

const NAME_PARAMS = ["owner", "name", "q", "where", "search", "query"];
const BBOX_HELP = "bbox=w,s,e,n required for mode=outlines, west < east and south < north, e.g. bbox=-98.492,29.422,-98.484,29.428";
const POINT_HELP = "lon and lat required, e.g. lon=-98.4861&lat=29.4260";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const named = NAME_PARAMS.find((k) => q.has(k));
  if (named) return badRequest(`this route takes a point (lon, lat) or a box (bbox), never a name or a search; '${named}' is not accepted`);
  const mode = q.get("mode") ?? "identify";
  try {
    switch (mode) {
      case "identify": {
        const p = point(q);
        if (!p) return badRequest(POINT_HELP);
        return await opIdentify(p.lon, p.lat);
      }
      case "outlines": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return badRequest(BBOX_HELP);
        return await opOutlines(b);
      }
      case "addresses": {
        const p = point(q);
        if (!p) return badRequest(POINT_HELP);
        return await opAddresses(p.lon, p.lat);
      }
      default:
        return badRequest("unknown mode: identify | outlines | addresses");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
