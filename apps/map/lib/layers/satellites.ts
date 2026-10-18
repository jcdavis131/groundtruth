// Layer 3: satellites.
//
// CelesTrak publishes orbital elements (GP / OMM JSON) for every tracked
// object; satellite.js propagates them with SGP4 to any instant, which is why
// this layer is fully time-scrubbable. Elements are refreshed every 2 h.

import type { Point } from "geojson";
import * as sat from "@/lib/vendor/satellite";
import { satWorker } from "@/lib/globe/satWorker";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

export interface SatGroup {
  id: string;
  label: string;
  heavy?: boolean;
}

/** Curated CelesTrak GROUP ids. "heavy" groups are thousands of objects. */
export const SATELLITE_GROUPS: SatGroup[] = [
  { id: "stations", label: "Space stations" },
  { id: "visual", label: "Brightest (visual)" },
  { id: "last-30-days", label: "Launched last 30 days" },
  { id: "military", label: "Military (misc)" },
  { id: "radar", label: "Radar calibration" },
  { id: "gps-ops", label: "GPS" },
  { id: "glo-ops", label: "GLONASS" },
  { id: "galileo", label: "Galileo" },
  { id: "beidou", label: "BeiDou" },
  { id: "weather", label: "Weather" },
  { id: "noaa", label: "NOAA" },
  { id: "goes", label: "GOES" },
  { id: "resource", label: "Earth resources" },
  { id: "planet", label: "Planet Labs" },
  { id: "spire", label: "Spire" },
  { id: "science", label: "Science" },
  { id: "geo", label: "Geostationary", heavy: true },
  { id: "intelsat", label: "Intelsat" },
  { id: "iridium-NEXT", label: "Iridium NEXT" },
  { id: "oneweb", label: "OneWeb", heavy: true },
  { id: "starlink", label: "Starlink", heavy: true },
  { id: "cubesat", label: "CubeSats", heavy: true },
  { id: "analyst", label: "Analyst objects" },
  { id: "active", label: "All active (~11k)", heavy: true },
];

/** CelesTrak OMM record as delivered by gp.php?FORMAT=json. */
export interface Omm {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
}

export interface SatExtra {
  omm: Omm;
  groups: string[];
}

const satrecCache = new Map<string, sat.SatRec>();

export function satrecFor(omm: Omm): sat.SatRec | null {
  const key = `${omm.NORAD_CAT_ID}:${omm.EPOCH}:${omm.ELEMENT_SET_NO}`;
  let rec = satrecCache.get(key);
  if (!rec) {
    try {
      rec = sat.json2satrec(omm as unknown as sat.OMMJsonObject);
    } catch {
      return null;
    }
    if (satrecCache.size > 30_000) satrecCache.clear();
    satrecCache.set(key, rec);
  }
  return rec;
}

/** Geodetic position [lon°, lat°, alt m] at a time, or null if propagation fails. */
export function satPosition(omm: Omm, timeMs: number): [number, number, number] | null {
  const rec = satrecFor(omm);
  if (!rec) return null;
  const date = new Date(timeMs);
  const pv = sat.propagate(rec, date);
  if (!pv || !pv.position) return null;
  const gmst = sat.gstime(date);
  const geo = sat.eciToGeodetic(pv.position, gmst);
  if (!Number.isFinite(geo.longitude) || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.height)) return null;
  return [sat.degreesLong(geo.longitude), sat.degreesLat(geo.latitude), geo.height * 1000];
}

/** Orbital period in ms from mean motion (rev/day). */
export function periodMs(omm: Omm): number {
  return (86_400_000 / omm.MEAN_MOTION) || 5_400_000;
}

function classify(omm: Omm, groups: string[]): string {
  if (groups.includes("stations")) return "station";
  if (groups.includes("military") || groups.includes("radar")) return "military";
  if (groups.some((g) => ["gps-ops", "glo-ops", "galileo", "beidou", "gnss", "sbas"].includes(g))) return "navigation";
  if (groups.includes("starlink") || groups.includes("oneweb") || groups.includes("iridium-NEXT")) return "constellation";
  if (groups.some((g) => ["weather", "noaa", "goes", "resource", "planet", "spire"].includes(g))) return "earth-observation";
  if (groups.includes("geo") || groups.includes("intelsat")) return "geostationary";
  if (groups.includes("science")) return "science";
  if (groups.includes("last-30-days")) return "new";
  return "satellite";
}

async function fetchSatellites(ctx: FetchContext): Promise<FetchResult> {
  const groups = (ctx.options.satelliteGroups as string[] | undefined) ?? ["stations"];
  const byId = new Map<number, { omm: Omm; groups: string[] }>();
  const failures: string[] = [];
  await Promise.all(
    groups.map(async (g) => {
      try {
        const env = await proxy<Omm[]>(`/api/satellites?group=${encodeURIComponent(g)}`, ctx);
        for (const omm of env.data ?? []) {
          const cur = byId.get(omm.NORAD_CAT_ID);
          if (cur) cur.groups.push(g);
          else byId.set(omm.NORAD_CAT_ID, { omm, groups: [g] });
        }
      } catch {
        failures.push(g);
      }
    }),
  );

  // Hand the catalogue to the propagation worker (no-op where Workers are
  // unavailable; the style then propagates on the main thread).
  satWorker.load(
    [...byId.values()].map(({ omm }) => [String(omm.NORAD_CAT_ID), omm] as const).map(([id, omm]) => ({ id, omm: omm as unknown as sat.OMMJsonObject })),
    ctx.now,
  );

  const features: LayerFeature<Point>[] = [];
  for (const { omm, groups: gs } of byId.values()) {
    const pos = satPosition(omm, ctx.now) ?? [0, 0, 0];
    const period = periodMs(omm) / 60_000;
    const extra: SatExtra = { omm, groups: gs };
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: pos },
      properties: {
        id: String(omm.NORAD_CAT_ID),
        layer: "satellites",
        name: omm.OBJECT_NAME,
        kind: classify(omm, gs),
        altitude: pos[2],
        source: "CelesTrak",
        details: {
          "NORAD id": omm.NORAD_CAT_ID,
          "intl designator": omm.OBJECT_ID,
          groups: gs.join(", "),
          inclination: `${omm.INCLINATION.toFixed(2)}°`,
          period: `${period.toFixed(1)} min`,
          eccentricity: omm.ECCENTRICITY.toFixed(5),
          "mean motion": `${omm.MEAN_MOTION.toFixed(4)} rev/day`,
          epoch: omm.EPOCH.replace("T", " ").slice(0, 19) + "Z",
          classification: omm.CLASSIFICATION_TYPE === "U" ? "unclassified" : omm.CLASSIFICATION_TYPE,
        },
        extra,
      },
    });
  }

  return {
    collection: { type: "FeatureCollection", features },
    source: "CelesTrak GP",
    fetchedAt: Date.now(),
    note:
      failures.length > 0
        ? `groups failed: ${failures.join(", ")}`
        : `${groups.length} group${groups.length === 1 ? "" : "s"} · SGP4 ${typeof Worker !== "undefined" ? "in a worker" : "on main thread"}`,
  };
}

export const satellitesLayer: LayerDefinition = {
  id: "satellites",
  label: "Satellites",
  description:
    "CelesTrak orbital elements propagated with SGP4 (satellite.js). Fully time-scrubbable; select a satellite for Look4Sat-style pass predictions over your observer location.",
  color: "#E6E6FA",
  updateIntervalMs: 2 * 3600 * 1000,
  defaultEnabled: true,
  attribution: "CelesTrak · satellite.js SGP4",
  fetch: fetchSatellites,
};
