// Layer 9: groundwater and drought. What is under the ground and how dry
// the ground above it is.
//
//   USGS latest-daily wells   depth to water (72019, feet below land surface,
//                             deeper = falling table) or water-level elevation
//                             (62610 / 62611, higher = rising), joined to the
//                             USGS national aquifer name of each well
//   US Drought Monitor        this week's D0–D4 polygons (USDM / NDMC / USDA / NOAA)
//
// Wells load below WELL_MAX_HEIGHT_M; drought polygons are always drawn.
// The row -> feature builders live in lib/water/features.ts.

import type { Point } from "geojson";
import type { WellReading } from "@/app/api/water/route";
import { buildDrought, buildWells, type WellExtra } from "@/lib/water/features";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";

export type { WellExtra, DroughtExtra } from "@/lib/water/features";
export { DROUGHT_COLOR, DROUGHT_LABEL } from "@/lib/water/features";

export const WELL_MAX_HEIGHT_M = 1_500_000;

let drought: Promise<LayerFeature[]> | null = null;
let droughtAt = 0;

function loadDrought(ctx: FetchContext): Promise<LayerFeature[]> {
  if (!drought || ctx.now - droughtAt > 6 * 3600_000) {
    droughtAt = ctx.now;
    drought = proxy<GeoJSON.FeatureCollection>("/api/water?op=drought", { ...ctx, signal: undefined })
      .then((env) => buildDrought(env.data))
      .catch((err) => {
        drought = null;
        throw err;
      });
  }
  return drought;
}

async function fetchGroundwater(ctx: FetchContext): Promise<FetchResult> {
  const notes: string[] = [];
  const sources: string[] = [];
  const features: LayerFeature[] = [];
  const droughtFeatures = await loadDrought(ctx).catch((e: Error) => {
    notes.push(`USDM: ${e.message.slice(0, 60)}`);
    return [] as LayerFeature[];
  });
  if (droughtFeatures.length) sources.push("USDM");
  features.push(...droughtFeatures);

  let wells: LayerFeature<Point>[] = [];
  if (ctx.view.height <= WELL_MAX_HEIGHT_M) {
    const bbox = viewBbox(ctx, 250_000);
    const env = await proxy<WellReading[]>(`/api/water?op=wells&bbox=${bbox.map((x) => x.toFixed(2)).join(",")}`, ctx).catch(
      (e: Error) => {
        notes.push(`USGS: ${e.message.slice(0, 60)}`);
        return null;
      },
    );
    if (env) {
      wells = buildWells(env.data, ctx.now);
      sources.push("USGS");
      const aquifers = new Set(wells.map((w) => (w.properties.extra as WellExtra).aquifer).filter(Boolean));
      notes.unshift(`${wells.length} wells · ${aquifers.size} named aquifers`);
    }
    features.push(...wells);
  } else {
    notes.unshift(`drought classes D0–D4 · descend below ${Math.round(WELL_MAX_HEIGHT_M / 1000)} km for wells`);
  }

  return {
    collection: { type: "FeatureCollection", features },
    source: sources.join(" + ") || "none",
    fetchedAt: ctx.now,
    note: notes.join(" · "),
    meta: { count: wells.length },
  };
}

export const groundwaterLayer: LayerDefinition = {
  id: "groundwater",
  label: "Aquifers & drought",
  description:
    "USGS monitoring wells with depth-to-water and the aquifer each one taps, over this week's US Drought Monitor classes.",
  color: "#D7B36A",
  updateIntervalMs: 30 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  attribution: "USGS Water Data · US Drought Monitor (NDMC, USDA, NOAA)",
  fetch: fetchGroundwater,
};
