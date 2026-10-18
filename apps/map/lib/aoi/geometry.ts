// Plane geometry on lon/lat for a hand-drawn area: which loaded features it
// holds, and how much of a line or a polygon layer falls inside it. The area
// is the Measure tool's drawn polygon (Shape kind "area"); a feature is
// "inside" when any part of it is. Lengths are geodesic on the WGS84
// ellipsoid's mean radius per step (haversine), areas come from the Measure
// tool's authalic-sphere formula. Pure, tested.

import type { LayerFeature } from "@/lib/layers/types";

export type LonLat = [number, number];
export type Ring = LonLat[];
export type Box = [number, number, number, number];

export function ringBox(ring: number[][]): Box {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of ring) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

export function boxesTouch(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function inBox(lon: number, lat: number, b: Box): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Even-odd point-in-ring on [lon, lat]; the ring may or may not repeat its first vertex. */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a polygon given as [outer, ...holes]. */
export function pointInPolygon(lon: number, lat: number, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (pointInRing(lon, lat, rings[k])) return false;
  return true;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Whether segments p1-p2 and q1-q2 cross or touch. */
export function segmentsCross(p1: number[], p2: number[], q1: number[], q2: number[]): boolean {
  const d1 = orient(q1[0], q1[1], q2[0], q2[1], p1[0], p1[1]);
  const d2 = orient(q1[0], q1[1], q2[0], q2[1], p2[0], p2[1]);
  const d3 = orient(p1[0], p1[1], p2[0], p2[1], q1[0], q1[1]);
  const d4 = orient(p1[0], p1[1], p2[0], p2[1], q2[0], q2[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: number[], b: number[], c: number[]) =>
    Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  if (d1 === 0 && on(q1, q2, p1)) return true;
  if (d2 === 0 && on(q1, q2, p2)) return true;
  if (d3 === 0 && on(p1, p2, q1)) return true;
  if (d4 === 0 && on(p1, p2, q2)) return true;
  return false;
}

/** Whether a polyline touches a ring: a vertex inside it, or an edge crossing it. */
function lineTouchesRing(line: number[][], ring: Ring, box: Box): boolean {
  if (!boxesTouch(ringBox(line), box)) return false;
  for (const c of line) if (inBox(c[0], c[1], box) && pointInRing(c[0], c[1], ring)) return true;
  for (let i = 1; i < line.length; i++) {
    for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
      if (segmentsCross(line[i - 1], line[i], ring[k], ring[j])) return true;
    }
  }
  return false;
}

/** The line parts of a line feature. */
export function lineParts(g: GeoJSON.Geometry): number[][][] {
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

/** The polygons of a polygon feature, each [outer, ...holes]. */
export function polygons(g: GeoJSON.Geometry): number[][][][] {
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

/** A feature's representative point: a Point's position, else its published anchor. */
export function featurePoint(f: LayerFeature): LonLat | null {
  const g = f.geometry;
  if (g.type === "Point") return [g.coordinates[0], g.coordinates[1]];
  const a = f.properties.anchor;
  return a && Number.isFinite(a[0]) && Number.isFinite(a[1]) ? [a[0], a[1]] : null;
}

/** Whether any part of a feature is inside the area. */
export function featureInside(f: LayerFeature, ring: Ring, box: Box = ringBox(ring)): boolean {
  const g = f.geometry;
  if (!g) return false;
  if (g.type === "Point") {
    const [lon, lat] = g.coordinates;
    return inBox(lon, lat, box) && pointInRing(lon, lat, ring);
  }
  if (g.type === "LineString" || g.type === "MultiLineString") return lineParts(g).some((l) => lineTouchesRing(l, ring, box));
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    for (const poly of polygons(g)) {
      const outer = poly[0];
      if (!outer?.length || !boxesTouch(ringBox(outer), box)) continue;
      if (lineTouchesRing(outer, ring, box)) return true;
      // The area wholly inside the polygon (and not in a hole).
      if (pointInPolygon(ring[0][0], ring[0][1], poly)) return true;
    }
    return false;
  }
  return false;
}

const R = 6_371_008.8;
const D2R = Math.PI / 180;

/** Great-circle metres on the mean Earth radius. */
export function metres(a: number[], b: number[]): number {
  const dLat = (b[1] - a[1]) * D2R;
  const dLon = (b[0] - a[0]) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longest step (metres) a line is cut into when measuring how much of it lies inside. */
export const LINE_STEP_M = 200;

/**
 * Metres of a line inside the area: each segment is cut into equal steps of at most
 * LINE_STEP_M and a step counts when its midpoint is inside, so the error is under one
 * step at each place the line crosses the edge.
 */
export function lengthInside(line: number[][], ring: Ring, box: Box = ringBox(ring)): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const seg = metres(a, b);
    if (seg === 0) continue;
    const n = Math.max(1, Math.ceil(seg / LINE_STEP_M));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const lon = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      if (inBox(lon, lat, box) && pointInRing(lon, lat, ring)) total += seg / n;
    }
  }
  return total;
}

/** A regular grid of sample points inside the area, at most about `max`, with its spacing. */
export function sampleGrid(ring: Ring, max = 2500): { points: LonLat[]; spacingM: number } {
  const box = ringBox(ring);
  const midLat = (box[1] + box[3]) / 2;
  const kx = Math.cos(midLat * D2R);
  const wDeg = (box[2] - box[0]) * kx;
  const hDeg = box[3] - box[1];
  if (!(wDeg > 0 && hDeg > 0)) return { points: [], spacingM: 0 };
  // Spacing in degrees of latitude so the box holds about `max` points.
  const step = Math.sqrt((wDeg * hDeg) / max);
  const points: LonLat[] = [];
  for (let lat = box[1] + step / 2; lat < box[3]; lat += step) {
    for (let lon = box[0] + step / kx / 2; lon < box[2]; lon += step / kx) {
      if (pointInRing(lon, lat, ring)) points.push([lon, lat]);
    }
  }
  return { points, spacingM: step * 111_195 };
}
