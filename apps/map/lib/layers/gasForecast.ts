// Layer: gas price forecast. Next-week EIA regular-gasoline print predicted
// per state by a walk-forward-validated ridge model (crude lags, seasonality,
// autoregressive terms), drawn at state label points and coloured by the
// predicted direction.
//
//   gas-forecaster pipeline   per-series ridge fits in
//                             ~/workspace/gas-forecaster; bundles emitted to
//                             lib/gas/data/gas_forecasts.json; refresh with
//                             `npm run data:gas`
//
// The honesty contract: every feature carries its series' trailing
// walk-forward MAE, and the layer note repeats the pooled number, so the UI
// can never show a forecast without its error bars. ESTIMATE.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { fmtGal, fmtGalChange, gasForecasts, stateForecastList } from "@/lib/gas/gas";

export interface GasForecastExtra {
  code: string;
  predNext: number;
  predChangeVsCurrent: number | null;
  maeTrailing: number;
  dirAccTrailing: number;
}

async function fetchGasForecast(ctx: FetchContext): Promise<FetchResult> {
  const bundle = gasForecasts();
  const states = stateForecastList();
  const features: LayerFeature<Point>[] = states.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: {
      id: `gasfc-${s.code}`,
      layer: "gasforecast",
      name: s.name,
      kind: "state",
      altitude: 0,
      observedAt: Date.parse(`${s.predDate}T12:00:00Z`),
      source: "EIA Weekly Retail Gasoline Price + ridge model (this project)",
      details: {
        "Predicted next print": fmtGal(s.predNext),
        "Predicted change": fmtGalChange(s.predChangeVsCurrent),
        "Last actual": fmtGal(s.lastActual),
        "Target week": s.predDate,
        "Trailing MAE": fmtGal(s.maeTrailing),
        "Direction accuracy": `${(s.dirAccTrailing * 100).toFixed(0)}%`,
      },
      extra: {
        code: s.code,
        predNext: s.predNext,
        predChangeVsCurrent: s.predChangeVsCurrent,
        maeTrailing: s.maeTrailing,
        dirAccTrailing: s.dirAccTrailing,
      } satisfies GasForecastExtra,
    },
  }));
  const pooledMae = bundle.national.maeTrailing;
  return {
    collection: { type: "FeatureCollection", features },
    source: "EIA inputs · walk-forward ridge model (this project)",
    fetchedAt: ctx.now,
    note: [
      `${features.length} states · next EIA print ${bundle.national.predDate}`,
      `national trailing MAE ${fmtGal(pooledMae)}`,
      `refresh: npm run data:gas`,
    ].join(" · "),
    meta: {
      predDate: bundle.national.predDate,
      pooledMae,
      count: features.length,
      provenance: bundle.meta.provenance,
    },
  };
}

export const gasForecastLayer: LayerDefinition = {
  id: "gasforecast",
  label: "Gas price forecast",
  description:
    "Ridge-model forecast of next week's EIA regular-gasoline print per state, from crude-oil lags, seasonality and autoregressive terms. Coloured by predicted direction; every feature carries its trailing walk-forward error.",
  color: "#E879F9",
  updateIntervalMs: 24 * 3600_000,
  defaultEnabled: false,
  estimate:
    "A statistical forecast, not a measurement. Trailing error is walk-forward out-of-sample MAE per series; the model is a calm-markets forecaster and misses geopolitical shocks (fat upside residual tail).",
  attribution: "EIA Weekly Retail Gasoline Price (inputs) · model by this project",
  fetch: fetchGasForecast,
};
