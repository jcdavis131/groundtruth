// Layer: community health (CDC PLACES, 2025 release). One measure at a time
// (the picker under the layer's row, pref placesMeasure), as CDC publishes
// it: age-adjusted prevalence by county below COUNTY_MAX_HEIGHT_M, on the
// shared county outlines (lib/layers/areas.ts), binned by national
// quintiles; crude prevalence by census tract below PLACES_TRACT_MAX_M, on
// fabric's TIGER tract outlines, for at most six counties in view.
//
// Model-based estimates, not counts of diagnosed people. A county or tract
// CDC publishes no row for is drawn unfilled with a dashed grey edge, "not
// published", never 0. Click a county for every measure there
// (components/hud/HealthAside.tsx, /api/civic?op=health&level=place).

import type { MultiPolygon, Polygon } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { COUNTY_MAX_HEIGHT_M, countyViewBbox, loadCountyOutlines, type CountyOutline } from "./areas";
import { viewBbox } from "./water";
import type { ConstructNode } from "@/lib/fabric/types";
import {
  binOf,
  isPlacesMeasure,
  PLACES_ATTRIBUTION,
  PLACES_DEFAULT_MEASURE,
  PLACES_MAX_COUNTIES,
  PLACES_MEASURES,
  PLACES_TRACT_MAX_M,
  quintiles,
  valueText,
  type PlacesMeasure,
} from "@/lib/civic/places";

export interface HealthExtra {
  level: "county" | "tract";
  fips: string;
  measure: PlacesMeasure;
  value: number | null;
  /** Quintile bin 0..4; null when not published. */
  bin: number | null;
  breaks: number[];
}

export interface HealthRow {
  fips: string;
  name?: string | null;
  state: string | null;
  value: number | null;
  low: number | null;
  high: number | null;
  year: number | null;
  population: number | null;
}

export function measureOf(options: Record<string, unknown>): PlacesMeasure {
  return isPlacesMeasure(options.placesMeasure) ? options.placesMeasure : PLACES_DEFAULT_MEASURE;
}

function feature(id: string, name: string, geometry: Polygon | MultiPolygon, extra: HealthExtra, row: HealthRow | undefined, anchor?: [number, number]): LayerFeature<Polygon | MultiPolygon> {
  const m = PLACES_MEASURES[extra.measure];
  const type = extra.level === "county" ? "AgeAdjPrv" : "CrdPrv";
  return {
    type: "Feature",
    geometry,
    properties: {
      id,
      layer: "health",
      name,
      kind: extra.bin == null ? "not-published" : extra.breaks.length !== 4 ? "unranked" : `q${extra.bin + 1}`,
      source: "CDC PLACES",
      details: {
        measure: `${m.short} (${m.category})`,
        "CDC wording": m.name,
        value: row ? valueText({ value: row.value, low: row.low, high: row.high, year: row.year, type }) : "not published for this measure",
        [extra.level === "county" ? "county fips" : "tract fips"]: extra.fips,
        bin:
          extra.bin == null
            ? "not published"
            : extra.breaks.length !== 4
              ? "not ranked: fewer than five published values to make quintiles from"
              : `quintile ${extra.bin + 1} of 5 (${extra.level === "county" ? "all US counties" : "the tracts in view"})`,
        "what this is": "a model-based estimate, not a count of diagnosed people; not for ranking small differences",
      },
      extra,
      anchor,
    },
  };
}

/** County rows joined by FIPS onto county outlines, binned by the national breaks; an outline with no row reads "not published". */
export function joinHealthCounties(outlines: readonly CountyOutline[], rows: readonly HealthRow[], measure: PlacesMeasure, breaks: number[]): { features: LayerFeature<Polygon | MultiPolygon>[]; published: number; notPublished: number } {
  const by = new Map(rows.map((r) => [r.fips, r]));
  let published = 0;
  const features = outlines.map((o) => {
    const r = by.get(o.geoid);
    const bin = binOf(r?.value ?? null, breaks);
    if (bin != null) published++;
    return feature(`places:county:${o.geoid}`, o.stusab ? `${o.name}, ${o.stusab}` : o.name, o.feature.geometry, { level: "county", fips: o.geoid, measure, value: r?.value ?? null, bin, breaks }, r, o.feature.properties.anchor);
  });
  return { features, published, notPublished: features.length - published };
}

/**
 * Esri rings -> a MultiPolygon: a clockwise ring (Esri's outer) starts a polygon, a
 * counter-clockwise ring is a hole of the polygon before it.
 */
export function esriRingsToMulti(rings: number[][][]): MultiPolygon {
  const polys: number[][][][] = [];
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    if (a <= 0 || !polys.length) polys.push([r]);
    else polys[polys.length - 1].push(r);
  }
  return { type: "MultiPolygon", coordinates: polys };
}

/** Tract rows joined by tract FIPS onto fabric's tract outlines, binned by the quintiles of the tracts loaded. */
export function joinHealthTracts(tracts: readonly ConstructNode[], rows: readonly HealthRow[], measure: PlacesMeasure, asked: ReadonlySet<string>): { features: LayerFeature<Polygon | MultiPolygon>[]; breaks: number[]; notAsked: number } {
  const by = new Map(rows.map((r) => [r.fips, r]));
  const breaks = quintiles(rows.map((r) => r.value));
  const features: LayerFeature<Polygon | MultiPolygon>[] = [];
  let notAsked = 0;
  for (const t of tracts) {
    if (!t.code || !/^\d{11}$/.test(t.code) || !t.rings?.length) continue;
    if (!asked.has(t.code.slice(0, 5))) {
      notAsked++;
      continue;
    }
    const r = by.get(t.code);
    const bin = binOf(r?.value ?? null, breaks);
    features.push(feature(`places:tract:${t.code}`, `Tract ${t.code}`, esriRingsToMulti(t.rings), { level: "tract", fips: t.code, measure, value: r?.value ?? null, bin, breaks }, r, t.anchor));
  }
  return { features, breaks, notAsked };
}

/** The counties to ask tracts for: those with the most tracts in view, at most PLACES_MAX_COUNTIES. */
export function countiesInView(tracts: readonly ConstructNode[]): string[] {
  const count = new Map<string, number>();
  for (const t of tracts) if (t.code && /^\d{11}$/.test(t.code)) count.set(t.code.slice(0, 5), (count.get(t.code.slice(0, 5)) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PLACES_MAX_COUNTIES).map(([c]) => c).sort();
}

export function healthViewKey(v: ViewState): string {
  if (v.height > COUNTY_MAX_HEIGHT_M) return "above";
  if (v.height <= PLACES_TRACT_MAX_M) return `tract:${Math.round(v.lon / 0.1)},${Math.round(v.lat / 0.1)}`;
  const bucket = Math.round(Math.log2(Math.max(v.height, 1000) / 1000));
  return `county:${Math.round(v.lon / 0.5)},${Math.round(v.lat / 0.5)},${bucket}`;
}

async function fetchHealth(ctx: FetchContext): Promise<FetchResult> {
  const measure = measureOf(ctx.options);
  const m = PLACES_MEASURES[measure];
  const base = { source: "CDC PLACES", fetchedAt: ctx.now };
  if (ctx.view.height > COUNTY_MAX_HEIGHT_M) {
    return { ...base, collection: { type: "FeatureCollection", features: [] }, note: `descend below ${(COUNTY_MAX_HEIGHT_M / 1000).toLocaleString("en-US")} km for CDC PLACES by county (PLACES has no state rows)`, meta: { count: 0, measure } };
  }
  if (ctx.view.height <= PLACES_TRACT_MAX_M) {
    const b = viewBbox(ctx, 20_000).map((x) => x.toFixed(3)).join(",");
    const field = await proxy<{ units: ConstructNode[] }>(`/api/fabric?op=field&kind=tract&bbox=${b}`, ctx);
    const tracts = field.data.units ?? [];
    const counties = countiesInView(tracts);
    if (!counties.length) return { ...base, collection: { type: "FeatureCollection", features: [] }, note: "no census tract in view (TIGER covers the United States)", meta: { count: 0, measure } };
    const env = await proxy<{ rows: HealthRow[] }>(`/api/civic?op=health&level=tract&measure=${measure}&counties=${counties.join(",")}`, ctx);
    const j = joinHealthTracts(tracts, env.data.rows ?? [], measure, new Set(counties));
    return {
      ...base,
      source: "CDC PLACES + Census TIGERweb tracts",
      collection: { type: "FeatureCollection", features: j.features as LayerFeature[] },
      note: `${j.features.length} tracts · ${m.short}, crude prevalence, ${m.year} · ${j.breaks.length === 4 ? "quintiles of the tracts in view" : j.features.some((f) => (f.properties.extra as HealthExtra).bin != null) ? "fewer than five published here: one shade, not ranked" : "none published here"} · dashed grey: not published${j.notAsked ? ` · ${j.notAsked} tracts in counties beyond the ${PLACES_MAX_COUNTIES} asked` : ""} · model-based estimates, not counts`,
      meta: { count: j.features.length, level: "tract", measure, counties },
    };
  }
  const [areas, env] = await Promise.all([loadCountyOutlines(ctx), proxy<{ rows: HealthRow[] }>(`/api/civic?op=health&level=county&measure=${measure}`, ctx)]);
  const breaks = Array.isArray((env as unknown as { breaks?: unknown }).breaks) ? ((env as unknown as { breaks: number[] }).breaks) : quintiles((env.data.rows ?? []).map((r) => r.value));
  const j = joinHealthCounties(areas.outlines, env.data.rows ?? [], measure, breaks);
  return {
    ...base,
    source: "CDC PLACES + Census TIGERweb",
    collection: { type: "FeatureCollection", features: j.features as LayerFeature[] },
    note: `${j.published} counties · ${m.short}, age-adjusted prevalence, ${m.year} · national quintiles${j.notPublished ? ` · ${j.notPublished} not published (dashed grey)` : ""} · model-based estimates, not counts · descend below ${PLACES_TRACT_MAX_M / 1000} km for tracts`,
    meta: { count: j.features.length, level: "county", measure, breaks, bbox: countyViewBbox(ctx) },
  };
}

export const healthLayer: LayerDefinition = {
  id: "health",
  label: "Community health (CDC PLACES)",
  description:
    "CDC PLACES (2025 release): one of 40 health measures at a time (diabetes, obesity, smoking, checkups, food insecurity, ...), as model-based estimates for every county below 2,500 km (age-adjusted, national quintiles) and every published census tract below 100 km (crude). Click a county for every measure there. Estimates, not counts of diagnosed people; a place CDC does not publish is masked, never 0.",
  color: "#2563EB",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: healthViewKey,
  estimate: "Model-based estimates from CDC's BRFSS survey, ACS and the Census population; not counts of diagnosed people.",
  attribution: PLACES_ATTRIBUTION,
  fetch: fetchHealth,
};
