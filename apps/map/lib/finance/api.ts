// Pure helpers for app/api/finance/route.ts: parameter validation and bbox
// snapping. Kept out of the route file so they can be unit tested without
// Next. CSV writing and the response envelope come from lib/server/respond.

/** Bounding box in degrees, [west, south, east, north]. */
export type Bbox = [number, number, number, number];

/** Same clamp and snap as the economy route so both routes share TIGERweb cache entries. */
export const MAX_SPAN_DEG = 18;

/** Parse "w,s,e,n"; clamp to MAX_SPAN_DEG around the centre and snap outward to a 1° grid. Null when malformed or inverted. */
export function parseBbox(raw: string | null): Bbox | null {
  const v = (raw ?? "").split(",").map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  let [w, s, e, n] = v as Bbox;
  if (w > e || s > n || Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) return null;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - MAX_SPAN_DEG / 2, -180);
  e = Math.min(e, cx + MAX_SPAN_DEG / 2, 180);
  s = Math.max(s, cy - MAX_SPAN_DEG / 2, -90);
  n = Math.min(n, cy + MAX_SPAN_DEG / 2, 90);
  return [Math.floor(w), Math.floor(s), Math.ceil(e), Math.ceil(n)];
}

/** Five-digit county FIPS (state 01-78, county not 000). */
export function parseCountyFips(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!/^\d{5}$/.test(s)) return null;
  const st = Number(s.slice(0, 2));
  if (st < 1 || st > 78 || s.slice(2) === "000") return null;
  return s;
}

/** FDIC certificate number: a positive integer, at most six digits. */
export function parseCert(raw: string | null): number | null {
  const s = (raw ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** A four-digit year within [min, max]; `fallback` when absent, null when malformed or out of range. */
export function parseYear(raw: string | null, min: number, max: number, fallback: number): number | null {
  const s = (raw ?? "").trim();
  if (!s) return fallback;
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return y >= min && y <= max ? y : null;
}

/** Two-letter USPS state code, upper-cased. */
export function parseState(raw: string | null): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** Split a list into runs of at most `size` (the last run may be shorter). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Generalization by box size, as the economy route chooses it: fine polygons for a city, coarse for a region. */
export function detailFor(b: Bbox): "500K" | "5M" | "20M" {
  const span = Math.max(b[2] - b[0], b[3] - b[1]);
  return span <= 2 ? "500K" : span <= 7 ? "5M" : "20M";
}
