// Shared fetch for the county layers. One server response carries the
// county outlines in view (Census TIGERweb, current vintage: Connecticut's
// planning regions) with jobs, home values and rents; commerce and
// realestate dress their own copy, and the county choropleths of round 4
// (riskindex, health) join their own attributes onto the same outlines by
// FIPS (loadCountyOutlines), so the globe has one county outline source.
// Above COUNTY_MAX_HEIGHT_M the same joins are shown per state.

import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { monthLabel, tagArea, type AreaExtra } from "@/lib/economy/features";
import type { BaseProps, FetchContext, FetchResult, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { viewBbox } from "./water";

export const COUNTY_MAX_HEIGHT_M = 2_500_000;

type AreaFc = FeatureCollection<Polygon | MultiPolygon, BaseProps>;
interface AreaEnvelope {
  data: AreaFc;
  asOf?: Record<string, string>;
  source?: string;
  level?: string;
  polygons?: number;
}

let states: Promise<AreaEnvelope> | null = null;
let statesAt = 0;

function loadStates(ctx: FetchContext): Promise<AreaEnvelope> {
  if (!states || ctx.now - statesAt > 6 * 3600_000) {
    statesAt = ctx.now;
    states = proxy<AreaFc>("/api/economy?op=areas&level=state", { ...ctx, signal: undefined }).catch((err) => {
      states = null;
      throw err;
    });
  }
  return states;
}

/** The county outlines in view, as /api/economy?op=areas answers them (the request every county layer shares, so the browser and the edge cache answer it once). */
export function countyAreasRequest(ctx: FetchContext): string {
  return `/api/economy?op=areas&bbox=${countyViewBbox(ctx)}`;
}

/** The box the county outlines are asked for, as sent ("w,s,e,n", 2 decimals); a layer joining onto them asks its rows for the same box. */
export function countyViewBbox(ctx: FetchContext): string {
  return viewBbox(ctx, ctx.view.bbox ? 300_000 : Math.min(ctx.view.height, 2_000_000)).map((x) => x.toFixed(2)).join(",");
}

/** A county outline to join onto: its 5-digit FIPS (GEOID), name and state abbreviation as TIGERweb gives them. */
export interface CountyOutline {
  geoid: string;
  name: string;
  stusab?: string;
  feature: LayerFeature<Polygon | MultiPolygon>;
}

/**
 * The county outlines in view, for a county choropleth that is not commerce or realestate.
 * A county the economy joins have no jobs or home row for is not in that answer, so it has no
 * outline here; a layer joining onto these counts its rows left without one.
 */
export async function loadCountyOutlines(ctx: FetchContext): Promise<{ outlines: CountyOutline[]; source: string }> {
  const env = await proxy<AreaFc>(countyAreasRequest(ctx), ctx);
  return { outlines: countyOutlines(env.data), source: "Census TIGERweb (via /api/economy?op=areas)" };
}

/** Area features -> county outlines keyed by GEOID (state features and features with no GEOID are skipped). */
export function countyOutlines(fc: AreaFc): CountyOutline[] {
  const out: CountyOutline[] = [];
  for (const f of fc.features) {
    const x = f.properties.extra as Partial<AreaExtra> | undefined;
    if (!x?.geoid || x.level !== "county" || !/^\d{5}$/.test(x.geoid)) continue;
    out.push({ geoid: x.geoid, name: x.name ?? x.geoid, stusab: x.stusab, feature: f as LayerFeature<Polygon | MultiPolygon> });
  }
  return out;
}

export async function fetchAreas(ctx: FetchContext, layer: "commerce" | "realestate"): Promise<FetchResult> {
  const level = ctx.view.height > COUNTY_MAX_HEIGHT_M ? "state" : "county";
  const env: AreaEnvelope = level === "state" ? await loadStates(ctx) : await proxy<AreaFc>(countyAreasRequest(ctx), ctx);
  const features: LayerFeature[] = [];
  for (const f of env.data.features) {
    const t = tagArea(f as LayerFeature<Polygon | MultiPolygon>, layer);
    if (t) features.push(t);
  }
  const asOf = env.asOf ?? {};
  const stamp = layer === "commerce" ? (asOf.qcew ? `QCEW ${asOf.qcew}` : "") : asOf.zhvi ? `ZHVI ${monthLabel(asOf.zhvi)}` : "";
  const note =
    level === "state"
      ? `${features.length} states${stamp ? " · " + stamp : ""} · descend below ${Math.round(COUNTY_MAX_HEIGHT_M / 1000).toLocaleString()} km for counties`
      : `${features.length} counties${stamp ? " · " + stamp : ""}`;
  return {
    collection: { type: "FeatureCollection", features },
    source: env.source ?? "BLS QCEW + Zillow + Census TIGERweb",
    fetchedAt: ctx.now,
    note,
    meta: { count: features.length, level },
  };
}
