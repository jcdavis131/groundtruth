// Layer: contaminated and regulated sites. EPA program listings as points
// below CONTAMINANTS_MAX_M, inside the same ~11 km dashed box as the
// Environmental permits layer, anywhere in the United States:
//
//   Superfund (SEMS)   EPA's Superfund site layer: the current NPL, final and
//                      proposed (1,374 = 1,337 + 37 by EPA ID, 2026-10-15); each
//                      point carries its row on EPA's NPL status list
//   TRI                Toxics Release Inventory reporters
//   RCRA               hazardous-waste handlers (RCRAInfo)
//   Brownfields        ACRES properties
//   FUDS               USACE's Formerly Used Defense Sites (property points,
//                      with their cleanup projects in the record)
//
// from EPA's Envirofacts EMEF map service through /api/permits, and below
// CONTAMINANTS_BOUNDARY_MAX_M EPA's Superfund site boundaries too (polygons=1,
// the historic layer's mechanism), coloured by NPL status, and FUDS property
// boundaries and munitions response sites. A listing is a
// regulatory status, not a finding of contamination at the point; a boundary
// is a regulatory area, not a contamination footprint. A feature is named by
// its program id or EPA ID; EPA's facility or site name is in the dossier and
// on the label only, and never searched.

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { civicLoadedBox } from "./civicBox";
import { envBox, inUs } from "./envpermits";
import { FeatureMemo } from "./featureMemo";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";
import type { ContaminantExtra } from "@/lib/permits/contaminants";
import type { Bbox } from "@/lib/zoning/features";

export const CONTAMINANTS_MAX_M = 25_000;
/** Below this, Superfund site boundaries load with the points. */
export const CONTAMINANTS_BOUNDARY_MAX_M = 10_000;
const KEY_GRID = 0.05;

const memos = { mid: new FeatureMemo(), near: new FeatureMemo() };

function tierOf(height: number): "near" | "mid" {
  return height <= CONTAMINANTS_BOUNDARY_MAX_M ? "near" : "mid";
}

export function contaminantsViewKey(v: ViewState): string {
  if (v.height > CONTAMINANTS_MAX_M) return "above";
  return `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)},${tierOf(v.height)}`;
}

/** The request for a view: the Environmental permits box, with polygons=1 when near. */
export function contaminantsRequest(v: Pick<ViewState, "lon" | "lat" | "height">): string {
  return `/api/permits?op=contaminants&bbox=${envBox(v).join(",")}${tierOf(v.height) === "near" ? "&polygons=1" : ""}`;
}

async function fetchContaminants(ctx: FetchContext): Promise<FetchResult> {
  const empty = (note: string): FetchResult => ({
    collection: { type: "FeatureCollection", features: [] },
    source: "EPA Envirofacts (EMEF)",
    fetchedAt: ctx.now,
    note,
    meta: { count: 0 },
  });
  if (ctx.view.height > CONTAMINANTS_MAX_M) return empty(`descend below ${CONTAMINANTS_MAX_M / 1000} km for EPA's Superfund, TRI, RCRA and Brownfields listings (United States)`);
  const want = envBox(ctx.view);
  if (!inUs(want)) return empty("EPA's program listings cover the United States only");
  const tier = tierOf(ctx.view.height);
  const env = await proxy<FeatureCollection>(contaminantsRequest(ctx.view), ctx);
  const meta = env as unknown as { bbox?: Bbox; coverage?: CoverageLike[] };
  const loaded: Bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : want;
  const features = memos[tier].stable(env.data.features as unknown as LayerFeature[]);
  const n = { listings: 0, boundary: 0, property: 0, mrs: 0 };
  for (const f of features) {
    const shape = (f.properties.extra as ContaminantExtra | undefined)?.shape;
    if (shape === "boundary" || shape === "property" || shape === "mrs") n[shape]++;
    else n.listings++;
  }
  const lead =
    `${n.listings.toLocaleString("en-US")} listings in the dashed box (outside it: not loaded)` +
    (tier === "near"
      ? `, ${n.boundary} Superfund site boundaries, ${n.property} FUDS property boundaries, ${n.mrs} munitions response sites`
      : ` · descend below ${CONTAMINANTS_BOUNDARY_MAX_M / 1000} km for Superfund site boundaries and FUDS boundaries`) +
    " · a listing is a regulatory status, not a finding of contamination";
  return {
    collection: { type: "FeatureCollection", features: [...features, civicLoadedBox("contaminants", loaded, "EPA program listings")] },
    source: "EPA Envirofacts (EMEF)",
    fetchedAt: ctx.now,
    note: coverageNote(lead, meta.coverage ?? []),
    meta: { count: features.length },
  };
}

export const contaminantsLayer: LayerDefinition = {
  id: "contaminants",
  label: "Contaminated sites (EPA)",
  description:
    "EPA program listings below 25 km inside a dashed box: Superfund sites (EPA's SEMS site layer: the current National Priorities List, final and proposed; sites deleted from the NPL and Superfund sites never listed are not in it), Toxics Release Inventory reporters, RCRA hazardous-waste handlers and Brownfields properties, coloured by program, each with its EPA record. Every Superfund site carries its NPL status and dates from EPA's NPL list; below 10 km EPA's Superfund site boundaries are drawn too, coloured by NPL status (a regulatory area, not a contamination footprint). USACE's Formerly Used Defense Sites are drawn as properties with their cleanup projects in the record, and below 10 km as property boundaries and munitions response sites (where munitions may be present, not a confirmed hazard). A listing is a regulatory status, not a finding of contamination; a TRI reporter's record shows, on request, what it reported releasing that year. United States.",
  color: "#F87171",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: contaminantsViewKey,
  attribution: "U.S. EPA Envirofacts (EMEF): SEMS, TRI, RCRAInfo, ACRES; EPA Superfund site boundaries (EPA_GEO) and the NPL status list; U.S. Army Corps of Engineers, FUDS (FY2024)",
  fetch: fetchContaminants,
};
