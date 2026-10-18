// Layer: parcels. Lot lines as the county or state publishes them, and the
// record of one parcel when you click inside it.
//
//   /api/parcels?mode=outlines   below PARCEL_OUTLINE_MAX_M: outlines in a box of about
//                                1 km around the view, with the parcel id and use class
//                                only, inside a dashed "loaded" box
//   /api/parcels (identify)      below PARCEL_IDENTIFY_MAX_M: a click on the ground asks
//                                for the parcel at that point (lib/parcels/pick.ts); the
//                                dossier shows owner, site and mailing address, values,
//                                use, area, last sale and legal text as the source
//                                publishes them, with the source's own record linked
//
// Owners appear only in the dossier of the one parcel clicked, never on the
// outlines, so panning a town does not collect names; and nothing searches
// owners (lib/search/allowlist.ts). Where no keyless public parcel service is
// wired, the note says so rather than showing an empty map as "no parcels".

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { loadedBoxFeature } from "./flood";

export type { ParcelOutlineExtra } from "@/lib/parcels/features";

/** Outlines load below this camera height. */
export const PARCEL_OUTLINE_MAX_M = 2_000;
/** A click on the ground identifies the parcel below this height. */
export const PARCEL_IDENTIFY_MAX_M = 5_000;
/** Radius of the outline box asked for; the route clamps it to 0.01 degrees. */
const OUTLINE_BOX_RADIUS_M = 550;
/** View-key grid: a new box every ~0.9 km of pan, so the target stays inside it. */
const OUTLINE_KEY_GRID = 0.008;

const memo = new FeatureMemo(6000);

export function parcelViewKey(v: ViewState): string {
  if (v.height > PARCEL_IDENTIFY_MAX_M) return "far";
  if (v.height > PARCEL_OUTLINE_MAX_M) return "identify-only";
  return `${Math.round(v.lon / OUTLINE_KEY_GRID)},${Math.round(v.lat / OUTLINE_KEY_GRID)}`;
}

interface OutlineMeta {
  bbox?: [number, number, number, number];
  truncated?: boolean;
  sources?: Array<{ id: string; name: string; count: number; truncated: boolean }>;
  failed?: Array<{ id: string; name: string }>;
  uncovered?: string[];
  identifyOnly?: Array<{ id: string; reason: string }>;
}

/** The layer note for an outline answer: what loaded, from where, and what did not. */
export function outlineNote(count: number, meta: OutlineMeta): string {
  const parts = [`${count.toLocaleString("en-US")} parcel outlines in the dashed box (outside it: not loaded)`];
  if (meta.sources?.length) parts.push(`from ${meta.sources.map((s) => s.name).join(", ")}`);
  parts.push("click inside a parcel for its record");
  if (meta.truncated) parts.push("record limit hit, zoom in for every parcel");
  if (meta.uncovered?.length) parts.push(`no keyless parcel service for ${meta.uncovered.join(", ")}`);
  if (meta.identifyOnly?.length) parts.push(`${meta.identifyOnly.map((c) => c.reason).join("; ")}: click for records there`);
  if (meta.failed?.length) parts.push(`did not answer: ${meta.failed.map((f) => f.name).join(", ")}`);
  return parts.join(" · ");
}

async function fetchParcels(ctx: FetchContext): Promise<FetchResult> {
  const h = ctx.view.height;
  if (h > PARCEL_OUTLINE_MAX_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "county and state parcel services",
      fetchedAt: ctx.now,
      note:
        h > PARCEL_IDENTIFY_MAX_M
          ? `descend below ${PARCEL_IDENTIFY_MAX_M / 1000} km to click a parcel for its record, below ${PARCEL_OUTLINE_MAX_M / 1000} km for lot lines`
          : `click the ground for the parcel record there; lot lines draw below ${PARCEL_OUTLINE_MAX_M / 1000} km`,
      meta: { count: 0 },
    };
  }
  // Centred on the view key's cell, so everyone in the same cell shares the route's cache entry.
  const lon = Math.round(ctx.view.lon / OUTLINE_KEY_GRID) * OUTLINE_KEY_GRID;
  const lat = Math.round(ctx.view.lat / OUTLINE_KEY_GRID) * OUTLINE_KEY_GRID;
  const bbox = bboxAround(lat, lon, OUTLINE_BOX_RADIUS_M);
  const env = await proxy<FeatureCollection>(`/api/parcels?mode=outlines&bbox=${bbox.map((x) => x.toFixed(4)).join(",")}`, ctx);
  const meta = env as unknown as OutlineMeta;
  const features = memo.stable(env.data.features as unknown as LayerFeature[]);
  const loaded = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : bbox;
  return {
    collection: { type: "FeatureCollection", features: [...features, loadedBoxFeature("parcels", loaded, "parcel outlines")] },
    source: meta.sources?.map((s) => s.name).join(", ") || "county and state parcel services",
    fetchedAt: ctx.now,
    note: outlineNote(features.length, meta),
    meta: { count: features.length },
  };
}

export const parcelsLayer: LayerDefinition = {
  id: "parcels",
  label: "Parcels",
  description:
    "Lot lines below 2 km from county and state parcel services, and below 5 km a click on the ground shows that parcel's record as its source publishes it: owner (or why it is withheld), site and mailing address, values with their basis and year, use, area, last sale, legal text, NAD address points and the PLSS section, with the source's own record linked. No search by owner.",
  color: "#FBBF24",
  updateIntervalMs: 12 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: parcelViewKey,
  attribution: "County and state parcel services as each publishes them (README, Parcels & ownership); USDOT NAD; BLM PLSS",
  fetch: fetchParcels,
};
