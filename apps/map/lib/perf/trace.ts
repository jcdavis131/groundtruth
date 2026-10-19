// Per-layer timings for ?perf=1: when a layer's fetch started, when the
// response arrived, when its FetchResult was ready (parse done) and the first
// frame drawn after the renderer took it. LayerHost and proxy() call
// markLayer(); with the flag off tracing() is false and they skip it.

import { perfMode } from "./flag";

export type LayerPhase = "start" | "response" | "parsed" | "drawn";

export interface LayerTiming {
  layer: string;
  /** performance.now() when the latest fetch started. */
  start: number;
  /** ms after start. null: not seen (the layer does not fetch through proxy(), or has not answered yet). */
  response: number | null;
  parsed: number | null;
  drawn: number | null;
  /** Features the renderer was given for that frame. */
  features: number | null;
  /** How many fetches this layer has started since load. */
  fetches: number;
}

const timings = new Map<string, LayerTiming>();

export function tracing(): boolean {
  return perfMode().on;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Record a phase of the layer's latest fetch. A "start" begins a new one. */
export function markLayer(layer: string, phase: LayerPhase, features?: number, t: number = now()): void {
  if (phase === "start") {
    const prev = timings.get(layer);
    timings.set(layer, { layer, start: t, response: null, parsed: null, drawn: null, features: null, fetches: (prev?.fetches ?? 0) + 1 });
    return;
  }
  const cur = timings.get(layer);
  if (!cur) return;
  const ms = Math.round((t - cur.start) * 10) / 10;
  if (phase === "response") {
    if (cur.response == null) cur.response = ms;
  } else if (phase === "parsed") {
    cur.parsed = ms;
  } else if (cur.parsed != null && cur.drawn == null) {
    cur.drawn = ms;
    cur.features = features ?? null;
  }
}

/** A copy of every layer's latest timing, by start time. */
export function layerTimings(): LayerTiming[] {
  return [...timings.values()].map((x) => ({ ...x })).sort((a, b) => a.start - b.start);
}

export function clearLayerTimings(): void {
  timings.clear();
}
