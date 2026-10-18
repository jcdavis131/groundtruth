// Layer: FEMA National Risk Index (December 2025). Below COUNTY_MAX_HEIGHT_M
// the counties in view, coloured by FEMA's rating word for the composite or
// one of 18 hazards (the picker under the layer's row, pref nriHazard);
// below NRI_TRACT_MAX_M the census tracts, on NRI's own tract polygons.
//
// Counties are the shared county outlines (lib/layers/areas.ts: Census
// TIGERweb, the same polygons commerce and realestate draw) joined by FIPS
// with NRI's attribute rows from /api/hazards?op=nri; NRI's county geometry
// is never fetched. A county with no NRI row reads "not in the index", and a
// rating that is not a class ("Not Applicable", "Insufficient Data", ...) is
// drawn unfilled with a dashed grey edge, never as low.

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";
import { COUNTY_MAX_HEIGHT_M, countyViewBbox, loadCountyOutlines } from "./areas";
import { buildTracts, joinCounties, NRI_HAZARDS, NRI_TRACT_BOX_DEG, NRI_TRACT_MAX_M, nriRow, parseNriPick } from "@/lib/hazards/nri";

const KEY_GRID = 0.5;
const TRACT_GRID = 0.05;

export function riskindexViewKey(v: ViewState): string {
  if (v.height > COUNTY_MAX_HEIGHT_M) return "above";
  if (v.height <= NRI_TRACT_MAX_M) return `tract:${Math.round(v.lon / TRACT_GRID)},${Math.round(v.lat / TRACT_GRID)}`;
  const bucket = Math.round(Math.log2(Math.max(v.height, 1000) / 1000));
  return `county:${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)},${bucket}`;
}

function pickLabel(pick: string): string {
  return pick === "composite" ? "composite risk" : `${NRI_HAZARDS[pick as keyof typeof NRI_HAZARDS]} risk`;
}

async function fetchRiskindex(ctx: FetchContext): Promise<FetchResult> {
  const pick = parseNriPick(ctx.options.nriHazard);
  const empty = (note: string): FetchResult => ({ collection: { type: "FeatureCollection", features: [] }, source: "FEMA National Risk Index", fetchedAt: ctx.now, note, meta: { count: 0, pick } });
  if (ctx.view.height > COUNTY_MAX_HEIGHT_M) return empty(`descend below ${(COUNTY_MAX_HEIGHT_M / 1000).toLocaleString("en-US")} km for FEMA's National Risk Index by county`);
  if (ctx.view.height <= NRI_TRACT_MAX_M) {
    // The route answers at most NRI_TRACT_BOX_DEG a side, around the view's centre.
    const b = viewBbox(ctx, 20_000).map((x) => x.toFixed(3)).join(",");
    const env = await proxy<FeatureCollection>(`/api/hazards?op=nri&level=tract&bbox=${b}`, ctx);
    const features = buildTracts(env.data.features as never, pick);
    const capped = (env as unknown as { capped?: boolean }).capped;
    return {
      collection: { type: "FeatureCollection", features: features as LayerFeature[] },
      source: "FEMA National Risk Index (tracts)",
      fetchedAt: ctx.now,
      note: `${features.length} census tracts · ${pickLabel(pick)}, FEMA's rating words · dashed grey: no rating (never low) · a tract's percentile among all US tracts, not comparable with a county's · tracts within ${NRI_TRACT_BOX_DEG / 2} degrees of the view's centre${capped ? " · cut at FEMA's record limit: zoom in for every tract" : ""}`,
      meta: { count: features.length, level: "tract", pick },
    };
  }
  // The same box the county outlines are asked for, so every outline in view has its row asked too.
  const b = countyViewBbox(ctx);
  const [areas, nri] = await Promise.all([loadCountyOutlines(ctx), proxy<{ rows: Array<Record<string, unknown>> }>(`/api/hazards?op=nri&level=county&bbox=${b}`, ctx)]);
  const joined = joinCounties(areas.outlines, (nri.data.rows ?? []).map(nriRow), pick);
  return {
    collection: { type: "FeatureCollection", features: joined.features as LayerFeature[] },
    source: "FEMA National Risk Index + Census TIGERweb",
    fetchedAt: ctx.now,
    note:
      `${joined.matched} counties · ${pickLabel(pick)}, FEMA's rating words · dashed grey: no rating or not in the index (never low)` +
      (joined.notInIndex ? ` · ${joined.notInIndex} not in the index` : "") +
      ` · a county's percentile among all US counties, not a likelihood · descend below ${NRI_TRACT_MAX_M / 1000} km for tracts`,
    meta: { count: joined.features.length, level: "county", pick, notInIndex: joined.notInIndex, unmatched: joined.unmatched.length },
  };
}

export const riskindexLayer: LayerDefinition = {
  id: "riskindex",
  label: "National Risk Index (FEMA)",
  description:
    "FEMA's National Risk Index (December 2025) by county below 2,500 km and by census tract below 60 km: composite risk or any one of 18 natural hazards in FEMA's rating words (very high to very low), expected annual loss in dollars, social vulnerability as published in the index and community resilience. A relative index: 'very high' means high compared with everywhere else, not likely.",
  color: "#EA580C",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: riskindexViewKey,
  attribution: "FEMA National Risk Index, December 2025 (not endorsed by FEMA) · Census TIGERweb",
  fetch: fetchRiskindex,
};
