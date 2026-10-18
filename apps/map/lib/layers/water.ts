// Layer 8: surface water. Rivers, lakes and the instruments that watch them.
//
//   Natural Earth 50 m rivers + lakes   bundled in public/data, drawn everywhere
//   USGS latest-continuous              stream / reservoir gauges: flow, stage,
//                                       temperature, DO, conductance, pH,
//                                       turbidity, reservoir elevation/storage
//   NOAA NWPS                           NWS flood categories, merged onto the
//                                       USGS site when within 200 m
//   TWDB                                Texas reservoirs, percent full
//
// Gauges load when the camera is below GAUGE_MAX_HEIGHT_M; the hydrography is
// always there. Every value shown is the upstream's latest reading with its
// own timestamp; readings older than a week are flagged, never hidden.

import type { MultiLineString, Point, Polygon } from "geojson";
import { bboxAround, haversine } from "@/lib/globe/geo";
import { fmtReading, isStale, qualityIndex, screenReadings, type Reading, type Screen } from "@/lib/water/quality";
import type { GaugeReading } from "@/app/api/water/route";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature, RefineContext } from "./types";
import { proxy } from "./aircraft";

export const GAUGE_MAX_HEIGHT_M = 1_500_000;

export interface GaugeExtra {
  site: string;
  readings: Partial<Record<string, Reading>>;
  screens: Screen[];
  index: ReturnType<typeof qualityIndex>;
  /** Parameter to chart when selected. */
  primary?: string;
  flood?: FloodStatus;
  stale: boolean;
}

export interface FloodStatus {
  lid: string;
  category: string;
  stage?: number;
  stageUnit?: string;
  flow?: number;
  flowUnit?: string;
  validTime?: string;
  forecastCategory?: string;
}

export interface ReservoirExtra {
  percentFull: number | null;
  capacityAcFt: number | null;
  storageAcFt: number | null;
  elevationFt: number | null;
  poolElevationFt: number | null;
}

export interface HydroExtra {
  scalerank: number;
  /** Natural Earth's label zoom; smaller = more prominent. */
  minZoom: number;
  named: boolean;
  featurecla: string;
}

interface NwpsRow {
  lid: string;
  name: string;
  lat: number;
  lon: number;
  state?: string;
  observed?: {
    primary: number;
    primaryUnit: string;
    secondary: number;
    secondaryUnit: string;
    floodCategory: string;
    validTime: string;
  };
  forecast?: { primary: number; primaryUnit: string; floodCategory: string; validTime: string };
}

interface TwdbRow {
  id: string;
  name: string;
  lon: number;
  lat: number;
  percentFull: number | null;
  capacityAcFt: number | null;
  storageAcFt: number | null;
  elevationFt: number | null;
  poolElevationFt: number | null;
  date?: string;
  tags: string[];
}

interface NeFeature {
  type: "Feature";
  id: number;
  properties: { name?: string; name_en?: string; featurecla?: string; scalerank?: number; min_zoom?: number; admin?: string };
  geometry: MultiLineString | Polygon;
}

let hydrography: Promise<LayerFeature[]> | null = null;

/** Natural Earth rivers + lakes, loaded once from the bundle. */
export function loadHydrography(): Promise<LayerFeature[]> {
  if (!hydrography) {
    hydrography = (async () => {
      const [rivers, lakes] = await Promise.all([
        fetch("/data/ne_rivers.json").then((r) => r.json() as Promise<{ features: NeFeature[] }>),
        fetch("/data/ne_lakes.json").then((r) => r.json() as Promise<{ features: NeFeature[] }>),
      ]);
      const out: LayerFeature[] = [];
      for (const f of rivers.features) {
        const name = f.properties.name_en ?? f.properties.name ?? "unnamed river";
        out.push({
          type: "Feature",
          geometry: f.geometry,
          properties: {
            id: `ne-river:${f.id}`,
            layer: "water",
            name,
            kind: "river",
            source: "Natural Earth 50m",
            details: { type: f.properties.featurecla ?? "River", "scale rank": f.properties.scalerank },
            extra: {
              scalerank: f.properties.scalerank ?? 9,
              minZoom: f.properties.min_zoom ?? 9,
              named: !!(f.properties.name_en ?? f.properties.name),
              featurecla: f.properties.featurecla ?? "",
            } satisfies HydroExtra,
          },
        });
      }
      for (const f of lakes.features) {
        const name = f.properties.name_en ?? f.properties.name ?? "unnamed lake";
        out.push({
          type: "Feature",
          geometry: f.geometry,
          properties: {
            id: `ne-lake:${f.id}`,
            layer: "water",
            name,
            kind: "lake",
            source: "Natural Earth 50m",
            details: { type: f.properties.featurecla ?? "Lake", country: f.properties.admin, "scale rank": f.properties.scalerank },
            extra: {
              scalerank: f.properties.scalerank ?? 9,
              minZoom: f.properties.min_zoom ?? 9,
              named: !!(f.properties.name_en ?? f.properties.name),
              featurecla: f.properties.featurecla ?? "",
            } satisfies HydroExtra,
          },
        });
      }
      return out;
    })().catch((err) => {
      hydrography = null;
      throw err;
    });
  }
  return hydrography;
}

const FLOOD_LABEL: Record<string, string> = {
  no_flooding: "no flooding",
  action: "ACTION stage",
  minor: "MINOR flooding",
  moderate: "MODERATE flooding",
  major: "MAJOR flooding",
  not_defined: "no flood categories defined",
  obs_not_current: "observation not current",
  out_of_service: "out of service",
  fcst_not_current: "no current forecast",
};

export function floodLabel(cat: string | undefined): string {
  if (!cat) return "unknown";
  return FLOOD_LABEL[cat] ?? cat.replace(/_/g, " ");
}

export function viewBbox(ctx: FetchContext, radiusM: number): [number, number, number, number] {
  return ctx.view.bbox ?? bboxAround(ctx.view.lat, ctx.view.lon, radiusM);
}

/** Short dossier keys (the info panel's label column is narrow). */
const DOSSIER_KEY: Record<string, string> = {
  "00060": "flow",
  "00065": "stage",
  "00062": "elevation",
  "00054": "storage",
  "00010": "temp",
  "00300": "DO",
  "00400": "pH",
  "00095": "conductance",
  "63680": "turbidity",
};

function intersectsTexas(b: [number, number, number, number]): boolean {
  const [w, s, e, n] = b;
  return !(e < -107 || w > -93 || n < 25.5 || s > 36.6);
}

function buildGauges(rows: GaugeReading[], now: number): LayerFeature<Point>[] {
  const bySite = new Map<string, { rows: GaugeReading[]; lon: number; lat: number }>();
  for (const r of rows) {
    let g = bySite.get(r.site);
    if (!g) {
      g = { rows: [], lon: r.lon, lat: r.lat };
      bySite.set(r.site, g);
    }
    g.rows.push(r);
  }
  const out: LayerFeature<Point>[] = [];
  for (const [site, g] of bySite) {
    const readings: Partial<Record<string, Reading>> = {};
    let latest = 0;
    for (const r of g.rows) {
      const t = Date.parse(r.time);
      const prev = readings[r.param];
      if (!prev || Date.parse(prev.time) < t) readings[r.param] = { value: r.value, unit: r.unit, time: r.time };
      if (t > latest) latest = t;
    }
    const codes = Object.keys(readings);
    const isReservoir = codes.includes("00062") || codes.includes("00054") || /lake|reservoir|res\b/i.test(g.rows[0].siteType ?? "");
    const screens = screenReadings(readings);
    const index = qualityIndex(screens);
    const primary = ["00060", "00065", "00062", "63680", "00300", "00010", "00095", "00400", "00054"].find((c) => readings[c]);
    const stale = latest > 0 && now - latest > 7 * 86_400_000;
    const details: BaseProps["details"] = {};
    for (const c of ["00060", "00065", "00062", "00054", "00010", "00300", "00400", "00095", "63680"]) {
      const r = readings[c];
      if (!r) continue;
      const s = screens.find((x) => x.param === c);
      details[DOSSIER_KEY[c] ?? c] = `${fmtReading(c, r)}${s && s.verdict !== "ok" ? ` · ${s.verdict.toUpperCase()}` : ""}${isStale(r.time, now) ? " · STALE" : ""}`;
    }
    if (index) details["screen"] = `${(index.score * 100).toFixed(0)} % · ${index.n} param${index.n === 1 ? "" : "s"} · ${index.formula}`;
    details["site"] = site;
    details["site type"] = g.rows[0].siteType;
    details["approval"] = g.rows[0].approval;
    details["usgs page"] = `https://waterdata.usgs.gov/monitoring-location/${site.replace("USGS-", "")}/`;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lon, g.lat, 0] },
      properties: {
        id: `usgs:${site}`,
        layer: "water",
        name: g.rows[0].name ?? site,
        kind: isReservoir ? "reservoir" : "gauge",
        altitude: 0,
        observedAt: latest || undefined,
        source: "USGS",
        details,
        extra: { site, readings, screens, index, primary, stale } satisfies GaugeExtra,
      },
    });
  }
  return out;
}

function mergeFlood(gauges: LayerFeature<Point>[], nwps: NwpsRow[]): LayerFeature<Point>[] {
  const extra: LayerFeature<Point>[] = [];
  for (const g of nwps) {
    const obs = g.observed;
    const flood: FloodStatus = {
      lid: g.lid,
      category: obs?.floodCategory ?? "unknown",
      stage: obs && obs.primary > -999 ? obs.primary : undefined,
      stageUnit: obs?.primaryUnit,
      flow: obs && obs.secondary > -999 ? obs.secondary : undefined,
      flowUnit: obs?.secondaryUnit,
      validTime: obs?.validTime,
      forecastCategory: g.forecast?.floodCategory,
    };
    let host: LayerFeature<Point> | undefined;
    let best = 200;
    for (const u of gauges) {
      const [lon, lat] = u.geometry.coordinates;
      const d = haversine(lat, lon, g.lat, g.lon);
      if (d < best) {
        best = d;
        host = u;
      }
    }
    if (host) {
      const x = host.properties.extra as GaugeExtra;
      x.flood = flood;
      host.properties.details = {
        ...host.properties.details,
        "flood status": floodLabel(flood.category),
        forecast: flood.forecastCategory && flood.forecastCategory !== "fcst_not_current" ? floodLabel(flood.forecastCategory) : undefined,
        "nws page": `https://water.noaa.gov/gauges/${g.lid}`,
      };
      continue;
    }
    if (!obs) continue;
    const details: BaseProps["details"] = {
      "flood status": floodLabel(flood.category),
      stage: flood.stage != null ? `${flood.stage} ${flood.stageUnit}` : undefined,
      flow: flood.flow != null ? `${flood.flow} ${flood.flowUnit}` : undefined,
      forecast: flood.forecastCategory && flood.forecastCategory !== "fcst_not_current" ? floodLabel(flood.forecastCategory) : undefined,
      "nws page": `https://water.noaa.gov/gauges/${g.lid}`,
    };
    const t = obs.validTime ? Date.parse(obs.validTime) : NaN;
    extra.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lon, g.lat, 0] },
      properties: {
        id: `nwps:${g.lid}`,
        layer: "water",
        name: g.name,
        kind: "flood-gauge",
        altitude: 0,
        observedAt: Number.isFinite(t) && t > 0 ? t : undefined,
        source: "NOAA NWPS",
        details,
        extra: { site: g.lid, readings: {}, screens: [], index: null, flood, stale: false } satisfies GaugeExtra,
      },
    });
  }
  return extra;
}

function buildReservoirs(rows: TwdbRow[]): LayerFeature<Point>[] {
  return rows.map((r) => {
    const pct = r.percentFull;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat, 0] },
      properties: {
        id: `twdb:${r.id}`,
        layer: "water",
        name: r.name,
        kind: "reservoir",
        altitude: 0,
        observedAt: r.date ? Date.parse(r.date) : undefined,
        source: "TWDB",
        details: {
          "percent full": pct != null ? `${pct.toFixed(1)} % of conservation pool` : null,
          storage: r.storageAcFt != null && r.capacityAcFt != null ? `${Math.round(r.storageAcFt).toLocaleString()} / ${Math.round(r.capacityAcFt).toLocaleString()} acre-ft` : null,
          elevation: r.elevationFt != null ? `${r.elevationFt.toFixed(2)} ft${r.poolElevationFt != null ? ` (pool ${r.poolElevationFt.toFixed(1)} ft)` : ""}` : null,
          role: r.tags.map((t) => t.replace(/_/g, " ")).join(", ") || null,
          date: r.date,
          "twdb page": `https://www.waterdatafortexas.org/reservoirs/individual/${r.id}`,
        },
        extra: {
          percentFull: pct,
          capacityAcFt: r.capacityAcFt,
          storageAcFt: r.storageAcFt,
          elevationFt: r.elevationFt,
          poolElevationFt: r.poolElevationFt,
        } satisfies ReservoirExtra,
      },
    };
  });
}

async function fetchWater(ctx: FetchContext): Promise<FetchResult> {
  const now = ctx.now;
  const hydro = await loadHydrography();
  const features: LayerFeature[] = [...hydro];
  const notes: string[] = [];
  const sources = ["Natural Earth"];
  let meta: Record<string, unknown> = {};

  if (ctx.view.height <= GAUGE_MAX_HEIGHT_M) {
    const bbox = viewBbox(ctx, 250_000);
    const bboxParam = bbox.map((x) => x.toFixed(2)).join(",");
    const [gauges, nwps, twdb] = await Promise.all([
      proxy<GaugeReading[]>(`/api/water?op=gauges&bbox=${bboxParam}`, ctx).catch((e: Error) => {
        notes.push(`USGS: ${e.message.slice(0, 60)}`);
        return null;
      }),
      proxy<NwpsRow[]>(`/api/water?op=nwps&bbox=${bboxParam}`, ctx).catch((e: Error) => {
        notes.push(`NWPS: ${e.message.slice(0, 60)}`);
        return null;
      }),
      intersectsTexas(bbox)
        ? proxy<TwdbRow[]>(`/api/water?op=twdb`, ctx).catch((e: Error) => {
            notes.push(`TWDB: ${e.message.slice(0, 60)}`);
            return null;
          })
        : Promise.resolve(null),
    ]);
    let usgsFeatures: LayerFeature<Point>[] = [];
    if (gauges) {
      usgsFeatures = buildGauges(gauges.data, now);
      sources.push("USGS");
      const returned = (gauges as { returned?: number }).returned ?? 0;
      if (returned >= 5000) notes.push("USGS page limit hit, zoom in for every gauge");
    }
    let floodOnly: LayerFeature<Point>[] = [];
    if (nwps) {
      floodOnly = mergeFlood(usgsFeatures, nwps.data);
      sources.push("NWPS");
    }
    const [w, s, e, n] = bbox;
    const reservoirs = twdb
      ? buildReservoirs(twdb.data.filter((r) => r.lon >= w && r.lon <= e && r.lat >= s && r.lat <= n))
      : [];
    if (twdb) sources.push("TWDB");
    features.push(...usgsFeatures, ...floodOnly, ...reservoirs);
    const flooding = [...usgsFeatures, ...floodOnly].filter((f) => {
      const c = (f.properties.extra as GaugeExtra).flood?.category;
      return c === "minor" || c === "moderate" || c === "major";
    }).length;
    const quality = usgsFeatures.filter((f) => (f.properties.extra as GaugeExtra).screens.length > 0).length;
    notes.unshift(
      `${usgsFeatures.length + floodOnly.length} gauges · ${quality} with quality params · ${flooding} flooding` +
        (reservoirs.length ? ` · ${reservoirs.length} TX reservoirs` : ""),
    );
    meta = { count: usgsFeatures.length + floodOnly.length + reservoirs.length, flooding, quality };
  } else {
    notes.push(`${hydro.length} rivers & lakes · descend below ${Math.round(GAUGE_MAX_HEIGHT_M / 1000)} km for live gauges`);
    meta = { count: hydro.length };
  }

  return {
    collection: { type: "FeatureCollection", features },
    source: sources.join(" + "),
    fetchedAt: now,
    note: notes.join(" · "),
    meta,
  };
}

/**
 * While Rivers and streams (NHD) is on it draws the rivers at stream scale, so Natural Earth's
 * generalised 50 m rivers step aside (lakes, gauges, flood points and reservoirs stay).
 */
export function refineWater(result: FetchResult, ctx: RefineContext): FetchResult {
  if (!ctx.layersOn.hydro) return result;
  const features = result.collection.features.filter((f) => f.properties.kind !== "river");
  return features.length === result.collection.features.length ? result : { ...result, collection: { ...result.collection, features } };
}

export const waterLayer: LayerDefinition = {
  id: "water",
  label: "Surface water",
  description:
    "Rivers and lakes with live USGS gauges (flow, stage, temperature, oxygen, conductance, pH, turbidity), NWS flood status and Texas reservoir levels.",
  color: "#3B9DFF",
  updateIntervalMs: 5 * 60_000,
  defaultEnabled: true,
  viewDependent: true,
  attribution: "USGS Water Data · NOAA NWPS · TWDB · Natural Earth",
  // Natural Earth's rivers step aside while the NHD picture is drawing streams.
  dependsOn: ["hydro"],
  fetch: fetchWater,
  refine: refineWater,
};
