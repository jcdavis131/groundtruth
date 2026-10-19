// Elevation profile along a drawn line, from the same keyless terrarium tiles
// the 3D terrain uses. Pure: the browser loader (lib/terrain/terrarium.ts)
// fetches and decodes tiles; everything here is arithmetic, tested on a crop
// of a real tile.
//
//   samples   N points evenly spaced by distance along the path; each segment's
//             length is the caller's (the measure tool's WGS84 geodesic), the
//             position at a fraction of a segment is the great-circle point at
//             that fraction (the two differ by far less than a pixel at any
//             length drawn by hand)
//   zoom      the deepest terrarium zoom (at most 15) whose tiles covering the
//             samples number at most `maxTiles`
//   height    bilinear between the four nearest pixel centres
//   gain/loss Σ max(0, h[i+1] − h[i]) and Σ max(0, h[i] − h[i+1]) over the samples:
//             they depend on the spacing, which is printed with them

import { bilinear, lonLatToTile } from "./webmercator";

export type LonLat = [number, number];

export interface ProfileSample {
  lon: number;
  lat: number;
  /** Distance along the path from the first vertex, metres. */
  distM: number;
}

const D2R = Math.PI / 180;

function toVec([lon, lat]: LonLat): [number, number, number] {
  const cl = Math.cos(lat * D2R);
  return [cl * Math.cos(lon * D2R), cl * Math.sin(lon * D2R), Math.sin(lat * D2R)];
}

/** Great-circle point at fraction t from a to b (spherical linear interpolation). */
export function slerp(a: LonLat, b: LonLat, t: number): LonLat {
  if (t <= 0) return [a[0], a[1]];
  if (t >= 1) return [b[0], b[1]];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const w = Math.acos(dot);
  if (w < 1e-12) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  const x = ka * va[0] + kb * vb[0];
  const y = ka * va[1] + kb * vb[1];
  const z = ka * va[2] + kb * vb[2];
  return [Math.atan2(y, x) / D2R, Math.atan2(z, Math.hypot(x, y)) / D2R];
}

/** N samples evenly spaced along the path (N ≥ 2); consecutive duplicate vertices are skipped. */
export function profileSamples(points: LonLat[], n: number, segmentLength: (a: LonLat, b: LonLat) => number): ProfileSample[] {
  const segs: Array<{ a: LonLat; b: LonLat; start: number; len: number }> = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const len = segmentLength(a, b);
    if (!(len > 0)) continue;
    segs.push({ a, b, start: total, len });
    total += len;
  }
  if (!segs.length) return [];
  const count = Math.max(2, Math.floor(n));
  const out: ProfileSample[] = [];
  let s = 0;
  for (let k = 0; k < count; k++) {
    const d = (k / (count - 1)) * total;
    while (s < segs.length - 1 && d > segs[s].start + segs[s].len) s++;
    const seg = segs[s];
    const t = Math.max(0, Math.min(1, (d - seg.start) / seg.len));
    const [lon, lat] = slerp(seg.a, seg.b, t);
    out.push({ lon, lat, distM: d });
  }
  return out;
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/** Tiles (z/x/y keys) the samples fall in at zoom z. */
export function tilesFor(samples: ProfileSample[], z: number): string[] {
  const keys = new Set<string>();
  const n = 2 ** z;
  for (const s of samples) {
    const [fx, fy] = lonLatToTile(s.lon, s.lat, z);
    keys.add(tileKey(z, Math.min(n - 1, Math.floor(fx)), Math.min(n - 1, Math.floor(fy))));
  }
  return [...keys];
}

/** Deepest zoom ≤ maxZoom whose covering tiles number at most maxTiles (never below 0). */
export function chooseZoom(samples: ProfileSample[], maxTiles = 16, maxZoom = 15): number {
  for (let z = maxZoom; z > 0; z--) if (tilesFor(samples, z).length <= maxTiles) return z;
  return 0;
}

/** A decoded terrarium tile: `size` × `size` heights, north row first. */
export interface HeightTile {
  size: number;
  heights: ArrayLike<number>;
}

/** Height at each sample from decoded tiles; null where a tile is missing. */
export function sampleHeights(samples: ProfileSample[], z: number, tiles: Map<string, HeightTile>): Array<number | null> {
  const n = 2 ** z;
  return samples.map((s) => {
    const [fx, fy] = lonLatToTile(s.lon, s.lat, z);
    const tx = Math.min(n - 1, Math.floor(fx));
    const ty = Math.min(n - 1, Math.floor(fy));
    const t = tiles.get(tileKey(z, tx, ty));
    if (!t) return null;
    return bilinear(t.heights, t.size, t.size, (fx - tx) * t.size, (fy - ty) * t.size);
  });
}

export interface ProfileStats {
  lengthM: number;
  samples: number;
  /** Samples with a height (tiles that failed leave gaps). */
  valid: number;
  spacingM: number;
  minM?: number;
  maxM?: number;
  startM?: number;
  endM?: number;
  gainM?: number;
  lossM?: number;
}

export function profileStats(samples: ProfileSample[], heights: Array<number | null>): ProfileStats {
  const lengthM = samples.length ? samples[samples.length - 1].distM : 0;
  const spacingM = samples.length > 1 ? lengthM / (samples.length - 1) : 0;
  const valid = heights.filter((h): h is number => h != null && Number.isFinite(h));
  const out: ProfileStats = { lengthM, samples: samples.length, valid: valid.length, spacingM };
  if (!valid.length) return out;
  out.minM = Math.min(...valid);
  out.maxM = Math.max(...valid);
  out.startM = heights[0] ?? undefined;
  out.endM = heights[heights.length - 1] ?? undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 0; i + 1 < heights.length; i++) {
    const a = heights[i];
    const b = heights[i + 1];
    if (a == null || b == null) continue;
    if (b > a) gain += b - a;
    else loss += a - b;
  }
  out.gainM = gain;
  out.lossM = loss;
  return out;
}
