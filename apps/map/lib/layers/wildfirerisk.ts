// Layer: wildfire risk ranks (USDA Forest Service Wildfire Risk to
// Communities, 2nd edition, 2024). Below COUNTY_MAX_HEIGHT_M every county in
// view, coloured by one of WRC's four rank families (by the service's own
// aliases; pref wrcMeasure) at national or state scope (pref wrcScope), on
// fixed breaks so a county reads the same in every view; below
// WRC_PLACE_MAX_M WRC's own community (Census place) polygons.
//
// Counties are the shared county outlines (lib/layers/areas.ts) joined by
// FIPS with the rows from /api/hazards?op=wrc&level=county (one national pull
// held a week). DC (every rank blank) and the communities USFS excludes are
// drawn unfilled and dashed, "not ranked by USFS", never low. Firehazard
// draws the WHP raster itself; this layer ranks communities.

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";
import { COUNTY_MAX_HEIGHT_M, countyViewBbox, loadCountyOutlines } from "./areas";
import {
  buildWrcPlaces,
  joinWrcCounties,
  parseWrcMeasure,
  parseWrcScope,
  unpackWrcRow,
  WRC_ATTRIBUTION,
  WRC_PLACE_BOX_DEG,
  WRC_PLACE_MAX_M,
  WRC_RANKS,
  WRC_SOURCE_LABEL,
  type WrcWireRow,
} from "@/lib/hazards/wrc";

const KEY_GRID = 0.5;
const PLACE_GRID = 0.25;

export function wildfireriskViewKey(v: ViewState): string {
  if (v.height > COUNTY_MAX_HEIGHT_M) return "above";
  if (v.height <= WRC_PLACE_MAX_M) return `place:${Math.round(v.lon / PLACE_GRID)},${Math.round(v.lat / PLACE_GRID)}`;
  const bucket = Math.round(Math.log2(Math.max(v.height, 1000) / 1000));
  return `county:${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)},${bucket}`;
}

async function fetchWildfireRisk(ctx: FetchContext): Promise<FetchResult> {
  const m = parseWrcMeasure(ctx.options.wrcMeasure);
  const scope = parseWrcScope(ctx.options.wrcScope);
  const label = scope === "state" ? WRC_RANKS[m].stateAlias : WRC_RANKS[m].alias;
  const base = { source: WRC_SOURCE_LABEL, fetchedAt: ctx.now };
  if (ctx.view.height > COUNTY_MAX_HEIGHT_M) {
    return { ...base, collection: { type: "FeatureCollection", features: [] }, note: `descend below ${(COUNTY_MAX_HEIGHT_M / 1000).toLocaleString("en-US")} km for USFS wildfire risk ranks by county`, meta: { count: 0, measure: m, scope } };
  }
  if (ctx.view.height <= WRC_PLACE_MAX_M) {
    const b = viewBbox(ctx, 60_000).map((x) => x.toFixed(3)).join(",");
    const env = await proxy<FeatureCollection>(`/api/hazards?op=wrc&level=place&bbox=${b}`, ctx);
    const features = buildWrcPlaces(env.data.features as never, m, scope);
    const notRanked = features.filter((f) => f.properties.kind === "not-ranked").length;
    const capped = (env as unknown as { capped?: boolean }).capped;
    return {
      ...base,
      source: `${WRC_SOURCE_LABEL} (communities)`,
      collection: { type: "FeatureCollection", features: features as LayerFeature[] },
      note: `${features.length} communities (Census places) · ${label} (fixed breaks)${notRanked ? ` · ${notRanked} not ranked by USFS (dashed, never low)` : ""} · within ${WRC_PLACE_BOX_DEG / 2} degrees of the view's centre${capped ? " · cut at 1,000 communities: zoom in for every one" : ""} · relative ranks, not a forecast`,
      meta: { count: features.length, level: "place", measure: m, scope },
    };
  }
  const [areas, env] = await Promise.all([loadCountyOutlines(ctx), proxy<{ rows: WrcWireRow[] }>("/api/hazards?op=wrc&level=county", ctx)]);
  const rows = (env.data.rows ?? []).map(unpackWrcRow);
  const j = joinWrcCounties(areas.outlines, rows, m, scope);
  return {
    ...base,
    source: `${WRC_SOURCE_LABEL} + Census TIGERweb`,
    collection: { type: "FeatureCollection", features: j.features as LayerFeature[] },
    note:
      `${j.ranked} counties · ${label} (fixed breaks)` +
      (j.notRanked ? ` · ${j.notRanked} not ranked by USFS` : "") +
      (j.notInRelease ? ` · ${j.notInRelease} not in this release` : "") +
      ` · dashed grey: no rank (never low) · relative ranks, not a forecast · descend below ${WRC_PLACE_MAX_M / 1000} km for communities`,
    meta: { count: j.features.length, level: "county", measure: m, scope, notInRelease: j.notInRelease, bbox: countyViewBbox(ctx) },
  };
}

export const wildfireriskLayer: LayerDefinition = {
  id: "wildfirerisk",
  label: "Wildfire risk ranks (USFS)",
  description:
    "USDA Forest Service Wildfire Risk to Communities (2nd edition, 2024; CC0): each county (below 2,500 km) and community (Census place, below 150 km) ranked against all others nationally or in its state, for four measures named by the service's own aliases (RISK_NATIONAL_RANK, BP_NATIONAL_RANK burn probability, WHP_NATIONAL_RANK hazard potential, EA_HURISK_NATIONAL_RANK), on fixed breaks. Modelled and relative: a high rank is not a forecast and does not replace a local assessment. Places USFS excludes (no people, no buildings) are masked, never 'low'. The Wildfire hazard layer draws the WHP raster itself.",
  color: "#D95F0E",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: wildfireriskViewKey,
  estimate: "Modelled percentile ranks (fuels 2020-2022); relative comparisons, not forecasts.",
  attribution: WRC_ATTRIBUTION,
  fetch: fetchWildfireRisk,
};
