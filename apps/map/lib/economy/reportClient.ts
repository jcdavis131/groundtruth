"use client";
// Browser side of the market report: read what the renderers hold, build.

import { getRenderer } from "@/lib/globe/registry";
import type { LayerFeature } from "@/lib/layers/types";
import type { LayerId } from "@/lib/layers/types";
import { buildMarketReport, type MarketReport, type MarketSources } from "./report";

function held(layer: LayerId): { loaded: boolean; list: LayerFeature[] } {
  const r = getRenderer(layer);
  if (!r) return { loaded: false, list: [] };
  return { loaded: r.size > 0, list: [...r.features()] };
}

export function marketReportFromGlobe(
  lon: number,
  lat: number,
  extras: Pick<MarketSources, "pulse" | "sectors" | "metroHome" | "usHome"> = {},
  now = Date.now(),
): MarketReport {
  const realestate = held("realestate");
  const commerce = held("commerce");
  const trade = held("trade");
  return buildMarketReport(
    lon,
    lat,
    {
      areas: [...realestate.list, ...commerce.list],
      trade: trade.list,
      loaded: { areas: realestate.loaded || commerce.loaded, trade: trade.loaded, pulse: !!extras.pulse?.length },
      ...extras,
    },
    now,
  );
}
