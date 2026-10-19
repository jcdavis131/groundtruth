// Layer: public schools (NCES EDGE, school year 2024-25). Points below
// SCHOOLS_MAX_M, inside the same ~11 km dashed civic box as Environmental
// permits and Contaminated sites, anywhere in the United States, coloured by
// NCES's school level (elementary, middle, high, other; the published word is
// in the click). A full virtual school is drawn faint: its point is an office.
// Inactive and Future schools are not drawn. Outside the box nothing is
// loaded, which is not the same as no school being there.

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { civicLoadedBox } from "./civicBox";
import { envBox, inUs } from "./envpermits";
import { FeatureMemo } from "./featureMemo";
import { SCHOOLS_ATTRIBUTION, type SchoolExtra } from "@/lib/civic/schools";
import type { Bbox } from "@/lib/zoning/features";

export const SCHOOLS_MAX_M = 25_000;
const KEY_GRID = 0.05;
const memo = new FeatureMemo();

export function schoolsViewKey(v: ViewState): string {
  return v.height > SCHOOLS_MAX_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`;
}

/** The request for a view: the civic box Environmental permits asks for. */
export function schoolsRequest(v: Pick<ViewState, "lon" | "lat">): string {
  return `/api/civic?op=schools&bbox=${envBox(v).join(",")}`;
}

async function fetchSchools(ctx: FetchContext): Promise<FetchResult> {
  const empty = (note: string): FetchResult => ({ collection: { type: "FeatureCollection", features: [] }, source: "NCES EDGE", fetchedAt: ctx.now, note, meta: { count: 0 } });
  if (ctx.view.height > SCHOOLS_MAX_M) return empty(`descend below ${SCHOOLS_MAX_M / 1000} km for public schools (NCES, school year 2024-25)`);
  const want = envBox(ctx.view);
  if (!inUs(want)) return empty("NCES's public school directory covers the United States only");
  const env = await proxy<FeatureCollection>(schoolsRequest(ctx.view), ctx);
  const meta = env as unknown as { bbox?: Bbox; hidden?: number; truncated?: boolean };
  const loaded: Bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : want;
  const features = memo.stable(env.data.features as unknown as LayerFeature[]);
  const n = { elementary: 0, middle: 0, high: 0, other: 0, charter: 0, virtual: 0 };
  for (const f of features) {
    const x = f.properties.extra as SchoolExtra | undefined;
    if (!x) continue;
    n[x.levelClass]++;
    if (x.charter) n.charter++;
    if (x.virtual) n.virtual++;
  }
  return {
    collection: { type: "FeatureCollection", features: [...features, civicLoadedBox("schools", loaded, "public schools")] },
    source: "NCES EDGE",
    fetchedAt: ctx.now,
    note:
      `${features.length} public schools in the dashed box (outside it: not loaded) · elementary ${n.elementary}, middle ${n.middle}, high ${n.high}, other ${n.other} · ${n.charter} charter` +
      (n.virtual ? ` · ${n.virtual} full virtual (drawn faint: the point is an office)` : "") +
      (meta.hidden ? ` · ${meta.hidden} inactive or future not drawn` : "") +
      (meta.truncated ? " · NCES's record limit hit: zoom in for every school" : "") +
      " · public schools only",
    meta: { count: features.length },
  };
}

export const schoolsLayer: LayerDefinition = {
  id: "schools",
  label: "Public schools (NCES)",
  description:
    "NCES public schools for school year 2024-25 below 25 km inside a dashed box, anywhere in the United States, coloured by school level, with district, grades, type, charter and virtual status, locale, enrollment, the free or reduced-price lunch share, FTE teachers and the student-teacher ratio as NCES publishes them, and a link to NCES's own page. No race, sex or grade-level enrollment is read. A full virtual school's point is its office. Private schools are not on this layer.",
  color: "#0EA5E9",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: schoolsViewKey,
  attribution: SCHOOLS_ATTRIBUTION,
  fetch: fetchSchools,
};
