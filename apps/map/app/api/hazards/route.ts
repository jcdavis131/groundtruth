// Hazards API: live wildfires, satellite fire detections and hazard alerts,
// every upstream keyless. CORS open and edge-cached like /api/water, with the
// shared envelope (lib/server/respond.ts): `data`, `provenance`,
// `generatedAt`, `caveats`, and the route's own counts beside them.
//
//   /api/hazards?op=wildfire              NIFC WFIGS current perimeters (containment,
//                                         perimeter capture time) and incident points for
//                                         fires with no perimeter yet. US only.
//   /api/hazards?op=fires&bbox=w,s,e,n    NASA FIRMS hotspots of the last 24 h (VIIRS
//                                         S-NPP, VIIRS NOAA-20, MODIS) inside the box,
//                                         binned to at most `max` rows (default 5000)
//                                         keeping the brightest detection per cell.
//   /api/hazards?op=alerts                NWS active alerts (polygon, or the counties the
//                                         alert lists), current GDACS events (quakes the
//                                         USGS 24 h feed also has carry alsoInUsgs; none
//                                         is dropped) and NASA EONET open volcano events.
//                                         Severities as published. NWS alerts the live
//                                         feed behind Live warnings outlined carry
//                                         liveOutlined (none is dropped either).
//   /api/hazards?op=nri&bbox=w,s,e,n[&level=county|tract]
//                                         FEMA National Risk Index (December 2025): composite
//                                         risk, expected annual loss, social vulnerability,
//                                         community resilience and the 18 hazard ratings, as
//                                         FEMA publishes them. level=county (box at most 18
//                                         degrees, snapped to 1, as op=areas): attribute rows only, joined
//                                         by FIPS onto the county outlines the globe draws;
//                                         level=tract (box at most 0.4 degrees, snapped to
//                                         0.05): NRI's tract polygons, paged by 2,000. Held a
//                                         week; answers or fails within 45 s.
//   /api/hazards?op=nri&fips=48453        One county (5 digits) or tract (11 digits) by FIPS,
//                                         the same named fields, no geometry; 404 "not in the
//                                         index" when FEMA has no row. For a click answer and
//                                         the MCP social_vulnerability pairing. Held a week.
//   /api/hazards?op=wrc&level=county      USDA Forest Service Wildfire Risk to Communities
//                                         (2nd edition, 2024; CC0): every county's national
//                                         and state ranks (risk, burn probability, hazard
//                                         potential, exposure-adjusted risk to homes, by the
//                                         service's aliases), exposure shares and building
//                                         counts, attributes only, two pages of 2,000, held a
//                                         week. Percent strings parsed to 0-100; blank is null.
//   /api/hazards?op=wrc&level=place&bbox=w,s,e,n
//                                         WRC's community (Census place) polygons in a box of
//                                         at most 1 degree (snapped to 0.05), at most 1,000,
//                                         rank strings as published, held a week per box.
//   /api/hazards?op=wrc&level=fips&fips=08013 (or a 7-digit place GEOID)
//                                         One county or community, attributes only; 404 "not
//                                         in this release" when WRC has no row.
//   /api/hazards?op=history&fips=48453[&years=1..131][&declarations=0..1000]
//   /api/hazards?op=history&lon=-97.74&lat=30.27   (the county containing the point, TIGERweb 1:20M)
//                                         County hazard history: FEMA OpenFEMA declarations
//                                         per year by type (DR, EM, FM) and the list; USDM's
//                                         weekly DSCI since 2000 and this week's D0-D4 shares;
//                                         NOAA Climate at a Glance annual temperature and
//                                         precipitation since 1895; SPC tornadoes per year since
//                                         1950 and USGS landslide susceptibility (both baked,
//                                         lib/hazards/data). One upstream failing is a caveat,
//                                         not a 500. Connecticut's planning regions get drought
//                                         only (the others publish legacy counties). part=landslide
//                                         answers the baked landslide row alone, with no upstream.
//                                         NCEI Storm Events reports per year by type since 1996
//                                         (county-coded rows, tornadoes left to SPC; one baked
//                                         state shard, lazily loaded); part=storms answers that alone.
//
// FIRMS confidence stays on each instrument's own scale: VIIRS low / nominal /
// high, MODIS 0–100 %. Nothing here merges or rescales them.
//
// The alerts op waits at most SOURCE_DEADLINE_MS on each source and answers
// with the ones that made it; a slow GDACS never costs the NWS warnings.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, notFound, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4 } from "@/lib/server/net";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import {
  buildEonetVolcanoes,
  buildGdacs,
  buildNwsAlerts,
  buildWildfire,
  flagQuakesInUsgs,
  FIRE_ROW_COLUMNS,
  markLiveOutlined,
  selectFires,
} from "@/lib/hazards/features";
import { ALERTS_URL as LIVE_ALERTS_URL, liveFeed } from "@/lib/live/fetch";
import { liveDrawnIds } from "@/lib/live/live";
import {
  countiesByGeoid,
  EONET_VOLCANOES_URL,
  eonetVolcanoes,
  firms,
  FIRMS_FILES,
  GDACS_RSS_URL,
  gdacs,
  NWS_ALERTS_URL,
  nwsAlerts,
  SOURCE_DEADLINE_MS,
  TIGER_COUNTY_20M,
  USGS_DAY_URL,
  usgsDay,
  WFIGS_INCIDENTS_URL,
  WFIGS_PERIMETERS_URL,
  wfigs,
} from "@/lib/hazards/sources";
import type { LayerFeature } from "@/lib/layers/types";
import { arcgisQuery, arcgisRowsCapped, envelope, truncated } from "@/lib/server/arcgis";
import { parseBbox as gridBbox, type Bbox as GridBbox } from "@/lib/civic/bbox";
import { snapBbox as countyBox } from "@/lib/economy/assemble";
import {
  packWrcRow,
  WRC_ALIAS_NOTE,
  WRC_ATTRIBUTION,
  WRC_BREAKS,
  WRC_CAVEAT,
  WRC_COUNTY_FIELDS,
  WRC_COUNTY_LAYER,
  WRC_COUNTY_PAGES,
  WRC_EXPOSURE,
  WRC_FIPS_COUNTY_FIELDS,
  WRC_PAGE,
  WRC_PLACE_BOX_DEG,
  WRC_PLACE_CAP,
  WRC_PLACE_FIELDS,
  WRC_PLACE_LAYER,
  WRC_RANKS,
  wrcRow,
  type WrcRow,
} from "@/lib/hazards/wrc";
import { countyGeoidAt } from "@/lib/hazards/sources";
import { polite, UpstreamError, upstreamJson } from "@/lib/server/upstream";
import { countyByFips } from "@/lib/places/registry";
import type { LandslideBake, SpcBake } from "@/lib/hazards/bake";
import spcBakeJson from "@/lib/hazards/data/spc-tornado-county.json";
import landslideBakeJson from "@/lib/hazards/data/landslide-county.json";
import stormMetaJson from "@/lib/hazards/data/storm-events/meta.json";
import type { StormMeta } from "@/lib/hazards/stormBake";
import { loadStormShard, STORM_LOADERS } from "@/lib/hazards/stormShards";
import {
  assembleHistory,
  assembleStorms,
  BAKED_ON,
  BOUNDARY_CHANGED_SINCE_2010,
  cagUrl,
  CT_HISTORY_LINE,
  CT_REGION,
  FEMA_MAX,
  femaUrl,
  landslideLine,
  parseCag,
  parseDroughtNow,
  parseDsci,
  parseFema,
  skips,
  usdmCategoryUrl,
  usdmDsciUrl,
  type CagElement,
  type MissingReason,
  type Part,
} from "@/lib/hazards/history";
import { NRI_CAVEATS, NRI_CITATION, NRI_COUNTIES, NRI_COUNTY_FIELDS, NRI_MAX_PAGES, NRI_PAGE, NRI_SOVI_NOTE, NRI_TERMS, NRI_TRACT_BOX_DEG, NRI_TRACT_FIELDS, NRI_TRACTS } from "@/lib/hazards/nri";

export const maxDuration = 60;
export const OPTIONS = options;

// earthquake.usgs.gov (the GDACS quake marking) reset over IPv6 in probing (lib/server/net.ts).
preferIpv4();

type Bbox = [number, number, number, number];

/** Snap outward to a one-degree grid so nearby callers share a cache entry. */
function parseBbox(raw: string | null): Bbox | null {
  const v = (raw ?? "").split(",").map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  const [w, s, e, n] = v;
  if (w >= e || s >= n) return null;
  return [Math.max(-180, Math.floor(w)), Math.max(-90, Math.floor(s)), Math.min(180, Math.ceil(e)), Math.min(90, Math.ceil(n))];
}

/** When a value `ageMs` old at `now` was fetched. */
const fetchedAt = (ageMs: number, now = Date.now()) => new Date(now - ageMs).toISOString();

/** "Fri, 26 Sep 2026 06:12:00 GMT" (a Last-Modified header) as ISO, or undefined when it does not parse. */
function httpDate(s: string | undefined): string | undefined {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const NOT_A_WARNING_SERVICE =
  "These layers relay what their publishers post, minutes to hours late; they are not a warning service. Follow official channels and local authorities in an emergency.";

interface OpResult {
  data: unknown;
  meta: Record<string, unknown>;
  ttlS: number;
  provenance: Provenance[];
  caveats?: string[];
}

async function opWildfire(): Promise<OpResult> {
  const r = await wfigs();
  const built = buildWildfire(r.value.perims, r.value.incidents);
  const retrievedAt = fetchedAt(r.age);
  const caveats = [
    "NIFC: these data are not legal documents; no warranty of accuracy, reliability or completeness.",
    "The current services keep a fire until it is declared contained, controlled or out, so a 100 %-contained fire can still be listed.",
    "A perimeter's age is its capture time (poly_PolygonDateTime); where WFIGS publishes none the perimeter says so rather than borrowing the record's edit time.",
    NOT_A_WARNING_SERVICE,
  ];
  if (r.value.truncated) caveats.push("WFIGS hit its record limit; some fires may be missing.");
  return {
    data: { type: "FeatureCollection", features: built.features },
    meta: {
      source: "NIFC WFIGS (Current Interagency Fire Perimeters, Current Wildland Fire Incident Locations)",
      perimeters: built.perimeters,
      pointsWithoutPerimeter: built.points,
      truncated: r.value.truncated,
      cacheAge: r.age,
    },
    ttlS: 300,
    provenance: [
      provenance(source("nifc-wfigs"), { kind: "snapshot", seriesId: "WFIGS_Interagency_Perimeters_Current", upstreamUrl: WFIGS_PERIMETERS_URL, retrievedAt }),
      provenance(source("nifc-wfigs"), { kind: "snapshot", seriesId: "WFIGS_Incident_Locations_Current", upstreamUrl: WFIGS_INCIDENTS_URL, retrievedAt }),
    ],
    caveats,
  };
}

async function opFires(bbox: Bbox, max: number): Promise<OpResult> {
  const set = await firms();
  // Keyed on the files present, so a selection made while one file was late is not served once it lands.
  const r = await cached(`firms:sel:${set.files}:${bbox.join(",")}:${max}`, 10 * 60_000, async () => selectFires(set.tables, bbox, max));
  const retrievedAt = fetchedAt(set.age);
  const binned = r.value.cellDeg != null;
  const caveats = [
    "A hotspot is a hot pixel seen from orbit, not a confirmed fire: gas flares, volcanoes and hot industrial roofs appear too.",
    "Confidence is on each instrument's own scale (VIIRS low / nominal / high, MODIS 0-100 %); the two are never merged or rescaled.",
    NOT_A_WARNING_SERVICE,
  ];
  if (binned) caveats.push(`More than ${max} detections in the box: binned to cells of ${r.value.cellDeg!.toFixed(4)}°, each row the brightest detection (max FRP) with the count it stands for in \`detections\`.`);
  for (const f of set.failed) caveats.push(`${f} did not answer in time; its detections are missing, not absent.`);
  return {
    data: r.value.rows,
    meta: {
      source: "NASA FIRMS (VIIRS S-NPP, VIIRS NOAA-20, MODIS), last 24 h",
      columns: FIRE_ROW_COLUMNS,
      confidence: "VIIRS: low | nominal | high. MODIS: 0-100 %. Separate scales, never merged.",
      files: set.tables.map((t) => ({ product: t.product, detections: t.n, version: t.version })),
      failed: set.failed,
      lastModified: set.lastModified,
      bbox,
      total: r.value.total,
      returned: r.value.rows.length,
      cellDeg: r.value.cellDeg,
      cacheAge: set.age,
    },
    ttlS: set.failed.length ? 120 : 600,
    provenance: FIRMS_FILES.filter((f) => set.files.split(",").includes(f.id)).map((f) =>
      provenance(source("nasa-firms"), {
        kind: "snapshot",
        seriesId: f.product,
        upstreamUrl: f.url,
        releasedAt: httpDate(set.lastModified[f.id]),
        retrievedAt,
        notes: ["global 24 h near-real-time file, cut to the box here"],
      }),
    ),
    caveats,
  };
}

interface AlertsCounts {
  nws?: {
    alerts: number;
    drawnAsPolygon: number;
    drawnAsCounties: number;
    notDrawn: number;
    cacheAge: number;
    /** Whether the live feed Live warnings draws answered with its NWS alerts in time to mark them. */
    liveChecked?: boolean;
    /** Alerts marked liveOutlined. */
    liveOutlined?: number;
    /** Age of the live feed answer used for the marks, ms; null when it was not checked. */
    liveCacheAge?: number | null;
  };
  gdacs?: { events: number; quakesAlsoInUsgs: number; usgsChecked: boolean; via: string[]; failed: string[]; lists: Record<string, number | undefined>; truncated: boolean; cacheAge: number };
  eonet?: { volcanoes: number; cacheAge: number };
}

async function opAlerts(): Promise<OpResult> {
  // The feed Live warnings draws (/api/live), through the same cache entry and
  // TTL, read alongside the sources: it marks which NWS alerts that layer
  // outlines. Bounded like a source; late or failed, nothing is marked, so the
  // layer leaves nothing to Live warnings.
  const liveP = liveFeed({ deadlineMs: SOURCE_DEADLINE_MS }).catch(() => null);
  const r = await cached("hazards:alerts", 2 * 60_000, async () => {
    // Each source answers within SOURCE_DEADLINE_MS or is reported in `failed` (see lib/hazards/sources.ts).
    const [nws, gd, eo, usgs] = await Promise.allSettled([nwsAlerts(), gdacs(), eonetVolcanoes(), usgsDay()]);
    const features: LayerFeature[] = [];
    const failed: string[] = [];
    const counts: AlertsCounts = {};
    let usgsAge: number | null = null;
    if (nws.status === "fulfilled") {
      const alerts = nws.value.value;
      const needed = alerts.filter((a) => !a.geometry).flatMap((a) => a.counties);
      const counties = await countiesByGeoid(needed).catch(() => new Map());
      const built = buildNwsAlerts(alerts, counties);
      features.push(...built.features);
      counts.nws = { alerts: alerts.length, drawnAsPolygon: built.drawnPolygon, drawnAsCounties: built.drawnCounties, notDrawn: built.undrawn, cacheAge: nws.value.age };
    } else failed.push("NWS");
    let truncated = false;
    if (gd.status === "fulfilled") {
      const g = gd.value.value;
      let events = g.events;
      let alsoInUsgs = 0;
      if (usgs.status === "fulfilled") {
        ({ events, flagged: alsoInUsgs } = flagQuakesInUsgs(g.events, usgs.value.quakes));
        usgsAge = usgs.value.age;
      }
      features.push(...buildGdacs(events));
      truncated = g.truncated;
      counts.gdacs = {
        events: events.length,
        quakesAlsoInUsgs: alsoInUsgs,
        usgsChecked: usgs.status === "fulfilled",
        via: g.via,
        failed: g.failed,
        lists: g.counts,
        truncated: g.truncated,
        cacheAge: gd.value.age,
      };
    } else failed.push("GDACS");
    if (eo.status === "fulfilled") {
      const v = buildEonetVolcanoes(eo.value.value);
      features.push(...v);
      counts.eonet = { volcanoes: v.length, cacheAge: eo.value.age };
    } else failed.push("EONET");
    if (!features.length && failed.length === 3) throw new Error("NWS, GDACS and EONET all failed");
    return { features, counts, failed, truncated, usgsAge };
  });
  const v = r.value;
  const live = await liveP;
  const outlined = live ? liveDrawnIds(live.value) : null;
  // Marked per request on copies: the cached features are never mutated, and the marks follow the live feed's own refreshes.
  const marked = markLiveOutlined(v.features, outlined);
  const counts: AlertsCounts = v.counts.nws
    ? { ...v.counts, nws: { ...v.counts.nws, liveChecked: outlined != null, liveOutlined: marked.marked, liveCacheAge: outlined != null && live ? live.age : null } }
    : v.counts;
  // Each source's own age when the answer was assembled, plus the answer's age now.
  const now = Date.now();
  const at = (sourceAge: number) => fetchedAt(r.age + sourceAge, now);
  const prov: Provenance[] = [];
  if (v.counts.nws) {
    prov.push(provenance(source("nws-api"), { kind: "snapshot", upstreamUrl: NWS_ALERTS_URL, retrievedAt: at(v.counts.nws.cacheAge) }));
    if (v.counts.nws.drawnAsCounties) {
      prov.push(
        provenance(source("census-tigerweb"), {
          kind: "published",
          seriesId: "Generalized_ACS2023 State_County layer 13 (1:20M counties)",
          upstreamUrl: TIGER_COUNTY_20M,
          retrievedAt: at(v.counts.nws.cacheAge),
          notes: ["county outlines for NWS alerts that carry no polygon, by the SAME codes they list"],
        }),
      );
    }
  }
  if (v.counts.gdacs) {
    const g = v.counts.gdacs;
    // The RSS feed is the list of record; without it the citation falls back to GDACS's landing page.
    prov.push(provenance(source("gdacs"), { kind: "snapshot", upstreamUrl: g.via.includes("RSS") ? GDACS_RSS_URL : undefined, retrievedAt: at(g.cacheAge), notes: [`lists that answered: ${g.via.join(", ")}`] }));
  }
  if (v.counts.eonet) prov.push(provenance(source("nasa-eonet"), { kind: "snapshot", upstreamUrl: EONET_VOLCANOES_URL, retrievedAt: at(v.counts.eonet.cacheAge) }));
  if (v.counts.nws && outlined != null && live) {
    prov.push(
      provenance(source("nws-api"), {
        kind: "snapshot",
        upstreamUrl: LIVE_ALERTS_URL,
        retrievedAt: fetchedAt(live.age, now),
        notes: ["the Severe and Extreme feed Live warnings draws (/api/live); used only to mark the alerts that layer outlines (liveOutlined)"],
      }),
    );
  }
  if (v.usgsAge != null) {
    prov.push(provenance(source("usgs-earthquakes"), { kind: "snapshot", upstreamUrl: USGS_DAY_URL, retrievedAt: at(v.usgsAge), notes: ["used only to mark GDACS quakes the Earthquakes layer also draws"] }));
  }
  const caveats = [
    "Severities are each publisher's own: NWS severity, GDACS alert level (an estimate of humanitarian impact). Anything unrated says \"not rated by source\".",
    "An NWS alert drawn as counties covers every county it lists; NWS issued it for forecast zones inside them. Alerts with neither a polygon nor a known county are counted in counts.nws.notDrawn, not drawn.",
    NOT_A_WARNING_SERVICE,
  ];
  if (v.counts.nws) {
    caveats.push(
      outlined != null
        ? "liveOutlined marks an NWS alert the Live warnings feed (/api/live) outlined; the Hazard alerts layer leaves only those to Live warnings, and only while that layer is on and drawing them. Nothing is dropped here."
        : "The Live warnings feed did not answer in time or its NWS request failed, so no alert is marked liveOutlined and the Hazard alerts layer leaves none to it.",
    );
  }
  for (const f of v.failed) caveats.push(`${f} did not answer within ${SOURCE_DEADLINE_MS / 1000} s; its events are missing, not absent.`);
  if (v.truncated) caveats.push("GDACS's lists may be incomplete this time (the RSS feed, the only uncapped list, did not answer, or a capped list came back full).");
  return {
    data: { type: "FeatureCollection", features: marked.features },
    meta: {
      source: "NWS alerts/active + GDACS (RSS, EVENTS4APP, SEARCH) + NASA EONET (volcanoes)",
      counts,
      failed: v.failed,
      truncated: v.truncated,
      deadlineS: SOURCE_DEADLINE_MS / 1000,
      trimmed: true,
      cacheAge: r.age,
    },
    ttlS: v.failed.length ? 60 : 120,
    provenance: prov,
    caveats,
  };
}

const WEEK_MS = 7 * 24 * 3600_000;
const NRI_GATE = { gate: "fema-nri", minIntervalMs: 250, timeoutMs: 25_000, tries: 2 };
/** Two pages at two tries of 25 s each would outlast the function's 60 s; the answer lands in the cache regardless. */
const NRI_DEADLINE_MS = 45_000;

/**
 * FEMA NRI for a box. Counties: attribute rows only (the browser joins them by FIPS onto the
 * county outlines it already draws), one page and a second when the first is cut at 2,000.
 * Tracts: NRI's own polygons, paged by 2,000 up to NRI_MAX_PAGES; a box still cut there says so.
 */
async function opNri(b: GridBbox, level: "county" | "tract"): Promise<OpResult> {
  const layer = level === "county" ? NRI_COUNTIES : NRI_TRACTS;
  const r = await cached(`nri:${level}:${b.join(",")}`, WEEK_MS, async () => {
    const rows: Array<Record<string, unknown>> = [];
    const features: Array<{ type: "Feature"; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> = [];
    let cut = false;
    for (let page = 0; page < (level === "county" ? 2 : NRI_MAX_PAGES); page++) {
      const base = {
        where: "1=1",
        ...envelope(b),
        orderByFields: level === "county" ? "STCOFIPS" : "TRACTFIPS",
        resultRecordCount: String(NRI_PAGE),
        resultOffset: String(page * NRI_PAGE),
      };
      if (level === "county") {
        const j = await arcgisRowsCapped<Record<string, unknown>>("fema-nri", layer, { ...base, outFields: NRI_COUNTY_FIELDS.join(","), returnGeometry: "false" }, NRI_GATE);
        rows.push(...j.rows);
        cut = j.exceeded;
      } else {
        const fc = await arcgisQuery("fema-nri", layer, { ...base, outFields: NRI_TRACT_FIELDS.join(","), returnGeometry: "true", geometryPrecision: "5", maxAllowableOffset: "0.0005" }, NRI_GATE);
        for (const f of fc.features) features.push({ type: "Feature", geometry: f.geometry, properties: f.properties as Record<string, unknown> });
        cut = truncated(fc);
      }
      if (!cut) break;
    }
    return { rows, features, cut };
  }, { deadlineMs: NRI_DEADLINE_MS });
  const caveats = [...NRI_CAVEATS, NRI_SOVI_NOTE, NRI_TERMS, NRI_CITATION];
  caveats.push("Ratings are FEMA's words, verbatim. 'Not Applicable', 'Insufficient Data', 'No Rating' and 'Data Unavailable' are not a class and never mean low.");
  if (level === "county") caveats.push("Counties come as attribute rows only: join them by STCOFIPS onto your own county outlines (the globe uses Census TIGERweb's current counties, which share NRI's Connecticut planning regions, 09110-09190).");
  if (r.value.cut) caveats.push(`FEMA's answer for this box was still cut at ${(level === "county" ? 2 : NRI_MAX_PAGES) * NRI_PAGE} records: ask a smaller box for every ${level}.`);
  const retrievedAt = new Date(Date.now() - r.age).toISOString();
  return {
    data: level === "county" ? { level, rows: r.value.rows } : { type: "FeatureCollection", features: r.value.features },
    meta: { source: "FEMA National Risk Index (December 2025)", level, bbox: b, count: level === "county" ? r.value.rows.length : r.value.features.length, capped: r.value.cut, cacheAge: r.age },
    ttlS: 86_400,
    provenance: [
      provenance(source("fema-nri"), {
        kind: "published",
        seriesId: `${level === "county" ? "National_Risk_Index_Counties" : "National_Risk_Index_Census_Tracts"} FeatureServer layer 0, ${level === "county" ? "attributes" : "polygons simplified to 0.0005 degrees"}`,
        upstreamUrl: layer,
        retrievedAt,
        notes: [`bbox ${b.join(",")}`],
      }),
    ],
    caveats,
  };
}

/**
 * One NRI row by FIPS: the county layer by STCOFIPS (5 digits) or the tract layer by TRACTFIPS
 * (11 digits), attributes only. Null when FEMA publishes no row (the route answers 404).
 */
async function opNriFips(fips: string): Promise<OpResult | null> {
  const county = fips.length === 5;
  const layer = county ? NRI_COUNTIES : NRI_TRACTS;
  const r = await cached(
    `nri:fips:${fips}`,
    WEEK_MS,
    async () => {
      const j = await arcgisRowsCapped<Record<string, unknown>>(
        "fema-nri",
        layer,
        { where: `${county ? "STCOFIPS" : "TRACTFIPS"}='${fips}'`, outFields: (county ? NRI_COUNTY_FIELDS : NRI_TRACT_FIELDS).join(","), returnGeometry: "false" },
        NRI_GATE,
      );
      return { row: j.rows[0] ?? null };
    },
    { deadlineMs: 30_000 },
  );
  if (!r.value.row) return null;
  return {
    data: { level: county ? "county" : "tract", fips, row: r.value.row },
    meta: { source: "FEMA National Risk Index (December 2025)", level: county ? "county" : "tract", cacheAge: r.age },
    ttlS: 86_400,
    provenance: [
      provenance(source("fema-nri"), {
        kind: "published",
        seriesId: `${county ? "National_Risk_Index_Counties" : "National_Risk_Index_Census_Tracts"} FeatureServer layer 0, ${county ? "STCOFIPS" : "TRACTFIPS"}='${fips}', attributes`,
        upstreamUrl: layer,
        retrievedAt: new Date(Date.now() - r.age).toISOString(),
      }),
    ],
    caveats: [...NRI_CAVEATS, NRI_SOVI_NOTE, NRI_TERMS, NRI_CITATION, "Ratings are FEMA's words, verbatim. 'Not Applicable', 'Insufficient Data', 'No Rating' and 'Data Unavailable' are not a class and never mean low."],
  };
}

// ---------------------------------------------------------------- wrc (USFS Wildfire Risk to Communities, ranks)

const WRC_GATE = { gate: "usfs-wrc", minIntervalMs: 500, timeoutMs: 25_000, tries: 2 };
const WRC_HELP = "op=wrc needs level=county, level=place&bbox=w,s,e,n (at most 1 degree a side), or level=fips&fips=<5-digit county or 7-digit place GEOID>";
const WRC_CAVEATS = [WRC_CAVEAT, WRC_ALIAS_NOTE];

const wrcProv = (layer: string, seriesId: string, age: number, notes?: string[]) =>
  provenance(source("usfs-wrc"), { kind: "published", seriesId, upstreamUrl: layer, period: "WRC 2nd edition (2024); boundaries May 2025 (TIGER 2023)", retrievedAt: fetchedAt(age), notes });

/** Every county's ranks, attributes only, as compact rows; the browser joins them by FIPS. */
async function opWrcCounty(): Promise<OpResult> {
  const r = await cached(
    "wrc:county",
    WEEK_MS,
    async () => {
      const rows: WrcRow[] = [];
      let cut = false;
      for (let page = 0; page < WRC_COUNTY_PAGES; page++) {
        const j = await arcgisRowsCapped<Record<string, unknown>>(
          "usfs-wrc",
          WRC_COUNTY_LAYER,
          { where: "1=1", outFields: WRC_COUNTY_FIELDS.join(","), returnGeometry: "false", orderByFields: "GEOID", resultRecordCount: String(WRC_PAGE), resultOffset: String(page * WRC_PAGE) },
          WRC_GATE,
        );
        for (const a of j.rows) {
          const row = wrcRow(a);
          if (row) rows.push(row);
        }
        cut = j.exceeded;
        if (!cut) break;
      }
      return { rows, cut };
    },
    { deadlineMs: 45_000 },
  );
  const notRanked = r.value.rows.filter((x) => x.national[0] == null).map((x) => x.geoid);
  const caveats = [
    ...WRC_CAVEATS,
    "Counties come as attribute rows only: join them by `geoid` onto your own county outlines (Connecticut in planning regions 09110-09190, as WRC publishes it). Ranks are percent strings in the source ('97.20%'); here they are numbers 0-100, and the published strings are in `raw`. A blank rank is null, not 0.",
  ];
  if (notRanked.length) caveats.push(`Not ranked by USFS: ${notRanked.join(", ")} (every rank blank in the source; DC is ranked only as a state).`);
  if (r.value.cut) caveats.push(`The answer was still cut at ${WRC_COUNTY_PAGES * WRC_PAGE} counties: some counties are missing from this answer, not unranked.`);
  return {
    data: { level: "county", measures: WRC_RANKS.map((k) => k.alias), rows: r.value.rows.map(packWrcRow) },
    meta: { source: WRC_ATTRIBUTION, level: "county", count: r.value.rows.length, notRanked: notRanked.length, breaks: [...WRC_BREAKS], capped: r.value.cut, cacheAge: r.age },
    ttlS: 86_400,
    provenance: [wrcProv(WRC_COUNTY_LAYER, "county_boundaries_conus_ak_hi FeatureServer layer 0 (WRC_County_Summary_Data), attributes", r.age)],
    caveats,
  };
}

/** WRC's own community polygons in a box, at most WRC_PLACE_CAP. */
async function opWrcPlace(b: GridBbox): Promise<OpResult> {
  const off = Math.max(0.001, Math.min(0.005, (b[2] - b[0]) / 1000));
  const r = await cached(
    `wrc:place:${b.join(",")}`,
    WEEK_MS,
    async () => {
      const fc = await arcgisQuery(
        "usfs-wrc",
        WRC_PLACE_LAYER,
        { where: "1=1", ...envelope(b), outFields: WRC_PLACE_FIELDS.join(","), returnGeometry: "true", outSR: "4326", maxAllowableOffset: String(off), geometryPrecision: "5", orderByFields: "GEOID", resultRecordCount: String(WRC_PLACE_CAP) },
        WRC_GATE,
      );
      return { features: fc.features.map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: f.properties as Record<string, unknown> })), cut: truncated(fc) || fc.features.length >= WRC_PLACE_CAP };
    },
    { deadlineMs: 30_000 },
  );
  const excluded = r.value.features.filter((f) => f.properties.exclude === 1).length;
  const caveats = [
    ...WRC_CAVEATS,
    `WRC's own community (Census place) polygons, simplified to ${off} degrees, with the rank strings as published. A community USFS excludes (exclude = 1, reason in exclude_re: no people, no buildings, or DC as a state) has blank ranks: not ranked, never low.`,
  ];
  if (r.value.cut) caveats.push(`The answer for this box was cut at ${WRC_PLACE_CAP} communities: ask a smaller box for every community.`);
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: { source: WRC_ATTRIBUTION, level: "place", bbox: b, count: r.value.features.length, excluded, capped: r.value.cut, breaks: [...WRC_BREAKS], cacheAge: r.age },
    ttlS: 86_400,
    provenance: [wrcProv(WRC_PLACE_LAYER, `place_boundaries_conus_ak_hi FeatureServer layer 0 (WRC_Community_Summary_Data), polygons simplified to ${off} degrees`, r.age, [`bbox ${b.join(",")}`])],
    caveats,
  };
}

/** One county (5 digits) or community (7 digits) by GEOID, attributes only; null when WRC has no row. */
async function opWrcFips(fips: string): Promise<OpResult | null> {
  const county = fips.length === 5;
  const layer = county ? WRC_COUNTY_LAYER : WRC_PLACE_LAYER;
  const r = await cached(
    `wrc:fips:${fips}`,
    WEEK_MS,
    async () => {
      const j = await arcgisRowsCapped<Record<string, unknown>>("usfs-wrc", layer, { where: `GEOID='${fips}'`, outFields: (county ? WRC_FIPS_COUNTY_FIELDS : WRC_PLACE_FIELDS).join(","), returnGeometry: "false" }, WRC_GATE);
      return { row: j.rows.map((a) => wrcRow(a)).find((x) => x != null) ?? null };
    },
    { deadlineMs: 30_000 },
  );
  const row = r.value.row;
  if (!row) return null;
  return {
    data: {
      level: county ? "county" : "place",
      fips,
      name: row.name,
      state: row.state,
      ranks: WRC_RANKS.map((k, i) => ({ measure: k.alias, national: row.national[i], state: row.stateRank[i], publishedNational: row.raw[k.national] ?? null, publishedState: row.raw[k.state] ?? null })),
      exposure: WRC_EXPOSURE.map((e, i) => ({ measure: e.alias, percent: row.exposure[i], published: row.raw[e.field] ?? null })),
      buildings: row.buildings,
      housingUnits: row.housingUnits,
      excluded: row.excluded,
      excludeReason: row.excludeReason,
    },
    meta: { source: WRC_ATTRIBUTION, level: county ? "county" : "place", cacheAge: r.age },
    ttlS: 86_400,
    provenance: [wrcProv(layer, `${county ? "county" : "place"}_boundaries_conus_ak_hi FeatureServer layer 0, GEOID='${fips}', attributes`, r.age)],
    caveats: [...WRC_CAVEATS, "Ranks are numbers 0-100 parsed from the published percent strings (kept beside them); a blank rank is null, not ranked, never 0."],
  };
}

// ---------------------------------------------------------------- history (county hazard history)

const SPC_BAKE = spcBakeJson as unknown as SpcBake;
const LANDSLIDE_BAKE = landslideBakeJson as unknown as LandslideBake;
const STORM_META = stormMetaJson as unknown as StormMeta;
const DAY_MS = 24 * 3600_000;
/** One request every 300 ms to FEMA and to NCEI, 500 ms to USDM; a 429 or 503 closes the gate for ten minutes. */
const FEMA_GATE = { gate: "fema-openfema", minIntervalMs: 300 };
const USDM_GATE = { gate: "usdm", minIntervalMs: 500 };
const CAG_GATE = { gate: "noaa-cag", minIntervalMs: 300 };
const HISTORY_HELP =
  "op=history needs fips=<5-digit county FIPS> or lon=&lat= (exactly one); optional years=1..131 (the last N calendar years; default all), declarations=0..1000 (how many declarations to list; default 1000) and part=landslide | storms (the baked landslide row, or the baked NCEI Storm Events series, alone)";

function gatedJson(name: string, g: { gate: string; minIntervalMs: number }, url: string, timeoutMs = 20_000): Promise<unknown> {
  return polite(g.gate, g.minIntervalMs, 600_000, () => upstreamJson(name, url, { timeoutMs }), [429, 503]);
}

/** One upstream through the cache; a failure becomes an error part (a caveat), a 404 a not-in-release skip. */
async function part<T>(key: string, ttlMs: number, url: string, load: () => Promise<T>): Promise<Part<T>> {
  try {
    const r = await cached(key, ttlMs, load, { deadlineMs: 25_000, coolMs: 60_000 });
    return { value: r.value, retrievedAt: fetchedAt(r.age), url };
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return { skip: "source:not_in_release" };
    return { error: err instanceof Error ? err.message : String(err), url };
  }
}

const skipPart = <T,>(reason: MissingReason): Part<T> => ({ skip: reason });

/** The county's storm-events shard: no fetch, a lazy per-state import. Alaska has no shard (its rows are NCEI's own areas); a load failure is an error part, never zeros. */
async function stormsPart(fips: string): Promise<Part<{ meta: StormMeta; shard: Awaited<ReturnType<typeof loadStormShard>> }>> {
  const st = fips.slice(0, 2);
  if (CT_REGION.test(fips)) return { skip: "join:legacy_ct_counties" };
  if (st === "02") return { skip: "join:ncei_areas_not_counties" };
  try {
    return { value: { meta: STORM_META, shard: await loadStormShard(st, STORM_LOADERS) }, retrievedAt: `${BAKED_ON}T00:00:00.000Z`, url: STORM_META.dir };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), url: STORM_META.dir };
  }
}

type HistoryPart = "landslide" | "storms" | null;

async function opHistory(fips: string, years: number | null, declarationsCap: number, only: HistoryPart): Promise<OpResult> {
  const c = countyByFips(fips)!;
  if (only === "storms") {
    const now = Date.now();
    const st = assembleStorms({ fips, now, years, storms: await stormsPart(fips) }, { kind: "county", id: fips, name: `${c.name}, ${c.stusab}` });
    return {
      data: { fips, name: c.name, state: c.stusab, series: st.series, storms: st.storms, missing: st.missing },
      meta: { source: "NOAA NCEI Storm Events Database, county-coded rows 1996 onward, baked in lib/hazards/data/storm-events", part: "storms", years, zeroFill: st.storms?.zeroFill ?? null, asOf: { storms: st.asOf } },
      ttlS: 86_400,
      provenance: st.provenance,
      caveats: [...st.caveats, ...(CT_REGION.test(fips) ? [CT_HISTORY_LINE] : [])],
    };
  }
  if (only === "landslide") {
    const ls = landslideLine(LANDSLIDE_BAKE, fips);
    return {
      data: { fips, name: c.name, state: c.stusab, landslide: ls.line, missing: ls.reason ? [{ source: "USGS landslide susceptibility", reason: ls.reason, detail: BOUNDARY_CHANGED_SINCE_2010[fips] }] : [] },
      meta: { source: "USGS landslide susceptibility (2024), county table baked in lib/hazards/data", part: "landslide" },
      ttlS: 86_400,
      provenance: ls.line
        ? [provenance(source("usgs-landslide-susc"), { kind: "published", seriesId: "county_analysis.csv (2010 counties), keyed by FIPS (lib/hazards/data/landslide-county.json)", upstreamUrl: LANDSLIDE_BAKE.meta.url, period: "2024 release", retrievedAt: `${BAKED_ON}T00:00:00.000Z`, notes: ["CC0 1.0"] })]
        : [],
      caveats: [
        "USGS's 2024 slope-relief model: the share of the county's land that is susceptible terrain, not a forecast. Landslide counts are version 2 of USGS's inventory, whose mapping effort varies by state.",
        ...(CT_REGION.test(fips) ? [CT_HISTORY_LINE] : []),
      ],
    };
  }
  const now = Date.now();
  const sk = skips(fips, c.stusab);
  const year = new Date(now).getUTCFullYear();
  const cag = (el: CagElement) => {
    const url = cagUrl(c.stusab, fips, el, year);
    return sk.cag ? Promise.resolve(skipPart<ReturnType<typeof parseCag>>(sk.cag)) : part(`history:cag:${el}:${fips}`, WEEK_MS, url, async () => parseCag(await gatedJson("noaa-cag", CAG_GATE, url)));
  };
  const femaU = femaUrl(fips);
  const dsciU = usdmDsciUrl(fips, now);
  const catU = usdmCategoryUrl(fips, now);
  const [fema, dsci, droughtNow, tavg, pcp, storms] = await Promise.all([
    sk.fema ? Promise.resolve(skipPart<ReturnType<typeof parseFema>>(sk.fema)) : part(`history:fema:${fips}`, DAY_MS, femaU, async () => parseFema(await gatedJson("fema-openfema", FEMA_GATE, femaU))),
    part(`history:usdm:dsci:${fips}`, DAY_MS, dsciU, async () => parseDsci(await gatedJson("usdm", USDM_GATE, dsciU, 25_000))),
    part(`history:usdm:now:${fips}`, DAY_MS, catU, async () => parseDroughtNow(await gatedJson("usdm", USDM_GATE, catU))),
    cag("tavg"),
    cag("pcp"),
    stormsPart(fips),
  ]);
  const a = assembleHistory({ fips, name: c.name, stusab: c.stusab, now, years, declarationsCap, fema, dsci, droughtNow, tavg, pcp, spc: SPC_BAKE, landslide: LANDSLIDE_BAKE, storms });
  return {
    data: a.data,
    meta: { source: "FEMA OpenFEMA, U.S. Drought Monitor, NOAA NCEI Climate at a Glance, NOAA SPC, USGS, NOAA NCEI Storm Events", ...a.meta, count: a.data.series.length, declarationsListed: a.data.declarations.length },
    ttlS: 3600,
    provenance: a.provenance,
    caveats: a.caveats,
  };
}

function respond(r: OpResult) {
  return ok(r.data, { meta: r.meta, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "wildfire":
        return respond(await opWildfire());
      case "fires": {
        const b = parseBbox(q.get("bbox") ?? "-180,-90,180,90");
        if (!b) return badRequest("bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-125,32,-114,42");
        const max = Math.round(Math.min(8000, Math.max(500, Number(q.get("max") ?? 5000) || 5000)));
        return respond(await opFires(b, max));
      }
      case "alerts":
        return respond(await opAlerts());
      case "nri": {
        const fips = q.get("fips");
        if (fips != null) {
          if (!/^(\d{5}|\d{11})$/.test(fips)) return badRequest("fips=<5-digit county or 11-digit tract FIPS>, e.g. fips=48453");
          const r = await opNriFips(fips);
          return r ? respond(r) : notFound(`not in the index: FEMA's National Risk Index has no ${fips.length === 5 ? "county" : "tract"} row for FIPS ${fips}`);
        }
        const level = q.get("level") ?? "county";
        if (level !== "county" && level !== "tract") return badRequest("level=county | tract");
        // Counties: the box /api/economy?op=areas snaps the same bbox to (18 degrees, 1 degree grid), so a client
        // joining onto those outlines has a row asked for every outline it drew.
        const raw = gridBbox(q.get("bbox"), 360, 0.0001);
        const b = level === "county" ? (raw ? countyBox(raw) : null) : gridBbox(q.get("bbox"), NRI_TRACT_BOX_DEG, 0.05);
        if (!b) return badRequest("bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-99,29,-98,30");
        return respond(await opNri(b, level));
      }
      case "wrc": {
        const level = q.get("level") ?? "county";
        if (level === "county") return respond(await opWrcCounty());
        if (level === "place") {
          const b = gridBbox(q.get("bbox"), WRC_PLACE_BOX_DEG, 0.05);
          return b ? respond(await opWrcPlace(b)) : badRequest(WRC_HELP);
        }
        if (level === "fips") {
          const fips = q.get("fips") ?? "";
          if (!/^(\d{5}|\d{7})$/.test(fips)) return badRequest(WRC_HELP);
          const r = await opWrcFips(fips);
          return r ? respond(r) : notFound(`not in this release: USFS Wildfire Risk to Communities has no ${fips.length === 5 ? "county" : "community"} row for GEOID ${fips} (it covers the states and DC)`);
        }
        return badRequest(WRC_HELP);
      }
      case "history": {
        const fipsQ = q.get("fips");
        const lonQ = q.get("lon");
        const latQ = q.get("lat");
        const yearsQ = q.get("years");
        const declQ = q.get("declarations");
        const partQ = q.get("part");
        if ((fipsQ != null) === (lonQ != null || latQ != null)) return badRequest(HISTORY_HELP);
        if (partQ != null && partQ !== "landslide" && partQ !== "storms") return badRequest(HISTORY_HELP);
        const years = yearsQ == null ? null : Number(yearsQ);
        if (years != null && !(Number.isInteger(years) && years >= 1 && years <= 131)) return badRequest(HISTORY_HELP);
        const decl = declQ == null ? FEMA_MAX : Number(declQ);
        if (!(Number.isInteger(decl) && decl >= 0 && decl <= FEMA_MAX)) return badRequest(HISTORY_HELP);
        let fips = fipsQ ?? "";
        if (fipsQ == null) {
          const lon = Number(lonQ);
          const lat = Number(latQ);
          if (lonQ == null || latQ == null || !(Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) return badRequest(HISTORY_HELP);
          const g = await countyGeoidAt(lon, lat);
          if (!g) return notFound(`no county: TIGERweb places no county at ${lon}, ${lat}`);
          fips = g;
        }
        if (!/^\d{5}$/.test(fips)) return badRequest(HISTORY_HELP);
        if (!countyByFips(fips)) return notFound(`not a current county: ${fips} is not one of the 3,222 county equivalents in Census's 2023 geography (Connecticut in planning regions 09110-09190)`);
        return respond(await opHistory(fips, years, decl, partQ === "landslide" || partQ === "storms" ? partQ : null));
      }
      default:
        return badRequest(`unknown op: wildfire | fires | alerts | nri | wrc | history (FIRMS files: ${FIRMS_FILES.map((f) => f.id).join(", ")})`);
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
