// Layer: building permits. Permits seven city portals list as issued in the
// last 30 days, as points, below PERMITS_MAX_M, inside a dashed "loaded"
// box of about 1.7 km around the view. Colour follows the city's own permit
// words (new construction, demolition, alterations, trade work); the dossier
// shows the number, type, work, description, valuation under its own column
// name, dates, status, site address, parcel key, contractor company and the
// city's record link.
//
// Where no feed is wired the note says so and why (Dallas stale, Houston no
// records, San Antonio's mixed coordinates, Denver's commercial layer behind
// a token); an empty map there is "not covered", never "no permits".

import type { FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { proxy } from "./aircraft";
import { civicLoadedBox, gridBox } from "./civicBox";
import { permitCitiesInBox, permitGapsInBox, PERMIT_CITY_IDS, PERMIT_CITIES, type PermitRecord } from "@/lib/permits/features";
import { permitFeature } from "@/lib/permits/dossier";
import type { RecordFeature } from "@/lib/permits/geojson";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";
import type { Bbox } from "@/lib/zoning/features";

export const PERMITS_MAX_M = 6_000;
export const PERMIT_DAYS = 30;
const HALF_LAT = 0.0075;
const KEY_GRID = 0.005;

export function permitsBox(v: Pick<ViewState, "lon" | "lat">): Bbox {
  return gridBox(v.lon, v.lat, HALF_LAT, KEY_GRID, 0.0025);
}

const covered = PERMIT_CITY_IDS.map((id) => PERMIT_CITIES[id].name).join(", ");

async function fetchPermits(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > PERMITS_MAX_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "city permit portals",
      fetchedAt: ctx.now,
      note: `descend below ${PERMITS_MAX_M / 1000} km for building permits issued in the last ${PERMIT_DAYS} days · ${covered}`,
      meta: { count: 0 },
    };
  }
  const want = permitsBox(ctx.view);
  if (!permitCitiesInBox(want).length) {
    const gaps = permitGapsInBox(want);
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "city permit portals",
      fetchedAt: ctx.now,
      note: gaps.length
        ? `${gaps.map((g) => `${g.name}: ${g.reason}`).join(" · ")} · covered: ${covered}`
        : `no building permit feed wired here · covered: ${covered}`,
      meta: { count: 0 },
    };
  }
  const env = await proxy<{ features: Array<RecordFeature<PermitRecord>> }>(
    `/api/permits?op=building&days=${PERMIT_DAYS}&bbox=${want.join(",")}`,
    ctx,
  );
  const meta = env as unknown as { bbox?: Bbox; coverage?: CoverageLike[] };
  const loaded: Bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : want;
  const features = env.data.features.map(permitFeature);
  return {
    collection: { type: "FeatureCollection", features: [...features, civicLoadedBox("permits", loaded, "building permits")] },
    source: "city permit portals",
    fetchedAt: ctx.now,
    note: coverageNote(`${features.length.toLocaleString("en-US")} permits issued in the last ${PERMIT_DAYS} days in the dashed box (outside it: not loaded)`, meta.coverage ?? []),
    meta: { count: features.length },
  };
}

export const permitsLayer: LayerDefinition = {
  id: "permits",
  label: "Building permits",
  description:
    "Building permits issued in the last 30 days as seven city portals publish them (Chicago, Austin, Seattle, Denver residential, New York DOB NOW, Los Angeles, San Francisco), below 6 km inside a dashed box: number, type, work, valuation, dates, status, site, parcel key, contractor company and the city's record. Dallas, Houston and San Antonio are named with the reason they are missing.",
  color: "#FDBA74",
  updateIntervalMs: 30 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: (v) => (v.height > PERMITS_MAX_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`),
  attribution: "City of Chicago, City of Austin, City of Seattle, City and County of Denver, NYC DOB, City of Los Angeles, San Francisco DBI (PDDL)",
  fetch: fetchPermits,
};
