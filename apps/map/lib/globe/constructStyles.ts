"use client";
// How the constructs layer is drawn. Focus, not clutter:
//
//  - Every stratum is a small node in its point-of-view colour, floating at
//    its height in a tight rosette over the point, with a short tether one
//    stratum long beneath it. No outlines, no labels: the strata rail in the
//    HUD lists the stack and carries the names.
//  - The focused stratum (the selection) draws its outline on the ground in
//    the signal colour, its tether all the way down, and its immediate parent
//    and child ghosted faintly on the ground, so the shell it sits in and the
//    shell inside it read together.
//  - "Here" keeps its label; the focused stratum gets one from the renderer.

import type { LayerFeature } from "@/lib/layers/types";
import type { LayerStyle, LonLatAlt, StyledLine } from "./renderer";
import { DOMAINS, KINDS } from "@/lib/fabric/catalog";
import { densifyRing } from "@/lib/fabric/strata";
import type { ConstructExtra } from "@/lib/fabric/types";
import { useStrata } from "@/lib/fabric/strataStore";

/** The HUD's warm signal accent (app/globals.css --signal): selection is always drawn in it. */
export const SIGNAL = "#FFA458";
/** The chrome's ice (app/globals.css --primary): ghosts of the parent and child. */
export const ICE = "#B4DCF2";

/** Ground outlines float a few metres up so they clear the imagery without visible parallax. */
const GROUND_ALT = 60;

function extraOf(f: LayerFeature): ConstructExtra | undefined {
  return f.properties.extra as ConstructExtra | undefined;
}

function colorOf(f: LayerFeature): string {
  const n = extraOf(f)?.node;
  return n ? DOMAINS[n.domain].color : "#FFFFFF";
}

/** Outline rings as ground polylines, densified so long edges do not sag into the globe. */
export function groundRings(rings: number[][][], color: string, alpha: number, width: number, dashed = false): StyledLine[] {
  return rings.map((ring) => ({
    positions: densifyRing(ring).map((p) => [p[0], p[1], GROUND_ALT] as LonLatAlt),
    color,
    alpha,
    width,
    dashed,
  }));
}

/** How long one stratum takes to rise, and the stagger between tiers, ms. */
const RISE_MS = 1400;
const STAGGER_MS = 70;

/** 0..1 progress of a stratum's rise out of the ground (ease-out cubic). */
export function riseProgress(born: number | undefined, tier: number, now: number): number {
  if (born == null) return 1;
  const t = (now - born - tier * STAGGER_MS) / RISE_MS;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 3;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const constructsStyle: LayerStyle = {
  color: "#E5E7EB",
  pointSize: (f) => (f.properties.kind === "here" ? 9 : 5),
  colorFor: colorOf,
  label: (f) => {
    const n = extraOf(f)?.node;
    return n ? `${KINDS[n.kind].label.toUpperCase()} · ${n.name}` : f.properties.name;
  },
  // Only "Here" keeps a standing label; the focused stratum is labelled as the selection.
  labelMax: 0,
  // While two places are compared, pin A stands on "Here" and carries the name.
  labelAlways: (f) => f.properties.kind === "here" && !useStrata.getState().compare,
  // Emergence: each stratum rises from the ground point to its place in the rosette.
  position: (f) => {
    if (f.geometry.type !== "Point") return null;
    const [lon, lat, alt] = f.geometry.coordinates as [number, number, number];
    const x = extraOf(f);
    if (!x?.node) return [lon, lat, alt ?? 0];
    const k = reducedMotion() ? 1 : riseProgress(x.born, x.tier, Date.now());
    return [x.ground[0] + (lon - x.ground[0]) * k, x.ground[1] + (lat - x.ground[1]) * k, (alt ?? 0) * k];
  },
  tickMs: 40,
  lines: (f) => {
    const x = extraOf(f);
    if (!x?.node || f.geometry.type !== "Point") return null;
    const [lon, lat, alt] = f.geometry.coordinates as number[];
    // A short drop, one stratum long: tilted, the nodes read as a stair of layers; from above, as quiet dots.
    const step = (alt ?? 0) / (x.tier + 1);
    return [{ positions: [[lon, lat, alt], [lon, lat, Math.max(0, alt - step * 0.85)]], color: colorOf(f), alpha: 0.42, width: 1 }];
  },
  selectedLines: (f) => {
    const x = extraOf(f);
    if (!x?.node || f.geometry.type !== "Point") return null;
    const [lon, lat, alt] = f.geometry.coordinates as number[];
    const out: StyledLine[] = [
      // The focused stratum's tether runs all the way to the point it contains.
      { positions: [[lon, lat, alt], [x.ground[0], x.ground[1], 0]], color: SIGNAL, alpha: 0.75, width: 1.2 },
    ];
    if (x.parent?.rings) out.push(...groundRings(x.parent.rings, ICE, 0.26, 1, true));
    if (x.child?.rings) out.push(...groundRings(x.child.rings, ICE, 0.34, 1));
    if (x.node.rings) out.push(...groundRings(x.node.rings, SIGNAL, 0.95, 2.2));
    return out;
  },
  scaleByDistance: [2e4, 1.0, 2e7, 0.5],
};
