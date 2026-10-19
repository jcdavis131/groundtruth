// Layer: historic topographic maps. USGS's Historical Topographic Map
// Collection (1879-2006, every scale and edition), one edition year at a
// time, drawn from Esri's HTMC ImageServer over the base imagery. The year is
// a setting (the picker under the layer's row, and `ty=` in links); none set
// means the newest edition at the view centre.
//
// The fetch asks /api/terrain?op=topo for the edition years and sheets at the
// view centre (snapped to 0.01 degrees there, held 30 days) and passes the
// year to draw in `meta`; the style builds the tiles from it
// (lib/globe/terrainStyles.ts). Years are offered only where a sheet exists
// at the centre: a year with no sheet under a tile draws blank. Tiles draw
// only from about level 11 (about 10 km or closer): a coarser tile is blank.

import { create } from "zustand";
import type { FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { proxy } from "./aircraft";
import { HTMC_ATTRIBUTION, resolveTopoYear, type TopoSheet, type TopoYear } from "@/lib/terrain/topo";

/** Above this camera height the years at the centre are not asked for. */
export const TOPO_LIST_MAX_M = 150_000;
/** The view-centre grid the years are asked on (the route snaps to the same). */
const KEY_GRID = 0.01;

/** The edition years at the view centre, for the picker (set by the layer's fetch). */
export interface TopoHere {
  lon: number;
  lat: number;
  years: TopoYear[];
}
export const useTopoHere = create<{ here: TopoHere | null; set: (h: TopoHere | null) => void }>()((set) => ({
  here: null,
  set: (here) => set({ here }),
}));

export function topoViewKey(v: ViewState): string {
  return v.height > TOPO_LIST_MAX_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`;
}

async function fetchTopo(ctx: FetchContext): Promise<FetchResult> {
  const base = { collection: { type: "FeatureCollection" as const, features: [] }, source: "USGS Historical Topographic Map Collection", fetchedAt: ctx.now };
  if (ctx.view.height > TOPO_LIST_MAX_M) {
    useTopoHere.getState().set(null);
    return { ...base, note: `descend below ${TOPO_LIST_MAX_M / 1000} km for the USGS topographic map editions here; the maps draw from about 10 km`, meta: { picture: true, count: 0, topoYear: null } };
  }
  const lon = Math.round(ctx.view.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(ctx.view.lat / KEY_GRID) * KEY_GRID;
  const env = await proxy<{ lon: number; lat: number; years: TopoYear[]; sheets: TopoSheet[] }>(`/api/terrain?op=topo&lon=${lon.toFixed(2)}&lat=${lat.toFixed(2)}`, ctx);
  const years = env.data.years ?? [];
  useTopoHere.getState().set({ lon: env.data.lon, lat: env.data.lat, years });
  const { year, present, nearest } = resolveTopoYear(years, ctx.options.topoYear);
  const meta: Record<string, unknown> = { picture: true, count: 0, topoYear: year, topoPresent: present, topoYears: years.length };
  let note: string;
  if (year == null) note = "no USGS topographic sheet at the view centre (the collection covers the United States)";
  else if (!present) note = `no ${year} sheet at the view centre${nearest.length ? `; nearest editions here: ${nearest.join(", ")}` : ""} · the ${year} edition draws only where a ${year} sheet exists`;
  else note = `USGS topographic map, ${year} edition, as published · draws when zoomed in (about 10 km or closer), where a ${year} sheet exists · ${years.length} edition years here, ${years[0].year} to ${years[years.length - 1].year} · click the ground for the sheets`;
  return { ...base, note, meta };
}

export const topoLayer: LayerDefinition = {
  id: "topo",
  label: "Historic topo maps (USGS)",
  description:
    "USGS topographic maps as published, 1879 to 2006, one edition year at a time, over the base imagery: pick a year under the layer's row (only years with a sheet at the view centre are offered). Draws when zoomed in. Click the ground for the sheets there, their USGS citation, and the GeoPDF and GeoTIFF.",
  color: "#D6B370",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: topoViewKey,
  attribution: HTMC_ATTRIBUTION,
  fetch: fetchTopo,
};
