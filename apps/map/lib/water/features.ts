// Pure builders: upstream water rows -> GeoJSON features.
//
// Shared by the browser layers (lib/layers/water.ts, groundwater.ts) and the
// server-side report (app/api/water?op=report). Nothing in here touches the
// store, Cesium or the network, so it runs identically in both places.

import type { MultiPolygon, Point, Polygon } from "geojson";
import type { GaugeReading, WellReading } from "@/app/api/water/route";
import { haversine } from "@/lib/globe/geo";
import type { BaseProps, LayerFeature } from "@/lib/layers/types";
import { fmtReading, isStale, PARAM_INFO, qualityIndex, screenReadings, type Reading, type Screen } from "./quality";

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

export interface WellExtra {
  site: string;
  readings: Partial<Record<string, Reading>>;
  /** Parameter charted when selected. */
  primary: string;
  aquifer?: string;
  aquiferCode?: string;
  localAquifer?: string;
  wellDepthFt?: number;
  stale: boolean;
}

export interface DroughtExtra {
  /** 0 abnormally dry … 4 exceptional drought. */
  dm: number;
}

export interface NwpsRow {
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

export interface TwdbRow {
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

export const DROUGHT_LABEL = [
  "D0 abnormally dry",
  "D1 moderate drought",
  "D2 severe drought",
  "D3 extreme drought",
  "D4 exceptional drought",
];
/** USDM's own map colours. */
export const DROUGHT_COLOR = ["#FFFF00", "#FCD37F", "#FFAA00", "#E60000", "#730000"];
const DROUGHT_MEANING = [
  "going into drought: short-term dryness slowing planting; coming out: lingering deficits",
  "some damage to crops and pastures; streams, reservoirs or wells low; voluntary water-use restrictions requested",
  "crop or pasture losses likely; water shortages common; restrictions imposed",
  "major crop and pasture losses; widespread water shortages or restrictions",
  "exceptional and widespread crop and pasture losses; shortages in reservoirs, streams and wells creating water emergencies",
];

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

export function intersectsTexas(b: [number, number, number, number]): boolean {
  const [w, s, e, n] = b;
  return !(e < -107 || w > -93 || n < 25.5 || s > 36.6);
}

export function buildGauges(rows: GaugeReading[], now: number): LayerFeature<Point>[] {
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
    const isReservoir =
      codes.includes("00062") || codes.includes("00054") || /lake|reservoir|res\b/i.test(g.rows[0].siteType ?? "");
    const screens = screenReadings(readings);
    const index = qualityIndex(screens);
    const primary = ["00060", "00065", "00062", "63680", "00300", "00010", "00095", "00400", "00054"].find((c) => readings[c]);
    const stale = latest > 0 && now - latest > 7 * 86_400_000;
    const details: BaseProps["details"] = {};
    for (const c of ["00060", "00065", "00062", "00054", "00010", "00300", "00400", "00095", "63680"]) {
      const r = readings[c];
      if (!r) continue;
      const s = screens.find((x) => x.param === c);
      details[DOSSIER_KEY[c] ?? c] =
        `${fmtReading(c, r)}${s && s.verdict !== "ok" ? ` · ${s.verdict.toUpperCase()}` : ""}${isStale(r.time, now) ? " · STALE" : ""}`;
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

/** Attach NWS flood status to the USGS gauge within 200 m, else emit a standalone flood gauge. */
export function mergeFlood(gauges: LayerFeature<Point>[], nwps: NwpsRow[]): LayerFeature<Point>[] {
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
        forecast:
          flood.forecastCategory && flood.forecastCategory !== "fcst_not_current" ? floodLabel(flood.forecastCategory) : undefined,
        "nws page": `https://water.noaa.gov/gauges/${g.lid}`,
      };
      continue;
    }
    if (!obs) continue;
    const details: BaseProps["details"] = {
      "flood status": floodLabel(flood.category),
      stage: flood.stage != null ? `${flood.stage} ${flood.stageUnit}` : undefined,
      flow: flood.flow != null ? `${flood.flow} ${flood.flowUnit}` : undefined,
      forecast:
        flood.forecastCategory && flood.forecastCategory !== "fcst_not_current" ? floodLabel(flood.forecastCategory) : undefined,
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

export function buildReservoirs(rows: TwdbRow[]): LayerFeature<Point>[] {
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
          storage:
            r.storageAcFt != null && r.capacityAcFt != null
              ? `${Math.round(r.storageAcFt).toLocaleString()} / ${Math.round(r.capacityAcFt).toLocaleString()} acre-ft`
              : null,
          elevation:
            r.elevationFt != null
              ? `${r.elevationFt.toFixed(2)} ft${r.poolElevationFt != null ? ` (pool ${r.poolElevationFt.toFixed(1)} ft)` : ""}`
              : null,
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

export function buildWells(rows: WellReading[], now: number): LayerFeature<Point>[] {
  const bySite = new Map<string, WellReading[]>();
  for (const r of rows) {
    const list = bySite.get(r.site) ?? [];
    list.push(r);
    bySite.set(r.site, list);
  }
  const out: LayerFeature<Point>[] = [];
  for (const [site, list] of bySite) {
    const readings: Partial<Record<string, Reading>> = {};
    let latest = 0;
    for (const r of list) {
      const t = Date.parse(r.time);
      const prev = readings[r.param];
      if (!prev || Date.parse(prev.time) < t) readings[r.param] = { value: r.value, unit: r.unit, time: r.time };
      if (t > latest) latest = t;
    }
    const primary = ["72019", "62611", "62610"].find((c) => readings[c]);
    if (!primary) continue;
    const first = list[0];
    const details: BaseProps["details"] = {};
    for (const c of ["72019", "62611", "62610"]) {
      const r = readings[c];
      if (!r) continue;
      details[PARAM_INFO[c].label] = `${fmtReading(c, r)} · ${r.time.slice(0, 10)}${isStale(r.time, now) ? " · STALE" : ""}`;
    }
    details["aquifer"] = first.aquifer ?? (first.aquiferCode ? `code ${first.aquiferCode}` : "not recorded");
    details["local aquifer code"] = first.localAquifer;
    details["well depth"] = first.wellDepthFt != null ? `${first.wellDepthFt} ft` : null;
    details["reading"] =
      primary === "72019"
        ? "depth below land surface: deeper means a falling water table"
        : "water-level elevation: higher means a rising water table";
    details["approval"] = first.approval;
    details["site"] = site;
    details["usgs page"] = `https://waterdata.usgs.gov/monitoring-location/${site.replace("USGS-", "")}/`;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [first.lon, first.lat, 0] },
      properties: {
        id: `well:${site}`,
        layer: "groundwater",
        name: first.name ?? site,
        kind: "well",
        altitude: 0,
        observedAt: latest || undefined,
        source: "USGS",
        details,
        extra: {
          site,
          readings,
          primary,
          aquifer: first.aquifer,
          aquiferCode: first.aquiferCode,
          localAquifer: first.localAquifer,
          wellDepthFt: first.wellDepthFt,
          stale: latest > 0 && now - latest > 7 * 86_400_000,
        } satisfies WellExtra,
      },
    });
  }
  return out;
}

/** US Drought Monitor GeoJSON (DM 0-4) -> one feature per class. */
export function buildDrought(fc: GeoJSON.FeatureCollection): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const f of fc.features) {
    const dm = Number((f.properties as { DM?: number } | null)?.DM);
    if (!Number.isFinite(dm) || dm < 0 || dm > 4) continue;
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
    out.push({
      type: "Feature",
      geometry: f.geometry as Polygon | MultiPolygon,
      properties: {
        id: `usdm:D${dm}`,
        layer: "groundwater",
        name: DROUGHT_LABEL[dm],
        kind: "drought",
        source: "US Drought Monitor",
        details: {
          class: `D${dm}`,
          meaning: DROUGHT_MEANING[dm],
          "usdm map": "https://droughtmonitor.unl.edu/CurrentMap.aspx",
        },
        extra: { dm } satisfies DroughtExtra,
      },
    });
  }
  return out;
}
