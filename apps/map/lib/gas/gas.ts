// Gas-price data access: EIA weekly retail gasoline prices (national + 9 states)
// and per-series ridge forecasts of the next weekly print.
//
// Bundles are built offline by the gas-forecaster pipeline
// (~/workspace/gas-forecaster: pull EIA weekly XLS -> parse -> walk-forward
// ridge per series -> emit bundles here). The bundles are imported at build
// time; queries are pure and synchronous. Refresh: `npm run data:gas`.

import pricesJson from "./data/gas_prices.json";
import forecastsJson from "./data/gas_forecasts.json";

/** One weekly observation as stored in the bundles. */
export type GasHistoryPoint = [date: string, price: number];

/** Current values + full weekly history for one series. */
export interface GasSeriesCurrent {
  current: number;
  prevWeek: number | null;
  /** Week-over-week change in $/gal, null when unavailable. */
  changeWow: number | null;
  /** ISO date of the latest weekly observation. */
  asof: string;
  history: GasHistoryPoint[];
}

export interface GasStateCurrent extends GasSeriesCurrent {
  name: string;
}

export interface GasBundleMeta {
  built: string;
  method: string;
  sources: Record<string, string>;
  provenance: string;
  freshness: string;
  verification_note?: string;
}

export interface GasPricesBundle {
  meta: GasBundleMeta;
  national: GasSeriesCurrent;
  states: Record<string, GasStateCurrent>;
  /** Approximate label points [lon, lat] per state code. */
  centroids: Record<string, [number, number]>;
}

/** Walk-forward-validated forecast of the next weekly print for one series. */
export interface GasForecast {
  /** Predicted next print in $/gal, null when the series is too short to model. */
  predNext: number | null;
  /** ISO date the prediction targets. */
  predDate: string;
  /** predNext - current, $/gal. */
  predChangeVsCurrent: number | null;
  /** Pooled walk-forward out-of-sample MAE ($/gal). The honesty number. */
  maeTrailing: number;
  /** Pooled walk-forward directional accuracy on print days. */
  dirAccTrailing: number;
  lastActual: number;
}

export interface GasForecastsBundle {
  meta: GasBundleMeta;
  national: GasForecast;
  states: Record<string, GasForecast>;
}

const PRICES = pricesJson as unknown as GasPricesBundle;
const FORECASTS = forecastsJson as unknown as GasForecastsBundle;

/** USPS state codes covered, in a stable display order (west to east). */
export const GAS_STATES = ["CA", "WA", "CO", "MN", "TX", "FL", "OH", "NY", "MA"] as const;
export type GasStateCode = (typeof GAS_STATES)[number];

export function gasPrices(): GasPricesBundle {
  return PRICES;
}

export function gasForecasts(): GasForecastsBundle {
  return FORECASTS;
}

/** State series with coordinates, skipping any state missing a centroid. */
export function statePriceList(): Array<GasStateCurrent & { code: string; lon: number; lat: number }> {
  const out: Array<GasStateCurrent & { code: string; lon: number; lat: number }> = [];
  for (const code of GAS_STATES) {
    const s = PRICES.states[code];
    const c = PRICES.centroids[code];
    if (!s || !c || !Number.isFinite(s.current)) continue;
    out.push({ ...s, code, lon: c[0], lat: c[1] });
  }
  return out;
}

/** A forecast the model could actually produce (predNext is never null here). */
export type ModelableGasForecast = Omit<GasForecast, "predNext"> & { predNext: number };

/** State forecasts with coordinates, skipping series too short to model. */
export function stateForecastList(): Array<ModelableGasForecast & { code: string; name: string; lon: number; lat: number }> {
  const out: Array<ModelableGasForecast & { code: string; name: string; lon: number; lat: number }> = [];
  for (const code of GAS_STATES) {
    const f = FORECASTS.states[code];
    const s = PRICES.states[code];
    const c = PRICES.centroids[code];
    const predNext = f?.predNext;
    if (!f || predNext == null || !s || !c) continue;
    out.push({
      code,
      name: s.name,
      lon: c[0],
      lat: c[1],
      predNext,
      predDate: f.predDate,
      predChangeVsCurrent: f.predChangeVsCurrent,
      maeTrailing: f.maeTrailing,
      dirAccTrailing: f.dirAccTrailing,
      lastActual: f.lastActual,
    });
  }
  return out;
}

/** Bundle provenance for layer notes and API responses. */
export function gasProvenance() {
  return {
    prices: {
      built: PRICES.meta.built,
      method: PRICES.meta.method,
      sources: PRICES.meta.sources,
      provenance: PRICES.meta.provenance,
      freshness: PRICES.meta.freshness,
      verification_note: PRICES.meta.verification_note,
    },
    forecasts: {
      built: FORECASTS.meta.built,
      method: FORECASTS.meta.method,
      sources: FORECASTS.meta.sources,
      provenance: FORECASTS.meta.provenance,
      freshness: FORECASTS.meta.freshness,
    },
  };
}

/** $/gal with two decimals, e.g. 4.48. Never invents precision. */
export function fmtGal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `$${v.toFixed(2)}/gal`;
}

/** Signed $/gal change, e.g. +0.16/gal. */
export function fmtGalChange(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}$${Math.abs(v).toFixed(2)}/gal`;
}
