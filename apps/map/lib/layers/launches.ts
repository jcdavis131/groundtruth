// Layer 7: rocket launches.
//
// Launch Library 2 gives every scheduled launch with its pad coordinates and
// target orbit. The ascent track drawn on the globe is a COARSE ESTIMATE:
// launch azimuth from the target inclination and pad latitude, a generic
// gravity-turn altitude profile, 1,500 km downrange. It is labelled as such
// in the info panel and is never presented as telemetry.

import type { Point } from "geojson";
import { destination } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

interface Ll2Launch {
  id: string;
  name: string;
  status: { id: number; name: string; abbrev: string; description?: string };
  net: string;
  window_start?: string;
  window_end?: string;
  launch_service_provider?: { name: string; type?: { name?: string } | string };
  rocket?: { configuration?: { name?: string; full_name?: string } };
  mission?: {
    name?: string;
    description?: string;
    type?: string;
    orbit?: { name?: string; abbrev?: string };
  } | null;
  pad?: {
    name?: string;
    latitude?: number | string;
    longitude?: number | string;
    location?: { name?: string; country?: { alpha_2_code?: string; name?: string }; country_code?: string };
  };
  image?: { image_url?: string } | string | null;
  webcast_live?: boolean;
  vid_urls?: Array<{ url: string; title?: string }>;
  url?: string;
}

interface Ll2List {
  results: Ll2Launch[];
}

export interface Trajectory {
  /** Estimated launch azimuth, degrees true. */
  azimuth: number;
  /** Target inclination used for the estimate, degrees. */
  inclination: number;
  /** Ascent track [lon, lat, alt m] from the pad to ~1,500 km downrange. */
  track: [number, number, number][];
  /** Estimate rationale, shown to the operator. */
  basis: string;
}

export interface LaunchExtra {
  netMs: number;
  windowStartMs?: number;
  windowEndMs?: number;
  status: string;
  trajectory: Trajectory | null;
}

/** Typical inclinations by orbit abbreviation when LL2 does not state one. */
const ORBIT_INCLINATION: Record<string, number> = {
  LEO: 51.6,
  ISS: 51.6,
  SSO: 97.6,
  PO: 90,
  GTO: 27,
  GEO: 0,
  GSO: 0,
  MEO: 55,
  HEO: 63.4,
  TLI: 28.5,
  "Sub": 90,
  ELLIPTICAL: 63.4,
  "Lunar": 28.5,
};

/** Estimate the ascent track. Returns null when the pad position is unknown. */
export function estimateTrajectory(padLat: number, padLon: number, orbitAbbrev: string | undefined, orbitName: string | undefined): Trajectory {
  const key = orbitAbbrev ?? "";
  let inclination = ORBIT_INCLINATION[key];
  if (inclination == null) {
    const n = (orbitName ?? "").toLowerCase();
    inclination = n.includes("sun-sync") ? 97.6 : n.includes("polar") ? 90 : n.includes("geo") ? 27 : 51.6;
  }
  // A launch cannot reach an inclination lower than its pad latitude.
  const effInc = Math.max(inclination, Math.abs(padLat) + 0.5);
  const cosLat = Math.cos((padLat * Math.PI) / 180);
  const sinAz = Math.max(-1, Math.min(1, Math.cos((effInc * Math.PI) / 180) / cosLat));
  let azimuth = (Math.asin(sinAz) * 180) / Math.PI; // eastern branch, [-90, 90]
  let basis: string;
  if (effInc > 90) {
    // Retrograde / sun-synchronous: most ranges (Vandenberg, Jiuquan, Taiyuan,
    // Tanegashima) launch south; near-equatorial Kourou and far-north Plesetsk
    // launch north. Coarse rule of thumb only.
    const north = padLat < 10 || padLat > 60;
    azimuth = north ? (azimuth + 360) % 360 : 180 - azimuth;
    basis = `retrograde ${effInc.toFixed(1)}° target, ${north ? "northbound" : "southbound"} range`;
  } else {
    azimuth = (azimuth + 360) % 360;
    // Prograde launches head east; pick the north-east branch for i < 90.
    basis = `prograde ${effInc.toFixed(1)}° target, eastbound range`;
  }
  const track: [number, number, number][] = [];
  const steps = 40;
  const downrange = 1_500_000;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const [lon, lat] = destination(padLat, padLon, azimuth, downrange * s);
    // Generic gravity turn: climbs to ~200 km by ~60 % downrange, then coasts.
    const alt = 200_000 * Math.min(1, Math.pow(s / 0.6, 1.5));
    track.push([lon, lat, alt]);
  }
  return { azimuth, inclination: effInc, track, basis };
}

function toFeature(l: Ll2Launch, now: number, upcoming: boolean): LayerFeature<Point> | null {
  const lat = Number(l.pad?.latitude);
  const lon = Number(l.pad?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const netMs = Date.parse(l.net);
  const status = l.status?.abbrev ?? l.status?.name ?? "TBD";
  const trajectory = estimateTrajectory(lat, lon, l.mission?.orbit?.abbrev, l.mission?.orbit?.name);
  const extra: LaunchExtra = {
    netMs,
    windowStartMs: l.window_start ? Date.parse(l.window_start) : undefined,
    windowEndMs: l.window_end ? Date.parse(l.window_end) : undefined,
    status,
    trajectory,
  };
  const dt = netMs - now;
  const inFlight = dt <= 0 && dt > -10 * 60_000 && status !== "Failure";
  const countdown = dt > 0 ? `T-${fmtDur(dt)}` : `T+${fmtDur(-dt)}`;
  const image = typeof l.image === "string" ? l.image : l.image?.image_url;
  const provider = l.launch_service_provider?.name;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat, 0] },
    properties: {
      id: l.id,
      layer: "launches",
      name: l.name,
      kind: inFlight ? "in-flight" : upcoming ? status.toLowerCase() : "previous",
      altitude: 0,
      observedAt: netMs,
      source: "Launch Library 2",
      details: {
        countdown,
        status: `${l.status?.name ?? status}${l.status?.description ? " — " + l.status.description : ""}`,
        NET: new Date(netMs).toISOString().replace("T", " ").slice(0, 16) + "Z",
        provider: provider ?? null,
        vehicle: l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name ?? null,
        mission: l.mission?.name ?? null,
        orbit: l.mission?.orbit?.name ?? null,
        pad: l.pad?.name ?? null,
        site: l.pad?.location?.name ?? null,
        "ascent track": `ESTIMATE · az ${trajectory.azimuth.toFixed(0)}° · ${trajectory.basis}`,
        "webcast live": l.webcast_live ? "yes" : null,
        webcast: l.vid_urls?.[0]?.url ?? null,
        "mission brief": l.mission?.description?.slice(0, 280) ?? null,
        "launch page": l.url ?? null,
      },
      imageUrl: undefined,
      extra: { ...extra, image },
    },
  };
}

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

async function fetchLaunches(ctx: FetchContext): Promise<FetchResult> {
  const [up, prev] = await Promise.all([
    proxy<Ll2List>("/api/launches?which=upcoming", ctx),
    proxy<Ll2List>("/api/launches?which=previous", ctx).catch(() => null),
  ]);
  const features: LayerFeature<Point>[] = [];
  const seen = new Set<string>();
  for (const l of up.data.results ?? []) {
    const f = toFeature(l, ctx.now, true);
    if (f && !seen.has(f.properties.id)) {
      seen.add(f.properties.id);
      features.push(f);
    }
  }
  for (const l of prev?.data.results ?? []) {
    const f = toFeature(l, ctx.now, false);
    if (f && !seen.has(f.properties.id)) {
      seen.add(f.properties.id);
      features.push(f);
    }
  }
  const next = features
    .filter((f) => (f.properties.extra as LaunchExtra).netMs > ctx.now)
    .sort((a, b) => (a.properties.extra as LaunchExtra).netMs - (b.properties.extra as LaunchExtra).netMs)[0];
  return {
    collection: { type: "FeatureCollection", features },
    source: "Launch Library 2",
    fetchedAt: Date.now(),
    note: next ? `next: ${next.properties.name.slice(0, 40)} ${next.properties.details?.countdown}` : undefined,
  };
}

export const launchesLayer: LayerDefinition = {
  id: "launches",
  label: "Launches",
  description: "Upcoming and recent orbital launches from Launch Library 2, with a coarse estimated ascent track.",
  color: "#FF3DAE",
  updateIntervalMs: 15 * 60_000,
  defaultEnabled: true,
  attribution: "The Space Devs · Launch Library 2",
  fetch: fetchLaunches,
};
