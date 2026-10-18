// Layer: flood zones. FEMA's regulatory flood map around the camera
// target: which ground is inside the 1 % annual-chance floodplain, the base
// flood elevation where FEMA published one, and the FIRM database it comes from.
//
//   FEMA NFHL layer 28   flood hazard zones (S_FLD_HAZ_AR) through /api/land,
//                        which retries FEMA's connection resets and caches each
//                        snapped box for a day
//
// FEMA itself draws these only finer than about 1:36,000, so the layer loads
// below FLOOD_MAX_HEIGHT_M. It is a regulatory map, not a forecast: it says
// nothing about whether anything is flooding now (the Surface water layer's
// NWS flood categories do that).
//
// Zones are loaded for one box around the camera target (the largest the
// route serves), and that box is drawn as a dashed outline: ground outside it
// is not loaded, which must never read as "not in a floodplain".

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, LayerId, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";

export type { FloodZoneExtra } from "@/lib/land/features";

export const FLOOD_MAX_HEIGHT_M = 5_000;

/** Radius of the box asked for; the route clamps flood and wetland boxes to 0.08 degrees anyway. */
export const LAND_BOX_RADIUS_M = 4_500;
/** View-key grid in degrees: a new box every ~4 km of pan, half the box, so the target stays well inside it. */
export const LAND_KEY_GRID = 0.04;

/** View key for the up-close land layers; height only matters for the "above" cut-off, since the box is fixed. */
export function nearViewKey(max: number, grid = LAND_KEY_GRID) {
  return (v: ViewState) => (v.height > max ? "above" : `${Math.round(v.lon / grid)},${Math.round(v.lat / grid)}`);
}

const memos: Record<"flood" | "wetlands", FeatureMemo> = { flood: new FeatureMemo(), wetlands: new FeatureMemo() };

/** The box a land layer loaded, as a dashed outline feature (kind "loaded-box"; never counted or searched). */
export function loadedBoxFeature(layer: LayerId, b: [number, number, number, number], what: string): LayerFeature {
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

export async function fetchLandBox(
  ctx: FetchContext,
  op: "flood" | "wetlands",
  maxHeight: number,
): Promise<{ features: LayerFeature[]; truncated: boolean; loaded: [number, number, number, number]; meta: Record<string, unknown> } | null> {
  if (ctx.view.height > maxHeight) return null;
  // Centred on the view key's cell rather than the exact target, so every viewer in the
  // same cell sends the same request and shares the route's cache entry.
  const lon = Math.round(ctx.view.lon / LAND_KEY_GRID) * LAND_KEY_GRID;
  const lat = Math.round(ctx.view.lat / LAND_KEY_GRID) * LAND_KEY_GRID;
  const bbox = bboxAround(lat, lon, LAND_BOX_RADIUS_M);
  const env = await proxy<FeatureCollection>(`/api/land?op=${op}&bbox=${bbox.map((x) => x.toFixed(4)).join(",")}`, ctx);
  const meta = env as unknown as Record<string, unknown> & { truncated?: boolean; bbox?: [number, number, number, number] };
  return {
    features: memos[op].stable(env.data.features as unknown as LayerFeature[]),
    truncated: !!meta.truncated,
    // The route's snapped box is what was actually loaded.
    loaded: Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : bbox,
    meta,
  };
}

async function fetchFlood(ctx: FetchContext): Promise<FetchResult> {
  const r = await fetchLandBox(ctx, "flood", FLOOD_MAX_HEIGHT_M);
  if (!r) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "FEMA NFHL",
      fetchedAt: ctx.now,
      note: `descend below ${FLOOD_MAX_HEIGHT_M / 1000} km for FEMA flood zones (FEMA draws them only finer than 1:36,000)`,
      meta: { count: 0 },
    };
  }
  const sfha = r.features.filter((f) => f.properties.kind === "sfha" || f.properties.kind === "coastal").length;
  return {
    collection: { type: "FeatureCollection", features: [...r.features, loadedBoxFeature("flood", r.loaded, "FEMA flood zones")] },
    source: "FEMA NFHL",
    fetchedAt: ctx.now,
    note:
      `${r.features.length} zones to click inside the dashed box (outside it: none loaded to click, not "no flood zone"; FEMA's own map is drawn across the view) · ${sfha} in the 1 % annual-chance floodplain · regulatory map, not a forecast` +
      (r.truncated ? " · FEMA record limit hit, zoom in" : ""),
    meta: { count: r.features.length },
  };
}

export const floodLayer: LayerDefinition = {
  id: "flood",
  label: "Flood zones (FEMA)",
  description:
    "FEMA's National Flood Hazard Layer below 5 km: flood zones (AE, VE, X…), whether ground is in the special flood hazard area, and the base flood elevation where published, inside a dashed box around the view, over FEMA's own map of the zones. A regulatory map, not a forecast.",
  color: "#3B82F6",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: nearViewKey(FLOOD_MAX_HEIGHT_M),
  attribution: "FEMA National Flood Hazard Layer (regulatory map, not a forecast)",
  fetch: fetchFlood,
};
