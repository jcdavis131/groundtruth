// Esri JSON polygons -> GeoJSON. ArcGIS `identify` answers in Esri JSON only
// (no f=geojson), where a polygon is a flat list of rings: outer rings run
// clockwise and holes counter-clockwise. GeoJSON wants each hole inside its
// outer ring, so holes are assigned to the outer ring that contains them.

import type { MultiPolygon, Polygon, Position } from "geojson";

/** Twice the signed area; positive for clockwise rings in lon/lat (y up). */
function signed2(ring: number[][]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[i][0] - ring[j][0]) * (ring[i][1] + ring[j][1]);
  return s;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Esri `{ rings }` -> Polygon or MultiPolygon; null when there is no usable ring. */
export function ringsToGeometry(rings: unknown): Polygon | MultiPolygon | null {
  if (!Array.isArray(rings)) return null;
  const clean = rings.filter((r): r is number[][] => Array.isArray(r) && r.length >= 4 && r.every((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)));
  if (!clean.length) return null;
  const outers: Position[][][] = [];
  const holes: number[][][] = [];
  for (const r of clean) {
    const ring = r.map((p) => [p[0], p[1]]);
    if (signed2(ring) >= 0) outers.push([ring]);
    else holes.push(ring);
  }
  // A service that wrote every ring counter-clockwise: treat them all as outer rings.
  if (!outers.length) return holes.length === 1 ? { type: "Polygon", coordinates: [holes[0]] } : { type: "MultiPolygon", coordinates: holes.map((h) => [h]) };
  for (const h of holes) {
    const [x, y] = h[0];
    const owner = outers.find((o) => inRing(x, y, o[0] as number[][])) ?? outers[0];
    owner.push(h);
  }
  return outers.length === 1 ? { type: "Polygon", coordinates: outers[0] } : { type: "MultiPolygon", coordinates: outers };
}

/** [w, s, e, n] of a polygon's outer rings. */
export function geometryBbox(g: Polygon | MultiPolygon): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys) {
    for (const [x, y] of p[0] ?? []) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/** Whether [lon, lat] is inside a polygon (holes excluded). */
export function pointInGeometry(lon: number, lat: number, g: Polygon | MultiPolygon): boolean {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((p) => {
    if (!p[0] || !inRing(lon, lat, p[0] as number[][])) return false;
    return !p.slice(1).some((h) => inRing(lon, lat, h as number[][]));
  });
}
