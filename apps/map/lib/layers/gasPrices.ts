// Layer: gas prices. EIA weekly retail regular-gasoline prices for the US
// and the nine states EIA's weekly survey covers, drawn at state label
// points and coloured against the national average.
//
//   EIA Weekly Retail Gasoline Price   bundled as lib/gas/data/gas_prices.json
//                                      by the gas-forecaster pipeline
//                                      (~/workspace/gas-forecaster); refresh
//                                      with `npm run data:gas`
//
// Published values as EIA sent them; nothing estimated here. Weekly cadence:
// the bundle goes stale between Monday prints, and the layer note says so.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { fmtGal, fmtGalChange, gasPrices, statePriceList } from "@/lib/gas/gas";
import { gasWeekForDate, missionTimeForYear } from "@/lib/globe/timeMachine";

export interface GasPriceExtra {
  code: string;
  price: number;
  changeWow: number | null;
  vsNational: number | null;
}

async function fetchGasPrices(ctx: FetchContext): Promise<FetchResult> {
  const bundle = gasPrices();
  // Time machine: nearest weekly observation <= the playback date.
  // Before a series' first observation there is no data — never invented.
  const playback = ctx.playbackYear != null;
  const playbackMs = playback
    ? (ctx.missionTime ?? missionTimeForYear(ctx.playbackYear as number))
    : null;
  const seriesAt = (hist: { history: [string, number][] }, fallback: { current: number; prevWeek: number | null; changeWow: number | null; asof: string }) => {
    if (!playback || playbackMs == null) return fallback;
    const found = gasWeekForDate(hist.history, playbackMs);
    if (!found) return { current: NaN, prevWeek: null, changeWow: null, asof: `no EIA data yet` };
    const prev = found.prev;
    return {
      current: found.point[1],
      prevWeek: prev ? prev[1] : null,
      changeWow: prev ? found.point[1] - prev[1] : null,
      asof: found.point[0],
    };
  };
  const nationalW = seriesAt(bundle.national, bundle.national);
  const national = nationalW.current;
  const states = statePriceList();
  const features: LayerFeature<Point>[] = states.map((s) => {
    const w = seriesAt(s, s);
    const hasData = Number.isFinite(w.current);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        id: `gas-${s.code}`,
        layer: "gasprices",
        name: s.name,
        kind: "state",
        altitude: 0,
        observedAt: hasData ? Date.parse(`${w.asof}T12:00:00Z`) : undefined,
        source: "U.S. Energy Information Administration",
        details: {
          "Regular": fmtGal(hasData ? w.current : null),
          "Week ago": fmtGal(w.prevWeek),
          "WoW change": fmtGalChange(w.changeWow),
          "vs national": !hasData || !Number.isFinite(national) ? "n/a" : fmtGalChange(w.current - national),
          "As of": w.asof,
          "National avg": fmtGal(Number.isFinite(national) ? national : null),
        },
        extra: {
          code: s.code,
          price: hasData ? w.current : NaN,
          changeWow: w.changeWow,
          vsNational: hasData && Number.isFinite(national) ? w.current - national : NaN,
        } satisfies GasPriceExtra,
      },
    };
  });
  return {
    collection: { type: "FeatureCollection", features },
    source: "U.S. Energy Information Administration",
    fetchedAt: ctx.now,
    note: [
      `${features.length} states · EIA weekly retail regular`,
      playback ? `playback ${nationalW.asof} · nearest week ≤ playback date` : `as of ${bundle.national.asof}`,
      `national ${fmtGal(Number.isFinite(national) ? national : null)}`,
      `refresh: npm run data:gas`,
    ].join(" · "),
    meta: {
      asof: nationalW.asof,
      national: Number.isFinite(national) ? national : null,
      count: features.length,
      provenance: bundle.meta.provenance,
      playbackYear: playback ? ctx.playbackYear : undefined,
    },
  };
}

export const gasPricesLayer: LayerDefinition = {
  id: "gasprices",
  label: "Gas prices",
  description:
    "EIA weekly retail regular-gasoline price for the nine states its weekly survey covers, coloured against the national average. Published values as EIA sent them; the bundle refreshes weekly via npm run data:gas.",
  color: "#FBBF24",
  updateIntervalMs: 24 * 3600_000,
  defaultEnabled: false,
  attribution: "U.S. Energy Information Administration, Weekly Retail Gasoline Price",
  fetch: fetchGasPrices,
};
