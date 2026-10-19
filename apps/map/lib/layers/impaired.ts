// Layer: impaired waters (EPA ATTAINS, 303(d)). The assessment units states,
// territories and tribes report to EPA as impaired, lines (stream reaches)
// and areas (lakes, estuaries, watersheds), below IMPAIRED_MAX_HEIGHT_M
// inside a dashed box, through /api/water?op=impaired. Category 5 (on the
// 303(d) list, needs a TMDL) is drawn red, category 4 (a TMDL or other plan)
// orange. A category is a regulatory listing for a whole unit and one
// reporting cycle, not a measured value at a point; waters not drawn were not
// reported impaired, which includes waters never assessed. Above 10 km the
// layer is empty: the zoomed-out picture EPA serves timed out on 3 of 5 calls
// when probed (2026-10-13), so it is not drawn.

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { loadedBoxFeature } from "./flood";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";
import type { ImpairedExtra } from "@/lib/water/impaired";

export const IMPAIRED_MAX_HEIGHT_M = 10_000;
/** Box radius asked for (~12 km across); the route clamps it to 0.12 degrees. */
const BOX_RADIUS_M = 6_000;
const KEY_GRID = 0.04;

const memo = new FeatureMemo();

export function impairedViewKey(v: ViewState): string {
  return v.height > IMPAIRED_MAX_HEIGHT_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`;
}

/** The request for a view, centred on the view key's cell so viewers in one cell share the route's cache. */
export function impairedRequest(v: Pick<ViewState, "lon" | "lat">): string {
  const lon = Math.round(v.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(v.lat / KEY_GRID) * KEY_GRID;
  return `/api/water?op=impaired&bbox=${bboxAround(lat, lon, BOX_RADIUS_M).map((x) => x.toFixed(4)).join(",")}`;
}

async function fetchImpaired(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > IMPAIRED_MAX_HEIGHT_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "EPA ATTAINS",
      fetchedAt: ctx.now,
      note: `descend below ${IMPAIRED_MAX_HEIGHT_M / 1000} km for impaired waters (United States)`,
      meta: { count: 0 },
    };
  }
  const env = await proxy<FeatureCollection>(impairedRequest(ctx.view), ctx);
  const meta = env as unknown as { bbox?: [number, number, number, number]; coverage?: CoverageLike[] };
  const features = memo.stable(env.data.features as unknown as LayerFeature[]);
  let listed = 0;
  for (const f of features) if ((f.properties.extra as ImpairedExtra | undefined)?.tier === "listed") listed++;
  const loaded = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : null;
  return {
    collection: { type: "FeatureCollection", features: loaded ? [...features, loadedBoxFeature("impaired", loaded, "impaired waters")] : features },
    source: "EPA ATTAINS",
    fetchedAt: ctx.now,
    note: coverageNote(
      `${features.length} impaired assessment units in the dashed box, ${listed} on the 303(d) list · as states report them; not shown is not clean (some waters were never assessed)`,
      meta.coverage ?? [],
    ),
    meta: { count: features.length },
  };
}

export const impairedLayer: LayerDefinition = {
  id: "impaired",
  label: "Impaired waters (EPA 303(d))",
  description:
    "Waters states report to EPA as impaired, below 10 km inside a dashed box: streams as lines, lakes, estuaries and watersheds as areas, red where on the 303(d) list (category 5), orange where a TMDL or other plan is in place (category 4). Each record has the assessment unit, category, TMDL, reporting cycle, EPA's action status and its How's My Waterway page. A listing for the whole unit, not a measurement; waters not shown were not reported impaired, which includes waters never assessed.",
  color: "#EF4444",
  updateIntervalMs: 12 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: impairedViewKey,
  attribution: "U.S. EPA ATTAINS, from state, territorial and tribal Integrated Reports",
  fetch: fetchImpaired,
};
