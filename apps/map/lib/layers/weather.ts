// Layer: weather. Live current atmospheric conditions from Open-Meteo
// (keyless, global), sampled on a coarse grid around the camera view.
// Points are coloured by temperature; a barb on each point shows wind
// direction (blowing toward) and speed. Labelled as sampled current
// conditions everywhere it appears — never a forecast, never modelled.

import type { Point } from "geojson";
import type {
  FetchContext,
  FetchResult,
  LayerDefinition,
  LayerFeature,
  ViewState,
} from "./types";
import { proxy } from "./aircraft";
import type { WeatherPoint } from "@/app/api/weather/route";

const COLS = 5;
const ROWS = 5;

/** WMO weather-code buckets for colour/icon choice. */
export function weatherBucket(code: number | null): string {
  if (code == null) return "unknown";
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 85 && code <= 86) return "snow-showers";
  if (code >= 95) return "storm";
  return "unknown";
}

export function weatherWord(code: number | null): string {
  switch (weatherBucket(code)) {
    case "clear": return "clear";
    case "partly-cloudy": return "partly cloudy";
    case "overcast": return "overcast";
    case "fog": return "fog";
    case "drizzle": return "drizzle";
    case "rain": return "rain";
    case "snow": return "snow";
    case "showers": return "showers";
    case "snow-showers": return "snow showers";
    case "storm": return "thunderstorm";
    default: return "unknown";
  }
}

function gridFor(view: ViewState): { lats: number[]; lons: number[]; stepDeg: number } {
  let w: number, s: number, e: number, n: number;
  if (view.bbox) {
    [w, s, e, n] = view.bbox;
  } else {
    // Horizon in view: span a region around the target from camera height.
    const span = Math.min(120, Math.max(4, (view.height / 111_320) * 1.5));
    w = view.lon - span / 2;
    e = view.lon + span / 2;
    s = Math.max(-84, view.lat - span / 4);
    n = Math.min(84, view.lat + span / 4);
  }
  // Clamp to sane spans; wrap longitudes.
  const spanLon = Math.min(120, Math.max(1, e - w));
  const spanLat = Math.min(60, Math.max(1, n - s));
  const cl = ((view.lon % 360) + 540) % 360 - 180;
  w = cl - spanLon / 2;
  e = cl + spanLon / 2;
  s = Math.max(-84, Math.min(84, (s + n) / 2) - spanLat / 2);
  n = Math.min(84, s + spanLat);
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < ROWS; r++) lats.push(s + (spanLat * r) / (ROWS - 1));
  for (let c = 0; c < COLS; c++) {
    let lon = w + (spanLon * c) / (COLS - 1);
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    lons.push(lon);
  }
  return { lats, lons, stepDeg: spanLon / (COLS - 1) };
}

function fmtTemp(t: number | null): string {
  return t == null ? "n/a" : `${t.toFixed(1)}°C`;
}

async function fetchWeather(ctx: FetchContext): Promise<FetchResult> {
  const { lats, lons, stepDeg } = gridFor(ctx.view);
  // Open-Meteo takes parallel arrays; expand the grid row-major.
  const glats: number[] = [];
  const glons: number[] = [];
  for (const lat of lats) for (const lon of lons) { glats.push(lat); glons.push(lon); }
  const env = await proxy<{ points: WeatherPoint[]; count: number }>(
    `/api/weather?lats=${glats.map((x) => x.toFixed(2)).join(",")}&lons=${glons.map((x) => x.toFixed(2)).join(",")}`,
    ctx,
  );
  const stepM = stepDeg * 111_320;
  const features: LayerFeature<Point>[] = env.data.points.map((p) => {
    const windTo = p.windDirDeg == null ? undefined : (p.windDirDeg + 180) % 360;
    const barbLenM = Math.min(0.45, Math.max(0.1, (p.windMs ?? 0) / 20)) * stepM;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat, 0] },
      properties: {
        id: `wx:${p.lat.toFixed(2)},${p.lon.toFixed(2)}`,
        layer: "weather",
        name: `${fmtTemp(p.tempC)} · ${weatherWord(p.weatherCode)}`,
        kind: weatherBucket(p.weatherCode),
        heading: windTo,
        speed: p.windMs ?? undefined,
        observedAt: p.time ? Date.parse(p.time) : undefined,
        source: "Open-Meteo",
        details: {
          temperature: fmtTemp(p.tempC),
          "feels like": fmtTemp(p.feelsLikeC),
          conditions: weatherWord(p.weatherCode),
          humidity: p.humidityPct == null ? null : `${p.humidityPct.toFixed(0)}%`,
          precipitation: p.precipMm == null ? null : `${p.precipMm.toFixed(1)} mm`,
          "cloud cover": p.cloudCoverPct == null ? null : `${p.cloudCoverPct.toFixed(0)}%`,
          wind:
            p.windMs == null || p.windDirDeg == null
              ? null
              : `${p.windMs.toFixed(1)} m/s from ${Math.round(p.windDirDeg)}°`,
          observed: p.time ?? null,
        },
        extra: { tempC: p.tempC, windMs: p.windMs, windDirTo: windTo, barbLenM },
      },
    };
  });
  return {
    collection: { type: "FeatureCollection", features },
    source: "Open-Meteo",
    fetchedAt: Date.now(),
    note: `${features.length} live samples around view · current conditions, not a forecast`,
  };
}

export const weatherLayer: LayerDefinition = {
  id: "weather",
  label: "Weather",
  description:
    "Live current conditions (temperature, wind, precipitation) sampled around your view.",
  color: "#7DD3FC",
  updateIntervalMs: 600_000,
  defaultEnabled: true,
  viewDependent: true,
  attribution: "Open-Meteo",
  fetch: fetchWeather,
};
