// The URL grammar for places: what /place/48453, /metro/41700, /state/TX and
// /compare/48453-vs-06037 are allowed to mean, and the one shape every page,
// route handler, brief and feed passes around afterwards.
//
// The load-bearing rule is in parseCountyParam. The committed counties.json is
// the full pull (MANIFEST.countiesComplete === true, 3,222 county
// equivalents), so an unknown FIPS is an exact 404 - including the eight old
// Connecticut counties, which the 2022 planning regions (09110-09190)
// replaced. The provisional branch exists for a build that ever ships an
// incomplete table: there, a county the manifest cannot name is still a real
// county, so a structurally valid FIPS whose state prefix is one of the 52
// known states resolves PROVISIONALLY - accepted, ref null, and the caller
// gets the name and the centroid from upstream at request time.
// Anything else - a four-digit code, an SSCCC form ending 000, an array from a
// repeated query parameter - is rejected in both worlds.
//
// Nothing here fetches. Every function is synchronous and total.

import type { CountyRef, MetroRef, StateRef } from "./registry";
import { MANIFEST, countyByFips, countyLabel, isKnownStateFips, metroByCbsa, stateByFips, stateByUsps } from "./registry";

export type PlaceScope =
  | { kind: "county"; id: string; ref: CountyRef | null; provisional: boolean }
  | { kind: "metro"; id: string; ref: MetroRef }
  | { kind: "state"; id: string; ref: StateRef };

const FIVE = /^[0-9]{5}$/;
const TWO_ALPHA = /^[A-Za-z]{2}$/;

function asParam(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

/**
 * A county URL segment. Accepts a 5-digit FIPS whose last three digits are not
 * "000" (that form is a state row in QCEW, never a county), and falls back to
 * structural validation while the county table is incomplete.
 */
export function parseCountyParam(raw: unknown): PlaceScope | null {
  const id = asParam(raw);
  if (!id || !FIVE.test(id) || id.slice(2) === "000") return null;
  const ref = countyByFips(id);
  if (ref) return { kind: "county", id, ref, provisional: false };
  if (!MANIFEST.countiesComplete && isKnownStateFips(id.slice(0, 2))) return { kind: "county", id, ref: null, provisional: true };
  return null;
}

/** A metro URL segment. The metro table is complete, so an unknown CBSA is a real 404. */
export function parseMetroParam(raw: unknown): PlaceScope | null {
  const id = asParam(raw);
  if (!id || !FIVE.test(id)) return null;
  const ref = metroByCbsa(id);
  return ref ? { kind: "metro", id, ref } : null;
}

/** A state URL segment, case-insensitive on the way in: /state/tx canonicalises to /state/TX. */
export function parseStateParam(raw: unknown): PlaceScope | null {
  const input = asParam(raw);
  if (!input || !TWO_ALPHA.test(input)) return null;
  const id = input.toUpperCase();
  const ref = stateByUsps(id);
  return ref ? { kind: "state", id, ref } : null;
}

/**
 * One side of a compare pair: "48453", "county:48453", "metro:41700",
 * "state:TX" or "tx". A bare five-digit code is always a county, never a
 * metro: the two code spaces overlap, and an ambiguity resolved by whether
 * the county table happens to have been pulled yet would move a URL's meaning
 * under it. Metros carry the prefix.
 */
/**
 * A side is `48453` (bare codes are counties), or a kind and an id joined by a
 * dot: `metro.41700`. A colon is accepted too, because `scopeId` writes one and
 * hand-built links exist — but it can only ever be read, never written: this
 * Next version's router rejects a colon inside a path segment before routing,
 * so `/compare/metro:41700-vs-metro:19100` 404s without the page being reached.
 * Query strings are unaffected, which is why `/api/brief?scope=county:48453`
 * keeps the colon form.
 */
function parseSide(raw: string): PlaceScope | null {
  const cut = ((): number => {
    const dot = raw.indexOf(".");
    const colon = raw.indexOf(":");
    if (dot < 0) return colon;
    if (colon < 0) return dot;
    return Math.min(dot, colon);
  })();
  const [head, tail] = cut >= 0 ? [raw.slice(0, cut), raw.slice(cut + 1)] : [null, raw];
  if (head === "county") return parseCountyParam(tail);
  if (head === "metro") return parseMetroParam(tail);
  if (head === "state") return parseStateParam(tail);
  if (head !== null) return null;
  return FIVE.test(tail) ? parseCountyParam(tail) : parseStateParam(tail);
}

/** "48453-vs-06037" or "metro.41700-vs-metro.19100"; null for a bad side or a self-pair. */
export function parseComparePair(raw: unknown): [PlaceScope, PlaceScope] | null {
  const pair = asParam(raw);
  if (!pair) return null;
  const parts = pair.split("-vs-");
  if (parts.length !== 2) return null;
  const left = parseSide(parts[0]);
  const right = parseSide(parts[1]);
  if (!left || !right) return null;
  return scopeId(left) === scopeId(right) ? null : [left, right];
}

/** "county:48453" - stable enough to be a series id, which is why it matches SERIES_ID_RE. */
export function scopeId(s: PlaceScope): string {
  return `${s.kind}:${s.id}`;
}

export function scopePath(s: PlaceScope): string {
  return s.kind === "county" ? `/place/${s.id}` : s.kind === "metro" ? `/metro/${s.id}` : `/state/${s.id}`;
}

export function scopeBriefPath(s: PlaceScope): string {
  return `${scopePath(s)}/brief`;
}

export function scopeLensBriefPath(s: PlaceScope, lens: string): string {
  return `${scopePath(s)}/brief/${lens}`;
}

/**
 * The full name. A provisional county has none - the manifest has not been
 * pulled - so it prints its FIPS and its state rather than inventing a name a
 * later render would contradict.
 */
export function scopeName(s: PlaceScope): string {
  if (s.kind === "county") {
    if (s.ref) return countyLabel(s.ref);
    const state = stateByFips(s.id.slice(0, 2));
    return state ? `FIPS ${s.id}, ${state.usps}` : `FIPS ${s.id}`;
  }
  return s.ref.name;
}

/** The name without its state tail: "Travis County", "Austin, TX" for a metro, "Texas". */
export function scopeShortName(s: PlaceScope): string {
  if (s.kind === "county") return s.ref ? s.ref.name : `FIPS ${s.id}`;
  if (s.kind === "state") return s.ref.name;
  const city = (s.ref.name.split(",")[0] ?? s.ref.name).split(/[-/]/)[0].trim();
  const state = s.ref.states[0];
  return state ? `${city}, ${state}` : city;
}

/** The point the manifest knows, or null for a provisional county whose centroid must come from upstream. */
export function scopeCentroid(s: PlaceScope): { lon: number; lat: number } | null {
  if (s.kind === "county") return s.ref ? { lon: s.ref.lon, lat: s.ref.lat } : null;
  return { lon: s.ref.lon, lat: s.ref.lat };
}
