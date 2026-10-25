// Forecast bands for the desk chart: turn an /api/ml?op=forecast payload into
// dashed ChartSeries. Pure (no DOM, no network) so the model-card-link
// contract is unit-tested: no prediction renders without a card link.
//
// The forecast is a single 12-month endpoint. It is drawn as a dashed line
// from the last observed value to the endpoint LEVEL (last value × (1 +
// change)); the connector is visual — the caption says so, and only the
// endpoint is the forecast.

import type { ChartSeries } from "./chart";
import type { Point } from "@/lib/series/types";

export interface ForecastPayload {
  fips: string;
  modelVersion: string;
  vintage: string;
  horizonMonths: number;
  point: number;
  lo: number;
  hi: number;
  modelCard: string;
}

const MONTH_MS = 30.44 * 86_400_000;

/** Dashed mid/lo/hi series from the last observed point to the forecast endpoint. */
export function forecastChartSeries(lastT: number, lastV: number, r: ForecastPayload, color: string): ChartSeries[] {
  const endT = lastT + r.horizonMonths * MONTH_MS;
  const level = (frac: number) => lastV * (1 + frac);
  const caption = `Dashed: ${r.modelVersion} @ ${r.vintage} 12-mo outlook (straight-line connector; only the endpoint is the forecast; band = empirical p10/p90, not a calibrated interval)`;
  const captionLink = { label: "model card", href: r.modelCard };
  const mk = (id: string, label: string, frac: number): ChartSeries => {
    const points: Point[] = [
      { t: lastT, v: lastV },
      { t: endT, v: level(frac) },
    ];
    return { id, label, color, unit: "USD", points, dash: true, caption, captionLink };
  };
  return [
    mk(`forecast:${r.fips}`, `12-mo forecast (${r.modelVersion})`, r.point),
    mk(`forecast:${r.fips}:lo`, "forecast band lo", r.lo),
    mk(`forecast:${r.fips}:hi`, "forecast band hi", r.hi),
  ];
}
