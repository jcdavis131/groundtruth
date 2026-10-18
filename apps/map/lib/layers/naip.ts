// Layer: aerial photographs by year (USDA NAIP, 2010 onward, through
// Microsoft Planetary Computer). One year at a time over the base imagery:
// pick a year under the layer's row (pref naipYear, `ny=` in links); none set
// means the newest year at the view centre.
//
// The fetch asks /api/terrain?op=naip for the years at the view centre (the
// grid is 0.1 degrees, so a pan re-asks only when the centre moves that far),
// then /api/terrain?op=naipmosaic for the year's mosaic, and passes the tile
// template to the style in `meta` (lib/globe/terrainStyles.ts). Years are
// offered only where NAIP flew the view centre. Tiles draw from level 11
// (about 20 km or closer); coarser, Planetary Computer answers no content.

import { create } from "zustand";
import type { FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { proxy } from "./aircraft";
import { NAIP_ATTRIBUTION, NAIP_UNLISTED, resolveNaipYear, type NaipYear } from "@/lib/terrain/naip";

/** Above this camera height the years at the centre are not asked for. */
export const NAIP_LIST_MAX_M = 150_000;
/** The view-centre grid the years are asked on (0.1 degrees). */
const KEY_GRID = 0.1;

export interface NaipHere {
  lon: number;
  lat: number;
  years: NaipYear[];
}
export const useNaipHere = create<{ here: NaipHere | null; set: (h: NaipHere | null) => void }>()((set) => ({
  here: null,
  set: (here) => set({ here }),
}));

export function naipViewKey(v: ViewState): string {
  return v.height > NAIP_LIST_MAX_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`;
}

async function fetchNaip(ctx: FetchContext): Promise<FetchResult> {
  const base = { collection: { type: "FeatureCollection" as const, features: [] }, source: "USDA NAIP via Microsoft Planetary Computer", fetchedAt: ctx.now };
  if (ctx.view.height > NAIP_LIST_MAX_M) {
    useNaipHere.getState().set(null);
    return { ...base, note: `descend below ${NAIP_LIST_MAX_M / 1000} km for the NAIP years here; the photographs draw from about 20 km`, meta: { picture: true, count: 0, naipYear: null, naipTiles: null } };
  }
  const lon = Math.round(ctx.view.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(ctx.view.lat / KEY_GRID) * KEY_GRID;
  const env = await proxy<{ lon: number; lat: number; years: NaipYear[] }>(`/api/terrain?op=naip&lon=${lon.toFixed(1)}&lat=${lat.toFixed(1)}`, ctx);
  const years = env.data.years ?? [];
  useNaipHere.getState().set({ lon: env.data.lon, lat: env.data.lat, years });
  const { year, present } = resolveNaipYear(years, ctx.options.naipYear);
  if (year == null) return { ...base, note: "no NAIP photograph at the view centre (NAIP covers the conterminous United States)", meta: { picture: true, count: 0, naipYear: null, naipTiles: null } };
  // A year asked for (a link, a saved pref) that NAIP has not published anywhere is refused by the
  // route before any register; say so rather than fail the layer.
  const mosaic = await proxy<{ year: number; tiles: string }>(`/api/terrain?op=naipmosaic&year=${year}`, ctx).catch((err: unknown) => {
    if (present || !(err instanceof Error) || !err.message.includes(NAIP_UNLISTED)) throw err;
    return null;
  });
  if (!mosaic) return { ...base, note: `no ${year} NAIP mosaic: Planetary Computer lists no ${year} photograph anywhere · pick a year under the layer's row`, meta: { picture: true, count: 0, naipYear: null, naipYears: years.length, naipTiles: null } };
  const span = years.length ? `${years.length} years here, ${years[0].year} to ${years[years.length - 1].year}` : "no NAIP year at the view centre";
  const note = present
    ? `USDA NAIP aerial photographs, ${year} · draws from about 20 km (level 11) and closer; tiles take 1-3 s · ${span} · click the ground for the flight date`
    : `no ${year} NAIP photograph at the view centre (${span}) · the ${year} mosaic draws only where ${year} was flown`;
  return { ...base, note, meta: { picture: true, count: 0, naipYear: year, naipPresent: present, naipYears: years.length, naipTiles: mosaic.data.tiles } };
}

export const naipLayer: LayerDefinition = {
  id: "naip",
  label: "Aerial photos by year (NAIP)",
  description:
    "USDA Farm Service Agency's NAIP aerial photographs, 2010 onward, one year at a time, from Microsoft Planetary Computer: pick a year under the layer's row (only years flown at the view centre are offered). Agricultural-season photographs at 0.3 to 1 m, flown state by state. Draws when zoomed in; click the ground for the flight date.",
  color: "#A3E635",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: naipViewKey,
  attribution: NAIP_ATTRIBUTION,
  fetch: fetchNaip,
};
