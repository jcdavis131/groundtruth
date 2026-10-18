"use client";
// Measure tools: geodesic distance and area of a drawn shape, the overlay
// that draws it on the globe, and the click handler that adds vertices or
// asks USGS for the ground elevation.
//
//   distance   geodesic length on the WGS84 ellipsoid (Cesium EllipsoidGeodesic,
//              an iterative inverse solution), summed over the segments
//   area       spherical excess on the authalic sphere: each vertex's geodetic
//              latitude becomes its authalic latitude (the equal-area mapping
//              of the ellipsoid onto a sphere of radius Rq = 6,371,007.2 m), then
//              A = Rq² · |Σ 2·atan2(tan(Δλ/2)·(tan(β1/2) + tan(β2/2)), 1 + tan(β1/2)·tan(β2/2))|
//              with great-circle edges. Area-preserving by construction; only the
//              edge shape differs from a true ellipsoidal geodesic, which is
//              negligible at the scale anyone draws by hand.
//   elevation  USGS 3DEP Elevation Point Query Service through /api/land
//
// Nothing here is persisted; the shape lives in the store and in share links.

import type * as CesiumNS from "cesium";
import { getCesium } from "./cesium";
import { useGlobe, type ElevationPick, type MeasureMode, type MeasureState, type Shape } from "@/lib/store/globe";
import { useStrata } from "@/lib/fabric/strataStore";

const WGS84_A = 6_378_137;
const WGS84_E2 = 0.00669437999014;
const WGS84_E = Math.sqrt(WGS84_E2);
const D2R = Math.PI / 180;

/** q(φ) from the authalic-latitude derivation (Snyder 1987, eq. 3-12). */
function q(sinPhi: number): number {
  const es = WGS84_E * sinPhi;
  return (1 - WGS84_E2) * (sinPhi / (1 - es * es) - (1 / (2 * WGS84_E)) * Math.log((1 - es) / (1 + es)));
}
const QP = q(1);
/** Authalic radius: the sphere with the same surface area as the WGS84 ellipsoid. */
export const AUTHALIC_RADIUS_M = WGS84_A * Math.sqrt(QP / 2);

function authalicLat(latDeg: number): number {
  const r = q(Math.sin(latDeg * D2R)) / QP;
  return Math.asin(Math.max(-1, Math.min(1, r)));
}

/** Area in m² of a closed ring of [lon, lat] (first vertex not repeated). */
export function ringArea(points: Array<[number, number]>): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = points[i];
    const [lon2, lat2] = points[(i + 1) % n];
    let dl = (lon2 - lon1) * D2R;
    if (dl > Math.PI) dl -= 2 * Math.PI;
    if (dl < -Math.PI) dl += 2 * Math.PI;
    const t1 = Math.tan(authalicLat(lat1) / 2);
    const t2 = Math.tan(authalicLat(lat2) / 2);
    sum += 2 * Math.atan2(Math.tan(dl / 2) * (t1 + t2), 1 + t1 * t2);
  }
  return Math.abs(sum) * AUTHALIC_RADIUS_M * AUTHALIC_RADIUS_M;
}

function geodesic(a: [number, number], b: [number, number]): CesiumNS.EllipsoidGeodesic {
  const C = getCesium();
  return new C.EllipsoidGeodesic(C.Cartographic.fromDegrees(a[0], a[1]), C.Cartographic.fromDegrees(b[0], b[1]), C.Ellipsoid.WGS84);
}

/** Geodesic length of one segment on the WGS84 ellipsoid, metres (the same as the measure readout). */
export function geodesicLength(a: [number, number], b: [number, number]): number {
  return geodesic(a, b).surfaceDistance;
}

export interface Measurement {
  /** Path length (line) or perimeter (area), metres. */
  lengthM: number;
  areaM2?: number;
  segments: number;
  formula: string[];
}

export function measureShape(shape: Shape): Measurement {
  const pts = shape.points;
  const closed = shape.kind === "area" && pts.length >= 3;
  let lengthM = 0;
  let segments = 0;
  const edges = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    lengthM += geodesic(a, b).surfaceDistance;
    segments++;
  }
  const formula = [
    `${closed ? "perimeter" : "length"} = Σ geodesic distance on the WGS84 ellipsoid over ${segments} segment${segments === 1 ? "" : "s"} (Cesium EllipsoidGeodesic)`,
  ];
  if (!closed) return { lengthM, segments, formula };
  formula.push(
    `area = Rq² · |Σ 2·atan2(tan(Δλ/2)·(tan(β1/2)+tan(β2/2)), 1+tan(β1/2)·tan(β2/2))|, β = authalic latitude, Rq = ${AUTHALIC_RADIUS_M.toFixed(1)} m (equal-area sphere of WGS84), great-circle edges`,
  );
  return { lengthM, areaM2: ringArea(pts), segments, formula };
}

export function fmtLength(m: number): string {
  const mi = m / 1609.344;
  if (m < 1000) return `${m.toFixed(1)} m · ${(m / 0.3048).toFixed(0)} ft`;
  return `${(m / 1000).toFixed(m < 100_000 ? 3 : 1)} km · ${mi.toFixed(mi < 100 ? 3 : 1)} mi`;
}

export function fmtArea(m2: number): string {
  const acres = m2 / 4046.8564224;
  const km2 = m2 / 1e6;
  if (km2 < 1) return `${Math.round(m2).toLocaleString("en-US")} m² · ${acres.toFixed(acres < 10 ? 2 : 1)} ac`;
  return `${km2.toLocaleString("en-US", { maximumFractionDigits: 3 })} km² · ${Math.round(acres).toLocaleString("en-US")} ac · ${(km2 / 2.589988110336).toFixed(3)} mi²`;
}

// ---------------------------------------------------------------- clicks

/** Most vertices a shape holds (and a share link carries). */
export const MAX_POINTS = 60;

/**
 * Switch a measure tool on (or off). Turning one on ends the strata rail's
 * wait for a pin-B tap, so the next click has one meaning; `patch` sets the
 * shape or elevation in the same update.
 */
export function setMeasureMode(mode: MeasureMode, patch: Partial<Omit<MeasureState, "mode">> = {}): void {
  if (mode !== "off") useStrata.getState().setPicking(false);
  useGlobe.getState().setMeasure({ ...patch, mode });
}

/** Whether the measure panel has anything to show: a tool on, a shape or an elevation reading. */
export function measureOpen(m: MeasureState): boolean {
  return m.mode !== "off" || !!m.shape || !!m.elevation;
}

/** Handle a globe click while a measure tool is active. Returns true when it consumed the click. */
export function measureClick(lon: number, lat: number): boolean {
  const st = useGlobe.getState();
  const m = st.measure;
  if (m.mode === "off") return false;
  if (m.mode === "elevation") {
    void pickElevation(lon, lat);
    return true;
  }
  const kind: Shape["kind"] = m.mode === "area" ? "area" : "line";
  const prev = m.shape && m.shape.kind === kind ? m.shape.points : [];
  if (prev.length >= MAX_POINTS) return true;
  st.setMeasure({ shape: { kind, points: [...prev, [round5(lon), round5(lat)]] } });
  return true;
}

function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

let elevationSeq = 0;

export async function pickElevation(lon: number, lat: number): Promise<void> {
  const seq = ++elevationSeq;
  const set = (e: ElevationPick) => {
    if (seq === elevationSeq) useGlobe.getState().setMeasure({ elevation: e });
  };
  set({ lon, lat, loading: true });
  try {
    const res = await fetch(`/api/land?op=elevation&lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}`);
    const j = (await res.json()) as { data?: { metres?: number; resolutionM?: number; note?: string }; error?: string };
    if (!res.ok) throw new Error(j.error ?? `${res.status}`);
    set({ lon, lat, loading: false, metres: j.data?.metres, resolutionM: j.data?.resolutionM, note: j.data?.note });
  } catch (err) {
    set({ lon, lat, loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------- overlay

const COLOR = "#FFE45E";

/** Draws the store's shape and elevation pick on the globe; returns a disposer. */
export function startMeasureOverlay(viewer: CesiumNS.Viewer): () => void {
  const C = getCesium();
  const scene = viewer.scene;
  const lines = scene.primitives.add(new C.PolylineCollection());
  const points = scene.primitives.add(new C.PointPrimitiveCollection());
  const labels = scene.primitives.add(new C.LabelCollection({ scene }));
  const color = C.Color.fromCssColorString(COLOR);

  const addLabel = (lon: number, lat: number, text: string) =>
    labels.add({
      text,
      position: C.Cartesian3.fromDegrees(lon, lat, 0),
      font: "12px Geist Mono, JetBrains Mono, Consolas, monospace",
      fillColor: color,
      outlineColor: C.Color.BLACK.withAlpha(0.9),
      outlineWidth: 3,
      style: C.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new C.Cartesian2(12, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });

  const draw = (m: MeasureState) => {
    if (viewer.isDestroyed()) return;
    lines.removeAll();
    points.removeAll();
    labels.removeAll();
    const shape = m.shape;
    if (shape && shape.points.length) {
      const pts = shape.points;
      for (const p of pts) {
        points.add({
          position: C.Cartesian3.fromDegrees(p[0], p[1], 0),
          pixelSize: 7,
          color,
          outlineColor: C.Color.BLACK.withAlpha(0.8),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
      const closed = shape.kind === "area" && pts.length >= 3;
      const edges = closed ? pts.length : pts.length - 1;
      const flat: number[] = [];
      for (let i = 0; i < edges; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        if (flat.length === 0) flat.push(a[0], a[1], 0);
        // Densify along the geodesic so long edges hug the surface instead of cutting through it.
        const g = geodesic(a, b);
        const steps = Math.max(1, Math.min(64, Math.ceil(g.surfaceDistance / 20_000)));
        for (let k = 1; k <= steps; k++) {
          const c = g.interpolateUsingFraction(k / steps);
          flat.push(C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude), 0);
        }
      }
      if (flat.length >= 6) {
        lines.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(flat),
          width: 2.5,
          material: C.Material.fromType("Color", { color: color.withAlpha(0.95) }),
        });
      }
      if (pts.length >= 2) {
        const mm = measureShape(shape);
        const last = pts[pts.length - 1];
        addLabel(last[0], last[1], mm.areaM2 != null ? fmtArea(mm.areaM2) : fmtLength(mm.lengthM));
      }
    }
    const e = m.elevation;
    if (e) {
      points.add({
        position: C.Cartesian3.fromDegrees(e.lon, e.lat, 0),
        pixelSize: 9,
        color: C.Color.fromCssColorString("#5EF2C2"),
        outlineColor: C.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      const text = e.loading
        ? "elevation…"
        : e.metres != null
          ? `${e.metres.toFixed(1)} m · ${(e.metres / 0.3048).toFixed(0)} ft`
          : e.error
            ? "elevation unavailable"
            : "no 3DEP data here";
      labels.add({
        text,
        position: C.Cartesian3.fromDegrees(e.lon, e.lat, 0),
        font: "12px Geist Mono, JetBrains Mono, Consolas, monospace",
        fillColor: C.Color.fromCssColorString("#5EF2C2"),
        outlineColor: C.Color.BLACK.withAlpha(0.9),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(12, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  };

  draw(useGlobe.getState().measure);
  const unsub = useGlobe.subscribe((s, prev) => {
    if (s.measure !== prev.measure) draw(s.measure);
  });
  return () => {
    unsub();
    if (viewer.isDestroyed()) return;
    for (const c of [lines, points, labels]) if (scene.primitives.contains(c)) scene.primitives.remove(c);
  };
}
