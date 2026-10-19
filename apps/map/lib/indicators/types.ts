// Named indicators: first-class signals built from series the app already
// fetches. Each one carries a name, a plain reason it matters, threshold
// rules with a citation, and a fetch() that returns a provenance-bearing
// Series. The registry (registry.ts) is the list; evaluate.ts turns a series
// into a status; service.ts fetches, caches and stores; the API and the HUD
// panel read the result.

import type { SourceId } from "@/lib/provenance/sources";
import type { Frequency, Series, SeriesMeta } from "@/lib/series/types";
import type { LayerId } from "@/lib/layers/types";

export type IndicatorCategory = "freight" | "housing" | "water" | "energy" | "labour" | "trade" | "macro";

export const INDICATOR_CATEGORIES: IndicatorCategory[] = ["freight", "housing", "water", "energy", "labour", "trade", "macro"];

export type ThresholdLevel = "watch" | "alert";
export type ThresholdOp = "<" | ">" | "<=" | ">=";

/**
 * A rule that fires when a metric of the series crosses a value. `on` picks
 * the metric: the latest value (default), the year-over-year percent change,
 * or the year-over-year absolute change (unemployment rate in points).
 */
export interface Threshold {
  level: ThresholdLevel;
  op: ThresholdOp;
  value: number;
  /** What the rule means, in words a reader can quote. Say "convention" when it is not an official level. */
  label: string;
  /** Where the level comes from (NWS flood stage page, Sahm 2019, ...). */
  citation?: string;
  /** Metric the rule is tested against. Defaults to "value". */
  on?: "value" | "yoyPct" | "yoyAbs";
}

export interface FetchCtx {
  /** Epoch ms the evaluation is for; readers use it to pick a date window. */
  now: number;
  /** The indicator being fetched, so shared readers can build its series meta without relying on `this`. */
  indicator: Indicator;
}

export interface Indicator {
  /** Stable id, kebab-case; the series id in the store is `indicator:<id>`. */
  id: string;
  title: string;
  category: IndicatorCategory;
  unit: string;
  /** One or two factual sentences. No advice. */
  whyItMatters: string;
  source: SourceId;
  /** Upstream series id, as the publisher spells it ("MORTGAGE30US", "USGS-07032000:00065"). */
  seriesId: string;
  geo?: SeriesMeta["geo"];
  cadence: Frequency;
  thresholds: Threshold[];
  /** Lower is worse (reservoir storage, container volumes). Changes the colour of a fall, not the rules. */
  invert?: boolean;
  /** Read the series from its upstream (or a shared reader that is already cached). Must include provenance. */
  fetch(ctx: FetchCtx): Promise<Series>;
  relatedLayers?: LayerId[];
  flyTo?: { lon: number; lat: number; height: number };
}

/** The serialisable part of an indicator, what `?op=list` returns. */
export type IndicatorMeta = Omit<Indicator, "fetch">;

/** Strip the fetch function so an indicator can be sent as JSON. */
export function indicatorMeta(ind: Indicator): IndicatorMeta {
  const meta: IndicatorMeta & { fetch?: Indicator["fetch"] } = { ...ind };
  delete meta.fetch;
  return meta;
}

/** Series id an indicator's history is stored under. */
export function indicatorSeriesId(id: string): string {
  return `indicator:${id}`;
}
