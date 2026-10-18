"use client";
// Styles for the energy layers: ERCOT prices, US electricity prices,
// global generation mix, and data centers.

import type { LayerStyle } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import type { ErcotPriceExtra } from "@/lib/layers/ercotPrices";
import type { StateElectricityExtra } from "@/lib/layers/usElectricityPrices";
import type { DataCenterExtra } from "@/lib/layers/datacenters";

/** ERCOT price band: red = expensive ($/MWh). Mirrors the staged energy map. */
function ercotBandColor(rtm: number | null | undefined): string {
  if (rtm == null) return "#8A93A6";
  if (rtm >= 400) return "#b91c1c";
  if (rtm >= 150) return "#ea580c";
  if (rtm >= 60) return "#ca8a04";
  return "#15803d";
}

/** State price colour against the national residential average: red = expensive. */
function statePriceColor(vsNational: number | null | undefined): string {
  if (vsNational == null) return "#8A93A6";
  if (vsNational > 5) return "#F87171";
  if (vsNational > 2) return "#FB923C";
  if (vsNational < -2) return "#4ADE80";
  return "#38BDF8";
}

export const ercotPricesStyle: LayerStyle = {
  color: "#EA580C",
  pointSize: () => 8,
  colorFor: (f: LayerFeature) => ercotBandColor((f.properties.extra as ErcotPriceExtra | undefined)?.rtm),
  label: (f: LayerFeature) => {
    const x = f.properties.extra as ErcotPriceExtra | undefined;
    return x && x.rtm != null ? `${f.properties.name} · $${x.rtm.toFixed(0)}/MWh` : f.properties.name;
  },
  labelMax: 13,
  scaleByDistance: [3e5, 1.0, 8e6, 0.35],
};

export const usElectricityPricesStyle: LayerStyle = {
  color: "#38BDF8",
  pointSize: () => 7,
  colorFor: (f: LayerFeature) =>
    statePriceColor((f.properties.extra as StateElectricityExtra | undefined)?.vsNational),
  label: (f: LayerFeature) => {
    const x = f.properties.extra as StateElectricityExtra | undefined;
    return x && x.residential != null
      ? `${f.properties.name} · ${x.residential.toFixed(2)}¢/kWh`
      : f.properties.name;
  },
  labelMax: 12,
  scaleByDistance: [3e5, 1.0, 8e6, 0.35],
};

export const globalGenerationStyle: LayerStyle = {
  color: "#A3E635",
  pointSize: () => 7,
  label: (f: LayerFeature) => f.properties.name,
  labelMax: 20,
  scaleByDistance: [3e5, 1.0, 8e6, 0.35],
};

export const datacentersStyle: LayerStyle = {
  color: "#22D3EE",
  pointSize: (f: LayerFeature) =>
    (f.properties.extra as DataCenterExtra | undefined)?.status === "construction" ? 7 : 5,
  colorFor: (f: LayerFeature) =>
    (f.properties.extra as DataCenterExtra | undefined)?.status === "construction"
      ? "#F59E0B"
      : "#22D3EE",
  label: (f: LayerFeature) => f.properties.name,
  labelMax: 30,
  scaleByDistance: [3e5, 1.0, 8e6, 0.35],
};
