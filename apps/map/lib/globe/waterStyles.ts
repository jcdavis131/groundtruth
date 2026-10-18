"use client";
// Styles for the three water layers. Kept apart from styles.ts so the
// hydrology palette and the turbidity ramp live next to each other.

import type { MultiLineString, Polygon } from "geojson";
import type { LayerStyle, StyledLine } from "./renderer";
import type { GaugeExtra, HydroExtra, ReservoirExtra } from "@/lib/layers/water";
import { DROUGHT_COLOR, type DroughtExtra, type WellExtra } from "@/lib/layers/groundwater";
import type { ChipExtra } from "@/lib/layers/turbidity";
import { buildTurbidityOverlay, turbidityHex } from "@/lib/water/overlay";

const WATER = "#3B9DFF";
const RIVER = "#4FB3FF";
const STALE = "#6E7F8C";
const FLOOD: Record<string, string> = {
  action: "#F5B849",
  minor: "#FFB347",
  moderate: "#FF7A3D",
  major: "#FF4D4D",
};

function gaugeColor(f: Parameters<NonNullable<LayerStyle["colorFor"]>>[0]): string {
  const p = f.properties;
  if (p.kind === "reservoir") {
    const x = p.extra as ReservoirExtra | GaugeExtra;
    if ("percentFull" in x && x.percentFull != null) {
      if (x.percentFull < 30) return "#FF6B3D";
      if (x.percentFull < 60) return "#F5B849";
      return "#5FD0FF";
    }
    return "#5FD0FF";
  }
  const x = p.extra as GaugeExtra | undefined;
  if (!x) return WATER;
  const cat = x.flood?.category;
  if (cat && FLOOD[cat]) return FLOOD[cat];
  if (x.stale) return STALE;
  if (x.index?.worst === "poor") return "#FF7A3D";
  if (x.index?.worst === "watch") return "#F5B849";
  return WATER;
}

export const waterStyle: LayerStyle = {
  color: WATER,
  icon: (f) => {
    const k = f.properties.kind;
    if (k === "gauge" || k === "flood-gauge") return "gauge";
    if (k === "reservoir") return "dam";
    return null;
  },
  iconSize: 18,
  colorFor: (f) => {
    const k = f.properties.kind;
    if (k === "river" || k === "lake") return RIVER;
    return gaugeColor(f);
  },
  label: (f) => f.properties.name,
  labelMax: 40,
  // Standing labels only for the planet-scale names (≈ 55 rivers and lakes);
  // everything else labels on hover or selection.
  labelAlways: (f) => {
    const k = f.properties.kind;
    const x = f.properties.extra as HydroExtra | undefined;
    if (!x?.named) return false;
    if (k === "river") return x.minZoom <= 2;
    if (k === "lake") return x.minZoom <= 1.7;
    return false;
  },
  scaleByDistance: [2e4, 1.0, 2.5e6, 0.3],
  lines: (f) => {
    const p = f.properties;
    if (p.kind === "river" && f.geometry.type === "MultiLineString") {
      const rank = (p.extra as HydroExtra | undefined)?.scalerank ?? 6;
      const alpha = Math.max(0.18, 0.75 - rank * 0.07);
      return (f.geometry as MultiLineString).coordinates
        .filter((part) => Array.isArray(part) && part.length > 1)
        .map(
          (part): StyledLine => ({ positions: part.map((c) => [c[0], c[1], 0]), color: RIVER, alpha, width: rank <= 2 ? 1.8 : 1.2 }),
        );
    }
    if (p.kind === "lake" && f.geometry.type === "Polygon") {
      return (f.geometry as Polygon).coordinates
        .filter((ring) => Array.isArray(ring) && ring.length > 2)
        .map((ring): StyledLine => ({ positions: ring.map((c) => [c[0], c[1], 0]), color: "#79C7FF", alpha: 0.6, width: 1.3 }));
    }
    return null;
  },
};

export const groundwaterStyle: LayerStyle = {
  color: "#D7B36A",
  icon: (f) => (f.properties.kind === "well" ? "well" : null),
  iconSize: 16,
  colorFor: (f) => {
    if (f.properties.kind === "drought") return DROUGHT_COLOR[(f.properties.extra as DroughtExtra).dm];
    const x = f.properties.extra as WellExtra | undefined;
    return x?.stale ? STALE : "#D7B36A";
  },
  label: (f) => {
    if (f.properties.kind === "well") {
      const x = f.properties.extra as WellExtra;
      return x.aquifer ? `${x.aquifer.replace(/ aquifer( system)?$/i, "")}` : f.properties.name;
    }
    return f.properties.name;
  },
  labelMax: 30,
  scaleByDistance: [2e4, 1.0, 2.5e6, 0.3],
  polygons: (f) => {
    if (f.properties.kind !== "drought") return null;
    const dm = (f.properties.extra as DroughtExtra).dm;
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    // Deeper classes sit on top of lighter ones on the USDM map; give them more body.
    return polys.map((rings) => ({ rings, color: DROUGHT_COLOR[dm], alpha: 0.16 + dm * 0.07 }));
  },
};

export const turbidityStyle: LayerStyle = {
  color: "#E8A653",
  pointSize: (f) => ((f.properties.extra as ChipExtra | undefined)?.insitu ? 9 : 5),
  colorFor: (f) => turbidityHex((f.properties.extra as ChipExtra).stats.median),
  label: (f) => {
    const x = f.properties.extra as ChipExtra;
    return `${x.stats.median.toFixed(1)} FNU est.${x.insitu ? " · gauge" : ""}`;
  },
  labelMax: 0,
  labelAlways: (f) => !!(f.properties.extra as ChipExtra | undefined)?.insitu,
  overlay: buildTurbidityOverlay,
};
