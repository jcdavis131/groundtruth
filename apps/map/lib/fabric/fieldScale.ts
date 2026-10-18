// The construct field's scale logic: which kinds can tile a view, which kind
// emerges for a point of view at a camera height, and how a bbox is clamped
// and generalised. No data tables here, so the browser layer can import it.

import type { ConstructKind, Domain } from "./types";

export type FieldService = "tiger" | "wbd" | "eco";

export interface FieldSpec {
  kind: ConstructKind;
  service: FieldService;
  layer: number;
  /** Widest bbox side, degrees, the upstream is asked about for this kind. */
  maxSpanDeg: number;
}

export const FIELD_SPECS: Partial<Record<ConstructKind, FieldSpec>> = {
  state: { kind: "state", service: "tiger", layer: 80, maxSpanDeg: 360 },
  county: { kind: "county", service: "tiger", layer: 82, maxSpanDeg: 14 },
  place: { kind: "place", service: "tiger", layer: 28, maxSpanDeg: 3 },
  cd: { kind: "cd", service: "tiger", layer: 54, maxSpanDeg: 30 },
  sldu: { kind: "sldu", service: "tiger", layer: 56, maxSpanDeg: 8 },
  sldl: { kind: "sldl", service: "tiger", layer: 58, maxSpanDeg: 4 },
  cbsa: { kind: "cbsa", service: "tiger", layer: 93, maxSpanDeg: 24 },
  tract: { kind: "tract", service: "tiger", layer: 8, maxSpanDeg: 0.8 },
  zcta: { kind: "zcta", service: "tiger", layer: 2, maxSpanDeg: 1.5 },
  school: { kind: "school", service: "tiger", layer: 14, maxSpanDeg: 4 },
  huc2: { kind: "huc2", service: "wbd", layer: 1, maxSpanDeg: 360 },
  huc4: { kind: "huc4", service: "wbd", layer: 2, maxSpanDeg: 60 },
  huc6: { kind: "huc6", service: "wbd", layer: 3, maxSpanDeg: 25 },
  huc8: { kind: "huc8", service: "wbd", layer: 4, maxSpanDeg: 10 },
  huc10: { kind: "huc10", service: "wbd", layer: 5, maxSpanDeg: 3 },
  huc12: { kind: "huc12", service: "wbd", layer: 6, maxSpanDeg: 1.2 },
  eco3: { kind: "eco3", service: "eco", layer: 11, maxSpanDeg: 60 },
  eco4: { kind: "eco4", service: "eco", layer: 7, maxSpanDeg: 12 },
};

export type FieldPov = Extract<Domain, "hydrologic" | "civic" | "representation" | "statistical" | "ecological" | "service">;

export const FIELD_POVS: readonly FieldPov[] = ["hydrologic", "civic", "representation", "statistical", "ecological", "service"];

/** Camera height (m) at or above which each kind takes over, per point of view; first match wins. */
const LADDER: Record<FieldPov, Array<[minHeight: number, kind: ConstructKind]>> = {
  hydrologic: [[5e6, "huc2"], [2e6, "huc4"], [8e5, "huc6"], [2.5e5, "huc8"], [8e4, "huc10"], [0, "huc12"]],
  civic: [[2.5e6, "state"], [1.2e5, "county"], [0, "place"]],
  representation: [[4e6, "state"], [6e5, "cd"], [1.5e5, "sldu"], [0, "sldl"]],
  statistical: [[3e6, "state"], [6e5, "cbsa"], [1e5, "county"], [0, "tract"]],
  ecological: [[5e5, "eco3"], [0, "eco4"]],
  service: [[1e6, "state"], [0, "school"]],
};

/** The kind that emerges for a point of view at a camera height. */
export function kindForScale(pov: FieldPov, height: number): ConstructKind {
  for (const [min, kind] of LADDER[pov]) if (height >= min) return kind;
  return LADDER[pov][LADDER[pov].length - 1][1];
}

export function isFieldKind(k: string): k is ConstructKind {
  return k in FIELD_SPECS;
}

export type BBox = [number, number, number, number];

/**
 * Clamp a bbox to what the kind may ask for and make it stable under small
 * pans: the span is rounded up a power-of-two ladder from the kind's widest
 * span, and the centre is snapped to an eighth of that span. Two views a few
 * kilometres apart therefore ask the same box and share a cache entry.
 */
export function clampFieldBbox(kind: ConstructKind, bbox: BBox): BBox {
  const max = FIELD_SPECS[kind]?.maxSpanDeg ?? 1;
  const [w0, s0, e0, n0] = bbox;
  const want = Math.max(0.05, e0 - w0, n0 - s0);
  let span = Math.min(max, 360);
  while (span / 2 >= want && span / 2 >= 0.05) span /= 2;
  const grid = span / 8;
  const snap = (v: number) => Math.round(v / grid) * grid;
  const cx = snap((w0 + e0) / 2);
  const cy = snap((s0 + n0) / 2);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(Math.max(-180, cx - span / 2)), r(Math.max(-85, cy - span / 2)), r(Math.min(180, cx + span / 2)), r(Math.min(85, cy + span / 2))];
}

/** Server-side generalisation for a bbox: about 400 vertices across the widest side. */
export function fieldOffset(bbox: BBox): number {
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  return Math.min(0.05, Math.max(0.0005, Math.round((span / 400) * 1e5) / 1e5));
}

