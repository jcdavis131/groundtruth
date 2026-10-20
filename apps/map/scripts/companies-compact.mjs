// Packs the companies snapshot into the committed on-disk format
// ("companies/2-compact") so the full EDGAR universe fits under the repo's
// 5 MB tracked-file limit (scripts/guard.mjs) without dropping anything.
//
// What changes on disk, and nothing else:
//   - a company is a row in `columns` order instead of an object with keys
//   - a fact is a tuple [conceptKeyIndex, value, period, end, accn, conceptIndex]
//     with the XBRL concept names in a table; a fact that is null is left out
//     (absent tuple = no fact, which the decoder turns back into null)
//   - the per-company `pulled` is dropped where it equals the bundle's `pulled`;
//     a company pulled on another day (a resumed build across midnight) keeps
//     its date in `pulledByCik`
//   - a missing accn or concept is written as null and read back as absent
//
// Anything the format cannot hold losslessly (an unexpected key, a per-company
// fact carrying filed or form)
// throws instead of being dropped. The decoder is lib/companies/bundle.ts;
// keep the two in step.
//
//   node scripts/companies-compact.mjs <full.json> [out.json]   pack a full-format bundle and check it round-trips
//   node scripts/companies-compact.mjs <full.json> --write-full <us-placed.json>
//                                       also write the full-format bundle after US-only placement and place
//                                       reasons, one line, as the dataset copy (data/hf/publish.py uploads it)
//
// Before packing, the CLI applies usOnlyPlacement (below) and records that in
// the bundle's source line; the round trip is checked against the result.
//
// A full file written before `geoReason` existed (the 2026-10-20 pull) gets
// it from placeReason below: derived from the zip, countyFips and lon/lat the
// record already carries, never guessed. companies-data.mjs writes the exact
// cause at build time instead.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const COMPACT_FORMAT = "companies/2-compact";

// USPS codes that mean a US business address: the 50 states, DC and PR from
// lib/places/data/states.json, plus the four other inhabited territories that
// table leaves out. Anything else in `state` (null, or an EDGAR country code
// such as 2M for Germany) is an address outside the US. bundle.test.ts checks
// this set against US_POSTAL_CODES in lib/fabric/regions.ts.
export const US_STATE_CODES = new Set([
  ...JSON.parse(fs.readFileSync(new URL("../lib/places/data/states.json", import.meta.url), "utf8")).rows.map((r) => r.usps),
  "GU", "VI", "AS", "MP",
]);

export const COLUMNS = ["cik", "name", "ticker", "exchange", "sic", "sicDescription", "state", "city", "zip", "countyFips", "lon", "lat", "geo", "fiscalYearEnd", "stateOfIncorporation", "geoReason"];

// Same order as lib/companies/facts.ts CONCEPTS.
export const FACT_KEYS = ["Revenues", "NetIncomeLoss", "OperatingIncomeLoss", "Assets", "StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "LongTermDebt", "EntityNumberOfEmployees"];

const FACT_FIELDS = ["value", "period", "end", "accn", "concept"];
const RECORD_KEYS = new Set([...COLUMNS, "facts", "pulled"]);

/**
 * Why a record has no map position, from what it already carries: null when
 * placed. A record without a five-digit ZIP may have had none in SEC
 * submissions or a non-US postcode the build could not use; the record does
 * not say which, so the reason names only what is known.
 */
export function placeReason(c) {
  if (c.lon != null && c.lat != null) return null;
  if (c.zip == null) return "no US five-digit business-address ZIP in SEC submissions";
  if (c.state == null || !US_STATE_CODES.has(c.state)) return `business address outside the US (postcode ${c.zip})`;
  if (c.countyFips == null) return `ZIP ${c.zip} is not a 2020 Census ZCTA`;
  return `TIGERweb returned no centroid for ZCTA ${c.zip}`;
}

export const US_ONLY_NOTE =
  "Placement is US-only: a filer whose business-address state is not a US state or territory code has no position (geoReason says so); for the 2026-10-20 pull this was applied after the pull by scripts/companies-compact.mjs.";

/**
 * Missing means missing: a foreign postcode that happens to match a US ZCTA
 * (Banco Santander, Madrid 28660) is a false point. The 2026-10-20 pull placed
 * 50 such filers before companies-data.mjs learned the rule; this unplaces
 * them the same way the build now does (lon, lat, countyFips, geo null) and
 * says so in the source line. Records already built under the rule pass through.
 */
export function usOnlyPlacement(full) {
  let changed = 0;
  const companies = full.companies.map((c) => {
    if (c.lon == null || (c.state != null && US_STATE_CODES.has(c.state))) return c;
    changed++;
    const out = { ...c, countyFips: null, lon: null, lat: null, geo: null };
    if ("geoReason" in c) out.geoReason = `business address outside the US (postcode ${c.zip})`;
    return out;
  });
  if (!changed) return { bundle: full, changed };
  const geocoded = companies.filter((c) => c.lon != null).length;
  const source = full.source.includes(US_ONLY_NOTE) ? full.source : `${full.source}. ${US_ONLY_NOTE}`;
  return { bundle: { ...full, source, counts: { ...full.counts, geocoded }, companies }, changed };
}

/** Adds `geoReason` from placeReason to records that lack it, in column order (after stateOfIncorporation). */
export function withPlaceReasons(full) {
  return {
    ...full,
    companies: full.companies.map((c) => {
      if ("geoReason" in c) return c;
      const out = {};
      for (const [k, v] of Object.entries(c)) {
        out[k] = v;
        if (k === "stateOfIncorporation") out.geoReason = placeReason(c);
      }
      return out;
    }),
  };
}

/** Full-format bundle -> compact bundle. Throws rather than lose a value. */
export function encodeBundle(full) {
  const concepts = [];
  const conceptIndex = new Map();
  const pulledByCik = {};
  const companies = full.companies.map((c) => {
    for (const k of Object.keys(c)) if (!RECORD_KEYS.has(k)) throw new Error(`cik ${c.cik}: key ${k} has no place in ${COMPACT_FORMAT}`);
    for (const k of RECORD_KEYS) if (!(k in c)) throw new Error(`cik ${c.cik}: key ${k} missing; ${COMPACT_FORMAT} cannot tell absent from null`);
    if (c.pulled !== full.pulled) pulledByCik[c.cik] = c.pulled;
    const facts = [];
    for (const [key, f] of Object.entries(c.facts ?? {})) {
      const ki = FACT_KEYS.indexOf(key);
      if (ki < 0) throw new Error(`cik ${c.cik}: fact key ${key} unknown`);
      if (f == null) continue;
      for (const k of Object.keys(f)) if (!FACT_FIELDS.includes(k)) throw new Error(`cik ${c.cik}: ${key}.${k} has no place in ${COMPACT_FORMAT}`);
      if (typeof f.value !== "number" || typeof f.period !== "string" || typeof f.end !== "string") throw new Error(`cik ${c.cik}: ${key} lacks value, period or end`);
      let ci = null;
      if (f.concept != null) {
        ci = conceptIndex.get(f.concept);
        if (ci == null) {
          ci = concepts.length;
          concepts.push(f.concept);
          conceptIndex.set(f.concept, ci);
        }
      }
      facts.push([ki, f.value, f.period, f.end, f.accn ?? null, ci]);
    }
    return [...COLUMNS.map((k) => c[k]), facts];
  });
  return {
    format: COMPACT_FORMAT,
    source: full.source,
    pulled: full.pulled,
    counts: full.counts,
    ...(full.frameYears ? { frameYears: full.frameYears } : {}),
    columns: COLUMNS,
    factKeys: FACT_KEYS,
    factFields: ["conceptKey", ...FACT_FIELDS],
    concepts,
    ...(Object.keys(pulledByCik).length ? { pulledByCik } : {}),
    companies,
  };
}

/** Compact bundle -> full-format bundle. Mirrors lib/companies/bundle.ts decodeBundle. */
export function decodeBundle(b) {
  if (b.format !== COMPACT_FORMAT) return b;
  return {
    source: b.source,
    pulled: b.pulled,
    counts: b.counts,
    ...(b.frameYears ? { frameYears: b.frameYears } : {}),
    companies: b.companies.map((row) => {
      const rec = {};
      b.columns.forEach((k, i) => (rec[k] = row[i]));
      const facts = Object.fromEntries(b.factKeys.map((k) => [k, null]));
      for (const [ki, value, period, end, accn, ci] of row[b.columns.length]) {
        const f = { value, period, end };
        if (accn != null) f.accn = accn;
        if (ci != null) f.concept = b.concepts[ci];
        facts[b.factKeys[ki]] = f;
      }
      rec.facts = facts;
      rec.pulled = b.pulledByCik && rec.cik in b.pulledByCik ? b.pulledByCik[rec.cik] : b.pulled;
      return rec;
    }),
  };
}

/** First path where a and b differ, or null. */
export function firstDifference(a, b, at = "$") {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return at;
  if (Array.isArray(a) !== Array.isArray(b)) return at;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${at} keys`;
  for (const k of ka) {
    const d = firstDifference(a[k], b[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const argv = process.argv.slice(2);
  const wf = argv.indexOf("--write-full");
  const fullOut = wf >= 0 ? argv[wf + 1] : undefined;
  if (wf >= 0 && !fullOut) throw new Error("--write-full needs a path");
  const [inPath, outPath] = wf < 0 ? argv : argv.filter((a, i) => i !== wf && i !== wf + 1);
  if (!inPath) throw new Error("usage: node scripts/companies-compact.mjs <full.json> [out.json] [--write-full <us-placed.json>]");
  const pulled = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const us = usOnlyPlacement(pulled);
  console.log(`US-only placement: ${us.changed} placed filers with a non-US business address unplaced (geocoded ${pulled.counts.geocoded} -> ${us.bundle.counts.geocoded})`);
  const full = withPlaceReasons(us.bundle);
  const compact = encodeBundle(full);
  const text = JSON.stringify(compact) + "\n";
  const diff = firstDifference(decodeBundle(JSON.parse(text)), full);
  const facts = full.companies.reduce((n, c) => n + Object.values(c.facts).filter((v) => v != null).length, 0);
  console.log(`${full.companies.length} companies, ${facts} facts, ${concepts(compact)} concepts; compact ${Buffer.byteLength(text)} bytes (full ${fs.statSync(inPath).size})`);
  if (diff) throw new Error(`round trip differs at ${diff}; nothing written`);
  console.log("round trip: decode(compact) deep-equals the full file after US-only placement and place reasons, every company and fact");
  const reasons = {};
  for (const c of full.companies) if (c.geoReason) reasons[c.geoReason.replace(/\d{5}/, "<zip>")] = (reasons[c.geoReason.replace(/\d{5}/, "<zip>")] ?? 0) + 1;
  console.log(`unplaced by reason: ${JSON.stringify(reasons)}`);
  if (outPath) {
    fs.writeFileSync(outPath, text);
    console.log(`wrote ${outPath}`);
  }
  if (fullOut) {
    // The same records the compact file decodes to, in full format, one line: the copy that leaves the repo.
    const fullText = JSON.stringify(full) + "\n";
    fs.writeFileSync(fullOut, fullText);
    console.log(`wrote ${fullOut} (${Buffer.byteLength(fullText)} bytes, geocoded ${full.counts.geocoded})`);
  }
}

function concepts(c) {
  return c.concepts.length;
}
