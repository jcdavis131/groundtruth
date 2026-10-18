// Server-side fetchers for the hazard layers. Every upstream is keyless;
// each one is cached in memory and gated so concurrent browsers share one
// request. Only route handlers import this file.
//
//   NIFC WFIGS        current perimeters + incident points (ArcGIS, 5 min)
//   NASA FIRMS        global 24 h CSVs for VIIRS S-NPP, VIIRS NOAA-20, MODIS
//                     (~19 MB together), each file fetched and cached on its own,
//                     parsed once per 30 min into typed arrays
//   NWS               alerts/active (~2.8 MB, trimmed to what the layer shows)
//   TIGERweb          1:20M county polygons for NWS alerts that carry no polygon
//   GDACS             the public RSS feed (every event type; only items GDACS marks
//                     iscurrent=true), merged with the EVENTS4APP list of the latest
//                     100 events and one SEARCH page of current Orange and Red events,
//                     so the highest-rated events can never fall off a capped list
//   NASA EONET        open volcano events
//   USGS              all_day, the feed the Earthquakes layer draws, only to mark
//                     the GDACS quakes it also has
//
// Every request keeps tries x timeout well under the routes' 60 s, and the
// sources the alerts op combines answer within SOURCE_DEADLINE_MS or are left
// out of that answer (their fetch finishes in the background and is cached).

import type { MultiPolygon, Polygon } from "geojson";
import { cached, type CachedOptions } from "@/lib/server/cache";
import { arcgisQuery, arcgisRowsCapped, truncated } from "@/lib/server/arcgis";
import { polite, upstream, upstreamJson } from "@/lib/server/upstream";
import { retrying } from "@/lib/server/net";
import {
  mergeGdacs,
  parseFirmsCsv,
  parseGdacsGeoJson,
  parseGdacsRss,
  trimNwsAlert,
  WFIGS_INCIDENT_FIELDS,
  WFIGS_PERIMETER_FIELDS,
  type EonetEvent,
  type FirmsTable,
  type GdacsEvent,
  type GdacsGeoJson,
  type Instrument,
  type NwsAlert,
} from "./features";

const MIN = 60_000;

/** How long the alerts op waits on any one source before answering without it. */
export const SOURCE_DEADLINE_MS = 20_000;
/** A source that timed out or failed is not waited on again for this long (a held value is served). */
const SOURCE_COOL_MS = 2 * MIN;
const SOURCE: CachedOptions = { deadlineMs: SOURCE_DEADLINE_MS, coolMs: SOURCE_COOL_MS };

// ---------------------------------------------------------------- WFIGS

const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";
export const WFIGS_PERIMETERS_URL = `${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0`;
export const WFIGS_INCIDENTS_URL = `${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0`;

export function wfigs() {
  return cached(
    "wfigs:current",
    5 * MIN,
    async () => {
      const [perims, incidents] = await Promise.all([
        arcgisQuery(
          "nifc-wfigs",
          WFIGS_PERIMETERS_URL,
          {
            where: "1=1",
            outFields: WFIGS_PERIMETER_FIELDS.join(","),
            returnGeometry: "true",
            outSR: "4326",
            // ~50 m: perimeters are read from altitude; the largest fires run to hundreds of thousands of acres.
            maxAllowableOffset: "0.0005",
            geometryPrecision: "5",
          },
          { gate: "nifc-wfigs", timeoutMs: 22_000, tries: 2 },
        ),
        arcgisQuery(
          "nifc-wfigs",
          WFIGS_INCIDENTS_URL,
          { where: "1=1", outFields: WFIGS_INCIDENT_FIELDS.join(","), returnGeometry: "true", outSR: "4326" },
          { gate: "nifc-wfigs", timeoutMs: 22_000, tries: 2 },
        ),
      ]);
      return { perims: perims.features, incidents: incidents.features, truncated: truncated(perims) || truncated(incidents) };
    },
    { deadlineMs: 45_000, coolMs: SOURCE_COOL_MS },
  );
}

// ---------------------------------------------------------------- FIRMS

const FIRMS = "https://firms.modaps.eosdis.nasa.gov/data/active_fire";
export const FIRMS_FILES: Array<{ id: string; url: string; instrument: Instrument; product: string }> = [
  { id: "snpp", url: `${FIRMS}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv`, instrument: "VIIRS", product: "VIIRS 375 m S-NPP" },
  { id: "noaa20", url: `${FIRMS}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv`, instrument: "VIIRS", product: "VIIRS 375 m NOAA-20" },
  { id: "modis", url: `${FIRMS}/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv`, instrument: "MODIS", product: "MODIS 1 km C6.1" },
];

export interface FirmsSet {
  tables: FirmsTable[];
  /** Products that did not answer (or not within the deadline) this time. */
  failed: string[];
  lastModified: Record<string, string>;
  /** Ids of the files present, e.g. "snpp,noaa20,modis": a selection is cached per set of files. */
  files: string;
  /** Age of the oldest file held, ms. */
  age: number;
}

/**
 * One FIRMS 24 h file, re-read at most every 30 minutes (FIRMS updates them a
 * few times an hour). A file that misses the deadline keeps downloading and
 * is cached when it lands, so the next request has it.
 */
function firmsFile(f: (typeof FIRMS_FILES)[number]) {
  return cached(
    `firms:${f.id}`,
    30 * MIN,
    async () => {
      const { text, lm } = await retrying(async () => {
        const res = await polite("nasa-firms", 500, 60_000, () => upstream("nasa-firms", f.url, { timeoutMs: 25_000, headers: { accept: "text/csv" } }));
        return { text: await res.text(), lm: res.headers.get("last-modified") };
      }, 2);
      return { table: parseFirmsCsv(text, f.instrument, f.product), lastModified: lm ?? undefined };
    },
    { deadlineMs: 40_000, coolMs: SOURCE_COOL_MS },
  );
}

/** All three 24 h files, fetched in parallel (three requests to one host, 0.5 s apart). */
export async function firms(): Promise<FirmsSet> {
  const settled = await Promise.allSettled(FIRMS_FILES.map(firmsFile));
  const out: FirmsSet = { tables: [], failed: [], lastModified: {}, files: "", age: 0 };
  const ids: string[] = [];
  settled.forEach((r, i) => {
    const f = FIRMS_FILES[i];
    if (r.status === "rejected") {
      out.failed.push(f.product);
      return;
    }
    out.tables.push(r.value.value.table);
    if (r.value.value.lastModified) out.lastModified[f.id] = r.value.value.lastModified;
    out.age = Math.max(out.age, r.value.age);
    ids.push(f.id);
  });
  if (!out.tables.length) throw new Error(`FIRMS: none of the 24 h files answered (${out.failed.join(", ")})`);
  out.files = ids.join(",");
  return out;
}

// ---------------------------------------------------------------- NWS

/** Every active, actual alert (all severities); the Live warnings feed asks the same endpoint for Severe and Extreme only. */
export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?status=actual";

export function nwsAlerts() {
  return cached(
    "nws:alerts:active",
    2 * MIN,
    async () => {
      const j = await retrying(
        () =>
          polite("nws", 500, 60_000, () =>
            upstreamJson<{ features?: Array<{ id?: string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> }>(
              "nws",
              NWS_ALERTS_URL,
              { timeoutMs: 18_000, headers: { accept: "application/geo+json" } },
            ),
          ),
        2,
      );
      return (j.features ?? []).map(trimNwsAlert).filter((a): a is NwsAlert => !!a);
    },
    SOURCE,
  );
}

// ---------------------------------------------------------------- TIGERweb counties for NWS

export const TIGER_COUNTY_20M = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/State_County/MapServer/13";

/**
 * The county (5-digit GEOID) containing a point, from the same 1:20M TIGERweb layer as
 * lib/economy/sources.ts tigerCountyAt and lib/places/data/counties.json (Connecticut as planning
 * regions). Attributes only, held a day; null when the point is in no county. Here rather than
 * importing tigerCountyAt, whose module loads the economy tables at import.
 */
export function countyGeoidAt(lon: number, lat: number): Promise<string | null> {
  return cached(
    `tiger:geoid-at:${lon.toFixed(3)},${lat.toFixed(3)}`,
    24 * 3600_000,
    async () => {
      const j = await arcgisRowsCapped<{ GEOID?: string }>(
        "tigerweb",
        TIGER_COUNTY_20M,
        { geometry: JSON.stringify({ x: lon, y: lat }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "GEOID", returnGeometry: "false" },
        { gate: "tigerweb", minIntervalMs: 150, timeoutMs: 15_000, tries: 2 },
      );
      const g = j.rows.map((r) => r.GEOID).find((x): x is string => typeof x === "string" && /^\d{5}$/.test(x));
      return g ?? null;
    },
    { deadlineMs: 15_000 },
  ).then((c) => c.value);
}
const countyCache = new Map<string, { name: string; geometry: Polygon | MultiPolygon; at: number } | { missing: true; at: number }>();
const countyPending = new Set<string>();

/**
 * County polygons (1:20M generalized) by GEOID, fetched in chunks for the ones
 * not already held. GEOIDs TIGERweb does not know (marine SAME codes) are
 * remembered as missing so they are not asked for again for a day. Answers
 * with what is held after `budgetMs`; chunks still loading finish in the
 * background and are there next time.
 */
export async function countiesByGeoid(geoids: string[], budgetMs = 15_000): Promise<Map<string, { name: string; geometry: Polygon | MultiPolygon }>> {
  const now = Date.now();
  const want = [...new Set(geoids)].filter((g) => /^\d{5}$/.test(g));
  const missing = want.filter((g) => {
    if (countyPending.has(g)) return false;
    const c = countyCache.get(g);
    return !c || now - c.at > 24 * 3600_000;
  });
  for (const g of missing) countyPending.add(g);
  const work = (async () => {
    for (let i = 0; i < missing.length; i += 120) {
      const chunk = missing.slice(i, i + 120);
      try {
        const fc = await arcgisQuery<{ GEOID?: string; NAME?: string }>(
          "tigerweb",
          TIGER_COUNTY_20M,
          { where: `GEOID IN (${chunk.map((g) => `'${g}'`).join(",")})`, outFields: "GEOID,NAME", returnGeometry: "true", outSR: "4326", geometryPrecision: "4" },
          { gate: "tigerweb", minIntervalMs: 150, timeoutMs: 20_000, tries: 2 },
        );
        const seen = new Set<string>();
        const at = Date.now();
        for (const f of fc.features) {
          const id = f.properties.GEOID;
          const g = f.geometry;
          if (!id || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
          seen.add(id);
          countyCache.set(id, { name: f.properties.NAME ?? id, geometry: g, at });
        }
        for (const g of chunk) if (!seen.has(g)) countyCache.set(g, { missing: true, at });
      } catch {
        // Leave this chunk unresolved; those alerts count as undrawn this round.
      } finally {
        for (const g of chunk) countyPending.delete(g);
      }
    }
  })();
  if (missing.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([work, new Promise((r) => (timer = setTimeout(r, budgetMs)))]);
    clearTimeout(timer);
  }
  const out = new Map<string, { name: string; geometry: Polygon | MultiPolygon }>();
  for (const g of want) {
    const c = countyCache.get(g);
    if (c && !("missing" in c)) out.set(g, { name: c.name, geometry: c.geometry });
  }
  return out;
}

// ---------------------------------------------------------------- GDACS

const GDACS = "https://www.gdacs.org";
export const GDACS_RSS_URL = `${GDACS}/xml/rss.xml`;
const GDACS_TYPES = "EQ;TC;FL;VO;DR;WF";
/** GDACS's GeoJSON lists stop at this many rows a page. */
const GDACS_PAGE = 100;

export interface GdacsSet {
  events: GdacsEvent[];
  /** The lists that answered: "RSS", "EVENTS4APP", "SEARCH Orange/Red". */
  via: string[];
  /** The lists that did not. */
  failed: string[];
  /** Current events each list contributed, and the rows EVENTS4APP answered (it always stops at 100). */
  counts: { rss?: number; recent?: number; recentRows?: number; orangeRed?: number };
  /**
   * The answer may be missing events: the RSS feed (the only list without a
   * row cap) did not answer and EVENTS4APP did not come back short of 100
   * rows, or the Orange/Red page itself held 100.
   */
  truncated: boolean;
}

function gdacsText(url: string, accept: string): Promise<string> {
  return retrying(async () => {
    const res = await polite("gdacs", 1000, 60_000, () => upstream("gdacs", url, { timeoutMs: 15_000, headers: { accept } }));
    return res.text();
  }, 2);
}

/** GDACS GeoJSON list; SEARCH answers 204 with no body when nothing matches. */
async function gdacsList(url: string): Promise<{ events: GdacsEvent[]; rows: number }> {
  const text = (await gdacsText(url, "application/json")).trim();
  return parseGdacsGeoJson(text ? (JSON.parse(text) as GdacsGeoJson) : { features: [] });
}

/** Current GDACS events from three lists, one record per event. */
export function gdacs() {
  return cached(
    "gdacs:events",
    10 * MIN,
    async (): Promise<GdacsSet> => {
      const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const now = Date.now();
      const [rss, recent, severe] = await Promise.allSettled([
        gdacsText(GDACS_RSS_URL, "application/rss+xml, application/xml").then(parseGdacsRss),
        gdacsList(`${GDACS}/gdacsapi/api/events/geteventlist/EVENTS4APP`),
        // Documented search: every current Orange and Red event whose dates touch the last 30 days.
        gdacsList(
          `${GDACS}/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${GDACS_TYPES}&alertlevel=Orange;Red&fromdate=${day(now - 30 * 86_400_000)}&todate=${day(now + 86_400_000)}`,
        ),
      ]);
      const set: GdacsSet = { events: [], via: [], failed: [], counts: {}, truncated: false };
      const lists: GdacsEvent[][] = [];
      if (rss.status === "fulfilled") {
        lists.push(rss.value);
        set.via.push("RSS");
        set.counts.rss = rss.value.length;
      } else set.failed.push("RSS");
      if (severe.status === "fulfilled") {
        lists.push(severe.value.events);
        set.via.push("SEARCH Orange/Red");
        set.counts.orangeRed = severe.value.events.length;
        if (severe.value.rows >= GDACS_PAGE) set.truncated = true;
      } else set.failed.push("SEARCH Orange/Red");
      if (recent.status === "fulfilled") {
        lists.push(recent.value.events);
        set.via.push("EVENTS4APP");
        set.counts.recent = recent.value.events.length;
        set.counts.recentRows = recent.value.rows;
      } else set.failed.push("EVENTS4APP");
      if (!lists.length) throw new Error("GDACS: RSS, EVENTS4APP and SEARCH all failed");
      // Without the RSS feed, only a latest-100 list that came back short is known to hold everything.
      if (rss.status !== "fulfilled" && !(recent.status === "fulfilled" && recent.value.rows < GDACS_PAGE)) set.truncated = true;
      set.events = mergeGdacs(lists);
      return set;
    },
    SOURCE,
  );
}

// ---------------------------------------------------------------- EONET

export const EONET_VOLCANOES_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes";

export function eonetVolcanoes() {
  return cached(
    "eonet:volcanoes",
    30 * MIN,
    async () => {
      const j = await retrying(
        () =>
          polite("eonet", 500, 60_000, () =>
            upstreamJson<{ events?: EonetEvent[] }>("eonet", EONET_VOLCANOES_URL, { timeoutMs: 18_000 }),
          ),
        2,
      );
      return j.events ?? [];
    },
    SOURCE,
  );
}

// ---------------------------------------------------------------- USGS (GDACS quake marking only)

export const USGS_DAY_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

/**
 * The USGS all_day feed as the Earthquakes layer's route (/api/earthquakes)
 * holds it: same cache key, same URL, same payload, so a GDACS quake marked
 * "also in USGS" is one that layer draws.
 */
export async function usgsDay() {
  const r = await cached(
    "usgs:all_day",
    60_000,
    () =>
      retrying(
        () =>
          upstreamJson<{ features?: Array<{ properties: { time: number }; geometry: { coordinates: [number, number, number] } | null }> }>(
            "usgs",
            USGS_DAY_URL,
            { timeoutMs: 15_000 },
          ),
        2,
      ),
    SOURCE,
  );
  const quakes = (r.value.features ?? []).filter((f) => f.geometry).map((f) => ({ lon: f.geometry!.coordinates[0], lat: f.geometry!.coordinates[1], t: f.properties.time }));
  return { quakes, age: r.age };
}
