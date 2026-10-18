// The offline identity layer. A county FIPS, a CBSA code or a USPS
// abbreviation resolves to a name, a state, a point and its neighbours here,
// synchronously, from three bundled tables - with no upstream call and no
// cache. That is the whole point of the module: URL validation, breadcrumbs,
// canonical links and sitemaps all need identity before any data source has
// been asked anything, and asking TIGERweb who county 48453 is before we can
// decide whether /place/48453 is a 404 would put a network round-trip in front
// of every crawler.
//
// This file imports the three JSON tables and nothing else. In particular it
// must never import lib/economy/sources.ts, which statically pulls ~4.4 MB of
// JSON into memory at module load; identity is needed on paths that have no
// business paying for that.
//
// The tables are built by scripts/places-data.mjs. states.json and metros.json
// are COMPLETE and derivable with zero network. counties.json is complete once
// the script's network pull has run (it has: 3,222 county equivalents, the 50
// states, DC and Puerto Rico), and while a build ever carries an incomplete
// table, every consumer must treat a missing county as "not pulled yet", not
// as "does not exist" - see MANIFEST.countiesComplete and lib/places/scope.ts.
//
// Ethics: places only. Names, states, Census internal points, CBSA membership
// and neighbouring counties. No addresses, no parcels, no people.

import countiesData from "./data/counties.json";
import metrosData from "./data/metros.json";
import statesData from "./data/states.json";

export interface CountyRef {
  geoid: string;
  name: string;
  stusab: string;
  stateFips: string;
  stateName: string;
  lon: number;
  lat: number;
  /**
   * The county's CBSA in OMB's July 2023 delineation: a metropolitan OR a
   * micropolitan code, null outside every CBSA. Only metropolitan codes have
   * a MetroRef, so resolve a metro through metroForCounty (or metroByCbsa),
   * never by assuming this code has a metro page.
   */
  cbsa: string | null;
  /** Neighbouring county GEOIDs, symmetric and sorted; empty in a seed build. */
  adj: string[];
}

export interface MetroRef {
  cbsa: string;
  /** Full OEWS title, e.g. "Austin-Round Rock-San Marcos, TX". */
  name: string;
  /** "principal city|ST", the same key shape lib/economy/sources.ts metroShortKey builds. */
  short: string;
  states: string[];
  /** Member county GEOIDs from OMB's July 2023 delineation; empty until the full pull has run. */
  counties: string[];
  lon: number;
  lat: number;
  zillowRegionId: string | null;
  /**
   * How zillowRegionId was found: "exact" (Zillow's RegionName is this title),
   * "short" (first principal city and state, "Austin, TX"), or "counties"
   * (the 2023 title no longer names Zillow's row, but Zillow's county file
   * files exactly this metro's counties under it). Never a shared code:
   * Zillow publishes none.
   */
  zillowMatchedBy: "exact" | "short" | "counties" | null;
}

export interface StateRef {
  fips: string;
  usps: string;
  name: string;
  lon: number;
  lat: number;
}

export interface ManifestMeta {
  /** Date of the last network pull, null when every table is offline-derived. */
  pulled: string | null;
  countiesComplete: boolean;
  metrosComplete: boolean;
  countyCount: number;
  metroCount: number;
  stateCount: number;
  /** How each county got its CBSA, in words, so a page can cite it. */
  cbsaMethod: string;
}

interface FileMeta {
  source: string;
  complete: boolean;
  pulled: string | null;
  count: number;
  cbsaMethod?: string;
  note?: string;
}

const countiesFile = countiesData as { meta: FileMeta; rows: CountyRef[] };
const metrosFile = metrosData as { meta: FileMeta; rows: MetroRef[] };
const statesFile = statesData as { meta: FileMeta; rows: StateRef[] };

const COUNTIES = countiesFile.rows;
const METROS = metrosFile.rows;
const STATES = statesFile.rows;

export const MANIFEST: ManifestMeta = {
  pulled: countiesFile.meta.pulled ?? metrosFile.meta.pulled,
  countiesComplete: countiesFile.meta.complete,
  metrosComplete: metrosFile.meta.complete,
  countyCount: COUNTIES.length,
  metroCount: METROS.length,
  stateCount: STATES.length,
  cbsaMethod: countiesFile.meta.cbsaMethod ?? "unrecorded",
};

const byGeoid = new Map<string, CountyRef>(COUNTIES.map((c) => [c.geoid, c]));
const byCbsa = new Map<string, MetroRef>(METROS.map((m) => [m.cbsa, m]));
const byUsps = new Map<string, StateRef>(STATES.map((s) => [s.usps, s]));
const byStateFips = new Map<string, StateRef>(STATES.map((s) => [s.fips, s]));

const nameOrder = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

// Membership is recorded twice - on the county as `cbsa` and on the metro as
// `counties` - because the pull writes both and a seed build has neither. Read
// them into one index so a partial table still answers what it can.
const cbsaOfCounty = new Map<string, string>();
for (const c of COUNTIES) if (c.cbsa) cbsaOfCounty.set(c.geoid, c.cbsa);
for (const m of METROS) for (const g of m.counties) if (!cbsaOfCounty.has(g)) cbsaOfCounty.set(g, m.cbsa);

const countiesOfCbsa = new Map<string, CountyRef[]>();
for (const [geoid, cbsa] of cbsaOfCounty) {
  const c = byGeoid.get(geoid);
  if (!c) continue;
  const list = countiesOfCbsa.get(cbsa);
  if (list) list.push(c);
  else countiesOfCbsa.set(cbsa, [c]);
}
for (const list of countiesOfCbsa.values()) list.sort(nameOrder);

const countiesOfState = new Map<string, CountyRef[]>();
for (const c of COUNTIES) {
  const list = countiesOfState.get(c.stusab);
  if (list) list.push(c);
  else countiesOfState.set(c.stusab, [c]);
}
for (const list of countiesOfState.values()) list.sort(nameOrder);

const metrosOfState = new Map<string, MetroRef[]>();
for (const m of METROS) {
  for (const usps of m.states) {
    const list = metrosOfState.get(usps);
    if (list) list.push(m);
    else metrosOfState.set(usps, [m]);
  }
}
for (const list of metrosOfState.values()) list.sort(nameOrder);

export function countyByFips(fips: string): CountyRef | null {
  return byGeoid.get(fips) ?? null;
}

export function metroByCbsa(cbsa: string): MetroRef | null {
  return byCbsa.get(cbsa) ?? null;
}

export function stateByUsps(usps: string): StateRef | null {
  return byUsps.get(usps.toUpperCase()) ?? null;
}

export function stateByFips(fips: string): StateRef | null {
  return byStateFips.get(fips) ?? null;
}

/** Counties sharing a border, sorted by name; empty when adjacency has not been pulled. */
export function neighbours(fips: string): CountyRef[] {
  const c = byGeoid.get(fips);
  if (!c) return [];
  return c.adj
    .map((g) => byGeoid.get(g))
    .filter((x): x is CountyRef => !!x)
    .sort(nameOrder);
}

export function countiesInMetro(cbsa: string): CountyRef[] {
  return countiesOfCbsa.get(cbsa) ?? [];
}

export function countiesInState(usps: string): CountyRef[] {
  return countiesOfState.get(usps.toUpperCase()) ?? [];
}

export function metrosInState(usps: string): MetroRef[] {
  return metrosOfState.get(usps.toUpperCase()) ?? [];
}

export function metroForCounty(fips: string): MetroRef | null {
  const cbsa = cbsaOfCounty.get(fips);
  return cbsa ? (byCbsa.get(cbsa) ?? null) : null;
}

export function allCountyFips(): string[] {
  return COUNTIES.map((c) => c.geoid).sort();
}

export function allCbsa(): string[] {
  return METROS.map((m) => m.cbsa).sort();
}

export function allUsps(): string[] {
  return STATES.map((s) => s.usps).sort();
}

/** "Travis County, TX" - the form a breadcrumb, a title and a citation all want. */
export function countyLabel(c: CountyRef): string {
  return `${c.name}, ${c.stusab}`;
}

/** True for the 52 two-digit state FIPS prefixes, which is what makes a county URL structurally checkable without the county table. */
export function isKnownStateFips(twoDigits: string): boolean {
  return byStateFips.has(twoDigits);
}
