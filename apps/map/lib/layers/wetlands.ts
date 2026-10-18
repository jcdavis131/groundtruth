// Layer: wetlands. Mapped wetland and deep-water habitat around the
// camera target, with the Cowardin classification USFWS assigns and the year
// of the imagery each polygon was drawn from.
//
//   USFWS National Wetlands Inventory   Wetlands MapServer layer 0 through
//                                       /api/land; the Cowardin names (system,
//                                       class, water regime) are decoded from
//                                       each polygon's code, and the Data_Source
//                                       layer gives each mapping project's
//                                       imagery year, date, scale and type
//
// NWI serves the layer only finer than 1:100,000, so it loads below
// WETLANDS_MAX_HEIGHT_M. These are habitat maps drawn from imagery that can be
// decades old (1983 around Mitchell Lake), not jurisdictional delineations;
// the note and every dossier say which imagery, with USFWS's own caveat that
// features may have changed since. Polygons load inside a dashed box, as for
// flood zones. Above that height the style draws NWI's national ~100 m raster
// instead (lib/globe/terrainStyles.ts WETLANDS_PICTURE), which has no click
// answer yet.

import type { FetchContext, FetchResult, LayerDefinition } from "./types";
import { fetchLandBox, loadedBoxFeature, nearViewKey } from "./flood";

export type { WetlandExtra } from "@/lib/land/features";

export const WETLANDS_MAX_HEIGHT_M = 10_000;

/** "mapped from 1983 imagery (Losoya, Southton)" or a year range when the quads differ. */
function imageryNote(years: number[] | null | undefined, projects: string[] | null | undefined): string {
  if (!years) return "imagery year unavailable (NWI's source layer did not answer)";
  if (!years.length) return "imagery year not recorded by NWI";
  const span = years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
  const names = projects?.length ? ` (${projects.slice(0, 4).join(", ")}${projects.length > 4 ? ` +${projects.length - 4}` : ""})` : "";
  return `mapped from ${span} imagery${names}; USFWS: features may have changed since`;
}

async function fetchWetlands(ctx: FetchContext): Promise<FetchResult> {
  const r = await fetchLandBox(ctx, "wetlands", WETLANDS_MAX_HEIGHT_M);
  if (!r) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "USFWS NWI",
      fetchedAt: ctx.now,
      note: `NWI's national wetlands raster (about 100 m, eight types; small wetlands can be missing) · descend below ${WETLANDS_MAX_HEIGHT_M / 1000} km for the polygons to click (NWI serves them only finer than 1:100,000)`,
      meta: { count: 0, picture: true },
    };
  }
  const acres = r.features.reduce((s, f) => s + ((f.properties.extra as { acres?: number }).acres ?? 0), 0);
  const imagery = imageryNote(r.meta.imageYears as number[] | null | undefined, r.meta.projects as string[] | null | undefined);
  return {
    collection: { type: "FeatureCollection", features: [...r.features, loadedBoxFeature("wetlands", r.loaded, "NWI wetlands")] },
    source: "USFWS NWI",
    fetchedAt: ctx.now,
    note:
      `${r.features.length} wetland polygons inside the dashed box · ${Math.round(acres).toLocaleString()} ac mapped · ${imagery}` +
      (r.truncated ? " · NWI record limit (500 polygons) hit, zoom in" : ""),
    meta: { count: r.features.length },
  };
}

export const wetlandsLayer: LayerDefinition = {
  id: "wetlands",
  label: "Wetlands",
  description:
    "USFWS National Wetlands Inventory below 10 km: wetland and deep-water polygons with their Cowardin code, plain-language type, water regime, acres and the year of the imagery they were mapped from, which can be decades old. Above 10 km, NWI's national ~100 m raster in eight types.",
  color: "#34D399",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: nearViewKey(WETLANDS_MAX_HEIGHT_M),
  attribution: "U.S. Fish and Wildlife Service, National Wetlands Inventory",
  fetch: fetchWetlands,
};
