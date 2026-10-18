// Layer: ERCOT real-time + day-ahead electricity prices, drawn at hub and
// load-zone label points and coloured by price band (mirrors the staged
// energy map: red >= $400, orange >= $150, yellow >= $60, green below).
//
//   ERCOT MIS public reports     bundled as lib/energy/data/ercot_prices.json
//                                by lib/energy/build_bundles.py; refresh
//                                with `npm run data:energy`
//
// Published values as ERCOT sent them; nothing estimated here. Real-time
// prices move every 15 minutes, so the bundle is a snapshot and the layer
// note says so. Hub/zone coordinates are approximate label points.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import {
  ercotBundle,
  ercotPriceColor,
  fmtMwh,
  type ErcotPricePoint,
} from "@/lib/energy/energy";

export interface ErcotPriceExtra {
  id: string;
  kind: "hub" | "zone";
  rtm: number | null;
  dam: number | null;
  loadMw: number | null;
}

async function fetchErcotPrices(ctx: FetchContext): Promise<FetchResult> {
  const bundle = ercotBundle();
  const damById = new Map(bundle.dam.points.map((p) => [p.id, p.price_usd_mwh]));
  const loadByZone = new Map(
    bundle.load.zones.map((z) => [z.zone.replace(" zone", ""), z.load_mw]),
  );
  const features: LayerFeature<Point>[] = bundle.rtm.points.map((p: ErcotPricePoint) => {
    const dam = damById.get(p.id) ?? null;
    const loadMw = loadByZone.get(p.id.replace("LZ_", "")) ?? null;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        id: `ercot-${p.id}`,
        layer: "ercotprices",
        name: p.label,
        kind: p.kind,
        altitude: 0,
        source: "ERCOT",
        details: {
          "Real-time": fmtMwh(p.price_usd_mwh),
          "Day-ahead": fmtMwh(dam),
          "Zone load": loadMw == null ? "n/a" : `${loadMw.toLocaleString()} MW`,
          "RTM as of": bundle.rtm.asof ?? "n/a",
          "DAM as of": bundle.dam.asof ?? "n/a",
        },
        extra: {
          id: p.id,
          kind: p.kind,
          rtm: p.price_usd_mwh,
          dam,
          loadMw,
        } satisfies ErcotPriceExtra,
      },
    };
  });
  return {
    collection: { type: "FeatureCollection", features },
    source: "ERCOT",
    fetchedAt: ctx.now,
    note: [
      `${features.length} hubs/zones · ERCOT real-time $/MWh`,
      `RTM as of ${bundle.rtm.asof ?? "n/a"}`,
      `snapshot — refresh: npm run data:energy`,
    ].join(" · "),
    meta: {
      rtmAsof: bundle.rtm.asof,
      damAsof: bundle.dam.asof,
      count: features.length,
      provenance: bundle.meta.provenance,
    },
  };
}

export const ercotPricesLayer: LayerDefinition = {
  id: "ercotprices",
  label: "ERCOT prices",
  description:
    "ERCOT real-time and day-ahead wholesale electricity prices at Texas hubs and load zones, coloured by price band. Published values as ERCOT sent them; the bundle is a 15-minute snapshot — refresh with npm run data:energy.",
  color: "#EA580C",
  updateIntervalMs: 15 * 60_000,
  defaultEnabled: false,
  attribution: "Electric Reliability Council of Texas, MIS public reports",
  fetch: fetchErcotPrices,
};

export { ercotPriceColor };
