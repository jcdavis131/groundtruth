"use client";
// Raster overlay for the turbidity layer: chips live on the scene's UTM grid,
// the globe wants a lon/lat rectangle, so every output cell looks up the chip
// under its centre (nearest neighbour). Colour is a log ramp from clear blue
// to sediment brown.

import type { LayerFeature } from "@/lib/layers/types";
import type { ChipExtra } from "@/lib/layers/turbidity";
import type { OverlaySpec } from "@/lib/globe/renderer";
import { lonLatToUtm } from "./utm";

/** Log ramp 0.5 → 250 FNU. Returns [r, g, b]. */
export function turbidityColor(fnu: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [46, 134, 255]], // clear, deep blue
    [0.3, [94, 200, 232]], // low, cyan
    [0.55, [201, 195, 106]], // moderate, olive
    [0.8, [216, 154, 74]], // high, ochre
    [1, [140, 70, 35]], // very high, brown
  ];
  const t = Math.max(0, Math.min(1, (Math.log10(Math.max(fnu, 0.5)) - Math.log10(0.5)) / (Math.log10(250) - Math.log10(0.5))));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export function turbidityHex(fnu: number): string {
  const [r, g, b] = turbidityColor(fnu).map(Math.round);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const MAX_SIDE = 640;

export function buildTurbidityOverlay(features: LayerFeature[]): OverlaySpec | null {
  const chips = features.filter((f) => f.properties.layer === "turbidity" && f.properties.extra);
  if (chips.length === 0 || typeof document === "undefined") return null;
  const first = chips[0].properties.extra as ChipExtra;
  const { zone, originE, originN, chipM } = first.grid;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const byCell = new Map<string, number>();
  for (const f of chips) {
    const x = f.properties.extra as ChipExtra;
    west = Math.min(west, x.bounds.west);
    south = Math.min(south, x.bounds.south);
    east = Math.max(east, x.bounds.east);
    north = Math.max(north, x.bounds.north);
    byCell.set(`${x.grid.i},${x.grid.j}`, x.stats.median);
  }
  if (!Number.isFinite(west)) return null;
  // Cell size: a third of a chip, capped so the canvas stays small.
  const latM = 111_320;
  const lonM = latM * Math.cos(((south + north) / 2) * (Math.PI / 180));
  const cellDeg = chipM / 3;
  let cols = Math.ceil(((east - west) * lonM) / cellDeg);
  let rows = Math.ceil(((north - south) * latM) / cellDeg);
  const scale = Math.max(1, cols / MAX_SIDE, rows / MAX_SIDE);
  cols = Math.max(1, Math.round(cols / scale));
  rows = Math.max(1, Math.round(rows / scale));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  const d = img.data;
  for (let r = 0; r < rows; r++) {
    const lat = north - ((r + 0.5) / rows) * (north - south);
    for (let c = 0; c < cols; c++) {
      const lon = west + ((c + 0.5) / cols) * (east - west);
      const [e, n] = lonLatToUtm(lon, lat, zone);
      const j = Math.floor((e - originE) / chipM);
      const i = Math.floor((originN - n) / chipM);
      const v = byCell.get(`${i},${j}`);
      if (v == null) continue;
      const [cr, cg, cb] = turbidityColor(v);
      const k = (r * cols + c) * 4;
      d[k] = cr;
      d[k + 1] = cg;
      d[k + 2] = cb;
      d[k + 3] = 200;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { image: canvas, west, south, east, north, alpha: 0.8 };
}
