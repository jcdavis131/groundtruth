// A drawn area of interest: what the loaded layers hold inside it, a watch
// that reports what arrives in it and what leaves, and the files to take it
// away. The area is the Measure tool's drawn polygon; nothing here fetches:
// it works on what the globe already holds (lib/globe/registry.ts), so the
// answer is only as complete as the layers that are on and what they loaded.
// Pure, tested.

import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { featureInside, featurePoint, ringBox, type Ring } from "./geometry";

/** Layers whose features are never "in" an area: map furniture, propagated orbits, simulations. */
export const NOT_IN_AREAS: ReadonlySet<LayerId> = new Set<LayerId>(["satellites", "traffic", "field", "constructs"]);

export function countable(f: LayerFeature): boolean {
  const p = f.properties;
  if (p.kind === "loaded-box" || p.kind === "ground") return false;
  if (p.simulated) return false;
  return !NOT_IN_AREAS.has(p.layer);
}

export interface InsideGroup {
  layer: LayerId;
  features: LayerFeature[];
}

/** Loaded features any part of which is inside the area, grouped by layer in the order given. */
export function featuresInside(features: Iterable<LayerFeature>, ring: Ring): InsideGroup[] {
  if (ring.length < 3) return [];
  const box = ringBox(ring);
  const by = new Map<LayerId, LayerFeature[]>();
  for (const f of features) {
    if (!countable(f)) continue;
    if (!featureInside(f, ring, box)) continue;
    const l = f.properties.layer;
    let arr = by.get(l);
    if (!arr) by.set(l, (arr = []));
    arr.push(f);
  }
  return [...by.entries()].map(([layer, fs]) => ({ layer, features: fs }));
}

// ---------------------------------------------------------------- watch

/**
 * Layers whose features come and go: the watch reports these. That includes the moving
 * contacts, aircraft and ships, by their stable id (ICAO hex, MMSI) and as each feed
 * reports them: the operator's decision (Cam, 2026-09-26). No LADD/PIA filter is added;
 * none was chosen.
 */
export const WATCH_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(["aircraft", "ships", "earthquakes", "fires", "wildfire", "hazards", "alerts", "events"]);

export interface WatchEvent {
  at: number;
  kind: "arrived" | "left";
  layer: LayerId;
  id: string;
  name: string;
}

export interface WatchState {
  /** key "<layer>:<id>" -> what was inside at the last step. */
  inside: Map<string, { layer: LayerId; id: string; name: string }>;
  /**
   * Layers whose baseline has been taken, with the step key (view and sources) of the
   * answer it was taken from. A layer's first answer, and its first answer for another
   * view or from other sources, set a new baseline silently: only two answers for the
   * same view from the same sources are compared.
   */
  seen: Map<LayerId, string>;
  /** Newest first, at most WATCH_LOG_MAX events. */
  log: WatchEvent[];
  /** Older events the log no longer holds, and when the newest of them happened. */
  dropped: number;
  droppedThrough: number | null;
}

export function newWatch(): WatchState {
  return { inside: new Map(), seen: new Map(), log: [], dropped: 0, droppedThrough: null };
}

/**
 * What one watch step does with a watched layer:
 *   step  its answer is settled: compare it with the baseline taken for the same key (the
 *         view the answer was fetched for and the sources that answered)
 *   hold  it is refetching, or its answer does not describe the area right now: skip it and
 *         keep its baseline; `stale` also forgets the baseline (the area left the view of a
 *         view-dependent layer, its answer did not cover the whole area, or it is still
 *         filling in), so it is retaken silently once the layer settles again. `reason`
 *         says why, when the panel has something to tell: "coverage" (the answer did not
 *         reach the whole area) or "settling" (a stream still filling in)
 *   drop  it is off, failed, or left out: forget it, so its return is a silent baseline
 * A layer with no mode is dropped.
 */
export type WatchMode = { mode: "step"; key: string } | { mode: "hold"; stale?: boolean; reason?: "coverage" | "settling" } | { mode: "drop" };

/** Most events kept in the log (and so in its CSV); older ones are counted in WatchState.dropped. */
export const WATCH_LOG_MAX = 500;

/**
 * One watch step. `features` are the loaded features now; `modes` says what to do with
 * each watched layer (see WatchMode, and watchModes in ./store.ts). Only a layer that
 * steps, on the same key as its baseline, reports arrivals and departures. A held
 * layer (refetching, or its answer kept on screen while another view loads) keeps what
 * was inside; a dropped layer (off, failed) is forgotten, so neither a layer switching
 * off nor its return reads as everything leaving or arriving.
 */
export function watchStep(state: WatchState, features: Iterable<LayerFeature>, ring: Ring, modes: ReadonlyMap<LayerId, WatchMode>, now: number): WatchEvent[] {
  const box = ringBox(ring);
  const current = new Map<string, { layer: LayerId; id: string; name: string }>();
  for (const f of features) {
    const l = f.properties.layer;
    if (!WATCH_LAYERS.has(l) || modes.get(l)?.mode !== "step" || !countable(f)) continue;
    if (!featureInside(f, ring, box)) continue;
    current.set(`${l}:${f.properties.id}`, { layer: l, id: f.properties.id, name: f.properties.name });
  }
  // A layer compares only against a baseline taken from an answer for the same view, from the same sources.
  const compares = (l: LayerId) => {
    const m = modes.get(l);
    return m?.mode === "step" && state.seen.get(l) === m.key;
  };
  const events: WatchEvent[] = [];
  for (const [key, v] of current) if (!state.inside.has(key) && compares(v.layer)) events.push({ at: now, kind: "arrived", ...v });
  for (const [key, v] of state.inside) if (!current.has(key) && compares(v.layer)) events.push({ at: now, kind: "left", ...v });
  // A held layer keeps what was inside; a stale hold and a drop forget it.
  const next = new Map(current);
  for (const [key, v] of state.inside) {
    const m = modes.get(v.layer);
    if (m?.mode === "hold" && !m.stale) next.set(key, v);
  }
  for (const l of WATCH_LAYERS) {
    const m = modes.get(l);
    if (m?.mode === "step") state.seen.set(l, m.key);
    else if (!m || m.mode === "drop" || m.stale) state.seen.delete(l);
  }
  state.inside = next;
  const log = [...events, ...state.log];
  for (const e of log.slice(WATCH_LOG_MAX)) {
    state.dropped += 1;
    if (state.droppedThrough == null || e.at > state.droppedThrough) state.droppedThrough = e.at;
  }
  state.log = log.slice(0, WATCH_LOG_MAX);
  return events;
}

// ---------------------------------------------------------------- take it away

type Scalar = string | number | boolean | null;

function flatDetails(f: LayerFeature): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(f.properties.details ?? {})) if (v != null && v !== "") out[k] = v as Scalar;
  return out;
}

/** The area and everything inside it as GeoJSON, each feature with its layer, source and dossier fields. */
export function insideGeoJson(ring: Ring, groups: InsideGroup[], generatedAt = new Date().toISOString()) {
  const closed = ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ? [...ring, ring[0]] : ring;
  return {
    type: "FeatureCollection" as const,
    generated: generatedAt,
    note: "Features the globe had loaded that touch the drawn area, as each layer's source published them; only as complete as the layers that were on.",
    features: [
      { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [closed] }, properties: { role: "drawn area" } },
      ...groups.flatMap((g) =>
        g.features.map((f) => ({
          type: "Feature" as const,
          geometry: f.geometry,
          properties: {
            layer: f.properties.layer,
            id: f.properties.id,
            name: f.properties.name,
            kind: f.properties.kind ?? null,
            source: f.properties.source,
            observed_at: f.properties.observedAt != null ? new Date(f.properties.observedAt).toISOString() : null,
            ...flatDetails(f),
          },
        })),
      ),
    ],
  };
}

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const INSIDE_COLUMNS = ["layer", "id", "name", "kind", "lon", "lat", "source", "observed_at", "details"] as const;

/** One row per feature inside; `lon`/`lat` are a point's position or a line or polygon's anchor. */
export function insideCsv(groups: InsideGroup[]): string {
  const rows = [INSIDE_COLUMNS.join(",")];
  for (const g of groups) {
    for (const f of g.features) {
      const pt = featurePoint(f);
      const details = Object.entries(flatDetails(f))
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      rows.push(
        [g.layer, f.properties.id, f.properties.name, f.properties.kind ?? "", pt?.[0] ?? "", pt?.[1] ?? "", f.properties.source, f.properties.observedAt != null ? new Date(f.properties.observedAt).toISOString() : "", details]
          .map(cell)
          .join(","),
      );
    }
  }
  return rows.join("\r\n") + "\r\n";
}

/**
 * The watch log as CSV, newest first. When older events were dropped (WATCH_LOG_MAX), a last
 * row with event "dropped" says how many, timed at the newest of them.
 */
export function watchCsv(log: WatchEvent[], dropped?: { count: number; through: number | null }): string {
  const rows = ["time,event,layer,id,name"];
  for (const e of log) rows.push([new Date(e.at).toISOString(), e.kind, e.layer, e.id, e.name].map(cell).join(","));
  if (dropped && dropped.count > 0) {
    const note = `${dropped.count} earlier event${dropped.count === 1 ? "" : "s"} not kept: the log keeps the newest ${WATCH_LOG_MAX}`;
    rows.push([dropped.through != null ? new Date(dropped.through).toISOString() : "", "dropped", "", "", note].map(cell).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}
