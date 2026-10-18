// The county storm-events bake (scripts/bake-storm-events.mjs writes it to
// lib/hazards/data/storm-events/; /api/hazards?op=history&part=storms reads
// one state's shard). Pure and import-free with only erasable TypeScript, so
// node runs it by type stripping and vitest loads it directly, as bake.ts.
//
//   <ss>.json   one state's counties: event reports per year per event type
//   meta.json   the national tallies the route's zone-share gate reads, the
//               files read (with their c stamps and sha256), and every row
//               that was not attached, by year and why
//
// Source: NOAA NCEI's Storm Events Database details files, one per year,
// 1996 onward (the year NCEI's scope widened to all event types). Only the
// columns YEAR, EVENT_TYPE, CZ_TYPE, STATE_FIPS, CZ_FIPS, CZ_NAME and
// BEGIN_YEARMONTH are read: never the narratives, the casualty or damage
// columns, the source or the locations.
//
// A row counts once in a county when it is county-coded (CZ_TYPE C), is not a
// Tornado (SPC's record owns tornadoes), and its code and its name agree with
// the county (see stormCountyOf). Zone-coded rows (CZ_TYPE Z) are never
// attached, because forecast zones cross county lines and NWS publishes its
// zone-county table only for 2025-2026; they are tallied per year and type so
// the route can blank a type's year when STORM_ZONE_SHARE_MAX (10 %) or more of its rows were zone-coded.
// The output is a pure function of the input bytes: no clock, sorted keys.

export interface StormCountyRef {
  geoid: string;
  name: string;
  stusab: string;
}

export const STORM_DIR = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";
/** The first year of NCEI's all-event-types scope (1950-1954 tornado only, 1955-1995 tornado, hail and wind). */
export const STORM_FIRST_YEAR = 1996;
export const STORM_FILE_RE = /StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz/g;

export const CENSUS_CHANGES_2010 = "https://www.census.gov/programs-surveys/geography/technical-documentation/county-changes.2010.html";
export const CENSUS_CHANGES_1990 = "https://www.census.gov/programs-surveys/geography/technical-documentation/county-changes.1990.html";

/**
 * NCEI's own state codes that are not FIPS. Puerto Rico is 99 in Storm Events and 72 in FIPS; whether
 * a 99 row's CZ_FIPS is the municipio code is decided by the name check, never by the code alone
 * (1996's 99 rows are NCEI's own multi-municipio areas, "FAJARDO RIO GRANDE").
 */
export const STORM_STATE_CODES: Readonly<Record<string, string>> = { "99": "72" };
/** NCEI state codes for territories with no county equivalent in the globe's geography. */
export const STORM_NOT_COUNTY_STATES: Readonly<Record<string, string>> = { "96": "U.S. Virgin Islands", "97": "American Samoa", "98": "Guam" };
/** Event types left out of the series, and why. */
export const STORM_EXCLUDED_TYPES: Readonly<Record<string, string>> = { Tornado: "SPC's tornado record owns tornadoes (one row per county segment here would double-count)" };

/** Connecticut's legacy counties (Census), which Storm Events still codes; current geography uses planning regions. */
export const STORM_CT_LEGACY: Readonly<Record<string, string>> = {
  "09001": "Fairfield",
  "09003": "Hartford",
  "09005": "Litchfield",
  "09007": "Middlesex",
  "09009": "New Haven",
  "09011": "New London",
  "09013": "Tolland",
  "09015": "Windham",
};

/** Census-documented changes of name and code with the same boundary: a row under the old code is the new county's. */
export const STORM_RENAMES: ReadonlyArray<{ from: string; to: string; oldName: string; what: string; citation: string }> = [
  { from: "12025", to: "12086", oldName: "Dade", what: "Dade County, FL renamed Miami-Dade County (1997-07-22), new code", citation: CENSUS_CHANGES_1990 },
  { from: "46113", to: "46102", oldName: "Shannon", what: "Shannon County, SD renamed Oglala Lakota County (2015-05-01), new code", citation: CENSUS_CHANGES_2010 },
  { from: "02270", to: "02158", oldName: "Wade Hampton", what: "Wade Hampton Census Area, AK renamed Kusilvak Census Area (2015-07-01), new code", citation: CENSUS_CHANGES_2010 },
];

/**
 * Current counties whose boundary changed since 2010 (the same six as lib/hazards/bake.ts's
 * BOUNDARY_CHANGED_SINCE_2010, with the year). An event count belongs to the county as it was that
 * year, so the rows are kept and the series carries a break at that year.
 */
export const STORM_BREAKS: Readonly<Record<string, { year: number; what: string }>> = {
  "02063": { year: 2019, what: "Chugach Census Area, created in 2019 from Valdez-Cordova Census Area" },
  "02066": { year: 2019, what: "Copper River Census Area, created in 2019 from Valdez-Cordova Census Area" },
  "02105": { year: 2013, what: "Hoonah-Angoon Census Area, part taken for the new Petersburg Borough in 2013" },
  "02195": { year: 2013, what: "Petersburg Borough, created in 2013 from Petersburg Census Area with a changed boundary" },
  "02198": { year: 2013, what: "Prince of Wales-Hyder Census Area, added part of the former Petersburg Census Area in 2013" },
  "51019": { year: 2013, what: "Bedford County, VA, absorbed the former independent city of Bedford in 2013" },
};

/** The columns read; every other column (narratives, casualties, damage, source, locations) is skipped unread. */
export const STORM_COLUMNS = ["YEAR", "EVENT_TYPE", "CZ_TYPE", "STATE_FIPS", "CZ_FIPS", "CZ_NAME", "BEGIN_YEARMONTH"] as const;

/** The details files from NCEI's directory listing, 1996 onward, the newest compilation (c stamp) per year. */
export function stormFiles(listing: string, firstYear = STORM_FIRST_YEAR): Array<{ year: number; file: string; stamp: string; url: string }> {
  const best = new Map<number, { file: string; stamp: string }>();
  for (const m of listing.matchAll(STORM_FILE_RE)) {
    const year = Number(m[1]);
    if (year < firstYear) continue;
    const cur = best.get(year);
    if (!cur || m[2] > cur.stamp) best.set(year, { file: m[0], stamp: m[2] });
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([year, x]) => ({ year, ...x, url: `${STORM_DIR}${x.file}` }));
}

// ---------------------------------------------------------------- the name check

const SUFFIX = /\b(COUNTY|PARISH|BOROUGH|CENSUS AREA|MUNICIPIO|MUNICIPALITY|CITY AND BOROUGH|CITY|CO|PAR|BORO)\b/g;

/** A county name folded for comparison: accents dropped, upper case, SAINT to ST, the county-type words removed, letters only. */
export function foldCountyName(s: string): string {
  const a = (s ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toUpperCase()
    .replace(/SAINT/g, "ST")
    .replace(/STE\./g, "ST");
  return a.replace(SUFFIX, "").replace(/[^A-Z]/g, "");
}

/**
 * Whether NCEI's CZ_NAME names the county: either folded name starts with the other's first five
 * letters (NCEI truncates, "DORAD" for Dorado). Loose by design (a same-state pair sharing five
 * letters, HARRIS and HARRISON, would pass), but it is what catches 1996's Puerto Rico areas and
 * 2025's Georgia rows whose county code is a zone number.
 */
export function stormNamesAgree(ncei: string, county: string): boolean {
  const a = foldCountyName(ncei);
  const b = foldCountyName(county);
  return b.startsWith(a.slice(0, 5)) || a.startsWith(b.slice(0, 5));
}

export type StormAttach =
  | { kind: "county"; code: string; renamedFrom?: string }
  | { kind: "legacy-ct"; code: string }
  | { kind: "name-mismatch"; code: string; countyName: string }
  | { kind: "not-county"; label: string }
  | { kind: "unmatched"; code: string };

/**
 * Where a county-coded row goes. STATE_FIPS 99 is read as 72; 96-98 are territories with no county
 * (not-county). The code must be a current county (or a Census rename's old code) and the folded
 * CZ_NAME must agree with its name (or the rename's old name); a Connecticut legacy code must agree
 * with its legacy county name and is kept under that code. Anything else is listed, never attached.
 */
export function stormCountyOf(stateFips: string, czFips: string, czName: string, names: ReadonlyMap<string, string>): StormAttach {
  const st0 = stateFips.trim().padStart(2, "0");
  if (st0 in STORM_NOT_COUNTY_STATES) return { kind: "not-county", label: `${st0} ${STORM_NOT_COUNTY_STATES[st0]}` };
  const st = STORM_STATE_CODES[st0] ?? st0;
  const cz = czFips.trim();
  if (!/^\d{1,3}$/.test(cz)) return { kind: "unmatched", code: `${st}${cz}` };
  const raw = `${st}${cz.padStart(3, "0")}`;
  const ct = STORM_CT_LEGACY[raw];
  if (ct) return stormNamesAgree(czName, ct) ? { kind: "legacy-ct", code: raw } : { kind: "name-mismatch", code: raw, countyName: ct };
  const rn = STORM_RENAMES.find((r) => r.from === raw);
  const code = rn ? rn.to : raw;
  const name = names.get(code);
  if (name == null) return { kind: "unmatched", code: raw };
  if (stormNamesAgree(czName, name) || (rn != null && stormNamesAgree(czName, rn.oldName))) return rn ? { kind: "county", code, renamedFrom: raw } : { kind: "county", code };
  return { kind: "name-mismatch", code: raw, countyName: name };
}

// ---------------------------------------------------------------- a streaming CSV reader

/**
 * RFC 4180 rows from text pushed in chunks: quoted fields may hold commas, doubled quotes and
 * newlines (Storm Events' narratives do), and a chunk may end anywhere, even inside a quote.
 */
export function csvStream(onRow: (row: string[]) => void): { push: (chunk: string) => void; end: () => void } {
  let field = "";
  let row: string[] = [];
  let inQuote = false;
  let afterQuote = false;
  let sawAny = false;
  const special = /[",\r\n]/g;
  const endRow = () => {
    row.push(field);
    field = "";
    const r = row;
    row = [];
    sawAny = false;
    if (!(r.length === 1 && r[0] === "")) onRow(r);
  };
  const push = (s: string) => {
    let i = 0;
    while (i < s.length) {
      if (inQuote) {
        const j = s.indexOf('"', i);
        if (j < 0) {
          field += s.slice(i);
          return;
        }
        field += s.slice(i, j);
        inQuote = false;
        afterQuote = true;
        i = j + 1;
        continue;
      }
      special.lastIndex = i;
      const m = special.exec(s);
      const j = m ? m.index : s.length;
      if (j > i) {
        field += s.slice(i, j);
        afterQuote = false;
        sawAny = true;
      }
      if (!m) return;
      const c = s[j];
      i = j + 1;
      if (c === '"') {
        if (afterQuote) field += '"';
        inQuote = true;
        afterQuote = false;
        sawAny = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
        afterQuote = false;
        sawAny = true;
      } else if (c === "\n") {
        afterQuote = false;
        endRow();
      } else afterQuote = false; // \r, dropped outside quotes
    }
  };
  const end = () => {
    if (sawAny || field || row.length) endRow();
  };
  return { push, end };
}

// ---------------------------------------------------------------- the accumulator

type Tally = Record<string, Record<string, number>>;

export interface StormFileMeta {
  year: number;
  file: string;
  stamp: string;
  url: string;
  sha256: string | null;
  bytes: number | null;
  rows: number;
  malformedRows: number;
  lastYearMonth: string | null;
}

export interface StormShard {
  state: string;
  /** Indexes into meta.types. */
  counties: Record<string, Record<string, Record<string, number>>>;
}

export interface StormMeta {
  what: string;
  source: string;
  credit: string;
  dir: string;
  columnsRead: readonly string[];
  firstYear: number | null;
  lastYear: number | null;
  /** BEGIN_YEARMONTH of the newest row in the newest file. */
  lastYearMonth: string | null;
  files: StormFileMeta[];
  /** The county-coded, non-tornado event types seen, sorted; shard type indexes point here. */
  types: string[];
  /** County-coded rows nationally per year per type (before the name check), for the zone-share gate. */
  countyRows: Tally;
  /** Zone-coded rows nationally per year per type: tallied, never attached. */
  zoneRows: Tally;
  /** County-coded rows of an excluded type per year (Tornado). */
  excludedTypeRows: Tally;
  /** Rows with any other CZ_TYPE per year, by CZ_TYPE. */
  otherCzType: Tally;
  /** County-coded rows of a territory with no county equivalent, per year. */
  notCounty: Tally;
  /** County-coded rows whose name disagrees with the code's county: [code, CZ_NAME, county name, rows], per year. */
  nameMismatch: Record<string, Array<[string, string, string, number]>>;
  /** County-coded rows whose code names no current county: [code, CZ_NAME, rows], per year. */
  unmatched: Record<string, Array<[string, string, number]>>;
  /** Connecticut legacy codes kept under their own code (current geography uses planning regions). */
  legacyCt: string[];
  renamed: Array<{ from: string; to: string; what: string; citation: string; rows: number }>;
  breaks: Record<string, { year: number; what: string }>;
  attachedRows: number;
  counties: number;
  shards: string[];
  generatedBy: string;
}

const sortKeys = <V>(o: Record<string, V>): Record<string, V> => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const bump = (t: Tally, a: string, b: string, n = 1) => {
  const x = (t[a] ??= {});
  x[b] = (x[b] ?? 0) + n;
};
const sortTally = (t: Tally): Tally => sortKeys(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, sortKeys(v)])));

/**
 * The bake, one file at a time: beginFile, then each CSV row (the header first), then endFile;
 * result() at the end. Only a {county: {year: {type: n}}} accumulator and the tallies are held.
 */
export function stormBaker(counties: readonly StormCountyRef[]) {
  const names = new Map(counties.map((c) => [c.geoid, c.name]));
  const perCounty = new Map<string, Map<string, Map<string, number>>>();
  const countyRows: Tally = {};
  const zoneRows: Tally = {};
  const excludedTypeRows: Tally = {};
  const otherCzType: Tally = {};
  const notCounty: Tally = {};
  const mismatch = new Map<string, number>();
  const unmatched = new Map<string, number>();
  const renamedRows = new Map<string, number>();
  const legacy = new Set<string>();
  const files: StormFileMeta[] = [];
  let cur: StormFileMeta | null = null;
  let idx: Record<string, number> | null = null;
  let width = 0;
  let attached = 0;

  const beginFile = (f: { year: number; file: string; stamp: string; url: string }) => {
    cur = { ...f, sha256: null, bytes: null, rows: 0, malformedRows: 0, lastYearMonth: null };
    idx = null;
  };
  const row = (r: string[]) => {
    if (!cur) throw new Error("stormBaker: row before beginFile");
    if (!idx) {
      const h = r.map((x) => x.replace(/^﻿/, "").trim());
      idx = {};
      for (const c of STORM_COLUMNS) {
        const i = h.indexOf(c);
        if (i < 0) throw new Error(`${cur.file}: no ${c} column`);
        idx[c] = i;
      }
      width = h.length;
      return;
    }
    if (r.length !== width) {
      cur.malformedRows++;
      return;
    }
    cur.rows++;
    const year = r[idx.YEAR].trim();
    const type = r[idx.EVENT_TYPE].trim();
    const cz = r[idx.CZ_TYPE].trim();
    const ym = r[idx.BEGIN_YEARMONTH].trim();
    if (!cur.lastYearMonth || ym > cur.lastYearMonth) cur.lastYearMonth = ym;
    if (cz === "Z") {
      bump(zoneRows, year, type);
      return;
    }
    if (cz !== "C") {
      bump(otherCzType, year, cz || "(blank)");
      return;
    }
    if (type in STORM_EXCLUDED_TYPES) {
      bump(excludedTypeRows, year, type);
      return;
    }
    bump(countyRows, year, type);
    const a = stormCountyOf(r[idx.STATE_FIPS], r[idx.CZ_FIPS], r[idx.CZ_NAME], names);
    if (a.kind === "not-county") {
      bump(notCounty, year, a.label);
      return;
    }
    if (a.kind === "name-mismatch") {
      const k = `${year}\u0000${a.code}\u0000${r[idx.CZ_NAME].trim()}\u0000${a.countyName}`;
      mismatch.set(k, (mismatch.get(k) ?? 0) + 1);
      return;
    }
    if (a.kind === "unmatched") {
      const k = `${year}\u0000${a.code}\u0000${r[idx.CZ_NAME].trim()}`;
      unmatched.set(k, (unmatched.get(k) ?? 0) + 1);
      return;
    }
    if (a.kind === "legacy-ct") legacy.add(a.code);
    if (a.kind === "county" && a.renamedFrom) renamedRows.set(a.renamedFrom, (renamedRows.get(a.renamedFrom) ?? 0) + 1);
    let ys = perCounty.get(a.code);
    if (!ys) perCounty.set(a.code, (ys = new Map()));
    let ts = ys.get(year);
    if (!ts) ys.set(year, (ts = new Map()));
    ts.set(type, (ts.get(type) ?? 0) + 1);
    attached++;
  };
  const endFile = (x: { sha256: string | null; bytes: number | null }) => {
    if (!cur) throw new Error("stormBaker: endFile before beginFile");
    files.push({ ...cur, ...x });
    cur = null;
  };

  const result = (): { meta: StormMeta; shards: Record<string, StormShard> } => {
    const types = [...new Set([...perCounty.values()].flatMap((ys) => [...ys.values()].flatMap((ts) => [...ts.keys()])))].sort();
    const ti = new Map(types.map((t, i) => [t, i]));
    const shards: Record<string, StormShard> = {};
    for (const code of [...perCounty.keys()].sort()) {
      const st = code.slice(0, 2);
      const sh = (shards[st] ??= { state: st, counties: {} });
      const ys = perCounty.get(code)!;
      sh.counties[code] = Object.fromEntries(
        [...ys.keys()].sort().map((y) => {
          const ts = ys.get(y)!;
          return [y, Object.fromEntries([...ts.entries()].map(([t, n]) => [String(ti.get(t)), n] as [string, number]).sort((a, b) => Number(a[0]) - Number(b[0])))];
        }),
      );
    }
    const byYear = <T,>(m: Map<string, number>, mk: (parts: string[], n: number) => T, cmp: (a: T, b: T) => number) => {
      const out: Record<string, T[]> = {};
      for (const [k, n] of m) {
        const parts = k.split("\u0000");
        (out[parts[0]] ??= []).push(mk(parts.slice(1), n));
      }
      for (const v of Object.values(out)) v.sort(cmp);
      return sortKeys(out);
    };
    const years = files.map((f) => f.year);
    const newest = files.length ? files.reduce((a, b) => (b.year > a.year ? b : a)) : null;
    return {
      meta: {
        what: "A derivation, not an upstream file: NCEI Storm Events details files counted as event reports per county per year per event type. A row counts when it is county-coded (CZ_TYPE C), is not a Tornado (SPC's record owns tornadoes) and its STATE_FIPS + CZ_FIPS (99 read as 72) and its CZ_NAME agree with a current county (or a Connecticut legacy county, kept under its own code, or a Census rename's old code and name). Zone-coded rows are tallied per year and type and never attached.",
        source: "NOAA National Centers for Environmental Information, Storm Events Database, details files (US federal work)",
        credit: "NOAA National Centers for Environmental Information, Storm Events Database",
        dir: STORM_DIR,
        columnsRead: STORM_COLUMNS,
        firstYear: years.length ? Math.min(...years) : null,
        lastYear: years.length ? Math.max(...years) : null,
        lastYearMonth: newest?.lastYearMonth ?? null,
        files: [...files].sort((a, b) => a.year - b.year),
        types,
        countyRows: sortTally(countyRows),
        zoneRows: sortTally(zoneRows),
        excludedTypeRows: sortTally(excludedTypeRows),
        otherCzType: sortTally(otherCzType),
        notCounty: sortTally(notCounty),
        nameMismatch: byYear(mismatch, (p, n) => [p[0], p[1], p[2], n] as [string, string, string, number], (a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : a[0] + a[1] > b[0] + b[1] ? 1 : 0)),
        unmatched: byYear(unmatched, (p, n) => [p[0], p[1], n] as [string, string, number], (a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : a[0] + a[1] > b[0] + b[1] ? 1 : 0)),
        legacyCt: [...legacy].sort(),
        renamed: STORM_RENAMES.filter((r) => renamedRows.has(r.from)).map((r) => ({ from: r.from, to: r.to, what: r.what, citation: r.citation, rows: renamedRows.get(r.from)! })),
        breaks: sortKeys(Object.fromEntries(Object.entries(STORM_BREAKS).filter(([k]) => perCounty.has(k)).map(([k, v]) => [k, { ...v }]))),
        attachedRows: attached,
        counties: perCounty.size,
        shards: Object.keys(shards).sort(),
        generatedBy: "scripts/bake-storm-events.mjs",
      },
      shards,
    };
  };

  return { beginFile, row, endFile, result };
}
