"use client";
// The Area panel's state: whether it is open, whether the watch is running,
// and the watch's baseline and log. The area itself is the Measure tool's
// drawn polygon (useGlobe().measure.shape), so it travels in share links as
// `shape=a:…`; `aoi=1` reopens this panel on arrival.

import { create } from "zustand";
import type { LayerId } from "@/lib/layers/types";
import type { LayerStatus } from "@/lib/store/globe";
import { newWatch, WATCH_LAYERS, type WatchMode, type WatchState } from "./area";
import { coverageKey, coversRing, WATCH_COVERAGE } from "./coverage";
import type { Ring } from "./geometry";

interface AreaStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: "inside" | "watch" | "report";
  setTab: (tab: AreaStore["tab"]) => void;
  watching: boolean;
  /** When the watch started; the log counts from here. */
  watchSince: number | null;
  watch: WatchState;
  /** The area the watch's baseline and log belong to (ringKey); null until its first step. */
  watchRing: string | null;
  /** Bumped on every watch step so the panel re-renders the log. */
  tick: number;
  startWatch: () => void;
  /** Start over for another area: a new baseline and an empty log, still watching. */
  restartWatch: (ring: string) => void;
  stopWatch: () => void;
  bump: () => void;
}

export const useArea = create<AreaStore>()((set) => ({
  open: false,
  setOpen: (open) => set(open ? { open } : { open, watching: false }),
  tab: "inside",
  setTab: (tab) => set({ tab }),
  watching: false,
  watchSince: null,
  watch: newWatch(),
  watchRing: null,
  tick: 0,
  startWatch: () => set({ watching: true, watchSince: Date.now(), watch: newWatch(), watchRing: null, tick: 0 }),
  restartWatch: (ring) => set({ watchSince: Date.now(), watch: newWatch(), watchRing: ring, tick: 0 }),
  stopWatch: () => set({ watching: false }),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));

/** The drawn area as a ring, when the shape is an area of at least three corners. */
export function areaRing(shape: { kind: "line" | "area"; points: Array<[number, number]> } | null | undefined): Ring | null {
  if (!shape || shape.kind !== "area" || shape.points.length < 3) return null;
  return shape.points.map(([lon, lat]) => [lon, lat] as [number, number]);
}

/** A drawn area by value, so a redrawn area is told apart from a re-render of the same one. */
export function ringKey(ring: Ring): string {
  return ring.map(([x, y]) => `${x},${y}`).join(";");
}

/** What the watch needs to know about a layer's definition. */
export interface WatchLayerInfo {
  viewDependent?: boolean;
  /** Layers this one hands some of its events to while they are on (hazards: earthquakes, alerts). */
  dependsOn?: LayerId[];
}

/**
 * What the watch does with each watched layer this step (see WatchMode in ./area.ts):
 *   drop  off, failed or never answered; or it hands events to another layer that is on
 *         (Hazard alerts steps aside for Earthquakes and Live warnings), so its features
 *         would vanish without leaving: it is left out of the watch while they are on
 *   hold  refetching; or view-dependent while the area is out of view (stale: its
 *         baseline is retaken silently when the area is back and the layer has settled);
 *         or (stale) its answer is still filling in (LayerStatus.settling: AISStream's
 *         first minutes); or (stale) a layer with a partial coverage (./coverage.ts:
 *         Aircraft) whose answer did not reach the whole area, since an airframe crossing
 *         the rim of what was asked is not one crossing the area's edge
 *   step  settled, keyed by the view its answer was fetched for (LayerStatus.viewKey), or
 *         for a layer with a partial coverage by what the answer covered (the snapped
 *         circle, the box, the world), and by the sources that answered (LayerStatus.source).
 *         So an answer for another view or coverage, or one from other sources (Aircraft's
 *         OpenSky falling back to adsb.lol, Ships without Digitraffic or without a live
 *         AISStream), sets a new baseline instead of being compared
 * Known gap: in the frame between a partner switching off and Hazard alerts re-running its
 * refine, a step could baseline without the events it takes back; they would then read as
 * arrivals. The window is one render, against a 5 s step.
 */
export function watchModes(
  on: Partial<Record<LayerId, boolean>>,
  status: Partial<Record<LayerId, LayerStatus>>,
  inView: boolean,
  info: (id: LayerId) => WatchLayerInfo | undefined,
  ring: Ring,
): Map<LayerId, WatchMode> {
  const out = new Map<LayerId, WatchMode>();
  for (const id of WATCH_LAYERS) {
    const st = status[id];
    const def = info(id);
    const coverage = WATCH_COVERAGE[id]?.(st?.source ?? "", st?.fetchView);
    if (!on[id] || !st || st.error || !(st.fetchedAt > 0)) out.set(id, { mode: "drop" });
    else if (def?.dependsOn?.some((d) => on[d])) out.set(id, { mode: "drop" });
    else if (def?.viewDependent && !inView) out.set(id, { mode: "hold", stale: true });
    else if (st.loading) out.set(id, { mode: "hold" });
    else if (st.settling) out.set(id, { mode: "hold", stale: true, reason: "settling" });
    else if (coverage && !coversRing(coverage, ring)) out.set(id, { mode: "hold", stale: true, reason: "coverage" });
    else out.set(id, { mode: "step", key: `${coverage ? coverageKey(coverage) : (st.viewKey ?? "static")}|${st.source}` });
  }
  return out;
}

/** Layers that are on and have an answer on the globe: a finished fetch that did not fail. */
export function answeringLayers(on: Partial<Record<LayerId, boolean>>, status: Partial<Record<LayerId, LayerStatus>>): Set<LayerId> {
  const out = new Set<LayerId>();
  for (const [id, isOn] of Object.entries(on) as Array<[LayerId, boolean]>) {
    const st = status[id];
    if (isOn && st && !st.error && st.fetchedAt > 0) out.add(id);
  }
  return out;
}

/**
 * Whether the drawn area is in the camera's view, so view-dependent layers are
 * loading it: the area's centre within reach of the camera target (half the camera
 * height, at least 30 km), or inside the visible box when the camera reports one.
 */
export function areaInView(ring: Ring, view: { lon: number; lat: number; height: number; bbox?: [number, number, number, number] }): boolean {
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  lon /= ring.length;
  lat /= ring.length;
  if (view.bbox) {
    const [w, s, e, n] = view.bbox;
    if (lon >= w && lon <= e && lat >= s && lat <= n) return true;
  }
  const dLat = (lat - view.lat) * 111_195;
  const dLon = (lon - view.lon) * 111_195 * Math.cos((view.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) <= Math.max(30_000, view.height * 0.5);
}
