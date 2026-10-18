// Pure geodesy helpers shared by layers and the simulation code. No Cesium
// dependency so they can run in tests, workers or on the server.

export const EARTH_RADIUS_M = 6_371_008.8;
export const DEG = Math.PI / 180;
export const KNOT_MS = 0.514444;
export const FT_M = 0.3048;
export const NM_M = 1852;

export function clampLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Initial bearing from point 1 to point 2, degrees true [0, 360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG;
  const φ2 = lat2 * DEG;
  const Δλ = (lon2 - lon1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): [lon: number, lat: number] {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = bearingDeg * DEG;
  const φ1 = lat * DEG;
  const λ1 = lon * DEG;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [clampLon(λ2 / DEG), φ2 / DEG];
}

/** Bounding box [w, s, e, n] around a centre with a radius in metres. */
export function bboxAround(lat: number, lon: number, radiusM: number): [number, number, number, number] {
  const dLat = (radiusM / EARTH_RADIUS_M) / DEG;
  const dLon = dLat / Math.max(Math.cos(lat * DEG), 0.05);
  return [
    clampLon(lon - dLon),
    Math.max(-90, lat - dLat),
    clampLon(lon + dLon),
    Math.min(90, lat + dLat),
  ];
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${m.toFixed(0)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString()} km`;
}

export function formatAltitude(m: number | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m > 1_000_000) return `${(m / 1000).toFixed(0)} km`;
  return `${Math.round(m).toLocaleString()} m / ${Math.round(m / FT_M).toLocaleString()} ft`;
}

export function formatSpeed(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms > 2000) return `${(ms / 1000).toFixed(2)} km/s`;
  return `${Math.round(ms * 3.6)} km/h / ${Math.round(ms / KNOT_MS)} kt`;
}

export function timeAgo(t: number | undefined, now = Date.now()): string {
  if (!t) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Cheap seeded PRNG (mulberry32) for deterministic simulations. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
