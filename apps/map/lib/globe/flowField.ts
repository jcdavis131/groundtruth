// Pure math for the animated flow layers: grid decoding, bilinear vector
// sampling, and the colour ramps. No Cesium, no DOM — unit-tested in
// flowField.test.ts.

/** Compact grid bundle as written by scripts/flows-data.mjs. */
export interface FlowGrid {
  asof: string;
  source: string;
  grid: { lat0: number; lon0: number; dlat: number; dlon: number; nlat: number; nlon: number };
  /** Row-major (lat-major) east component, m/s; null where the source had no value. */
  u: Array<number | null>;
  /** Row-major north component, m/s; null where the source had no value. */
  v: Array<number | null>;
  /** Row-major sea-surface temperature, °C; currents grid only. */
  sst?: Array<number | null>;
}

export interface FlowSample {
  u: number;
  v: number;
  sst: number | null;
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Bilinear sample of the vector field at lon/lat. Null where any corner is null. */
export function sampleFlow(grid: FlowGrid, lon: number, lat: number): FlowSample | null {
  const { lat0, lon0, dlat, dlon, nlat, nlon } = grid.grid;
  const x = (wrapLon(lon) - lon0) / dlon;
  const y = (lat - lat0) / dlat;
  if (y < 0 || y > nlat - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = (x0 + 1) % nlon;
  const yy0 = Math.min(y0, nlat - 1);
  const yy1 = Math.min(y0 + 1, nlat - 1);
  const at = (xx: number, yy: number) => {
    const i = yy * nlon + xx;
    const u = grid.u[i];
    const v = grid.v[i];
    if (u == null || v == null) return null;
    return { u, v, sst: grid.sst ? (grid.sst[i] ?? null) : null };
  };
  const a = at(((x0 % nlon) + nlon) % nlon, yy0);
  const b = at(x1, yy0);
  const c = at(((x0 % nlon) + nlon) % nlon, yy1);
  const d = at(x1, yy1);
  if (!a || !b || !c || !d) return null;
  const lx = (p: number, q: number) => p * (1 - fx) + q * fx;
  const ly = (p: number, q: number) => p * (1 - fy) + q * fy;
  const sstOk = a.sst != null && b.sst != null && c.sst != null && d.sst != null;
  return {
    u: ly(lx(a.u, b.u), lx(c.u, d.u)),
    v: ly(lx(a.v, b.v), lx(c.v, d.v)),
    sst: sstOk ? ly(lx(a.sst!, b.sst!), lx(c.sst!, d.sst!)) : null,
  };
}

export const speedOf = (s: FlowSample) => Math.hypot(s.u, s.v);

type RGB = [number, number, number];

/** Piecewise-linear ramp through stops: [value, r, g, b]. */
function ramp(stops: Array<[number, RGB]>, value: number): RGB {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = (value - v0) / Math.max(1e-9, v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** Wind: colour by speed (m/s). Calm is dim slate, strong is hot orange/red. */
export function windColor(speedMs: number): { rgb: RGB; alpha: number } {
  const s = Math.max(0, speedMs);
  const rgb = ramp(
    [
      [0, [56, 80, 120]],
      [4, [37, 99, 235]],
      [9, [34, 211, 238]],
      [14, [163, 230, 53]],
      [20, [250, 204, 21]],
      [27, [249, 115, 22]],
      [35, [239, 68, 68]],
    ],
    s,
  );
  return { rgb, alpha: 0.22 + 0.68 * Math.min(1, s / 18) };
}

/**
 * Currents, the reel look: colour by sea-surface temperature (°C), brightness
 * by speed (m/s). Cold water is deep blue, warm water runs to red; still water
 * fades out so the motion reads.
 */
export function currentColor(sstC: number | null, speedMs: number): { rgb: RGB; alpha: number } {
  const rgb =
    sstC == null
      ? ([148, 163, 184] as RGB)
      : ramp(
          [
            [-2, [29, 78, 216]],
            [6, [14, 165, 233]],
            [14, [45, 212, 191]],
            [20, [163, 230, 53]],
            [25, [250, 204, 21]],
            [30, [249, 115, 22]],
            [34, [220, 38, 38]],
          ],
          sstC,
        );
  return { rgb, alpha: 0.12 + 0.78 * Math.min(1, speedMs / 1.2) };
}

/** Indices of grid cells with a real vector (ocean cells for the currents grid). */
export function liveCells(grid: FlowGrid): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.u.length; i++) {
    if (grid.u[i] != null && grid.v[i] != null) out.push(i);
  }
  return out;
}

/** Cell centre lon/lat for a row-major index. */
export function cellLonLat(grid: FlowGrid, i: number): [number, number] {
  const { lat0, lon0, dlat, dlon, nlon } = grid.grid;
  const row = Math.floor(i / nlon);
  const col = i % nlon;
  return [wrapLon(lon0 + col * dlon), lat0 + row * dlat];
}
