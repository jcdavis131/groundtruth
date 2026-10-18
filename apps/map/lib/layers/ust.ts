// Layer: leaking underground storage tanks, by county. EPA UST Finder's
// county counts of reported releases (open and no further action) and of
// tank facilities, from state records as of 2018-2021 (tribal records to
// October 2025), through /api/permits?op=ust, drawn as county outlines filled
// by open releases between UST_MIN_HEIGHT_M and UST_MAX_HEIGHT_M.
//
// Counts only: individual tank sites are never requested, because many are
// private homes and no field marks them reliably. A release is a reported
// leak; "no further action" means the state closed it, not that no
// contamination remains. A snapshot, not current status.

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { loadedBoxFeature } from "./flood";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";

export const UST_MIN_HEIGHT_M = 50_000;
export const UST_MAX_HEIGHT_M = 1_500_000;
/** ~4 degrees across, the route's clamp. */
const BOX_RADIUS_M = 220_000;
const KEY_GRID = 1;

const memo = new FeatureMemo();

export function ustViewKey(v: ViewState): string {
  if (v.height > UST_MAX_HEIGHT_M) return "above";
  if (v.height < UST_MIN_HEIGHT_M) return "below";
  return `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`;
}

export function ustRequest(v: Pick<ViewState, "lon" | "lat">): string {
  const lon = Math.round(v.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(v.lat / KEY_GRID) * KEY_GRID;
  return `/api/permits?op=ust&bbox=${bboxAround(lat, lon, BOX_RADIUS_M).map((x) => x.toFixed(4)).join(",")}`;
}

async function fetchUst(ctx: FetchContext): Promise<FetchResult> {
  const empty = (note: string): FetchResult => ({ collection: { type: "FeatureCollection", features: [] }, source: "EPA UST Finder", fetchedAt: ctx.now, note, meta: { count: 0 } });
  if (ctx.view.height > UST_MAX_HEIGHT_M) return empty(`descend below ${UST_MAX_HEIGHT_M / 1000} km for leaking-tank counts by county (United States)`);
  if (ctx.view.height < UST_MIN_HEIGHT_M) return empty(`rise above ${UST_MIN_HEIGHT_M / 1000} km for leaking-tank counts by county; individual tank sites are not shown (many are private homes)`);
  const env = await proxy<FeatureCollection>(ustRequest(ctx.view), ctx);
  const meta = env as unknown as { bbox?: [number, number, number, number]; coverage?: CoverageLike[]; unjoined?: { releases: number; facilities: number } };
  const features = memo.stable(env.data.features as unknown as LayerFeature[]);
  const loaded = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : null;
  const lead =
    `${features.length} counties in the dashed box, filled by open releases (0 / 1-9 / 10-49 / 50-199 / 200+, as EPA counts them)` +
    (meta.unjoined?.releases ? ` · ${meta.unjoined.releases} counties' facilities not joined by name` : "") +
    " · state records as of 2018-2021, not current status; no individual sites";
  return {
    collection: { type: "FeatureCollection", features: loaded ? [...features, loadedBoxFeature("ust", loaded, "county counts")] : features },
    source: "EPA UST Finder",
    fetchedAt: ctx.now,
    note: coverageNote(lead, meta.coverage ?? []),
    meta: { count: features.length },
  };
}

export const ustLayer: LayerDefinition = {
  id: "ust",
  label: "Leaking tanks by county (EPA UST)",
  description:
    "Leaking underground storage tanks counted by county, from EPA's UST Finder (state records as of 2018-2021; tribal records to October 2025), between 50 and 1,500 km: county outlines filled by open releases, with total and closed ('no further action') releases and the county's tank facilities and tanks (open, closed, temporarily out of service). A release is a reported leak; no further action is the state's closure, not proof that no contamination remains. Individual sites are not shown: many are private homes.",
  color: "#FB923C",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: ustViewKey,
  attribution: "U.S. EPA UST Finder: EPA's Office of Underground Storage Tanks, EPA's Office of Research and Development, ASTSWMO",
  fetch: fetchUst,
};
