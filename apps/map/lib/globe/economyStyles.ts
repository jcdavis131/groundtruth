"use client";
// Styles for the trade, commerce and real-estate layers.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerStyle, StyledLine, StyledPolygon } from "./renderer";
import { fmtNum, fmtPct, fmtUsd, greatCircle, type AreaExtra, type CountryExtra, type CrossingExtra, type PortExtra } from "@/lib/economy/features";
import type { LayerFeature } from "@/lib/layers/types";

const TRADE = "#FFB454";
const IMPORT_ARC = "#4DD8FF";
const JOBS = "#C084FC";
const HOMES = "#F472B6";

function yoyColor(v: number | null | undefined, neutral: string): string {
  if (v == null) return "#6E7F8C";
  if (v <= -3) return "#FF4D4D";
  if (v < -1) return "#FF7A3D";
  if (v <= 1) return neutral;
  if (v <= 3) return "#8DE7A8";
  return "#5EF2C2";
}

function ringsOf(g: Polygon | MultiPolygon): number[][][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/** Outer rings of a polygon feature as thin outlines. */
function outlines(f: LayerFeature, color: string, alpha: number): StyledLine[] {
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") return [];
  return ringsOf(f.geometry)
    .map((poly) => poly[0])
    .filter((ring) => Array.isArray(ring) && ring.length > 2)
    .map((ring) => ({ positions: ring.map((c) => [c[0], c[1], 0] as [number, number, number]), color, alpha, width: 1 }));
}

function fills(f: LayerFeature, color: string, alpha: number): StyledPolygon[] {
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") return [];
  return ringsOf(f.geometry).map((rings) => ({ rings, color, alpha }));
}

/** Arc between two places lifted off the surface so it reads against the globe. */
function arc(lon1: number, lat1: number, lon2: number, lat2: number, color: string, width: number, alpha: number): StyledLine {
  const pts = greatCircle(lon1, lat1, lon2, lat2, 40);
  const d2r = Math.PI / 180;
  const span = Math.acos(
    Math.min(1, Math.sin(lat1 * d2r) * Math.sin(lat2 * d2r) + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.cos((lon2 - lon1) * d2r)),
  );
  const lift = Math.min(1_800_000, span * 6_371_000 * 0.18);
  const n = pts.length - 1;
  return {
    positions: pts.map((p, i) => {
      const t = i / n;
      return [p[0], p[1], 4 * t * (1 - t) * lift + 2000] as [number, number, number];
    }),
    color,
    width,
    alpha,
    glow: true,
  };
}

export const tradeStyle: LayerStyle = {
  color: TRADE,
  icon: (f) => {
    const k = f.properties.kind;
    if (k === "port") return "port";
    if (k === "crossing") return "crossing";
    return null;
  },
  iconSize: 16,
  colorFor: (f) => {
    const k = f.properties.kind;
    if (k === "port") {
      const x = f.properties.extra as PortExtra;
      if (x.stats) return "#FFD08A";
      switch (x.wpi.size) {
        case "large":
          return TRADE;
        case "medium":
          return "#E0A050";
        case "small":
          return "#B08A50";
        default:
          return "#8A7550";
      }
    }
    if (k === "crossing") return yoyColor((f.properties.extra as CrossingExtra).measures.Trucks?.yoyPct, TRADE);
    return TRADE;
  },
  label: (f) => {
    const k = f.properties.kind;
    if (k === "country") {
      const x = f.properties.extra as CountryExtra;
      const ex = x.wb?.exports;
      return ex ? `${f.properties.name} · exports ${fmtUsd(ex.value)}` : f.properties.name;
    }
    if (k === "crossing") {
      const t = (f.properties.extra as CrossingExtra).measures.Trucks;
      return t ? `${f.properties.name} · ${fmtNum(t.latest)} trucks/mo` : f.properties.name;
    }
    if (k === "port") {
      const s = (f.properties.extra as PortExtra).stats;
      if (s?.container?.total != null) return `${f.properties.name} · ${fmtNum(s.container.total)} TEU`;
      if (s?.tonnage?.total != null) return `${f.properties.name} · ${fmtNum(s.tonnage.total)} tons`;
    }
    return f.properties.name;
  },
  labelMax: 80,
  labelAlways: (f) => {
    const k = f.properties.kind;
    if (k === "country") return ((f.properties.extra as CountryExtra).rank ?? 999) <= 15;
    if (k === "port") return !!(f.properties.extra as PortExtra).labelled;
    if (k === "crossing") return !!(f.properties.extra as CrossingExtra).labelled;
    return false;
  },
  scaleByDistance: [2e5, 1.0, 6e6, 0.45],
  polygons: (f) => {
    if (f.properties.kind !== "country") return null;
    const rank = (f.properties.extra as CountryExtra).rank;
    const alpha = rank ? 0.05 + 0.3 * Math.max(0, 1 - Math.log(rank) / Math.log(120)) : 0.03;
    return fills(f, TRADE, alpha);
  },
  selectedLines: (f) => {
    if (f.properties.kind !== "country") return null;
    const x = f.properties.extra as CountryExtra;
    const p = x.partners;
    if (!p) return null;
    const out: StyledLine[] = [];
    const widthFor = (share: number | null) => 1 + 3 * Math.min(1, (share ?? 5) / 30);
    for (const t of p.exports) out.push(arc(x.lx, x.ly, t.lon, t.lat, TRADE, widthFor(t.sharePct), 0.85));
    for (const t of p.imports) out.push(arc(t.lon, t.lat, x.lx, x.ly, IMPORT_ARC, widthFor(t.sharePct), 0.7));
    return out;
  },
};

export const commerceStyle: LayerStyle = {
  color: JOBS,
  icon: () => "jobs",
  iconSize: 18,
  colorFor: (f) => yoyColor((f.properties.extra as AreaExtra).jobs?.yoy.emp, JOBS),
  pointSize: () => 6,
  label: (f) => {
    const j = (f.properties.extra as AreaExtra).jobs;
    if (!j || j.suppressed) return f.properties.name;
    return `${f.properties.name} · ${fmtNum(j.emp)} jobs · ${fmtPct(j.yoy.emp)}`;
  },
  labelMax: 40,
  labelAlways: (f) => !!(f.properties.extra as AreaExtra).labelled,
  // Below the anchor: the home-value label of the same county sits above it.
  labelOffset: [14, 12],
  scaleByDistance: [1e5, 1.0, 3e6, 0.5],
  lines: (f) => outlines(f, JOBS, 0.22),
};

function homeFill(yoy: number | null | undefined): [string, number] {
  if (yoy == null) return ["#6E7F8C", 0.15];
  if (yoy <= -5) return ["#3B82F6", 0.32];
  if (yoy < -1) return ["#60A5FA", 0.24];
  if (yoy <= 1) return ["#A78BFA", 0.18];
  if (yoy <= 5) return [HOMES, 0.26];
  return ["#FF4D6D", 0.34];
}

export const realestateStyle: LayerStyle = {
  color: HOMES,
  icon: () => null,
  label: (f) => {
    const h = (f.properties.extra as AreaExtra).home;
    if (!h) return f.properties.name;
    return `${f.properties.name} · ${fmtUsd(h.latest)} · ${fmtPct(h.yoyPct)}`;
  },
  labelMax: 40,
  labelAlways: (f) => !!(f.properties.extra as AreaExtra).labelled,
  colorFor: (f) => homeFill((f.properties.extra as AreaExtra).home?.yoyPct)[0],
  polygons: (f) => {
    const [color, alpha] = homeFill((f.properties.extra as AreaExtra).home?.yoyPct);
    return fills(f, color, alpha);
  },
  lines: (f) => outlines(f, HOMES, 0.18),
};
