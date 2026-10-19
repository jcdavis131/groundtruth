// What part of the world one answer of a moving layer reports, so the area watch
// compares two answers only where both of them saw the whole area. "The area is in
// view" is not enough: Aircraft asks adsb.lol for a circle around the camera target
// (at most 250 nm), and an area can be in view yet reach past that circle, so an
// airframe crossing the circle's rim would read as leaving the area, and a pan
// inside one view-key cell (a new circle, the same key) would read as arrivals.
// lib/layers/aircraft.ts is left as it is; this mirrors how it asks, from the
// sources that answered and the view the answer was fetched with. Pure, tested.

import { haversine, NM_M } from "@/lib/globe/geo";
import { GLOBAL_VIEW_HEIGHT_M } from "@/lib/layers/aircraft";
import { snapPointQuery } from "@/lib/layers/pointQuery";
import type { LayerId, ViewState } from "@/lib/layers/types";
import type { Ring } from "./geometry";

export type Coverage =
  | { kind: "world" }
  /** A [west, south, east, north] box, as OpenSky was asked for it. */
  | { kind: "box"; bbox: [number, number, number, number] }
  /** A point query's circle, as the route snapped it. */
  | { kind: "circle"; lat: number; lon: number; distNm: number }
  /** Nothing the answer can vouch for (only the military feed answered, or nothing did). */
  | { kind: "none" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * What an aircraft answer covers, from the sources that answered (FetchResult.source)
 * and the view it was fetched with (FetchResult.fetchView), as lib/layers/aircraft.ts asks:
 *   OpenSky        the visible box it was sent, or the world (no box, or zoomed out past
 *                  GLOBAL_VIEW_HEIGHT_M)
 *   adsb.lol with the military feed   OpenSky was refused: 250 nm around the view centre
 *   adsb.lol or ADS-B Exchange alone  the point query, min(250, max(40, 1.2 h / 1852)) nm
 *                  around the view centre. The refused-OpenSky fallback without the
 *                  military feed looks the same; its 250 nm is never smaller, so the
 *                  point query's radius is the one assumed.
 * Centre and radius are snapped as the route snaps them (lib/layers/pointQuery.ts).
 */
export function aircraftCoverage(source: string, view: ViewState | undefined): Coverage {
  if (!view) return { kind: "none" };
  const parts = source.split(" + ").map((p) => p.trim());
  if (parts.some((p) => p.startsWith("opensky"))) {
    if (view.bbox && !(view.height > GLOBAL_VIEW_HEIGHT_M)) {
      const [w, s, e, n] = view.bbox;
      // A box across the antimeridian is not one OpenSky query can answer as asked.
      return w <= e ? { kind: "box", bbox: [w, s, e, n] } : { kind: "none" };
    }
    return { kind: "world" };
  }
  if (parts.some((p) => p === "adsb.lol" || p === "adsbexchange")) {
    const asked = parts.includes("adsb.lol mil") ? 250 : Math.round(Math.min(250, Math.max(40, (view.height * 1.2) / NM_M)));
    const q = snapPointQuery(clamp(Number(view.lat.toFixed(3)), -90, 90), clamp(Number(view.lon.toFixed(3)), -180, 180), clamp(asked, 1, 250));
    return { kind: "circle", ...q };
  }
  return { kind: "none" };
}

/** Layers whose answers cover only part of the world, and how to tell which part. */
export const WATCH_COVERAGE: Partial<Record<LayerId, (source: string, view: ViewState | undefined) => Coverage>> = {
  aircraft: aircraftCoverage,
};

/** Share of a circle's radius trusted, for the upstream's own distance arithmetic at the rim. */
const RIM = 0.99;
/** Points checked along each edge of the area, besides its corners. */
const EDGE_STEPS = 16;

function coversPoint(c: Coverage, lon: number, lat: number): boolean {
  switch (c.kind) {
    case "world":
      return true;
    case "box":
      return lon >= c.bbox[0] && lon <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3];
    case "circle":
      return haversine(c.lat, c.lon, lat, lon) <= c.distNm * NM_M * RIM;
    default:
      return false;
  }
}

/**
 * Whether the answer saw the whole area: its outline (corners and points along each edge,
 * on [lon, lat] as the area is drawn) lies inside the coverage, and so does what it encloses.
 */
export function coversRing(c: Coverage, ring: Ring): boolean {
  if (c.kind === "world") return true;
  if (c.kind === "none" || ring.length < 3) return false;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    for (let k = 0; k < EDGE_STEPS; k++) {
      const t = k / EDGE_STEPS;
      if (!coversPoint(c, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
  }
  return true;
}

/** A step key part: two answers compare only when they covered the same part of the world. */
export function coverageKey(c: Coverage): string {
  switch (c.kind) {
    case "world":
      return "world";
    case "box":
      return `box:${c.bbox.join(",")}`;
    case "circle":
      return `circle:${c.lat},${c.lon},${c.distNm}`;
    default:
      return "none";
  }
}

/** For the panel: what the answer covered, in words. */
export function describeCoverage(c: Coverage): string {
  switch (c.kind) {
    case "world":
      return "the whole world";
    case "box":
      return "the box that was in view";
    case "circle":
      return `${c.distNm} nm around ${c.lat.toFixed(1)}, ${c.lon.toFixed(1)}`;
    default:
      return "no area it can vouch for";
  }
}
