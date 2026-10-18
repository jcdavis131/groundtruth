// Layer 4: earthquakes. USGS GeoJSON feed of the last 24 h (all magnitudes),
// refreshed every minute. Already GeoJSON upstream; we only normalise props.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

interface UsgsProps {
  mag: number | null;
  place: string | null;
  time: number;
  updated: number;
  tz: number | null;
  url: string;
  felt: number | null;
  cdi: number | null;
  mmi: number | null;
  alert: string | null;
  status: string;
  tsunami: number;
  sig: number;
  net: string;
  code: string;
  magType: string | null;
  type: string;
  title: string;
}

interface UsgsFeature {
  type: "Feature";
  id: string;
  properties: UsgsProps;
  geometry: { type: "Point"; coordinates: [number, number, number] };
}

interface UsgsCollection {
  metadata: { generated: number; count: number; title: string };
  features: UsgsFeature[];
}

export function magnitudeClass(mag: number | null): string {
  if (mag == null) return "unknown";
  if (mag >= 7) return "major";
  if (mag >= 6) return "strong";
  if (mag >= 5) return "moderate";
  if (mag >= 4) return "light";
  if (mag >= 2.5) return "minor";
  return "micro";
}

async function fetchEarthquakes(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<UsgsCollection>("/api/earthquakes?feed=all_day", ctx);
  const features: LayerFeature<Point>[] = env.data.features
    .filter((f) => f.geometry && f.properties)
    .map((f) => {
      const p = f.properties;
      const [lon, lat, depthKm] = f.geometry.coordinates;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat, 0] },
        properties: {
          id: f.id,
          layer: "earthquakes",
          name: `M${p.mag?.toFixed(1) ?? "?"} ${p.place ?? "unknown location"}`,
          kind: magnitudeClass(p.mag),
          altitude: 0,
          observedAt: p.time,
          source: "USGS",
          details: {
            magnitude: p.mag != null ? `${p.mag.toFixed(1)} ${p.magType ?? ""}`.trim() : null,
            depth: `${depthKm.toFixed(1)} km`,
            time: new Date(p.time).toISOString().replace("T", " ").slice(0, 19) + "Z",
            "felt reports": p.felt,
            alert: p.alert,
            tsunami: p.tsunami === 1 ? "advisory issued" : null,
            significance: p.sig,
            status: p.status,
            type: p.type,
            network: p.net,
            "usgs page": p.url,
          },
          extra: { mag: p.mag ?? 0, depthKm },
        },
      };
    });
  const strong = features.filter((f) => ((f.properties.extra as { mag: number }).mag ?? 0) >= 5);
  return {
    collection: { type: "FeatureCollection", features },
    source: "USGS all_day",
    fetchedAt: Date.now(),
    note: `${features.length} events / 24 h · ${strong.length} ≥ M5`,
  };
}

export const earthquakesLayer: LayerDefinition = {
  id: "earthquakes",
  label: "Earthquakes",
  description: "USGS real-time feed, every event of the past 24 hours.",
  color: "#FF6B3D",
  updateIntervalMs: 60_000,
  defaultEnabled: true,
  attribution: "USGS Earthquake Hazards Program",
  fetch: fetchEarthquakes,
};
