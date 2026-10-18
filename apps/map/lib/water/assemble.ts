// The community water report for a point, assembled server-side.
//
// This was the private `opReport` body inside app/api/water/route.ts. It moved
// here unchanged so a page can render the same report the API answers with,
// without going through HTTP to its own route. The arithmetic is identical:
// same bbox snapping, same five upstreams, same call order into mergeFlood,
// same caveats. Only two things are added, both for the page: `retrievedAt`,
// so a section can say how old its numbers are, and a merged provenance list,
// so the page can cite what the ops knew (bbox, cache age) as well as what the
// report knew (which parameters were actually present).
//
// The five upstream fetchers live here too, because the report needs them and
// the route needs the report. The route keeps its own envelope, its CSV
// flatteners, its single-site history/matchup ops and its GET, and calls into
// these for everything else, so no response shape or TTL moves.
//
// Nothing here throws on an upstream failure. Each fetcher is caught to null
// and buildWaterReport still returns a report with `loaded` false on the dead
// sections and a caveat naming each one — a page with no egress renders
// "unavailable, here is why" per section rather than blank or a 500.
//
// The radii are discs around the point, not a boundary: REPORT_RADII_KM
// searches 150 km for reservoirs and 75 km for gauges and wells, and every
// ReportItem carries its own distanceKm. A caller that hands this a county
// centroid must say so in words.

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import type { Provenance } from "@/lib/provenance/types";
import { dedupeProvenance, iso } from "@/lib/provenance/collect";
import { bboxAround } from "@/lib/globe/geo";
import type { LayerFeature } from "@/lib/layers/types";
import { buildDrought, buildGauges, buildReservoirs, buildWells, intersectsTexas, mergeFlood, type NwpsRow, type TwdbRow } from "./features";
import { nwpsProvenance, twdbProvenance, usdmProvenance, usgsProvenance } from "./provenance";
import { buildWaterReport, type WaterReport } from "./report";

export const USGS = "https://api.waterdata.usgs.gov/ogcapi/v0/collections";
export const GAUGE_PARAMS = "00060,00065,00010,00300,00095,00400,63680,00062,00054";
export const WELL_PARAMS = "72019,62610,62611";
export const MAX_SPAN_DEG = 4;

export type Bbox = [number, number, number, number];

export interface UsgsRow {
  properties: {
    monitoring_location_id: string;
    parameter_code: string;
    statistic_id?: string;
    time: string;
    value: string | null;
    unit_of_measure: string;
    approval_status?: string;
    qualifier?: string | null;
  };
  geometry: { type: "Point"; coordinates: [number, number] } | null;
}

interface UsgsSite {
  properties: {
    id: string;
    monitoring_location_name?: string;
    site_type?: string;
    site_type_code?: string;
    county_name?: string;
    state_name?: string;
    altitude?: number | null;
    aquifer_code?: string | null;
    national_aquifer_code?: string | null;
    aquifer_type_code?: string | null;
    well_depth?: number | null;
    hole_depth?: number | null;
    drainage_area?: number | null;
  };
  geometry: { type: "Point"; coordinates: [number, number] } | null;
}

export interface UsgsCollection<T> {
  features: T[];
  numberReturned?: number;
}

export interface GaugeReading {
  site: string;
  name?: string;
  siteType?: string;
  lon: number;
  lat: number;
  param: string;
  value: number;
  unit: string;
  time: string;
  approval?: string;
}

export interface WellReading extends GaugeReading {
  aquifer?: string;
  aquiferCode?: string;
  localAquifer?: string;
  wellDepthFt?: number;
}

interface NwpsGauge {
  lid: string;
  name: string;
  latitude: number;
  longitude: number;
  state?: { abbreviation: string };
  status?: {
    observed?: {
      primary: number;
      primaryUnit: string;
      secondary: number;
      secondaryUnit: string;
      floodCategory: string;
      validTime: string;
    };
    forecast?: { primary: number; primaryUnit: string; floodCategory: string; validTime: string };
  };
}

interface TwdbReservoir {
  short_name: string;
  full_name: string;
  percent_full: number | null;
  conservation_capacity: number | null;
  conservation_storage: number | null;
  elevation: number | null;
  conservation_pool_elevation: number | null;
  gauge_location?: { coordinates: [number, number] } | null;
  timestamp?: string;
  tags?: string[];
}

/** Clamp to MAX_SPAN_DEG around the centre and snap outward to a 0.5 degree grid. */
export function snapBbox(v: Bbox): Bbox {
  let [w, s, e, n] = v;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - MAX_SPAN_DEG / 2);
  e = Math.min(e, cx + MAX_SPAN_DEG / 2);
  s = Math.max(s, cy - MAX_SPAN_DEG / 2);
  n = Math.min(n, cy + MAX_SPAN_DEG / 2);
  const f = (x: number) => Math.floor(x * 2) / 2;
  const c = (x: number) => Math.ceil(x * 2) / 2;
  return [f(w), f(s), c(e), c(n)];
}

export async function usgsItems<T>(collection: string, params: Record<string, string>): Promise<UsgsCollection<T>> {
  const qs = new URLSearchParams({ f: "json", limit: "5000", ...params });
  return polite("usgs-water", 400, 30_000, () =>
    upstreamJson<UsgsCollection<T>>("usgs-water", USGS + "/" + collection + "/items?" + qs.toString(), {
      timeoutMs: 40_000,
    }),
  );
}

async function sitesFor(bbox: string): Promise<Map<string, UsgsSite["properties"]>> {
  const r = await cached("usgs:sites:" + bbox, 6 * 3600_000, () => usgsItems<UsgsSite>("monitoring-locations", { bbox }));
  const m = new Map<string, UsgsSite["properties"]>();
  for (const s of r.value.features) m.set(s.properties.id, s.properties);
  return m;
}

function rows(features: UsgsRow[], sites: Map<string, UsgsSite["properties"]>): GaugeReading[] {
  const out: GaugeReading[] = [];
  for (const f of features) {
    const p = f.properties;
    if (!f.geometry || p.value == null) continue;
    const value = Number(p.value);
    if (!Number.isFinite(value)) continue;
    const site = sites.get(p.monitoring_location_id);
    out.push({
      site: p.monitoring_location_id,
      name: site?.monitoring_location_name,
      siteType: site?.site_type,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      param: p.parameter_code,
      value,
      unit: p.unit_of_measure,
      time: p.time,
      approval: p.approval_status,
    });
  }
  return out;
}

let aquiferNames: Promise<Map<string, string>> | null = null;
function aquiferLookup(): Promise<Map<string, string>> {
  if (!aquiferNames) {
    aquiferNames = usgsItems<{ properties: { id: string; national_aquifer_name: string } }>("national-aquifer-codes", {})
      .then((r) => new Map(r.features.map((f) => [f.properties.id, f.properties.national_aquifer_name])))
      .catch((err) => {
        aquiferNames = null;
        throw err;
      });
  }
  return aquiferNames;
}

/** When a cached value was fetched: now minus its age. */
export function retrievedAt(ageMs: number): string {
  return new Date(Date.now() - ageMs).toISOString();
}

/** Newest observation time in a set of readings, or undefined when empty. */
function newest(list: Array<{ time: string }>): string | undefined {
  let best: string | undefined;
  for (const r of list) if (!best || r.time > best) best = r.time;
  return best;
}

/** The approval flag readings carry ("Provisional" / "Approved"); "mixed" when both appear. */
function approvalOf(list: Array<{ approval?: string }>): string | undefined {
  const set = new Set(list.map((r) => r.approval).filter((a): a is string => !!a));
  return set.size === 0 ? undefined : set.size === 1 ? [...set][0] : "mixed: " + [...set].sort().join(", ");
}

/** One upstream's answer: the payload, the envelope meta the route publishes, its edge TTL and its provenance. */
export interface WaterOp<T> {
  data: T;
  meta: Record<string, unknown>;
  ttlS: number;
  provenance: Provenance[];
  /** Age of the cached value in ms, so a caller can date its own report. */
  age: number;
}

export async function opGauges(bbox: Bbox, param?: string | null): Promise<WaterOp<GaugeReading[]>> {
  const key = bbox.join(",");
  const params = param && /^[\d,]+$/.test(param) ? param : GAUGE_PARAMS;
  const r = await cached("usgs:gauges:" + key + ":" + params, 5 * 60_000, async () => {
    const [latest, sites] = await Promise.all([usgsItems<UsgsRow>("latest-continuous", { bbox: key, parameter_code: params }), sitesFor(key)]);
    return { readings: rows(latest.features, sites), returned: latest.numberReturned ?? latest.features.length };
  });
  return {
    data: r.value.readings,
    meta: { source: "usgs", bbox, cacheAge: r.age, returned: r.value.returned },
    ttlS: 300,
    age: r.age,
    provenance: [
      usgsProvenance({ collection: "latest-continuous", params: params.split(","), period: newest(r.value.readings), approval: approvalOf(r.value.readings), retrievedAt: retrievedAt(r.age), notes: [`bbox ${key}; site names from monitoring-locations`] }),
    ],
  };
}

export async function opWells(bbox: Bbox): Promise<WaterOp<WellReading[]>> {
  const key = bbox.join(",");
  const r = await cached("usgs:wells:" + key, 60 * 60_000, async () => {
    const [latest, sites, names] = await Promise.all([
      usgsItems<UsgsRow>("latest-daily", { bbox: key, parameter_code: WELL_PARAMS }),
      sitesFor(key),
      aquiferLookup().catch(() => new Map<string, string>()),
    ]);
    const base = rows(latest.features, sites);
    const readings: WellReading[] = base.map((g) => {
      const s = sites.get(g.site);
      const code = s?.national_aquifer_code ?? undefined;
      return {
        ...g,
        aquiferCode: code,
        aquifer: code ? names.get(code) : undefined,
        localAquifer: s?.aquifer_code ?? undefined,
        wellDepthFt: s?.well_depth ?? undefined,
      };
    });
    return { readings, returned: latest.numberReturned ?? latest.features.length };
  });
  return {
    data: r.value.readings,
    meta: { source: "usgs", bbox, cacheAge: r.age, returned: r.value.returned },
    ttlS: 1800,
    age: r.age,
    provenance: [
      usgsProvenance({ collection: "latest-daily", params: WELL_PARAMS.split(","), period: newest(r.value.readings), approval: approvalOf(r.value.readings), retrievedAt: retrievedAt(r.age), notes: [`bbox ${key}; aquifer names from national-aquifer-codes`] }),
    ],
  };
}

export async function opNwps(bbox: Bbox): Promise<WaterOp<NwpsRow[]>> {
  const [w, s, e, n] = bbox;
  const r = await cached("nwps:" + bbox.join(","), 5 * 60_000, async () => {
    const url = `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${w}&bbox.ymin=${s}&bbox.xmax=${e}&bbox.ymax=${n}&srid=EPSG_4326`;
    const json = await polite("nwps", 300, 30_000, () => upstreamJson<{ gauges?: NwpsGauge[] }>("nwps", url, { timeoutMs: 30_000 }));
    return (json.gauges ?? []).map((g) => ({
      lid: g.lid,
      name: g.name,
      lat: g.latitude,
      lon: g.longitude,
      state: g.state?.abbreviation,
      observed: g.status?.observed,
      forecast: g.status?.forecast,
    }));
  });
  const validTimes = r.value.map((g) => g.observed?.validTime).filter((t): t is string => !!t).sort();
  return {
    data: r.value,
    meta: { source: "nwps", bbox, cacheAge: r.age },
    ttlS: 300,
    age: r.age,
    provenance: [nwpsProvenance(retrievedAt(r.age), validTimes[validTimes.length - 1] ?? null)],
  };
}

export async function opTwdb(): Promise<WaterOp<TwdbRow[]>> {
  const r = await cached("twdb:reservoirs", 30 * 60_000, async () => {
    const json = await upstreamJson<TwdbReservoir[] | Record<string, TwdbReservoir>>(
      "twdb",
      "https://www.waterdatafortexas.org/reservoirs/recent-conditions.json",
      { timeoutMs: 30_000 },
    );
    const list = Array.isArray(json) ? json : Object.values(json);
    return list
      .filter((x) => x.gauge_location?.coordinates)
      .map((x) => ({
        id: x.short_name,
        name: x.full_name,
        lon: x.gauge_location!.coordinates[0],
        lat: x.gauge_location!.coordinates[1],
        percentFull: x.percent_full,
        capacityAcFt: x.conservation_capacity,
        storageAcFt: x.conservation_storage,
        elevationFt: x.elevation,
        poolElevationFt: x.conservation_pool_elevation,
        date: x.timestamp,
        tags: (x.tags ?? []).filter((t) => /^(water_supply|municipal_|flood_control|monitored)/.test(t)),
      }));
  });
  const dates = r.value.map((x) => x.date).filter((d): d is string => !!d).sort();
  return {
    data: r.value,
    meta: { source: "twdb", cacheAge: r.age },
    ttlS: 1800,
    age: r.age,
    provenance: [twdbProvenance(dates[dates.length - 1] ?? null, retrievedAt(r.age))],
  };
}

export async function opDrought(): Promise<WaterOp<GeoJSON.FeatureCollection>> {
  const r = await cached("usdm:current", 6 * 3600_000, () =>
    upstreamJson<GeoJSON.FeatureCollection>(
      "usdm",
      "https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/0/query?where=1%3D1&outFields=DM&outSR=4326&geometryPrecision=2&maxAllowableOffset=0.05&f=geojson",
      { timeoutMs: 40_000 },
    ),
  );
  return { data: r.value, meta: { source: "usdm", cacheAge: r.age }, ttlS: 3600, age: r.age, provenance: [usdmProvenance(retrievedAt(r.age))] };
}

export interface AssembledWater {
  report: WaterReport;
  bbox: Bbox;
  provenance: Provenance[];
  caveats: string[];
  retrievedAt: string;
}

/**
 * The community water report for a point: same builders and arithmetic as the
 * globe, minus satellite turbidity, which only a browser can compute.
 *
 * The bbox is snapped to a 0.5 degree grid so a neighbouring county shares the
 * cache entry rather than paying USGS for the same window twice.
 */
export async function waterReportAt(lon: number, lat: number, opts: { now?: number } = {}): Promise<AssembledWater> {
  const now = opts.now ?? Date.now();
  const bbox = snapBbox(bboxAround(lat, lon, 160_000));
  const [gauges, nwps, twdb, wells, drought] = await Promise.all([
    opGauges(bbox).catch(() => null),
    opNwps(bbox).catch(() => null),
    intersectsTexas(bbox) ? opTwdb().catch(() => null) : Promise.resolve(null),
    opWells(bbox).catch(() => null),
    opDrought().catch(() => null),
  ]);
  const water: LayerFeature[] = [];
  const caveats = ["Server report: satellite turbidity is only computed in a browser, so that term is absent here."];
  if (gauges) {
    const g = buildGauges(gauges.data, now);
    water.push(...g);
    if (nwps) water.push(...mergeFlood(g, nwps.data));
  } else caveats.push("USGS gauges did not answer.");
  if (twdb) {
    const [w, s, e, n] = bbox;
    water.push(...buildReservoirs(twdb.data.filter((r) => r.lon >= w && r.lon <= e && r.lat >= s && r.lat <= n)));
  }
  const groundwater: LayerFeature[] = [];
  if (drought) groundwater.push(...buildDrought(drought.data));
  else caveats.push("US Drought Monitor did not answer.");
  if (wells) groundwater.push(...buildWells(wells.data, now));
  else caveats.push("USGS wells did not answer.");
  const report = buildWaterReport(
    lon,
    lat,
    {
      water,
      groundwater,
      turbidity: [],
      loaded: { water: !!gauges, groundwater: !!(drought || wells), turbidity: false },
      caveats,
    },
    now,
  );
  // Date the report by its oldest ingredient, not its newest: a section that is
  // an hour stale should not be advertised as fresh because a sibling refreshed.
  const answered: Array<WaterOp<unknown>> = [gauges, nwps, twdb, wells, drought].filter((o) => o != null);
  const oldest = answered.reduce((a, o) => Math.max(a, o.age), 0);
  return {
    report,
    bbox,
    provenance: dedupeProvenance([report.provenance, ...answered.map((o) => o.provenance)]),
    caveats: report.caveats,
    retrievedAt: answered.length ? new Date(now - oldest).toISOString() : iso(now),
  };
}
