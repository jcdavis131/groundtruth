// Layer: public & protected lands. Who owns and manages the land in view,
// whether the public may enter it, and how it is protected.
//
//   USGS PAD-US 4.1   Protected Areas Database, Manager Name service: fee lands,
//                     easements, designations and proclamation boundaries with
//                     manager, owner agency, local owner, easement holder, public
//                     access (open / restricted / closed / unknown), GAP status
//                     and IUCN category
//
// Ownership is shown as PAD-US publishes it, field by field; the ⌘K palette
// never searches the owner, manager or holder fields (lib/search/
// allowlist.ts). Easements are outlined, not filled: the owner keeps the
// land and the holder has the rights the easement grants. Proclamation
// boundaries are outlines only too: the land inside them is not all public.
// Zoomed out (the wide box), the route keeps the largest 600 units, coarser.

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { Access, PublicLandExtra } from "@/lib/land/features";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";

export type { PublicLandExtra } from "@/lib/land/features";

export const PUBLIC_MAX_HEIGHT_M = 250_000;
/** Above this, the wide (2 degree) box; below it, a tighter box with finer geometry. */
const NEAR_HEIGHT_M = 60_000;

// One memo per tier: the wide box is generalised ~6x coarser, so its objects must not stand in near.
const memos = { wide: new FeatureMemo(), near: new FeatureMemo() };

function viewKeyPublic(v: ViewState): string {
  if (v.height > PUBLIC_MAX_HEIGHT_M) return "above";
  return `${Math.round(v.lon * 4)},${Math.round(v.lat * 4)},${v.height > NEAR_HEIGHT_M ? "wide" : "near"}`;
}

async function fetchPublicLands(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > PUBLIC_MAX_HEIGHT_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "USGS PAD-US",
      fetchedAt: ctx.now,
      note: `descend below ${PUBLIC_MAX_HEIGHT_M / 1000} km for public and protected lands`,
      meta: { count: 0 },
    };
  }
  const tier = ctx.view.height > NEAR_HEIGHT_M ? "wide" : "near";
  const radius = tier === "wide" ? 110_000 : 40_000;
  const bbox = bboxAround(ctx.view.lat, ctx.view.lon, radius);
  const env = await proxy<FeatureCollection>(`/api/land?op=publiclands&bbox=${bbox.map((x) => x.toFixed(3)).join(",")}`, ctx);
  const features = memos[tier].stable(env.data.features as unknown as LayerFeature[]);
  const meta = env as unknown as { truncated?: boolean; maxUnits?: number | null; coarsenedForSize?: boolean };
  const byAccess: Record<Access, number> = { open: 0, restricted: 0, closed: 0, unknown: 0 };
  let easements = 0;
  for (const f of features) {
    const x = f.properties.extra as PublicLandExtra;
    if (x.category === "Fee") byAccess[x.access]++;
    else if (x.category === "Easement") easements++;
  }
  return {
    collection: { type: "FeatureCollection", features },
    source: "USGS PAD-US 4.1",
    fetchedAt: ctx.now,
    note:
      `${features.length} areas · fee lands: ${byAccess.open} open, ${byAccess.restricted} restricted, ${byAccess.closed} closed, ${byAccess.unknown} access unknown · ${easements} easements` +
      (meta.truncated ? ` · ${meta.maxUnits ? `largest ${meta.maxUnits} shown, zoom in for the rest` : "record limit hit, largest shown"}` : "") +
      (meta.coarsenedForSize ? " · outlines coarsened to fit" : ""),
    meta: { count: features.length },
  };
}

export const publiclandsLayer: LayerDefinition = {
  id: "publiclands",
  label: "Public lands",
  description:
    "USGS PAD-US 4.1 below 250 km: fee lands filled by public access (open, restricted, closed, unknown), easements, designations and proclamation boundaries outlined, with owner, manager, local owner, easement holder, GAP status and IUCN category as PAD-US publishes them.",
  color: "#4ADE80",
  updateIntervalMs: 12 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: viewKeyPublic,
  attribution: "USGS Gap Analysis Project, PAD-US 4.1 (doi:10.5066/P96WBCHS)",
  fetch: fetchPublicLands,
};
