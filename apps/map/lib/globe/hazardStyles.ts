"use client";
// Styles for the three hazard layers (wildfire, active fires, hazard alerts),
// plus the polygon helpers the land styles share.
//
// Colour follows the publisher's own rating: NWS severity, GDACS alert level,
// FIRMS confidence per instrument, WFIGS percent contained. A rating the
// source did not publish gets UNRATED, a colour no rated level uses.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerStyle, StyledLine, StyledPolygon } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import { modisClass, type HazardAlertExtra, type FireExtra } from "@/lib/hazards/features";
import type { HotspotExtra } from "@/lib/layers/fires";

/** Drawn for anything the source did not rate. Never a "calm" colour. */
export const UNRATED = "#C39BFF";

export function ringsOf(g: Polygon | MultiPolygon): number[][][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

export function polyFills(f: LayerFeature, color: string, alpha: number): StyledPolygon[] {
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") return [];
  return ringsOf(f.geometry).map((rings) => ({ rings, color, alpha }));
}

/** Outer rings as outlines. */
export function polyOutlines(f: LayerFeature, color: string, alpha: number, width = 1, dashed = false): StyledLine[] {
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") return [];
  return ringsOf(f.geometry)
    .map((poly) => poly[0])
    .filter((ring) => Array.isArray(ring) && ring.length > 2)
    .map((ring) => ({ positions: ring.map((c) => [c[0], c[1], 0] as [number, number, number]), color, alpha, width, dashed }));
}

// ---------------------------------------------------------------- wildfire

const PRESCRIBED = "#E28CFF";

function fireColor(f: LayerFeature): string {
  const x = f.properties.extra as FireExtra;
  if (x.type === "RX") return PRESCRIBED;
  const c = x.contained;
  // Containment not reported is drawn like an uncontained fire, never like a finished one.
  if (c == null || c < 50) return "#FF3B1F";
  if (c < 100) return "#FF8A3D";
  return "#C79A6B";
}

export const wildfireStyle: LayerStyle = {
  color: "#FF5A1F",
  icon: (f) => (f.geometry.type === "Point" ? "fire" : null),
  iconSize: 18,
  colorFor: fireColor,
  label: (f) => {
    const x = f.properties.extra as FireExtra;
    const acres = x.acres != null ? ` · ${Math.round(x.acres).toLocaleString("en-US")} ac` : "";
    const cont = x.contained != null ? ` · ${Math.round(x.contained)}%` : " · containment n/r";
    return `${f.properties.name}${acres}${cont}`;
  },
  labelMax: 40,
  labelAlways: (f) => {
    const x = f.properties.extra as FireExtra;
    return x.hasPerimeter && (x.acres ?? 0) >= 5_000;
  },
  // Larger fires keep their labels first: +2 per decade of acres past 1,000, at most 8.
  labelPriority: (f) => {
    const acres = (f.properties.extra as FireExtra).acres ?? 0;
    return acres > 1_000 ? Math.min(8, Math.round(2 * Math.log10(acres / 1_000))) : 0;
  },
  scaleByDistance: [5e4, 1.0, 4e6, 0.45],
  polygons: (f) => {
    const x = f.properties.extra as FireExtra;
    return polyFills(f, fireColor(f), (x.contained ?? 0) >= 100 ? 0.16 : 0.3);
  },
  lines: (f) => polyOutlines(f, fireColor(f), 0.9, 2),
};

// ---------------------------------------------------------------- FIRMS hotspots

function hotspotColor(f: LayerFeature): string {
  const x = f.properties.extra as HotspotExtra;
  const c = x.confidence;
  if (x.instrument === "VIIRS") {
    if (c === "high") return "#FF3B1F";
    if (c === "nominal") return "#FF7A1A";
    if (c === "low") return "#A0643C";
    return "#F2E6D9";
  }
  if (typeof c !== "number") return "#F2E6D9";
  const k = modisClass(c);
  return k === "high" ? "#FFC21A" : k === "nominal" ? "#FFD966" : "#8A7A3A";
}

export const firesStyle: LayerStyle = {
  color: "#FF7A1A",
  pointSize: (f) => {
    const x = f.properties.extra as HotspotExtra;
    const base = 3 + Math.log10(1 + (x.frp ?? 0)) * 2.4;
    return Math.min(12, base + (x.count > 1 ? Math.min(3, Math.log10(x.count) * 1.5) : 0));
  },
  colorFor: hotspotColor,
  label: (f) => f.properties.name,
  labelMax: 0,
  translucencyByDistance: [1e6, 1.0, 1.5e7, 0.75],
};

// ---------------------------------------------------------------- hazard alerts

const NWS_COLOR: Record<string, string> = {
  Extreme: "#FF2D95",
  Severe: "#FF4D4D",
  Moderate: "#FF9A3D",
  Minor: "#FFD23F",
};

const GDACS_COLOR: Record<string, string> = {
  Red: "#FF3B30",
  Orange: "#FF9500",
  // GDACS's own published level; green here is theirs, not ours.
  Green: "#34C759",
};

export function alertColor(f: LayerFeature): string {
  const x = f.properties.extra as HazardAlertExtra;
  if (!x.severity) return UNRATED;
  if (x.source === "NWS") return NWS_COLOR[x.severity] ?? UNRATED;
  if (x.source === "GDACS") return GDACS_COLOR[x.severity] ?? UNRATED;
  return UNRATED;
}

export const hazardsStyle: LayerStyle = {
  color: "#FF9A3D",
  icon: (f) => {
    if (f.geometry.type !== "Point") return null;
    const k = f.properties.kind;
    return k === "volcano" || k === "gdacs-vo" ? "volcano" : "hazard";
  },
  iconSize: 20,
  colorFor: alertColor,
  label: (f) => {
    const x = f.properties.extra as HazardAlertExtra;
    if (x.source === "GDACS") return `${x.severity ?? "unrated"} · ${f.properties.name}`;
    return f.properties.name;
  },
  labelMax: 40,
  labelAlways: (f) => {
    const x = f.properties.extra as HazardAlertExtra;
    return (x.source === "GDACS" && (x.severity === "Red" || x.severity === "Orange")) || (x.source === "NWS" && x.severity === "Extreme");
  },
  // In a crowded frame the publisher's highest levels keep their labels first.
  labelPriority: (f) => {
    const s = (f.properties.extra as HazardAlertExtra).severity;
    return s === "Red" || s === "Extreme" ? 8 : s === "Orange" || s === "Severe" ? 4 : 0;
  },
  scaleByDistance: [2e5, 1.0, 1e7, 0.5],
  polygons: (f) => {
    const x = f.properties.extra as HazardAlertExtra;
    if (x.source !== "NWS") return null;
    return polyFills(f, alertColor(f), x.drawnAs === "counties" ? 0.12 : 0.26);
  },
  lines: (f) => {
    const x = f.properties.extra as HazardAlertExtra;
    if (x.source !== "NWS") return null;
    // Dashed when the area is the listed counties rather than a polygon NWS drew.
    return polyOutlines(f, alertColor(f), 0.85, 1.5, x.drawnAs === "counties");
  },
};
