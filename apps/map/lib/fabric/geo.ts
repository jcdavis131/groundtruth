// Small geometry helpers for the fabric: point-in-polygon over Esri-style
// ring lists, a bounding box, and coordinate rounding to keep payloads small.
// Pure; used on the server (country lookup) and in the browser (joining
// loaded features to a construct).

/** Even-odd point in polygon over every ring (outer rings and holes alike). */
export function ringsContain(rings: number[][][], lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export type BBox = [west: number, south: number, east: number, north: number];

export function ringsBbox(rings: number[][][]): BBox | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function bboxContains(b: BBox, lon: number, lat: number): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Round every coordinate to `digits` decimals (4 ≈ 11 m) and drop repeated vertices. */
export function roundRings(rings: number[][][], digits = 4): number[][][] {
  const k = 10 ** digits;
  const out: number[][][] = [];
  for (const ring of rings) {
    const r: number[][] = [];
    for (const p of ring) {
      const x = Math.round(p[0] * k) / k;
      const y = Math.round(p[1] * k) / k;
      const last = r[r.length - 1];
      if (!last || last[0] !== x || last[1] !== y) r.push([x, y]);
    }
    if (r.length >= 4) out.push(r);
  }
  return out;
}

/** GeoJSON Polygon / MultiPolygon coordinates flattened to a ring list. */
export function geojsonRings(geometry: { type: string; coordinates: unknown }): number[][][] {
  if (geometry.type === "Polygon") return geometry.coordinates as number[][][];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).flat();
  return [];
}

const KM_PER_DEG = 111.32;

/** Signed shoelace area of one ring in km², on a local equirectangular projection. */
function ringSignedArea(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let lat0 = 0;
  for (const p of ring) lat0 += p[1];
  const k = Math.cos(((lat0 / ring.length) * Math.PI) / 180) * KM_PER_DEG;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * k * ring[i][1] * KM_PER_DEG - ring[i][0] * k * ring[j][1] * KM_PER_DEG;
  return a / 2;
}

/**
 * Area of a ring list in km². Esri polygons wind outer rings one way and
 * holes the other, so the signed sum is outers minus holes. An estimate from
 * a generalised outline; callers label it as computed.
 */
export function ringsArea(rings: number[][][]): number {
  let a = 0;
  for (const r of rings) a += ringSignedArea(r);
  return Math.abs(a);
}

/** Centroid of the largest ring, [lon, lat]. */
export function ringCentroid(rings: number[][][]): [number, number] | null {
  let best: number[][] | null = null;
  let bestA = 0;
  for (const r of rings) {
    const a = Math.abs(ringSignedArea(r));
    if (a > bestA) {
      bestA = a;
      best = r;
    }
  }
  if (!best) return rings[0]?.[0] ? [rings[0][0][0], rings[0][0][1]] : null;
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
    cx += (best[j][0] + best[i][0]) * f;
    cy += (best[j][1] + best[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) return [best[0][0], best[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Great-circle distance in km. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
