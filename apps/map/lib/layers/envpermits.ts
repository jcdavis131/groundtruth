// Layer: environmental permits. EPA ECHO's Clean Water Act (NPDES) and Clean
// Air Act facilities and the U.S. Army Corps of Engineers' regulatory actions
// (Section 10/404 permits, nationwide permit verifications, Section 408
// permissions, jurisdictional determinations), as points below ENV_MAX_M,
// inside a dashed box of about 11 km. Anywhere in the United States.
//
// A feature is named by its permit or action number; the facility or project
// name is in the dossier only. ECHO's compliance words are shown as they
// are, and a facility ECHO gives none for says "not reported by ECHO".

import type { FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { proxy } from "./aircraft";
import { civicLoadedBox, gridBox } from "./civicBox";
import type { EnvRecord } from "@/lib/permits/environmental";
import { envFeature } from "@/lib/permits/dossier";
import type { RecordFeature } from "@/lib/permits/geojson";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";
import type { Bbox } from "@/lib/zoning/features";

export const ENV_MAX_M = 25_000;
/** ~5.5 km each way: a 0.2 degree box held 1,666 NPDES facilities around the Houston Ship Channel (1.3 MB). */
const HALF_LAT = 0.05;
const KEY_GRID = 0.05;

export function envBox(v: Pick<ViewState, "lon" | "lat">): Bbox {
  return gridBox(v.lon, v.lat, HALF_LAT, KEY_GRID, 0.05);
}

/** Rough United States boxes (conterminous, Alaska, Hawaii, Puerto Rico): ECHO and ORM cover US facilities only. */
const US: Bbox[] = [
  [-125, 24, -66.5, 49.5],
  [-170, 51, -129, 71.5],
  [-161, 18.5, -154.5, 22.5],
  [-67.5, 17.5, -65, 18.6],
];

export function inUs(b: Bbox): boolean {
  return US.some((u) => b[0] < u[2] && b[2] > u[0] && b[1] < u[3] && b[3] > u[1]);
}

async function fetchEnv(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > ENV_MAX_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "EPA ECHO, USACE ORM",
      fetchedAt: ctx.now,
      note: `descend below ${ENV_MAX_M / 1000} km for Clean Water Act and Clean Air Act facilities and Corps of Engineers actions (United States)`,
      meta: { count: 0 },
    };
  }
  const want = envBox(ctx.view);
  if (!inUs(want)) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "EPA ECHO, USACE ORM",
      fetchedAt: ctx.now,
      note: "EPA ECHO and the Corps cover the United States only",
      meta: { count: 0 },
    };
  }
  const env = await proxy<{ features: Array<RecordFeature<EnvRecord>> }>(`/api/permits?op=environmental&bbox=${want.join(",")}`, ctx);
  const meta = env as unknown as { bbox?: Bbox; coverage?: CoverageLike[] };
  const loaded: Bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : want;
  const features = env.data.features.map(envFeature);
  return {
    collection: { type: "FeatureCollection", features: [...features, civicLoadedBox("envpermits", loaded, "environmental permits")] },
    source: "EPA ECHO, USACE ORM",
    fetchedAt: ctx.now,
    note: coverageNote(`${features.length.toLocaleString("en-US")} facilities and actions in the dashed box (outside it: not loaded)`, meta.coverage ?? []),
    meta: { count: features.length },
  };
}

export const envpermitsLayer: LayerDefinition = {
  id: "envpermits",
  label: "Environmental permits",
  description:
    "EPA ECHO Clean Water Act (NPDES) and Clean Air Act facilities with their permit status and ECHO's compliance words, and U.S. Army Corps of Engineers regulatory actions (Section 10/404 permits, nationwide permit verifications, Section 408 permissions, jurisdictional determinations), below 25 km inside a dashed box. United States.",
  color: "#86EFAC",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: (v) => (v.height > ENV_MAX_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`),
  attribution: "U.S. EPA ECHO (public domain), U.S. Army Corps of Engineers ORM (public domain)",
  fetch: fetchEnv,
};
