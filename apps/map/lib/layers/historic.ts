// Layer: historic places. Properties listed on the National Register of
// Historic Places around the camera target, as the National Park Service's
// public spatial data shows them.
//
//   NPS nrhp_locations   layer 0 points below HISTORIC_MAX_HEIGHT_M, and the
//                        layer 1 boundaries of districts and sites below
//                        HISTORIC_BOUNDARY_MAX_M, through /api/land
//
// Only what NPS publishes as non-restricted: archaeological sites whose
// locations are withheld under NHPA section 304 / ARPA are left out of the
// source itself. The boundary layer does still hold a few listings whose
// Address reads "Address Restricted"; /api/land filters those out in its where
// clause, so they never reach this layer. Absence on the map is not absence on
// the ground. No address is requested. A feature is
// named by its NRIS number and type; the property's name (which can be a
// person's) is in the dossier and on the globe's label, never searched
// (lib/search/allowlist.ts). Listings load inside a dashed box.

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { loadedBoxFeature } from "./flood";
import type { HistoricExtra } from "@/lib/land/features";

export type { HistoricExtra } from "@/lib/land/features";

export const HISTORIC_MAX_HEIGHT_M = 25_000;
/** Below this, district and site boundaries load with the points. */
export const HISTORIC_BOUNDARY_MAX_M = 10_000;
/** Box radius asked for (~12 km across); the route clamps it to 0.12 degrees. */
const BOX_RADIUS_M = 6_000;
/** A new box every ~4 km of pan, about a third of the box, so the target stays well inside it. */
const KEY_GRID = 0.04;

const memos = { mid: new FeatureMemo(), near: new FeatureMemo() };

function tierOf(height: number): "near" | "mid" {
  return height <= HISTORIC_BOUNDARY_MAX_M ? "near" : "mid";
}

export function historicViewKey(v: ViewState): string {
  if (v.height > HISTORIC_MAX_HEIGHT_M) return "above";
  return `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)},${tierOf(v.height)}`;
}

/** The request for a view: centred on the view key's cell so viewers in one cell share the route's cache entry. */
export function historicRequest(v: Pick<ViewState, "lon" | "lat" | "height">, nhlOnly = false): string {
  const lon = Math.round(v.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(v.lat / KEY_GRID) * KEY_GRID;
  const bbox = bboxAround(lat, lon, BOX_RADIUS_M);
  const near = tierOf(v.height) === "near";
  return `/api/land?op=historic&bbox=${bbox.map((x) => x.toFixed(4)).join(",")}${near ? "&polygons=1" : ""}${nhlOnly ? "&nhl=1" : ""}`;
}

async function fetchHistoric(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > HISTORIC_MAX_HEIGHT_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "NPS National Register",
      fetchedAt: ctx.now,
      note: `descend below ${HISTORIC_MAX_HEIGHT_M / 1000} km for National Register listings (United States)`,
      meta: { count: 0 },
    };
  }
  const tier = tierOf(ctx.view.height);
  const nhlOnly = ctx.options.nhlOnly === true;
  const env = await proxy<FeatureCollection>(historicRequest(ctx.view, nhlOnly), ctx);
  const meta = env as unknown as { bbox?: [number, number, number, number]; truncated?: boolean; boundaries?: number | null };
  const features = memos[tier].stable(env.data.features as unknown as LayerFeature[]);
  const loaded = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : null;
  let points = 0;
  let nhl = 0;
  let bounds = 0;
  for (const f of features) {
    const x = f.properties.extra as HistoricExtra;
    if (x.shape === "point") points++;
    else bounds++;
    if (x.nhl && x.shape === "point") nhl++;
  }
  const tail =
    tier === "mid"
      ? ` · descend below ${HISTORIC_BOUNDARY_MAX_M / 1000} km for district and site boundaries`
      : meta.boundaries === null
        ? " · NPS's boundary layer did not answer, boundaries missing"
        : ` · ${bounds} boundaries`;
  return {
    collection: { type: "FeatureCollection", features: loaded ? [...features, loadedBoxFeature("historic", loaded, "National Register listings")] : features },
    source: "NPS National Register",
    fetchedAt: ctx.now,
    note:
      (nhlOnly ? `${points} National Historic Landmarks in the dashed box (landmarks only: other listings hidden)${tail}` : `${points} listed places in the dashed box (${nhl} National Historic Landmarks)${tail}`) +
      ` · only what NPS publishes as non-restricted: withheld archaeological sites are not shown` +
      (meta.truncated ? " · showing the first 2,000, zoom in" : ""),
    meta: { count: features.length, nhlOnly },
  };
}

export const historicLayer: LayerDefinition = {
  id: "historic",
  label: "Historic places (NRHP)",
  description:
    "National Register of Historic Places below 25 km: the listings NPS publishes as non-restricted, by type (building, structure, district, site, object), National Historic Landmarks marked, with the listing date, place and the nomination at the National Archives; district and site boundaries below 10 km. Archaeological sites whose locations are restricted under NHPA section 304 / ARPA are not in the source.",
  color: "#F59E0B",
  updateIntervalMs: 12 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: historicViewKey,
  attribution: "National Park Service, National Register of Historic Places (public, non-restricted listings)",
  fetch: fetchHistoric,
};
