// Shared by the zoning, permits, licences and environmental-permits layers:
// the box a near-only layer loaded, drawn as a dashed outline, and the view
// key that asks for a new box only when the camera target leaves a grid cell.
// Ground outside the box was never loaded, which must not read as "nothing
// there" (the flood layer's rule, lib/layers/flood.ts).

import type { Bbox } from "@/lib/zoning/features";
import type { LayerFeature, LayerId, ViewState } from "./types";

/** The box a layer loaded, as a dashed outline feature (kind "loaded-box"; never counted or searched). */
export function civicLoadedBox(layer: LayerId, b: Bbox, what: string): LayerFeature {
  const [w, s, e, n] = b;
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    properties: {
      id: `${layer}:loaded-box`,
      layer,
      name: "Loaded area",
      kind: "loaded-box",
      source: "this app",
      details: {
        "what this is": `the box ${what} were loaded for. Outside it nothing is loaded, which is not the same as none being there`,
        box: `${w}, ${s} to ${e}, ${n}`,
      },
    },
  };
}

/** "above" over `max` metres; otherwise the grid cell of the camera target. */
export function civicViewKey(max: number, grid: number) {
  return (v: ViewState) => (v.height > max ? "above" : `${Math.round(v.lon / grid)},${Math.round(v.lat / grid)}`);
}

/** Centre of the view key's cell, so every viewer in a cell sends the same box. */
export function cellCentre(v: ViewState, grid: number): { lon: number; lat: number } {
  return { lon: Math.round(v.lon / grid) * grid, lat: Math.round(v.lat / grid) * grid };
}

export function isLoadedBox(f: LayerFeature): boolean {
  return f.properties.kind === "loaded-box";
}

/**
 * A box around the view key's cell, `halfLat` degrees tall each way and about
 * as wide on the ground, with every edge on the route's `routeGrid` so the
 * route's snapping does not grow it. `halfLat` and `keyGrid` must be
 * multiples of `routeGrid`.
 */
export function gridBox(lon: number, lat: number, halfLat: number, keyGrid: number, routeGrid: number): Bbox {
  const c = { lon: Math.round(lon / keyGrid) * keyGrid, lat: Math.round(lat / keyGrid) * keyGrid };
  const halfLon = Math.max(routeGrid, Math.round(halfLat / Math.max(Math.cos((c.lat * Math.PI) / 180), 0.2) / routeGrid) * routeGrid);
  const r = (x: number) => Number(x.toFixed(4));
  return [r(c.lon - halfLon), r(c.lat - halfLat), r(c.lon + halfLon), r(c.lat + halfLat)];
}
