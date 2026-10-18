// Server-side fetchers for /api/zoning. Only the route imports this file.
//
//   placeAt        the Census incorporated place under a point (TIGERweb layer 28),
//                  which picks the city; cached 30 days per ~11 m cell
//   zoningAt       the city's own district at a point (New York: DCP's district
//                  plus the Zoning Tax Lot Database row of the lot under it, or
//                  DCP's overlay layers at the point when the lot has none);
//                  cached a day per ~1 m cell
//   zoningOutlines district outlines in a box for the cities whose services can
//                  simplify them on the server; cached a day per snapped box
//
// Every request goes through lib/civic/request.ts (a gate per host, ten
// minutes off after a 429 or a 503).

import { cacheDelete, cached } from "@/lib/server/cache";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { runRows } from "@/lib/civic/request";
import {
  arcgisPoint,
  buildOutlines,
  citiesInBox,
  cityByGeoid,
  cityRecord,
  hitFor,
  houstonRecord,
  notCoveredRecord,
  NYC_LOT_GAP,
  NYC_PLUTO_FIELDS,
  NYC_PLUTO_LAYER,
  nycOverlayRequests,
  overlaysUnknown,
  parsePlace,
  plutoBbl,
  pointRequest,
  polygonRequest,
  requestUrl,
  withPointOverlays,
  withZtldb,
  ztldbUrl,
  ZONING_CITIES,
  type Bbox,
  type PlaceHit,
  type ZoningCityId,
  type ZoningHit,
  type ZoningOutlineExtra,
  type ZoningRecord,
} from "./features";

const DAY = 24 * 3600_000;
export const TIGER_PLACES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28";

const iso = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

/** The incorporated place under a point. */
export async function placeAt(lon: number, lat: number): Promise<{ place: PlaceHit | null; age: number }> {
  const x = lon.toFixed(4);
  const y = lat.toFixed(4);
  const r = await cached(`zoning-place:${x},${y}`, 30 * DAY, async () => {
    const res = await runRows("tigerweb", arcgisPoint(TIGER_PLACES, Number(x), Number(y), ["GEOID", "NAME", "BASENAME"]), 15_000);
    return parsePlace(res.features.map((f) => f.properties ?? {}));
  });
  return { place: r.value, age: r.age };
}

export interface ZoningAnswer {
  record: ZoningRecord;
  provenance: Provenance[];
  age: number;
  /** Part of the answer did not arrive (New York's tax-lot lookup); not held, and briefly at the edge. */
  partial: boolean;
  /** New York: neither the tax lot's ZTLDB row nor DCP's overlay layers answered, so the overlays are unknown. */
  overlaysUnknown: boolean;
  /** New York: why the overlays did not come from the lot's ZTLDB row. */
  lotGap?: string;
}

interface NycAnswer {
  hit: ZoningHit | null;
  bbl: string | null;
  /** The lot lookup, when it answered with a lot. */
  lotUrl?: string;
  /** The ZTLDB row's URL, when the lot had one. */
  ztlUrl?: string;
  /** DCP's point layers, when they answered for the overlays. */
  overlayUrl?: string;
  /** Something did not answer: not held, asked again next time. */
  partial: boolean;
  /** Neither the ZTLDB nor DCP's point layers answered: the overlays are unknown, not absent. */
  overlaysUnknown: boolean;
  /** Why the lot's ZTLDB row could not give the overlays (NYC_LOT_GAP), when it could not. */
  lotGap?: string;
}

/**
 * New York: the district at the point (DCP), then the tax lot under it
 * (MapPLUTO, BBL only) and its Zoning Tax Lot Database row for the overlays,
 * special districts and limited-height district. When the lot has no ZTLDB
 * row (a condominium billing lot, 75xx), there is no lot (a street), or a
 * lookup did not answer, DCP's own overlay layers are asked at the point, so
 * a missing row never reads as "no overlays".
 */
async function nycHit(lon: number, lat: number): Promise<NycAnswer> {
  const zd = pointRequest("nyc", lon, lat)!;
  const lotReq = arcgisPoint(NYC_PLUTO_LAYER, lon, lat, NYC_PLUTO_FIELDS);
  const [zdRows, lotRows] = await Promise.all([runRows("nyc-dcp", zd), runRows("nyc-dcp", lotReq).catch(() => null)]);
  const hit = hitFor("nyc", zdRows.features.map((f) => f.properties ?? {}));
  const bbl = lotRows ? plutoBbl(lotRows.features.map((f) => f.properties ?? {})) : null;
  const lotUrl = lotRows && bbl ? requestUrl(lotReq) : undefined;
  // No district polygon here (a street, water): the lot's overlays would not be asked about.
  if (!hit) return { hit, bbl, lotUrl, partial: false, overlaysUnknown: false };

  let why: string;
  let partial = !lotRows;
  if (!lotRows) why = NYC_LOT_GAP.lotDown;
  else if (!bbl) why = NYC_LOT_GAP.noLot;
  else {
    const url = ztldbUrl(bbl);
    const z = await runRows("nyc-ztldb", { kind: "socrata", url }).catch(() => null);
    const rows = z?.features.map((f) => f.properties ?? {}) ?? null;
    if (rows?.length) return { hit: withZtldb(hit, rows), bbl, lotUrl, ztlUrl: url, partial: false, overlaysUnknown: false };
    if (!rows) partial = true;
    why = rows ? NYC_LOT_GAP.condo : NYC_LOT_GAP.ztldbDown;
  }

  const o = nycOverlayRequests(lon, lat);
  const layers = await Promise.all([o.sp, o.co, o.lh].map((req) => runRows("nyc-dcp", req).then((r) => r.features.map((f) => f.properties ?? {}))))
    .then(([sp, co, lh]) => ({ sp, co, lh }))
    .catch(() => null);
  if (!layers) return { hit: overlaysUnknown(hit, why), bbl, lotUrl, partial: true, overlaysUnknown: true, lotGap: why };
  return { hit: withPointOverlays(hit, layers.sp, layers.co, layers.lh, why), bbl, lotUrl, overlayUrl: requestUrl(o.sp), partial, overlaysUnknown: false, lotGap: why };
}

/** What the city says about one point. */
export async function zoningAt(lon: number, lat: number): Promise<ZoningAnswer> {
  const { place, age: placeAge } = await placeAt(lon, lat);
  const placeProv = provenance(source("census-tigerweb"), {
    kind: "published",
    seriesId: "tigerWMS_Current layer 28 (incorporated places)",
    upstreamUrl: TIGER_PLACES,
    retrievedAt: iso(placeAge),
    notes: [place ? `${place.name} (GEOID ${place.geoid})` : "no incorporated place at this point"],
  });
  const city = cityByGeoid(place?.geoid);
  if (!place || !city) return { record: notCoveredRecord(lon, lat, place), provenance: [placeProv], age: placeAge, partial: false, overlaysUnknown: false };
  if (city.id === "houston") return { record: houstonRecord(lon, lat, place), provenance: [placeProv], age: placeAge, partial: false, overlaysUnknown: false };

  const x = Number(lon.toFixed(5));
  const y = Number(lat.toFixed(5));
  const id = city.id as Exclude<ZoningCityId, "houston">;
  const key = `zoning-point:${id}:${x},${y}`;
  const r = await cached(key, DAY, async (): Promise<{ hit: ZoningHit | null; bbl: string | null; partial: boolean; overlaysUnknown: boolean; lotGap?: string; url: string; ztlUrl?: string; overlayUrl?: string }> => {
    if (id === "nyc") {
      const n = await nycHit(x, y);
      return { hit: n.hit, bbl: n.bbl, partial: n.partial, overlaysUnknown: n.overlaysUnknown, lotGap: n.lotGap, url: requestUrl(pointRequest("nyc", x, y)!), ztlUrl: n.ztlUrl, overlayUrl: n.overlayUrl };
    }
    const req = pointRequest(id, x, y)!;
    const res = await runRows(`zoning-${id}`, req, id === "sanfrancisco" ? 25_000 : 20_000);
    return { hit: hitFor(id, res.features.map((f) => f.properties ?? {})), bbl: null, partial: false, overlaysUnknown: false, url: requestUrl(req) };
  });
  // A partial answer is not held: the next caller asks again.
  if (r.value.partial) cacheDelete(key);
  const record = cityRecord(id, lon, lat, place, r.value.hit, r.value.bbl ? { bbl: r.value.bbl } : undefined);
  const prov: Provenance[] = [placeProv];
  const src = city.source!;
  prov.push(
    provenance(source(src), {
      kind: "published",
      seriesId: city.id === "nyc" ? "nyzd FeatureServer layer 0 (zoning districts)" : undefined,
      upstreamUrl: r.value.url,
      retrievedAt: iso(r.age),
      notes: [`${city.name}: ${record.state}${record.code ? ` ${record.code}` : ""}`],
    }),
  );
  if (r.value.ztlUrl) {
    prov.push(
      provenance(source("nyc-ztldb"), {
        kind: "published",
        seriesId: "fdkv-4t4z (Zoning Tax Lot Database), by the BBL MapPLUTO gives for the point",
        upstreamUrl: r.value.ztlUrl,
        retrievedAt: iso(r.age),
        notes: [`BBL ${r.value.bbl}`],
      }),
    );
  }
  if (r.value.overlayUrl) {
    prov.push(
      provenance(source("nyc-dcp-zoning"), {
        kind: "published",
        seriesId: "nysp, nyco and nylh FeatureServer layer 0 (special purpose districts, commercial overlays, limited-height districts) at the point",
        upstreamUrl: r.value.overlayUrl,
        retrievedAt: iso(r.age),
        notes: [record.published["overlays from"] ?? "overlays at the point"],
      }),
    );
  }
  return { record, provenance: prov, age: r.age, partial: r.value.partial, overlaysUnknown: r.value.overlaysUnknown, lotGap: r.value.lotGap };
}

export interface OutlineSource {
  city: ZoningCityId;
  name: string;
  count: number;
  truncated: boolean;
}

export interface OutlinesAnswer {
  features: Array<{ type: "Feature"; id: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; properties: ZoningOutlineExtra }>;
  sources: OutlineSource[];
  failed: Array<{ city: ZoningCityId; name: string; error: string }>;
  /** Cities in the box with no outlines to draw (today only Houston, which has no zoning). */
  pointOnly: Array<{ city: ZoningCityId; name: string; reason: string }>;
  provenance: Provenance[];
  age: number;
}

/** District outlines in a box from every wired city the box meets. */
export async function zoningOutlines(b: Bbox): Promise<OutlinesAnswer> {
  const cities = citiesInBox(b);
  const pointOnly = cities
    .filter((c) => !c.polygons)
    .map((c) => ({ city: c.id, name: c.name, reason: c.note ?? "point answers only" }));
  const drawn = cities.filter((c) => c.polygons);
  const results = await Promise.all(
    drawn.map(async (c) => {
      const req = polygonRequest(c.id, b)!;
      try {
        const r = await cached(`zoning-outlines:${c.id}:${b.join(",")}`, DAY, async () => {
          const res = await runRows(`zoning-${c.id}`, req, 25_000);
          return { features: buildOutlines(c.id, res.features), truncated: res.truncated };
        });
        return { city: c, ok: true as const, value: r.value, age: r.age, url: requestUrl(req) };
      } catch (err) {
        return { city: c, ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  const features: OutlinesAnswer["features"] = [];
  const sources: OutlineSource[] = [];
  const failed: OutlinesAnswer["failed"] = [];
  const prov: Provenance[] = [];
  let age = 0;
  for (const r of results) {
    if (!r.ok) {
      failed.push({ city: r.city.id, name: r.city.name, error: r.error.slice(0, 160) });
      continue;
    }
    features.push(...r.value.features);
    age = Math.max(age, r.age);
    sources.push({ city: r.city.id, name: r.city.name, count: r.value.features.length, truncated: r.value.truncated });
    prov.push(
      provenance(source(r.city.source!), {
        kind: "published",
        upstreamUrl: r.url,
        retrievedAt: iso(r.age),
        notes: [`${r.value.features.length} district outlines, generalised on the server`],
      }),
    );
  }
  return { features, sources, failed, pointOnly, provenance: prov, age };
}

export { ZONING_CITIES };
