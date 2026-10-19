"use client";
// ?perf=1&view=<name> deep links. The view is spelled out into the link's
// ordinary state (camera and layers), so the link that opens a test is also a
// plain share link of where the test starts.

import { shareQuery, type ShareState } from "@/lib/globe/share";
import { perfMode, type PerfView } from "./flag";
import { PERF_PRESETS } from "./views";

/** The share state a test view starts from: its first keyframe, its layers, perf on. */
export function perfViewShare(view: PerfView): ShareState {
  const preset = PERF_PRESETS[view];
  const k = preset.path[0];
  return { lat: k.lat, lon: k.lon, h: k.h, hd: k.hd, p: k.p, layers: preset.layers, perf: true, perfView: view };
}

/** "?lat=…&layers=…&perf=1&view=austin" for a test view. */
export function perfViewQuery(view: PerfView): string {
  return shareQuery(perfViewShare(view));
}

/**
 * On load: a ?perf=1&view=<name> link that names no camera or layers of its own
 * is rewritten (replaceState) into the view's start, before the cockpit reads the
 * link. A link that carries its own camera or layers is left as it is.
 */
export function expandPerfLink(): void {
  const mode = perfMode();
  if (!mode.on || !mode.view) return;
  const q = new URLSearchParams(window.location.search);
  if (q.has("lat") || q.has("layers")) return;
  try {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${perfViewQuery(mode.view)}`);
  } catch {
    /* some embedders forbid it */
  }
}
