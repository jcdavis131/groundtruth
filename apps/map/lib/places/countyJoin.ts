// County joins for the place-tower exports (docs/place-towers.md): a county
// name + state to a 5-digit FIPS from lib/places/data/counties.json, and a
// point to the county polygon it falls in. Pure and import-free, so the export
// scripts (node, type stripping) and vitest both load it directly.
//
// The name join is the rule scripts/export-npl-county.mjs uses, factored out:
// it fails closed. A name that matches no county, or that is ambiguous (a bare
// name where the state has both "<X> County" and "<X> city"), is not placed.
// The whole string is matched first ("Lewis and Clark" is one county); only
// when that fails is it split into a list, on "," and "/" only.

export interface CountyRow {
  geoid: string;
  name: string;
  stusab: string;
  stateName: string;
}

export interface NameJoin {
  geoid: string | null;
  /** Why it was not placed: no_name_match, ambiguous, ambiguous_county_or_city, multi_county, no_county, state_not_in_counties. */
  reason: string | null;
  /** The counties it could be in when not placed; null means any county of its state. */
  candidates: string[] | null;
}

const ENTITIES: Record<string, string> = { amp: "&", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", uuml: "ü", apos: "'", quot: '"' };

/** Agency county strings can carry HTML entities ("Pe&ntilde;uelas"); decode the named and numeric ones. */
export function decodeEntities(s: unknown): string {
  return String(s ?? "").replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e] ?? m)));
}

/** Lower case, no accents, "St." as "saint", punctuation as space, and the county-type suffix dropped. */
export function norm(s: unknown): string {
  return decodeEntities(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bste\.?\s/g, "sainte ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+(county|parish|borough|census area|city and borough|municipality|municipio)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NameIndex {
  /** USPS code by upper-case USPS code or state name. */
  stateKey: Map<string, string>;
  /** Per USPS code: normalised name (and "nospace:" form) to FIPS, or "ambiguous". */
  byState: Map<string, Map<string, string>>;
  /** Every county FIPS of a state. */
  countiesOf: Map<string, string[]>;
}

export function nameIndex(rows: readonly CountyRow[]): NameIndex {
  const stateKey = new Map<string, string>();
  const byState = new Map<string, Map<string, string>>();
  const countiesOf = new Map<string, string[]>();
  for (const c of rows) {
    stateKey.set(c.stusab.toUpperCase(), c.stusab);
    stateKey.set(c.stateName.toUpperCase(), c.stusab);
    if (!byState.has(c.stusab)) byState.set(c.stusab, new Map());
    if (!countiesOf.has(c.stusab)) countiesOf.set(c.stusab, []);
    countiesOf.get(c.stusab)!.push(c.geoid);
    const m = byState.get(c.stusab)!;
    const n = norm(c.name);
    m.set(n, m.has(n) ? "ambiguous" : c.geoid);
    // "Du Page" / "DuPage", "La Salle" / "LaSalle": the same name without spaces, kept only when unique.
    const ns = `nospace:${n.replace(/ /g, "")}`;
    m.set(ns, m.has(ns) ? "ambiguous" : c.geoid);
  }
  return { stateKey, byState, countiesOf };
}

/** USPS code for a state name or code, any case; null when not in counties.json. */
export function stateOf(ix: NameIndex, state: unknown): string | null {
  return ix.stateKey.get(String(state ?? "").trim().toUpperCase()) ?? null;
}

function one(m: Map<string, string>, n: string): NameJoin {
  // A bare name where the state has both "<X> County" and "<X> city" cannot be placed.
  if (m.has(`${n} city`) && m.has(n)) return { geoid: null, reason: "ambiguous_county_or_city", candidates: [m.get(n)!, m.get(`${n} city`)!] };
  const g = m.get(n) ?? m.get(`nospace:${n.replace(/ /g, "")}`) ?? (n.endsWith(" city") ? undefined : m.get(`${n} city`));
  if (!g) return { geoid: null, reason: "no_name_match", candidates: null };
  if (g === "ambiguous") return { geoid: null, reason: "ambiguous", candidates: null };
  return { geoid: g, reason: null, candidates: null };
}

/**
 * A county string + state to a FIPS, or why not and which counties it could be in. A string
 * naming several counties ("Kern, Los Angeles, San Bernardino") is not placed in one: its
 * candidates are the counties named, or the whole state when any one name matches nothing.
 */
export function joinName(ix: NameIndex, state: unknown, county: unknown): NameJoin {
  const st = stateOf(ix, state);
  const m = st ? ix.byState.get(st) : undefined;
  if (!st || !m) return { geoid: null, reason: "state_not_in_counties", candidates: [] };
  const all = ix.countiesOf.get(st)!;
  const whole = norm(county);
  if (whole) {
    const w = one(m, whole);
    if (w.geoid) return w;
  }
  const parts = decodeEntities(county).split(/[,/]/).map(norm).filter(Boolean);
  if (!parts.length) return { geoid: null, reason: "no_county", candidates: all };
  if (parts.length === 1) {
    const r = one(m, parts[0]);
    return r.geoid || r.candidates ? r : { ...r, candidates: all };
  }
  const each = parts.map((p) => one(m, p));
  const known = each.every((r) => r.geoid || r.candidates);
  return { geoid: null, reason: "multi_county", candidates: known ? [...new Set(each.flatMap((r) => (r.geoid ? [r.geoid] : r.candidates!)))] : all };
}

/** Levenshtein distance, capped: anything above `cap` is returned as cap + 1. */
export function editDistance(a: string, b: string, cap = 1): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return Math.min(prev[b.length], cap + 1);
}

/**
 * A misspelt county string ("SCHUYKILL", "BARNEWELL") to the one county of its state whose
 * normalised name is a single edit away, or null when there is none or more than one. Only for a
 * single name that matched nothing whole; the caller lists every use.
 */
export function nearName(ix: NameIndex, state: unknown, county: unknown): string | null {
  const st = stateOf(ix, state);
  const m = st ? ix.byState.get(st) : undefined;
  const n = norm(county);
  if (!m || n.length < 5 || /[,/]/.test(decodeEntities(county))) return null;
  const hits = new Set<string>();
  for (const [k, g] of m) {
    if (k.startsWith("nospace:") || g === "ambiguous") continue;
    if (editDistance(n, k) <= 1) hits.add(g);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/**
 * Census's published successors of a county that no longer exists, as candidates (never a
 * placement): Valdez-Cordova (02261) became Chugach (02063) and Copper River (02066) in 2019.
 */
export const SUCCESSORS: Record<string, string[]> = { "AK|valdez cordova": ["02063", "02066"] };

// ------------------------------------------------------------------ points

export type Ring = number[][];
export interface CountyPolygon {
  geoid: string;
  rings: Ring[];
  bbox: [number, number, number, number];
}

/** Even-odd over every ring, so holes count; x = longitude, y = latitude. */
export function pointInRings(x: number, y: number, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function polygon(geoid: string, rings: Ring[]): CountyPolygon {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  return { geoid, rings, bbox: [w, s, e, n] };
}

/**
 * The polygons a point is in: one id when it is placed, none when it is in no polygon (offshore,
 * across the antimeridian, a territory), several only if the outlines overlap. Never the nearest.
 */
export function pointIn(polys: readonly CountyPolygon[], x: number, y: number): string[] {
  const hit: string[] = [];
  for (const p of polys) {
    const [w, s, e, n] = p.bbox;
    if (x < w || x > e || y < s || y > n) continue;
    if (pointInRings(x, y, p.rings)) hit.push(p.geoid);
  }
  return hit;
}
