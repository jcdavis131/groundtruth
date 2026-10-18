// Layer: ISS tracker. Live position of the International Space Station from
// wheretheiss.at (keyless, ~1 s cadence upstream; we poll every 10 s).
//
// One point at true altitude (~420 km) with a short orbit trail drawn from
// the renderer's recorded position history. Between polls the marker
// interpolates along the short arc between the last two fixes; under
// prefers-reduced-motion it holds the latest fix instead. Real data only —
// an unreachable feed fails honest through the proxy, never a propagated
// guess (positions past the latest fix are held, not extrapolated).

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

interface IssUpstream {
  name: string;
  id: number;
  latitude: number;
  longitude: number;
  altitude: number; // km
  velocity: number; // km/h
  visibility: string;
  footprint: number; // km
  timestamp: number; // epoch seconds
}

export interface IssFix {
  lon: number;
  lat: number;
  altM: number;
  t: number; // epoch ms
}

export interface IssExtra {
  prev: IssFix | null;
  cur: IssFix;
  velocityKmh: number;
  visibility: string;
  footprintKm: number;
}

/** Previous fix, kept module-side so consecutive polls can be interpolated. */
let prevFix: IssFix | null = null;

/**
 * Position at mission time: linear interpolation between the last two fixes
 * (a 10 s arc is ~76 km; slerp would be theatre). Holds the latest fix once
 * past it — an orbit is never extrapolated from a single velocity vector.
 */
export function issPositionAt(extra: IssExtra, timeMs: number): [number, number, number] {
  const { prev, cur } = extra;
  if (!prev || timeMs <= prev.t) return [cur.lon, cur.lat, cur.altM];
  if (timeMs >= cur.t) return [cur.lon, cur.lat, cur.altM];
  const f = (timeMs - prev.t) / (cur.t - prev.t);
  // Shortest path across the antimeridian.
  let dlon = cur.lon - prev.lon;
  if (dlon > 180) dlon -= 360;
  if (dlon < -180) dlon += 360;
  const lon = ((prev.lon + dlon * f + 540) % 360) - 180;
  return [lon, prev.lat + (cur.lat - prev.lat) * f, prev.altM + (cur.altM - prev.altM) * f];
}

async function fetchIss(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<IssUpstream>("/api/iss", ctx);
  const p = env.data;
  if (!Number.isFinite(p?.latitude) || !Number.isFinite(p?.longitude)) {
    throw new Error("ISS feed returned no position");
  }
  const cur: IssFix = {
    lon: p.longitude,
    lat: p.latitude,
    altM: p.altitude * 1000,
    t: p.timestamp * 1000,
  };
  const extra: IssExtra = {
    prev: prevFix,
    cur,
    velocityKmh: p.velocity,
    visibility: p.visibility,
    footprintKm: p.footprint,
  };
  prevFix = cur;
  const speed = Number.isFinite(p.velocity) ? p.velocity / 3.6 : undefined; // km/h → m/s
  const feature: LayerFeature<Point> = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [cur.lon, cur.lat, cur.altM] },
    properties: {
      id: "iss",
      layer: "iss",
      name: "ISS",
      kind: "station",
      altitude: cur.altM,
      speed,
      observedAt: cur.t,
      source: "wheretheiss.at",
      details: {
        altitude: `${p.altitude.toFixed(1)} km`,
        velocity: Number.isFinite(p.velocity) ? `${Math.round(p.velocity).toLocaleString("en-US")} km/h` : null,
        visibility: p.visibility ?? null,
        footprint: Number.isFinite(p.footprint) ? `Ø ${Math.round(p.footprint).toLocaleString("en-US")} km` : null,
        "norad id": p.id,
      },
      extra,
    },
  };
  return {
    collection: { type: "FeatureCollection", features: [feature] },
    source: env.source,
    fetchedAt: Date.now(),
    note: `${p.altitude.toFixed(0)} km up · ${Math.round(p.velocity).toLocaleString("en-US")} km/h · ${p.visibility}`,
  };
}

export const issLayer: LayerDefinition = {
  id: "iss",
  label: "ISS tracker",
  description:
    "The International Space Station's live position with a short orbit trail. Real telemetry, polled every 10 seconds.",
  color: "#FFFFFF",
  updateIntervalMs: 10_000,
  defaultEnabled: false,
  attribution: "wheretheiss.at",
  fetch: fetchIss,
};
