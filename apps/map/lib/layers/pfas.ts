// Layer: PFAS in public drinking water, EPA UCMR 5 (2023-2025). The water
// systems that serve the view, from EPA's PFAS Analytic Tools through
// /api/water?op=pfas, each in one of four states: PFAS detected at or above
// the reporting level, sampled with none at or above it, not in UCMR 5, or
// unknown (EPA did not answer; never drawn as not-detected).
//
//   below PFAS_POLYGON_MAX_M   each system on its service area as EPA maps it
//                              (modelled boundaries dashed); a system with no
//                              boundary as a ring at EPA's estimated location
//   to PFAS_MAX_HEIGHT_M       every sampled system as a ring at EPA's
//                              estimated location, labelled with how EPA placed it
//   above                      nothing
//
// A result belongs to a system, sampled where treated water enters its
// distribution system, not at a tap: it is never a pin. The fill is the
// system's highest single result in ng/L, a measured value, not compared with
// any health limit. A system is named by its PWSID; the system's name (which
// can be an apartment complex or a rental park) is on the label and in the
// record only, never searched.

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { loadedBoxFeature } from "./flood";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";
import type { PfasExtra, PfasState } from "@/lib/water/pfas";
export { PFAS_BINS, pfasBin } from "@/lib/water/pfas";

export const PFAS_MAX_HEIGHT_M = 25_000;
/** Below this, systems are drawn on their service areas. */
export const PFAS_POLYGON_MAX_M = 10_000;
/** Box radius asked for (~12 km across); the route clamps it to 0.12 degrees. */
const BOX_RADIUS_M = 6_000;
const KEY_GRID = 0.04;
/** The ring drawn at an estimated location: big enough to read as an area, never as a point. */
export const PFAS_RING_M = 600;

const memos = { mid: new FeatureMemo(), near: new FeatureMemo() };

function tierOf(height: number): "near" | "mid" {
  return height <= PFAS_POLYGON_MAX_M ? "near" : "mid";
}

export function pfasViewKey(v: ViewState): string {
  if (v.height > PFAS_MAX_HEIGHT_M) return "above";
  return `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)},${tierOf(v.height)}`;
}

/** The request for a view, centred on the view key's cell so viewers in one cell share the route's cache. */
export function pfasRequest(v: Pick<ViewState, "lon" | "lat" | "height">): string {
  const lon = Math.round(v.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(v.lat / KEY_GRID) * KEY_GRID;
  const bbox = bboxAround(lat, lon, BOX_RADIUS_M);
  return `/api/water?op=pfas&bbox=${bbox.map((x) => x.toFixed(4)).join(",")}${tierOf(v.height) === "near" ? "&polygons=1" : ""}`;
}

/** A ring polygon of `radiusM` around a point (32 sides). */
export function ringAround(lon: number, lat: number, radiusM: number): GeoJSON.Polygon {
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  const ring: number[][] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    ring.push([Number((lon + dLon * Math.cos(a)).toFixed(6)), Number((lat + dLat * Math.sin(a)).toFixed(6))]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Estimated-location points become rings: a system's result is never drawn as a pin. */
export function asRings(features: LayerFeature[]): LayerFeature[] {
  return features.map((f) => {
    if (f.geometry.type !== "Point") return f;
    const [lon, lat] = f.geometry.coordinates;
    return { ...f, geometry: ringAround(lon, lat, PFAS_RING_M) };
  });
}

async function fetchPfas(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > PFAS_MAX_HEIGHT_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "EPA UCMR 5",
      fetchedAt: ctx.now,
      note: `descend below ${PFAS_MAX_HEIGHT_M / 1000} km for drinking-water PFAS results (United States)`,
      meta: { count: 0 },
    };
  }
  const tier = tierOf(ctx.view.height);
  const env = await proxy<FeatureCollection>(pfasRequest(ctx.view), ctx);
  const meta = env as unknown as { bbox?: [number, number, number, number]; coverage?: CoverageLike[]; systems?: Record<PfasState, number>; notDrawn?: unknown[] };
  const features = memos[tier].stable(asRings(env.data.features as unknown as LayerFeature[]));
  const loaded = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : null;
  const c = meta.systems;
  const nd = meta.notDrawn?.length ?? 0;
  const lead =
    (c ? `${c.detected} systems with PFAS at or above the reporting level, ${c["not-detected"]} sampled with none, ${c["not-in-ucmr5"]} not in UCMR 5, ${c.unknown} unknown` : `${features.length} water systems`) +
    (nd ? ` · ${nd} not drawn (no location EPA publishes for them here)` : "") +
    " · fill: highest single result, under 5 / 5-10 / 10-20 / 20+ ng/L, measured, not compared with any limit" +
    (tier === "mid" ? ` · rings at EPA's estimated locations; descend below ${PFAS_POLYGON_MAX_M / 1000} km for service areas` : "");
  return {
    collection: { type: "FeatureCollection", features: loaded ? [...features, loadedBoxFeature("pfas", loaded, "water systems")] : features },
    source: "EPA UCMR 5",
    fetchedAt: ctx.now,
    note: coverageNote(lead, meta.coverage ?? []),
    meta: { count: features.filter((f) => (f.properties.extra as PfasExtra | undefined)?.state).length },
  };
}

export const pfasLayer: LayerDefinition = {
  id: "pfas",
  label: "PFAS in drinking water (EPA UCMR 5)",
  description:
    "PFAS results for the public water systems serving the view, EPA's fifth Unregulated Contaminant Monitoring Rule (2023-2025), below 25 km: each system on its service area as EPA maps it below 10 km (modelled boundaries dashed), otherwise a ring at EPA's estimated location, never a pin. Filled by the system's highest single result in ng/L where PFAS were found at or above the reporting level; outlined where sampled with none; dashed where the system was not in UCMR 5; unknown when EPA did not answer. Samples are taken where treated water enters the distribution system, not at a tap, and are not compared with any health limit.",
  color: "#A855F7",
  updateIntervalMs: 12 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: pfasViewKey,
  attribution: "U.S. EPA UCMR 5 via the PFAS Analytic Tools (EPA OECA); EPA Community Water System Service Area Boundaries",
  fetch: fetchPfas,
};
