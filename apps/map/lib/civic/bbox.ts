// Box and number parsing for the civic routes (/api/zoning, /api/permits).
// Pure, so the snapping rules are tested without a request.

export type Bbox = [number, number, number, number];

/**
 * Clamp to `span` degrees around the centre and snap outward to a `grid`
 * degree grid, so nearby callers share a cache entry. A box already on the
 * grid comes back unchanged: the epsilon keeps -98.5 / 0.0025
 * (-39400.000000000004) from growing it by a cell.
 */
export function snapBbox(v: Bbox, span: number, grid: number): Bbox {
  let [w, s, e, n] = v;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - span / 2, -180);
  e = Math.min(e, cx + span / 2, 180);
  s = Math.max(s, cy - span / 2, -90);
  n = Math.min(n, cy + span / 2, 90);
  const f = (x: number) => Number((Math.floor(x / grid + 1e-9) * grid).toFixed(4));
  const c = (x: number) => Number((Math.ceil(x / grid - 1e-9) * grid).toFixed(4));
  return [f(w), f(s), c(e), c(n)];
}

/** `w,s,e,n` with west < east and south < north, clamped and snapped; anything else is null. */
export function parseBbox(raw: string | null, span: number, grid: number): Bbox | null {
  const v = (raw ?? "").split(",").map((x) => (x.trim() === "" ? NaN : Number(x)));
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  if (v[0] >= v[2] || v[1] >= v[3]) return null;
  if (Math.abs(v[1]) > 90 || Math.abs(v[3]) > 90 || Math.abs(v[0]) > 180 || Math.abs(v[2]) > 180) return null;
  return snapBbox(v as Bbox, span, grid);
}

/** A query parameter as a finite number; a missing or blank one is null, never 0 (Number(null) is 0). */
export function numParam(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
