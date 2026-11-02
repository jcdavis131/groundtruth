// Layers: windflow + oceanflow. Animated particle-flow overlays on the globe,
// drawn by FlowRenderer (lib/globe/flowRenderer.ts) instead of the GeoJSON
// LayerRenderer: the fetch() loads a coarse vector grid bundled by
// `npm run data:flows` (scripts/flows-data.mjs), and the grid rides to the
// renderer in FetchResult.meta. Real data only — a missing or stale bundle
// fails honest (see the note), never synthetic.
//
//   windflow:   10 m wind, GFS via Open-Meteo, 5° grid, colour = speed
//   oceanflow:  surface currents + SST, Open-Meteo Marine, 4° grid,
//               colour = sea-surface temperature, brightness = speed
//               (the mapped.earth reel look)

import type * as CesiumNS from "cesium";
import type { FetchResult, LayerDefinition } from "./types";
import { emptyCollection } from "./types";
import { FlowRenderer, type FlowColorMode } from "@/lib/globe/flowRenderer";
import type { FlowGrid } from "@/lib/globe/flowField";
import windBundle from "@/lib/flows/data/wind.json";
import currentsBundle from "@/lib/flows/data/currents.json";

// Each bundle refreshes once a day: the cron runs scripts/flows-data.mjs every
// 12 h with --layer auto, one layer per run, to stay inside Open-Meteo's free
// limits (each location is one call; 10,000 a day). Stale past 28 h = the 24 h
// cadence + 4 h of grace. In normal operation a bundle is at most about 24 h
// 40 min old when its replacement deploys (its as-of is the 15-minute slot the
// fetch starts in, and the paced fetch, data PR and deploy take about 25 min),
// so 28 h leaves over 3 h for a slow run without a false flag. A missed daily
// refresh crosses 28 h about 4 h after it was due and stays flagged until the
// retry, 12 h after the miss, deploys (age about 36 h 40 min).
export const STALE_MS = 28 * 3_600_000;

export function bundleAgeNote(bundle: FlowGrid, now = Date.now()): { note: string; stale: boolean } {
  const asof = Date.parse(bundle.asof);
  const stale = !Number.isFinite(asof) || now - asof > STALE_MS;
  const when = Number.isFinite(asof) ? new Date(asof).toUTCString().slice(5, 22) : "unknown time";
  return {
    note: `${stale ? "STALE — " : ""}as of ${when} UTC · refreshes daily`,
    stale,
  };
}

// How often an open tab re-reads the bundled grid. The data changes once a day;
// re-reading every 6 h keeps the as-of note and the stale flag current in a
// tab left open, and costs no network request (the bundle is built in).
const REREAD_MS = 21_600_000;

function flowFetch(bundle: FlowGrid, source: string) {
  return async (): Promise<FetchResult> => {
    if (!bundle || !Array.isArray(bundle.u) || bundle.u.length === 0) {
      throw new Error("flow data bundle missing — run npm run data:flows");
    }
    const { note } = bundleAgeNote(bundle);
    const live = bundle.u.filter((x) => x != null).length;
    return {
      collection: emptyCollection(),
      source,
      fetchedAt: Date.now(),
      note: `${live.toLocaleString()} vectors · ${note}`,
      meta: { grid: bundle, count: live },
    };
  };
}

function makeFlowLayer(
  id: "windflow" | "oceanflow",
  colorMode: FlowColorMode,
  def: Omit<LayerDefinition, "id" | "fetch" | "createRenderer"> & { source: string },
  bundle: FlowGrid,
): LayerDefinition {
  return {
    ...def,
    id,
    fetch: flowFetch(bundle, def.source),
    createRenderer: (viewer: CesiumNS.Viewer) => new FlowRenderer(viewer, id, colorMode),
  };
}

export const windFlowLayer = makeFlowLayer(
  "windflow",
  "wind",
  {
    label: "Wind flow",
    description:
      "Animated wind particles over the whole globe, coloured by speed. 10 m wind from GFS, refreshed daily.",
    color: "#38BDF8",
    updateIntervalMs: REREAD_MS,
    defaultEnabled: false,
    attribution: "Open-Meteo (GFS)",
    source: "Open-Meteo (GFS 10 m wind)",
  },
  windBundle as FlowGrid,
);

export const oceanFlowLayer = makeFlowLayer(
  "oceanflow",
  "current",
  {
    label: "Ocean currents",
    description:
      "Animated surface-current particles, coloured by water temperature with brightness by speed — the tidal-reel look, worldwide.",
    color: "#2DD4BF",
    updateIntervalMs: REREAD_MS,
    defaultEnabled: false,
    attribution: "Open-Meteo Marine",
    source: "Open-Meteo Marine (currents + SST)",
  },
  currentsBundle as FlowGrid,
);
