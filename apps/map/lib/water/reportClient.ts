"use client";
// Browser side of the water report: read what the renderers hold, build.

import { getRenderer } from "@/lib/globe/registry";
import type { LayerFeature } from "@/lib/layers/types";
import { buildWaterReport, type WaterReport } from "./report";

function held(layer: "water" | "groundwater" | "turbidity"): { loaded: boolean; list: LayerFeature[] } {
  const r = getRenderer(layer);
  if (!r) return { loaded: false, list: [] };
  return { loaded: r.size > 0, list: [...r.features()] };
}

export function reportFromGlobe(lon: number, lat: number, now = Date.now()): WaterReport {
  const water = held("water");
  const groundwater = held("groundwater");
  const turbidity = held("turbidity");
  return buildWaterReport(
    lon,
    lat,
    {
      water: water.list,
      groundwater: groundwater.list,
      turbidity: turbidity.list,
      loaded: { water: water.loaded, groundwater: groundwater.loaded, turbidity: turbidity.loaded },
    },
    now,
  );
}
