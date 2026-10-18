"use client";
// Styles for the gas prices and gas price forecast layers.

import type { LayerStyle } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import type { GasPriceExtra } from "@/lib/layers/gasPrices";
import type { GasForecastExtra } from "@/lib/layers/gasForecast";

const GAS = "#FBBF24";
const FORECAST = "#E879F9";

/** Price colour against the national average: red = expensive. Non-finite
 * (no observation yet in playback) draws neutral grey. */
function priceColor(vsNational: number | null | undefined): string {
  if (vsNational == null || !Number.isFinite(vsNational)) return "#8A93A6";
  if (vsNational > 0.5) return "#F87171";
  if (vsNational > 0.15) return "#FB923C";
  if (vsNational < -0.15) return "#4ADE80";
  return GAS;
}

/** Forecast colour by predicted direction: red = prices rising. */
function forecastColor(change: number | null | undefined): string {
  if (change == null) return "#8A93A6";
  if (change > 0.03) return "#F87171";
  if (change < -0.03) return "#4ADE80";
  return "#9AA7B8";
}

export const gasPricesStyle: LayerStyle = {
  color: GAS,
  pointSize: () => 7,
  colorFor: (f: LayerFeature) => priceColor((f.properties.extra as GasPriceExtra | undefined)?.vsNational),
  label: (f: LayerFeature) => {
    const x = f.properties.extra as GasPriceExtra | undefined;
    if (!x) return f.properties.name;
    return Number.isFinite(x.price) ? `${f.properties.name} · $${x.price.toFixed(2)}` : `${f.properties.name} · no data yet`;
  },
  labelMax: 12,
  scaleByDistance: [3e5, 1.0, 8e6, 0.35],
};

export const gasForecastStyle: LayerStyle = {
  color: FORECAST,
  pointSize: () => 7,
  colorFor: (f: LayerFeature) => forecastColor((f.properties.extra as GasForecastExtra | undefined)?.predChangeVsCurrent),
  label: (f: LayerFeature) => {
    const x = f.properties.extra as GasForecastExtra | undefined;
    return x ? `${f.properties.name} → $${x.predNext.toFixed(2)}` : f.properties.name;
  },
  labelMax: 12,
  scaleByDistance: [3e5, 1.0, 8e6, 0.35],
};
