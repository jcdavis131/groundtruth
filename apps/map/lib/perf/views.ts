// The three fixed ?perf=1 views and their scripted 10-second camera paths
// (MEASURE-FIRST: a dense-point city, a polygon state, an animated layer).
// Pure: keyframes and interpolation only; the overlay drives the camera.
//
// Keyframes are camera targets (the reticle), like a share link's lat/lon.
// Paths hold still for over a second between legs on purpose: LayerHost only
// refetches view-dependent layers once the camera has been still for 700 ms,
// so a path that never stops would measure no layer fetches at all.

import type { LayerId } from "@/lib/layers/types";
import type { PerfView } from "./flag";

export const RUN_MS = 10_000;

export interface PathKey {
  /** Seconds from the start of the run. */
  at: number;
  lon: number;
  lat: number;
  /** Camera height, metres. */
  h: number;
  /** Heading and pitch, degrees. */
  hd: number;
  p: number;
}

export interface PerfPreset {
  label: string;
  layers: LayerId[];
  path: PathKey[];
  /** Move the time scrubber from its first year to its last over the run. */
  scrub?: boolean;
  /** What the view can and cannot show, said in the results. */
  note?: string;
}

const AUSTIN = { lon: -97.7431, lat: 30.2672 };

export const PERF_PRESETS: Record<PerfView, PerfPreset> = {
  austin: {
    label: "Austin, dense points",
    layers: ["schools", "dams", "hospitals"],
    // Stays under 25 km, where public schools are drawn.
    path: [
      { at: 0, ...AUSTIN, h: 18_000, hd: 0, p: -55 },
      { at: 1.5, ...AUSTIN, h: 18_000, hd: 0, p: -55 },
      { at: 4, lon: -97.7, lat: 30.3, h: 9_000, hd: 60, p: -50 },
      { at: 5.5, lon: -97.7, lat: 30.3, h: 9_000, hd: 60, p: -50 },
      { at: 8, lon: -97.78, lat: 30.24, h: 15_000, hd: 140, p: -45 },
      { at: 10, lon: -97.78, lat: 30.24, h: 15_000, hd: 140, p: -45 },
    ],
  },
  texas: {
    label: "Texas, PAD-US and flood zones",
    layers: ["publiclands", "flood"],
    // Statewide, then down to central Texas (PAD-US draws below 250 km), then
    // into Houston (FEMA flood zones draw below 5 km).
    path: [
      { at: 0, lon: -99.3, lat: 31.3, h: 1_300_000, hd: 0, p: -90 },
      { at: 1.5, lon: -99.3, lat: 31.3, h: 1_300_000, hd: 0, p: -90 },
      { at: 4, lon: -97.9, lat: 30.4, h: 200_000, hd: 0, p: -60 },
      { at: 5.5, lon: -97.9, lat: 30.4, h: 200_000, hd: 0, p: -60 },
      { at: 8, lon: -95.37, lat: 29.76, h: 4_500, hd: 20, p: -50 },
      { at: 10, lon: -95.37, lat: 29.76, h: 4_500, hd: 20, p: -50 },
    ],
    note: "PAD-US is drawn only below 250 km and flood zones only below 5 km, so the statewide leg shows neither; the path descends to reach both.",
  },
  flows: {
    label: "Wind and currents, time scrubber moving",
    layers: ["windflow", "oceanflow"],
    path: [
      { at: 0, lon: -100, lat: 20, h: 14_000_000, hd: 0, p: -90 },
      { at: 10, lon: -10, lat: 20, h: 14_000_000, hd: 0, p: -90 },
    ],
    scrub: true,
  },
};

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Shortest signed turn from a to b, degrees. */
function turn(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Where the camera target is `t` seconds into the path (clamped to its ends). */
export function cameraAt(path: readonly PathKey[], t: number): Omit<PathKey, "at"> {
  if (path.length === 0) throw new Error("empty path");
  const first = path[0];
  const last = path[path.length - 1];
  const strip = ({ lon, lat, h, hd, p }: PathKey) => ({ lon, lat, h, hd, p });
  if (t <= first.at) return strip(first);
  if (t >= last.at) return strip(last);
  let i = 0;
  while (i < path.length - 2 && path[i + 1].at <= t) i++;
  const a = path[i];
  const b = path[i + 1];
  const span = b.at - a.at;
  const u = span > 0 ? smooth((t - a.at) / span) : 1;
  return {
    lon: a.lon + (b.lon - a.lon) * u,
    lat: a.lat + (b.lat - a.lat) * u,
    // Height moves on a log scale, so a descent from orbit does not rush the last kilometres.
    h: Math.exp(Math.log(a.h) + (Math.log(b.h) - Math.log(a.h)) * u),
    hd: (((a.hd + turn(a.hd, b.hd) * u) % 360) + 360) % 360,
    p: a.p + (b.p - a.p) * u,
  };
}
