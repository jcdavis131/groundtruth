"use client";
// The downstream trace the HUD is showing. It drives the resumable walk:
// the first leg starts at the point, each truncated leg is continued from its
// `next`, and the state grows as each leg lands, so the path visibly extends
// toward the sea. Outlines (and so centroids, the drawn path and the gauges
// joined along it) stream in behind the walk in batches.

import { create } from "zustand";
import { centroidPathKm, type DownstreamResult, type DownstreamStep } from "./downstream";

/** Most legs one trace will ask for before calling it a day (each is one time-boxed server call). */
const MAX_LEGS = 12;
const OUTLINE_BATCH = 100;

export interface TraceState {
  status: "idle" | "loading" | "ready" | "error";
  point: { lon: number; lat: number } | null;
  startName: string;
  steps: DownstreamStep[];
  /** "" while the walk is still going. */
  terminal: string;
  basins: string[];
  legs: number;
  /** Walk stopped at MAX_LEGS before a terminal. */
  gaveUp: boolean;
  outlines: Record<string, number[][][]>;
  centroids: Record<string, [number, number]>;
  /** Names and areas from the outline batches (the bundled drainage table carries codes only). */
  names: Record<string, string>;
  areas: Record<string, number>;
  outlinesPending: number;
  error: string | null;
  run: (lon: number, lat: number) => Promise<void>;
  clear: () => void;
}

async function getData<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!r.ok || !j.data) throw new Error(j.error ?? `${r.status} from ${url}`);
  return j.data;
}

const EMPTY = {
  status: "idle" as const,
  point: null,
  startName: "",
  steps: [],
  terminal: "",
  basins: [],
  legs: 0,
  gaveUp: false,
  outlines: {},
  centroids: {},
  names: {},
  areas: {},
  outlinesPending: 0,
  error: null,
};

let seq = 0;

/** Path length through the centroids that have arrived, in walk order. Not river length. */
export function tracePathKm(t: Pick<TraceState, "steps" | "centroids">): number {
  return centroidPathKm(t.steps.map((s) => t.centroids[s.huc12]));
}

export const useTrace = create<TraceState>()((set, get) => ({
  ...EMPTY,
  run: async (lon, lat) => {
    const my = ++seq;
    const alive = () => my === seq;
    set({ ...EMPTY, status: "loading", point: { lon, lat } });

    // Outlines trail the walk: every new batch of steps queues its codes.
    const queue: string[] = [];
    let pumping: Promise<void> | null = null;
    const pump = async () => {
      while (queue.length && alive()) {
        const batch = queue.splice(0, OUTLINE_BATCH);
        try {
          const d = await getData<{ outlines: Record<string, number[][][]>; centroids: Record<string, [number, number]>; names?: Record<string, string>; areas?: Record<string, number> }>(
            `/api/fabric?op=outlines&huc12=${batch.join(",")}`,
          );
          if (!alive()) return;
          set((s) => ({
            outlines: { ...s.outlines, ...d.outlines },
            centroids: { ...s.centroids, ...d.centroids },
            names: { ...s.names, ...(d.names ?? {}) },
            areas: { ...s.areas, ...(d.areas ?? {}) },
            outlinesPending: Math.max(0, s.outlinesPending - batch.length),
          }));
        } catch {
          if (alive()) set((s) => ({ outlinesPending: Math.max(0, s.outlinesPending - batch.length) }));
        }
      }
    };
    const enqueue = (steps: DownstreamStep[]) => {
      queue.push(...steps.map((s) => s.huc12));
      set((s) => ({ outlinesPending: s.outlinesPending + steps.length }));
      if (!pumping) pumping = pump().finally(() => (pumping = null));
    };

    try {
      let url = `/api/fabric?op=downstream&lon=${lon.toFixed(3)}&lat=${lat.toFixed(3)}`;
      let retries = 2;
      for (let leg = 1; leg <= MAX_LEGS; leg++) {
        let d: DownstreamResult;
        try {
          d = await getData<DownstreamResult>(url);
        } catch (err) {
          // A cold WBD basin can outlast one call; the retry usually finds it warm.
          if (retries-- > 0 && alive()) {
            leg--;
            continue;
          }
          throw err;
        }
        if (!alive()) return;
        set((s) => ({
          startName: s.startName || d.startName,
          steps: [...s.steps, ...d.steps.map((x) => ({ ...x, hop: s.steps.length + x.hop }))],
          basins: [...s.basins, ...d.basins.filter((b, i) => i > 0 || s.basins[s.basins.length - 1] !== b)],
          terminal: d.truncated ? "" : d.terminal,
          legs: leg,
        }));
        enqueue(d.steps);
        if (!d.truncated || !d.next) break;
        if (leg === MAX_LEGS) set({ gaveUp: true });
        url = `/api/fabric?op=downstream&from=${d.next}`;
      }
      if (alive()) set({ status: "ready" });
    } catch (err) {
      if (alive()) set({ status: get().steps.length ? "ready" : "error", error: err instanceof Error ? err.message : String(err) });
    }
    while (pumping) await pumping;
  },
  clear: () => {
    seq++;
    set({ ...EMPTY });
  },
}));
