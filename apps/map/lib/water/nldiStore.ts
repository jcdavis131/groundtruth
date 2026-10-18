"use client";
// The NLDI traces the HUD is showing, from one NHDPlus V2 reach: the main stem
// downstream, the drainage basin and the USGS gauges upstream, each asked of
// /api/water?op=trace when its button is pressed (the hydro ground dossier and
// every USGS gauge of the Surface water layer offer them) and drawn by
// components/globe/NldiOverlay.tsx. A gauge the Surface water layer is already
// drawing is drawn once, by that layer (matched on the USGS site number).

import { create } from "zustand";
import { newGauges, type TraceMode, type UpstreamGauge } from "./nldi";

export interface TracePart<T> {
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  error: string | null;
  /** The distance NLDI was asked for, km (down and gauges). */
  distanceKm: number | null;
}

export interface NldiState {
  /** The reach the traces start from, and what the dossier called it. */
  origin: { comid: number; label: string } | null;
  down: TracePart<GeoJSON.MultiLineString>;
  basin: TracePart<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  gauges: TracePart<UpstreamGauge[]>;
  run: (comid: number, label: string, mode: TraceMode) => Promise<void>;
  clear: () => void;
}

const idle = <T,>(): TracePart<T> => ({ status: "idle", data: null, error: null, distanceKm: null });

interface TraceBody {
  data?: { features?: Array<{ geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }> };
  meta?: { distanceKm?: number | null };
  error?: string;
}

/** The data a trace answer holds, typed by mode; pure, tested. */
export function traceData(mode: TraceMode, body: TraceBody): TracePart<unknown>["data"] {
  const feats = body.data?.features ?? [];
  if (mode === "gauges") {
    return feats
      .filter((f) => f.geometry?.type === "Point")
      .map((f) => {
        const p = f.properties ?? {};
        const c = (f.geometry as GeoJSON.Point).coordinates;
        return { identifier: String(p.identifier), siteNo: String(p.siteNo), name: typeof p.name === "string" ? p.name : null, lon: c[0], lat: c[1], comid: typeof p.comid === "number" ? p.comid : null, uri: typeof p.uri === "string" ? p.uri : null } satisfies UpstreamGauge;
      });
  }
  const g = feats[0]?.geometry ?? null;
  if (mode === "down") return g?.type === "MultiLineString" ? g : null;
  return g && (g.type === "Polygon" || g.type === "MultiPolygon") ? g : null;
}

let seq = 0;

export const useNldi = create<NldiState>()((set, get) => ({
  origin: null,
  down: idle(),
  basin: idle(),
  gauges: idle(),
  run: async (comid, label, mode) => {
    // A new reach clears the traces of the last one.
    if (get().origin?.comid !== comid) {
      seq++;
      set({ origin: { comid, label }, down: idle(), basin: idle(), gauges: idle() });
    }
    const my = seq;
    set({ [mode]: { status: "loading", data: null, error: null, distanceKm: null } } as Partial<NldiState>);
    try {
      const res = await fetch(`/api/water?op=trace&comid=${comid}&mode=${mode}`);
      const body = (await res.json().catch(() => ({}))) as TraceBody;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (my !== seq) return;
      set({ [mode]: { status: "ready", data: traceData(mode, body), error: null, distanceKm: body.meta?.distanceKm ?? null } } as Partial<NldiState>);
    } catch (err) {
      if (my !== seq) return;
      set({ [mode]: { status: "error", data: null, error: err instanceof Error ? err.message : String(err), distanceKm: null } } as Partial<NldiState>);
    }
  },
  clear: () => {
    seq++;
    set({ origin: null, down: idle(), basin: idle(), gauges: idle() });
  },
}));

/** The upstream gauges to draw: those the water layer is not drawing itself (`drawnIds` are its feature ids). */
export function gaugesToDraw(gauges: UpstreamGauge[] | null, drawnIds: Iterable<string>): UpstreamGauge[] {
  return gauges ? newGauges(gauges, drawnIds) : [];
}
