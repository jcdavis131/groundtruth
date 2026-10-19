// Layer 6: traffic — A SIMULATION.
//
// This is the only layer that is not a live signal, and it says so
// everywhere: layer flag, every feature, the info panel, the README.
//
// What is real:   the road network (OpenStreetMap via Overpass) and the
//                 time-of-day / day-of-week demand curve, which is a published
//                 aggregate pattern (FHWA-style diurnal profile), not a feed.
// What is not:    every vehicle. They are deterministic pseudo-random agents
//                 moving along real roads at class-typical speeds. No real
//                 vehicle, phone, plate or person is represented. Ever.

import type { LineString, Point } from "geojson";
import { hashString, haversine, mulberry32 } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { emptyCollection } from "./types";
import { proxy } from "./aircraft";

interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: OverpassWay[];
}

export interface Road {
  id: number;
  cls: string;
  name?: string;
  oneway: boolean;
  /** [lon, lat] vertices */
  pts: [number, number][];
  /** cumulative distance (m) at each vertex */
  cum: number[];
  length: number;
  speed: number;
}

export interface VehicleExtra {
  road: Road;
  /** 0..1 start fraction along the road */
  phase: number;
  /** +1 forward, -1 backward along the way */
  dir: 1 | -1;
  /** speed multiplier ~ 0.85..1.15 */
  jitter: number;
}

/** Class-typical free-flow speed (m/s) and demand (vehicles / km / direction at peak). */
const CLASS: Record<string, { speed: number; density: number }> = {
  motorway: { speed: 31, density: 9 },
  motorway_link: { speed: 18, density: 3 },
  trunk: { speed: 25, density: 6 },
  trunk_link: { speed: 15, density: 2 },
  primary: { speed: 16, density: 4 },
  secondary: { speed: 13, density: 2.5 },
  tertiary: { speed: 11, density: 1.4 },
};

/**
 * Aggregate diurnal demand profile (fraction of daily peak by local hour).
 * Shape follows typical urban weekday traffic counts: morning and evening
 * peaks, deep overnight trough. Weekends are flatter and lower.
 */
export const DIURNAL_WEEKDAY = [
  0.12, 0.08, 0.06, 0.06, 0.1, 0.28, 0.62, 0.95, 1.0, 0.8, 0.7, 0.72, 0.76, 0.76, 0.8, 0.9, 1.0, 0.98, 0.82, 0.6,
  0.46, 0.36, 0.28, 0.2,
];
export const DIURNAL_WEEKEND = [
  0.18, 0.12, 0.08, 0.06, 0.06, 0.1, 0.2, 0.34, 0.5, 0.66, 0.78, 0.86, 0.9, 0.9, 0.88, 0.86, 0.84, 0.8, 0.72, 0.6,
  0.5, 0.42, 0.34, 0.26,
];

/** Demand factor for a longitude at a UTC time (local solar-ish hour). */
export function demandFactor(lon: number, timeMs: number): { factor: number; localHour: number; weekend: boolean } {
  const d = new Date(timeMs + lon * 240_000); // 4 min per degree
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const prof = weekend ? DIURNAL_WEEKEND : DIURNAL_WEEKDAY;
  const i = Math.floor(h) % 24;
  const t = h - Math.floor(h);
  const factor = prof[i] * (1 - t) + prof[(i + 1) % 24] * t;
  return { factor, localHour: h, weekend };
}

export const TRAFFIC_MAX_HEIGHT_M = 30_000;
const MAX_VEHICLES = 1600;

function buildRoad(w: OverpassWay): Road | null {
  const cls = w.tags?.highway ?? "";
  const spec = CLASS[cls];
  if (!spec || !w.geometry || w.geometry.length < 2) return null;
  const pts: [number, number][] = w.geometry.map((g) => [g.lon, g.lat]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]));
  }
  const length = cum[cum.length - 1];
  if (length < 30) return null;
  const oneway = w.tags?.oneway === "yes" || w.tags?.oneway === "1" || cls.startsWith("motorway");
  const maxspeed = Number.parseFloat(w.tags?.maxspeed ?? "");
  const speed = Number.isFinite(maxspeed)
    ? ((w.tags?.maxspeed ?? "").includes("mph") ? maxspeed * 0.447 : maxspeed / 3.6) * 0.92
    : spec.speed;
  return { id: w.id, cls, name: w.tags?.name, oneway, pts, cum, length, speed };
}

/** Position along a road at distance s (m), wrapping around. */
export function alongRoad(road: Road, s: number): [number, number] {
  const L = road.length;
  let d = s % L;
  if (d < 0) d += L;
  const cum = road.cum;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  const a = road.pts[lo];
  const b = road.pts[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function vehiclePosition(v: VehicleExtra, timeMs: number): [number, number, number] {
  const road = v.road;
  const s = v.phase * road.length + v.dir * road.speed * v.jitter * (timeMs / 1000);
  const [lon, lat] = alongRoad(road, s);
  return [lon, lat, 0];
}

export function vehicleHeading(v: VehicleExtra, timeMs: number): number {
  const road = v.road;
  const s = v.phase * road.length + v.dir * road.speed * v.jitter * (timeMs / 1000);
  const a = alongRoad(road, s - 5 * v.dir);
  const b = alongRoad(road, s + 5 * v.dir);
  const dLon = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dLat = b[1] - a[1];
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

async function fetchTraffic(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > TRAFFIC_MAX_HEIGHT_M) {
    return {
      collection: emptyCollection(),
      source: "simulation (idle)",
      fetchedAt: Date.now(),
      note: `zoom below ${TRAFFIC_MAX_HEIGHT_M / 1000} km to simulate · SIMULATED, not real vehicles`,
      meta: { count: 0 },
    };
  }
  const span = 0.09;
  const bbox = [ctx.view.lon - span, ctx.view.lat - span * 0.75, ctx.view.lon + span, ctx.view.lat + span * 0.75]
    .map((x) => x.toFixed(4))
    .join(",");
  const env = await proxy<OverpassResponse>(`/api/roads?bbox=${bbox}`, ctx);
  const roads: Road[] = [];
  for (const el of env.data.elements ?? []) {
    if (el.type !== "way") continue;
    const r = buildRoad(el);
    if (r) roads.push(r);
  }
  const { factor, localHour, weekend } = demandFactor(ctx.view.lon, ctx.now);

  // Vehicle budget per road from class density × demand, capped globally.
  let planned = 0;
  const wanted = roads.map((r) => {
    const dirs = r.oneway ? 1 : 2;
    const n = Math.round(CLASS[r.cls].density * (r.length / 1000) * factor * dirs);
    planned += n;
    return n;
  });
  const scale = planned > MAX_VEHICLES ? MAX_VEHICLES / planned : 1;

  const features: LayerFeature<Point | LineString>[] = [];
  let vehicles = 0;
  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri];
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: road.pts.map(([lon, lat]) => [lon, lat, 0]) },
      properties: {
        id: `road:${road.id}`,
        layer: "traffic",
        name: road.name ?? `${road.cls} ${road.id}`,
        kind: "road",
        source: "OpenStreetMap",
        simulated: true,
        details: {
          "what is this": "Real OSM road used as a track for SIMULATED vehicles",
          class: road.cls,
          length: `${(road.length / 1000).toFixed(2)} km`,
          oneway: road.oneway,
          "sim speed": `${Math.round(road.speed * 3.6)} km/h`,
          "osm way": `https://www.openstreetmap.org/way/${road.id}`,
        },
      },
    });
    if (vehicles >= MAX_VEHICLES) continue;
    const n = Math.min(Math.floor(wanted[ri] * scale + 0.5), MAX_VEHICLES - vehicles);
    const rng = mulberry32(hashString(String(road.id)));
    for (let i = 0; i < n; i++) {
      const dir: 1 | -1 = road.oneway || rng() < 0.5 ? 1 : -1;
      const extra: VehicleExtra = { road, phase: rng(), dir, jitter: 0.85 + rng() * 0.3 };
      const [lon, lat] = alongRoad(road, extra.phase * road.length);
      vehicles++;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat, 0] },
        properties: {
          id: `veh:${road.id}:${i}`,
          layer: "traffic",
          name: `SIM vehicle ${road.id}-${i}`,
          kind: "vehicle",
          altitude: 0,
          speed: road.speed * extra.jitter,
          source: "simulation",
          simulated: true,
          details: {
            "what is this": "SIMULATED agent on a real OSM road. Not a real vehicle, phone or person.",
            road: road.name ?? road.cls,
            "demand factor": `${(factor * 100).toFixed(0)}% of peak (local ${localHour.toFixed(0)}h, ${weekend ? "weekend" : "weekday"})`,
          },
          extra,
        },
      });
    }
  }

  return {
    collection: { type: "FeatureCollection", features },
    source: "simulation on OSM roads",
    fetchedAt: Date.now(),
    note: `SIMULATED · ${vehicles} agents on ${roads.length} roads · demand ${(factor * 100).toFixed(0)}%`,
    meta: { count: vehicles },
  };
}

export const trafficLayer: LayerDefinition = {
  id: "traffic",
  label: "Traffic (sim)",
  description:
    "SIMULATION. Pseudo-random vehicles moving along real OpenStreetMap roads at aggregate time-of-day demand. No real vehicle positions are used.",
  color: "#B48CFF",
  updateIntervalMs: 10 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  simulated: true,
  viewKey: (v: ViewState) =>
    v.height > TRAFFIC_MAX_HEIGHT_M ? "far" : `${Math.round(v.lon * 40) / 40},${Math.round(v.lat * 40) / 40}`,
  attribution: "Roads © OpenStreetMap contributors (ODbL) · vehicles simulated",
  fetch: fetchTraffic,
};
