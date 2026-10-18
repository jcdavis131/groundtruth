// Layer: broadband availability (FCC Broadband Data Collection, December
// 2025, as Esri summarizes it). Below COUNTY_MAX_HEIGHT_M every county in
// view, coloured by one of four measures (the picker under the layer's row,
// pref broadbandMeasure): the unserved, underserved or fiber-served share of
// Broadband Serviceable Locations, or the number of providers, on fixed breaks
// so a county reads the same in every view; below BROADBAND_HEX_MAX_M BDC's
// own H3 resolution-8 hexagons in a box around the view.
//
// Counties are the shared county outlines (lib/layers/areas.ts) joined by
// FIPS with the rows from /api/civic?op=broadband&level=county (one national
// pull held a week); BDC's county geometry is never fetched. Connecticut's
// nine planning regions have no BDC row (BDC still publishes the eight legacy
// counties) and are drawn unfilled and dashed, "not published in this
// geography"; the hexagons still cover Connecticut when zoomed in.

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";
import { COUNTY_MAX_HEIGHT_M, countyViewBbox, loadCountyOutlines } from "./areas";
import { civicLoadedBox } from "./civicBox";
import {
  BDC_ATTRIBUTION,
  BDC_SOURCE_LABEL,
  BROADBAND_HEX_BOX_DEG,
  BROADBAND_HEX_MAX_M,
  BROADBAND_MEASURES,
  buildBroadbandHexes,
  joinBroadbandCounties,
  parseBroadbandMeasure,
  unpackBdcRow,
  type BdcRow,
} from "@/lib/civic/broadband";

const KEY_GRID = 0.5;
const HEX_GRID = 0.05;

export function broadbandViewKey(v: ViewState): string {
  if (v.height > COUNTY_MAX_HEIGHT_M) return "above";
  if (v.height <= BROADBAND_HEX_MAX_M) return `hex:${Math.round(v.lon / HEX_GRID)},${Math.round(v.lat / HEX_GRID)}`;
  const bucket = Math.round(Math.log2(Math.max(v.height, 1000) / 1000));
  return `county:${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)},${bucket}`;
}

/** The hexagon request for a view: a box of at most BROADBAND_HEX_BOX_DEG around the camera. */
export function broadbandHexRequest(ctx: FetchContext): string {
  const b = viewBbox(ctx, 15_000).map((x) => x.toFixed(3)).join(",");
  return `/api/civic?op=broadband&level=hex&bbox=${b}`;
}

async function fetchBroadband(ctx: FetchContext): Promise<FetchResult> {
  const m = parseBroadbandMeasure(ctx.options.broadbandMeasure);
  const label = BROADBAND_MEASURES[m].name.toLowerCase();
  const base = { source: BDC_SOURCE_LABEL, fetchedAt: ctx.now };
  if (ctx.view.height > COUNTY_MAX_HEIGHT_M) {
    return { ...base, collection: { type: "FeatureCollection", features: [] }, note: `descend below ${(COUNTY_MAX_HEIGHT_M / 1000).toLocaleString("en-US")} km for FCC broadband availability by county`, meta: { count: 0, measure: m } };
  }
  if (ctx.view.height <= BROADBAND_HEX_MAX_M) {
    const env = await proxy<FeatureCollection>(broadbandHexRequest(ctx), ctx);
    const features = buildBroadbandHexes(env.data.features as never, m);
    const { capped, bbox } = env as unknown as { capped?: boolean; bbox?: [number, number, number, number] };
    // The box the hexagons were asked for, dashed: outside it is not loaded, which is not "no data".
    const box = Array.isArray(bbox) && bbox.length === 4 ? [civicLoadedBox("broadband", bbox, "BDC hexagons")] : [];
    return {
      ...base,
      source: `${BDC_SOURCE_LABEL} (H3 hexagons)`,
      collection: { type: "FeatureCollection", features: [...(features as LayerFeature[]), ...box] },
      note: `${features.length} H3 hexagons (about 0.7 km2 each) · ${label} (fixed breaks) · hexagons within ${BROADBAND_HEX_BOX_DEG / 2} degrees of the view's centre; outside that box is not loaded, not "no data"${capped ? " · cut at 2,000 hexagons: zoom in for every hexagon" : ""} · available, not subscribed`,
      meta: { count: features.length, level: "hex", measure: m },
    };
  }
  const [areas, env] = await Promise.all([loadCountyOutlines(ctx), proxy<{ columns: string[]; rows: unknown[][] }>("/api/civic?op=broadband&level=county", ctx)]);
  const rows: BdcRow[] = (env.data.rows ?? []).map((w) => unpackBdcRow(w)).filter((r): r is BdcRow => r != null);
  const j = joinBroadbandCounties(areas.outlines, rows, m);
  return {
    ...base,
    source: `${BDC_SOURCE_LABEL} + Census TIGERweb`,
    collection: { type: "FeatureCollection", features: j.features as LayerFeature[] },
    note:
      `${j.drawn} counties · ${label} (fixed breaks)` +
      (j.ctRegions ? ` · ${j.ctRegions} Connecticut planning regions not published in this geography (dashed)` : "") +
      (j.noData - j.ctRegions > 0 ? ` · ${j.noData - j.ctRegions} with no BDC row (dashed)` : "") +
      ` · available, not subscribed · descend below ${BROADBAND_HEX_MAX_M / 1000} km for hexagons`,
    meta: { count: j.features.length, level: "county", measure: m, unmatched: j.unmatched.length, bbox: countyViewBbox(ctx) },
  };
}

export const broadbandLayer: LayerDefinition = {
  id: "broadband",
  label: "Broadband availability (FCC)",
  description:
    "Fixed broadband availability from the FCC's Broadband Data Collection (December 2025), as Esri summarizes it (Esri Master License Agreement): by county below 2,500 km and by BDC's own H3 hexagons (about 0.7 km2) below 60 km. Colour by the unserved, underserved or fiber-served share of Broadband Serviceable Locations, or by the number of providers, on fixed breaks. Served, underserved and unserved are the FCC tiers by speed and technology; satellite and unlicensed fixed wireless count as unserved. What providers report as available, not what anyone subscribes to or measures. Connecticut is published in its old counties, so its planning regions read 'not published in this geography' until you zoom in to the hexagons.",
  color: "#2563EB",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: broadbandViewKey,
  attribution: BDC_ATTRIBUTION,
  fetch: fetchBroadband,
};
