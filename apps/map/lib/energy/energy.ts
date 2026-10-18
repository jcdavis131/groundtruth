// Energy data access: ERCOT real-time/day-ahead prices + weather-zone load,
// EIA SEDS US state retail electricity prices, Ember global generation by
// fuel, and OpenStreetMap data-center locations.
//
// Bundles are built offline by lib/energy/build_bundles.py from the raw
// collector outputs (lib/energy/collectors/, free public sources only).
// The bundles are imported at build time; queries are pure and synchronous.
// Refresh: `npm run data:energy`.
//
// Published values as the sources sent them; nothing estimated here.
// Coverage caveats live in each bundle's meta.

import ercotJson from "./data/ercot_prices.json";
import usPricesJson from "./data/us_electricity_prices.json";
import generationJson from "./data/global_generation.json";
import datacentersJson from "./data/datacenters.json";

export interface EnergyBundleMeta {
  built: string;
  sources: Record<string, string>;
  provenance: string;
  freshness: string;
  coverage_caveats?: string[];
}

/** One ERCOT hub or load-zone price point. */
export interface ErcotPricePoint {
  id: string;
  label: string;
  kind: "hub" | "zone";
  lat: number;
  lon: number;
  price_usd_mwh: number;
}

export interface ErcotLoadZone {
  zone: string;
  lat: number;
  lon: number;
  load_mw: number;
}

export interface ErcotBundle {
  meta: EnergyBundleMeta;
  rtm: { asof: string | null; points: ErcotPricePoint[] };
  dam: { asof: string | null; points: ErcotPricePoint[] };
  load: { asof: string | null; zones: ErcotLoadZone[]; note: string };
}

/** One US state's retail electricity prices, cents/kWh. */
export interface StateElectricity {
  name: string;
  lat: number;
  lon: number;
  residential: number | null;
  commercial: number | null;
  industrial: number | null;
  transportation: number | null;
  /** [year, cents/kWh] residential history. */
  history_residential: [number, number][];
}

export interface UsElectricityBundle {
  meta: EnergyBundleMeta;
  asof_year: number;
  national_residential_avg: number | null;
  units: string;
  states: Record<string, StateElectricity>;
}

export interface CountryGenerationYear {
  year: number;
  total_twh: number;
  fuels: { fuel: string; twh: number; share_pct: number }[];
}

export interface CountryGeneration {
  country: string;
  lat: number;
  lon: number;
  /** Latest year (backwards-compatible snapshot of history's last entry). */
  year: number;
  total_twh: number;
  fuels: { fuel: string; twh: number; share_pct: number }[];
  /** Yearly history, ascending. Missing years stay missing: consumers must
      step from the last known year, never interpolate. */
  history: CountryGenerationYear[];
}

export interface GlobalGenerationBundle {
  meta: EnergyBundleMeta;
  asof_year: number;
  /** [first, last] year present across country histories. */
  history_years: [number, number];
  countries: CountryGeneration[];
  skipped_no_label_point: string[];
}

export interface DataCenter {
  name: string;
  operator: string | null;
  lat: number;
  lon: number;
  start_date?: string;
  opening_date?: string;
}

export interface DataCentersBundle {
  meta: EnergyBundleMeta;
  operating: DataCenter[];
  construction: DataCenter[];
}

export function ercotBundle(): ErcotBundle {
  return ercotJson as unknown as ErcotBundle;
}

export function usElectricityBundle(): UsElectricityBundle {
  return usPricesJson as unknown as UsElectricityBundle;
}

export function globalGenerationBundle(): GlobalGenerationBundle {
  return generationJson as unknown as GlobalGenerationBundle;
}

export function datacentersBundle(): DataCentersBundle {
  return datacentersJson as unknown as DataCentersBundle;
}

/** Price-band colour, mirroring the staged energy map: $/MWh thresholds. */
export function ercotPriceColor(priceUsdMwh: number): string {
  if (priceUsdMwh >= 400) return "#b91c1c";
  if (priceUsdMwh >= 150) return "#ea580c";
  if (priceUsdMwh >= 60) return "#ca8a04";
  return "#15803d";
}

export function fmtMwh(price: number | null): string {
  return price == null ? "n/a" : `$${price.toFixed(2)}/MWh`;
}

export function fmtCentsKwh(cents: number | null): string {
  return cents == null ? "n/a" : `${cents.toFixed(2)}¢/kWh`;
}
