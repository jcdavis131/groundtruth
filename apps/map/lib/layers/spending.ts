// Layer: federal spending. Where federal dollars land, by county, for the
// latest complete fiscal year, against how many people work there.
//
//   USAspending   obligations by place of performance (contracts, grants,
//                 loans, direct payments), fiscal-year-to-date total, and on
//                 selection the top recipients, awarding agencies, NAICS mix
//                 and a six-year trace
//   BLS QCEW      covered employment, the denominator of the per-job estimate
//   TIGERweb      generalized county polygons (states above 2,500 km)
//
// Obligations are commitments, not outlays; recipients are legal entities.
// Labelled ESTIMATE for the per-job figure, which prints its formula.

import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { SpendingExtra } from "@/lib/finance/features";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition } from "./types";
import { proxy, type ProxyEnvelope } from "./aircraft";
import { COUNTY_MAX_HEIGHT_M } from "./areas";
import { viewBbox } from "./water";

export type { SpendingExtra } from "@/lib/finance/features";
export { COUNTY_MAX_HEIGHT_M };

type SpendingFc = FeatureCollection<Polygon | MultiPolygon, BaseProps>;
interface SpendingMeta {
  caveats?: string[];
  fy?: number;
  level?: string;
  qcewPeriod?: string | null;
}
type Envelope = ProxyEnvelope<SpendingFc> & SpendingMeta;

let states: Promise<Envelope> | null = null;
let statesAt = 0;

function loadStates(ctx: FetchContext): Promise<Envelope> {
  if (!states || ctx.now - statesAt > 12 * 3600_000) {
    statesAt = ctx.now;
    states = (proxy<SpendingFc>("/api/finance?op=spending&level=state", { ...ctx, signal: undefined }) as Promise<Envelope>).catch((err) => {
      states = null;
      throw err;
    });
  }
  return states;
}

async function fetchSpending(ctx: FetchContext): Promise<FetchResult> {
  const level = ctx.view.height > COUNTY_MAX_HEIGHT_M ? "state" : "county";
  const env: Envelope =
    level === "state"
      ? await loadStates(ctx)
      : ((await proxy<SpendingFc>(
          `/api/finance?op=spending&bbox=${viewBbox(ctx, ctx.view.bbox ? 300_000 : Math.min(ctx.view.height, 2_000_000))
            .map((x) => x.toFixed(2))
            .join(",")}`,
          ctx,
        )) as Envelope);
  const features = env.data.features;
  const withPerJob = features.filter((f) => (f.properties.extra as SpendingExtra).perJob).length;
  const shownLevel = env.level ?? level;
  const note =
    shownLevel === "state"
      ? `${features.length} states · FY${env.fy ?? "?"}${level === "county" ? " · too many counties in view, showing states" : ` · descend below ${Math.round(COUNTY_MAX_HEIGHT_M / 1000).toLocaleString()} km for counties`}`
      : `${features.length} counties · FY${env.fy ?? "?"} · ${withPerJob} with a per-job figure${env.qcewPeriod ? ` (QCEW ${env.qcewPeriod})` : ""}`;
  return {
    collection: { type: "FeatureCollection", features },
    source: env.source ?? "USAspending + BLS QCEW + Census TIGERweb",
    fetchedAt: ctx.now,
    note,
    meta: { count: features.length, level: shownLevel, fy: env.fy, caveats: env.caveats },
  };
}

export const spendingLayer: LayerDefinition = {
  id: "spending",
  label: "Federal spending",
  description:
    "USAspending obligations by place of performance for every county in the latest complete fiscal year, coloured by dollars per covered job (an estimate that prints its formula), with the top recipients, awarding agencies, NAICS mix and a six-year trace on selection.",
  color: "#FFD166",
  updateIntervalMs: 12 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  estimate: "Per-job divides USAspending obligations by BLS QCEW covered employment; obligations are commitments, not outlays",
  attribution: "USAspending (U.S. Treasury) · BLS QCEW · US Census Bureau TIGERweb",
  fetch: fetchSpending,
};
