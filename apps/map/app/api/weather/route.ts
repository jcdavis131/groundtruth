// Open-Meteo current-conditions proxy. Keyless, global, no signup:
//   /api/weather?lats=52.52,48.85&lons=13.41,2.35
// Up to 36 coordinate pairs per call; cached 10 min per coordinate set.
// Returns live CURRENT conditions only (never a forecast, never modelled).

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, proxied, upstreamJson } from "@/lib/server/upstream";

const MAX_POINTS = 36;

export interface WeatherPoint {
  lat: number;
  lon: number;
  /** ISO time of the observation as reported by Open-Meteo. */
  time: string | null;
  tempC: number | null;
  feelsLikeC: number | null;
  humidityPct: number | null;
  precipMm: number | null;
  /** WMO weather code, null when the upstream omits it. */
  weatherCode: number | null;
  cloudCoverPct: number | null;
  /** m/s at 10 m. */
  windMs: number | null;
  /** Meteorological convention: degrees true the wind blows FROM. */
  windDirDeg: number | null;
}

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  precipitation?: number;
  weather_code?: number;
  cloud_cover?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
}

interface OpenMeteoOne {
  latitude: number;
  longitude: number;
  current?: OpenMeteoCurrent;
}

function toPoint(r: OpenMeteoOne): WeatherPoint {
  const c = r.current ?? {};
  const n = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    lat: r.latitude,
    lon: r.longitude,
    time: typeof c.time === "string" ? c.time : null,
    tempC: n(c.temperature_2m),
    feelsLikeC: n(c.apparent_temperature),
    humidityPct: n(c.relative_humidity_2m),
    precipMm: n(c.precipitation),
    weatherCode: n(c.weather_code),
    cloudCoverPct: n(c.cloud_cover),
    windMs: n(c.wind_speed_10m),
    windDirDeg: n(c.wind_direction_10m),
  };
}

function parseList(v: string | null, min: number, max: number): number[] | null {
  if (!v) return null;
  const xs = v
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((x) => Number.isFinite(x) && x >= min && x <= max);
  return xs.length > 0 ? xs : null;
}

export async function GET(req: NextRequest) {
  const lats = parseList(req.nextUrl.searchParams.get("lats"), -90, 90);
  const lons = parseList(req.nextUrl.searchParams.get("lons"), -180, 180);
  if (!lats || !lons || lats.length !== lons.length)
    return Response.json(
      { error: "lats and lons must be equal-length comma lists" },
      { status: 400 },
    );
  if (lats.length > MAX_POINTS)
    return Response.json(
      { error: `at most ${MAX_POINTS} points per call` },
      { status: 400 },
    );
  const key = lats.map((x) => x.toFixed(2)).join(",") + "|" + lons.map((x) => x.toFixed(2)).join(",");
  try {
    const r = await cached(`openmeteo:${key}`, 600_000, () =>
      upstreamJson<OpenMeteoOne | OpenMeteoOne[]>(
        "open-meteo",
        `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
          `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m` +
          `&wind_speed_unit=ms&timezone=auto&forecast_days=1`,
      ),
    );
    const raw = Array.isArray(r.value) ? r.value : [r.value];
    const points = raw.map(toPoint);
    return proxied(
      { points, count: points.length },
      { source: "open-meteo", cacheAge: r.age },
    );
  } catch (err) {
    return jsonError(err);
  }
}
