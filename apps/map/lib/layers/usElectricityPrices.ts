// Layer: US state retail electricity prices. EIA SEDS annual retail prices
// by sector, drawn at state label points and coloured against the national
// residential average.
//
//   EIA State Energy Data System   bundled as lib/energy/data/us_electricity_prices.json
//                                 by lib/energy/build_bundles.py; refresh
//                                 with `npm run data:energy`
//
// Published values as EIA sent them; nothing estimated here. Annual cadence:
// the bundle goes stale between EIA releases, and the layer note says so.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { fmtCentsKwh, usElectricityBundle } from "@/lib/energy/energy";
import { nationalAvgForYear, statePriceForYear } from "@/lib/globe/timeMachine";

export interface StateElectricityExtra {
  code: string;
  residential: number | null;
  vsNational: number | null;
}

async function fetchUsElectricityPrices(ctx: FetchContext): Promise<FetchResult> {
  const bundle = usElectricityBundle();
  // Time machine: step to the playback year's residential prices; missing
  // years stay missing (step from the last known year, never interpolated).
  const year = ctx.playbackYear ?? bundle.asof_year;
  const playback = ctx.playbackYear != null;
  const national = playback
    ? nationalAvgForYear(bundle.states, year)
    : bundle.national_residential_avg;
  const priceFor = (code: string) =>
    playback ? statePriceForYear(bundle.states[code], year) : bundle.states[code].residential;
  const features: LayerFeature<Point>[] = Object.entries(bundle.states).map(
    ([code, s]) => {
      const residential = priceFor(code);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: {
          id: `uselec-${code}`,
          layer: "uselectricity",
          name: s.name,
          kind: "state",
          altitude: 0,
          source: "U.S. Energy Information Administration",
          details: {
            "Residential": fmtCentsKwh(residential),
            "Commercial": playback ? "n/a (playback)" : fmtCentsKwh(s.commercial),
            "Industrial": playback ? "n/a (playback)" : fmtCentsKwh(s.industrial),
            "vs national": residential == null || national == null
              ? "n/a"
              : `${residential - national >= 0 ? "+" : ""}${(residential - national).toFixed(2)}¢`,
            "Year": playback && residential == null ? `${year} (no data yet)` : String(year),
            "National avg": fmtCentsKwh(national),
          },
          extra: {
            code,
            residential,
            vsNational: residential == null || national == null ? null : residential - national,
          } satisfies StateElectricityExtra,
        },
      };
    },
  );
  return {
    collection: { type: "FeatureCollection", features },
    source: "U.S. Energy Information Administration",
    fetchedAt: ctx.now,
    note: [
      `${features.length} states · EIA SEDS annual retail electricity`,
      playback ? `playback year ${year} · stepped from last known` : `year ${bundle.asof_year}`,
      `national residential ${fmtCentsKwh(national)}`,
      `refresh: npm run data:energy`,
    ].join(" · "),
    meta: {
      asofYear: year,
      nationalResidentialAvg: national,
      count: features.length,
      provenance: bundle.meta.provenance,
      playbackYear: playback ? year : undefined,
    },
  };
}

export const usElectricityPricesLayer: LayerDefinition = {
  id: "uselectricity",
  label: "US electricity prices",
  description:
    "EIA annual retail electricity prices by state and sector, coloured against the national residential average. Published values as EIA sent them; the bundle refreshes with npm run data:energy.",
  color: "#38BDF8",
  updateIntervalMs: 24 * 3600_000,
  defaultEnabled: false,
  attribution: "U.S. Energy Information Administration, State Energy Data System",
  fetch: fetchUsElectricityPrices,
};
