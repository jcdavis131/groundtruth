// Writes the committed breaks/1 files in data/breaks (schema: data/breaks/breaks.schema.json):
// the cut points a styled layer bins against, with the publisher's URL, the retrieval time and
// the sha256 of what was fetched. 44 files: the 40 CDC PLACES county measures (layer "health")
// and the four place exports (npl-status, ust-releases-county, ust-facilities-county,
// fuds-properties), each by its headline measure.
//
//   node scripts/export-breaks.mjs                       fetch the 40 PLACES county pulls (at most one request per
//                                                        1.1 s), write data/breaks/inputs/health/*.json and every
//                                                        breaks file
//   node scripts/export-breaks.mjs --offline             rewrite every breaks file from the committed inputs, no
//                                                        network, and say which bytes changed (none, on a clean tree)
//   node scripts/export-breaks.mjs --offline --check     the same in memory: exit 1 if any file differs, write nothing
//   node scripts/export-breaks.mjs --recompute DIABETES  refetch one PLACES measure from the URL its breaks file
//                                                        cites; print the sha256 it gets and the breaks it computes
//                                                        beside the committed ones; exit 1 if they differ
//
// PLACES: the input is the county pull the app itself asks for (countyMeasureUrl in lib/civic/places.ts, one
// whole-measure pull, age-adjusted). The fetched body's url, time, last-modified and sha256 are kept with the
// county values it holds (data/breaks/inputs/health/<MEASURE>.json, compact: 2,957 FIPS and values), so the file
// can be recomputed offline; the breaks are quintiles() from lib/civic/places.ts, the function the app has always
// used, so the rule and the code cannot differ.
//
// Place exports: nothing is refetched. The input is the committed export (lib/catalog/data/*.json), whose meta
// already carries the publisher's layer URL, fetchedAt and the sha256 of every page it fetched; the breaks file
// cites those pages and the sha256 of the committed export. The county join behind each export is its own
// script's (export-npl-county.mjs and the others); redoing it here would be a second copy.
//
// Offline runs copy retrievedAt, lastModified and sha256 from the input, never the clock, which is why a rerun on the
// committed inputs is byte-identical.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countyMeasureUrl, parsePlaces, PLACES_MEASURES, quintiles } from "../lib/civic/places.ts";
import { USER_AGENT } from "../lib/server/ua.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BREAKS = "data/breaks";
const COUNTIES = "lib/places/data/counties.json";
/** At most one request per second, with margin. */
const MIN_GAP_MS = 1100;

export const METHODS = {
  "quintile-nearest-rank":
    "Sort the published values ascending (n of them); breaks[i] = sorted[min(n-1, floor(q*n))] for q = 0.2, 0.4, 0.6, 0.8. A value's bin is the number of breaks it is at or above, 0 to 4.",
  "zero-bin-quartile-nearest-rank":
    "Bin 0 is the value 0. Sort the nonzero values ascending (m of them); breaks = the smallest nonzero value, then sorted[min(m-1, floor(q*m))] for q = 0.25, 0.5, 0.75, with a repeated cut point dropped so the breaks rise strictly. A value's bin is the number of breaks it is at or above.",
};

/** The four place exports: the committed file each is computed from and the one measure its breaks file carries. */
export const EXPORTS = [
  {
    layer: "npl-status",
    file: "lib/catalog/data/npl-county.json",
    feature: "npl_active",
    year: 2025,
    period: "year-end 2025",
    valueType: "count of NPL sites listed by December 31 and not deleted by then",
    universe:
      "US counties and county equivalents in the committed county table (50 states, DC and Puerto Rico; TIGERweb ACS2023) with a value for active NPL sites at year-end 2025: 0 where EPA lists no site there (the NPL list is complete), null where a site could be in the county but EPA's county string did not place it",
  },
  {
    layer: "ust-releases-county",
    file: "lib/catalog/data/ust-releases-county.json",
    feature: "ust_release_count",
    year: null,
    period: "state records as of 2018-2021, tribal records to October 2025",
    valueType: "count of reported leaking underground storage tank releases",
    universe:
      "US counties and county equivalents in the committed county table (50 states, DC and Puerto Rico; TIGERweb ACS2023) that EPA UST Finder has a county row for; a county with no row is null",
  },
  {
    layer: "ust-facilities-county",
    file: "lib/catalog/data/ust-facilities-county.json",
    feature: "ust_facility_count",
    year: null,
    period: "state records as of 2018-2021, tribal records to October 2025",
    valueType: "count of underground storage tank facilities",
    universe:
      "US counties and county equivalents in the committed county table (50 states, DC and Puerto Rico; TIGERweb ACS2023) that EPA UST Finder has a county row for; a county with no row is null",
  },
  {
    layer: "fuds-properties",
    file: "lib/catalog/data/fuds-county.json",
    feature: "fuds_properties",
    year: null,
    period: "FUDS inventory, fiscal year 2024 (USACE calls it preliminary)",
    valueType: "count of FUDS properties USACE locates in the county",
    universe:
      "US counties and county equivalents in the committed county table (50 states, DC and Puerto Rico; TIGERweb ACS2023) with a value for FUDS properties: 0 where USACE locates no property there (the inventory is complete, a rule approved on 2026-10-16), null where an unplaced property could be in the county",
  },
];

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The bytes of a breaks file: two-space JSON, keys in the order the builders write them, a final newline. */
export function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** The bytes of a PLACES input: compact, one line. */
export function serializeInput(obj) {
  return `${JSON.stringify(obj)}\n`;
}

function strictlyIncreasing(breaks, what) {
  for (let i = 1; i < breaks.length; i++) if (!(breaks[i] > breaks[i - 1])) throw new Error(`${what}: breaks do not rise strictly: ${JSON.stringify(breaks)}`);
}

// ---------------------------------------------------------------- PLACES

/**
 * The input file for one measure from the body CDC sent: the fetch record and every county's value, in the order CDC sent
 * them (locationid). The national row (locationid 59) is dropped by parsePlaces; a county CDC publishes no value for stays, null.
 */
export function placesInput(measure, url, body, fetched) {
  const rows = JSON.parse(body.toString("utf8"));
  if (!Array.isArray(rows)) throw new Error(`${measure}: CDC did not send an array`);
  const meta = PLACES_MEASURES[measure];
  const values = parsePlaces(rows, "county").filter((r) => r.measure === measure);
  for (const r of values) if (r.year !== meta.year) throw new Error(`${measure}: county ${r.fips} is data year ${r.year}, the measure list says ${meta.year}`);
  if (rows.length !== meta.rows) process.stderr.write(`warning: ${measure}: CDC sent ${rows.length} rows, the measure list says ${meta.rows}\n`);
  return {
    schema: "breaks-input/1",
    layer: "health",
    measure,
    source: { url, retrievedAt: fetched.retrievedAt, lastModified: fetched.lastModified, sha256: sha256(body), rows: rows.length },
    values: values.map((r) => [r.fips, r.value]),
  };
}

/** One PLACES breaks file from its input (and the input's bytes, whose sha256 it records). */
export function placesBreaksFile(measure, input, inputBytes) {
  const meta = PLACES_MEASURES[measure];
  const published = input.values.map((v) => v[1]).filter((x) => x != null);
  const breaks = quintiles(published);
  if (breaks.length !== 4) throw new Error(`${measure}: ${published.length} published values cannot make four quintile breaks`);
  strictlyIncreasing(breaks, `health/${measure}`);
  return {
    schema: "breaks/1",
    layer: "health",
    measure,
    period: `data year ${meta.year}`,
    valueType: "age-adjusted prevalence (percent)",
    method: "quintile-nearest-rank",
    rule: METHODS["quintile-nearest-rank"],
    breaks,
    n: published.length,
    nNull: input.values.length - published.length,
    universe: `US counties and county equivalents (Connecticut as planning regions) with a published age-adjusted prevalence for ${meta.short}, CDC PLACES 2025 release`,
    source: { url: input.source.url, retrievedAt: input.source.retrievedAt, lastModified: input.source.lastModified, sha256: input.source.sha256 },
    input: { path: `${BREAKS}/inputs/health/${measure}.json`, sha256: sha256(inputBytes) },
  };
}

// ---------------------------------------------------------------- place exports

/** One value per county of the committed county table: null, 0 from a complete census, or the export's cell. */
export function exportCells(exported, counties, feature, year) {
  const at = new Map(exported.places.map((g, i) => [g, i]));
  const fi = exported.meta.features.indexOf(feature);
  if (fi < 0) throw new Error(`${feature} is not a feature of this export`);
  const yi = year == null ? -1 : exported.meta.years.indexOf(year);
  if (year != null && yi < 0) throw new Error(`${year} is not a year of this export`);
  return counties.map((g) => {
    if (Object.hasOwn(exported.nullPlaces, g)) return null;
    const i = at.get(g);
    if (i === undefined) {
      if (exported.meta.zero_vs_missing !== "complete-census") throw new Error(`county ${g} has no row and the export is not a complete census`);
      return 0;
    }
    return yi >= 0 ? exported.value[i][yi][fi] : exported.value[i][fi];
  });
}

/** Zero is its own bin; the rest are cut at the smallest nonzero value and the nearest-rank quartiles of the nonzero values. */
export function countBreaks(cells) {
  const valued = cells.filter((x) => x != null);
  const positive = valued.filter((x) => x > 0).sort((a, b) => a - b);
  if (!positive.length) throw new Error("no nonzero value to cut");
  const m = positive.length;
  const at = (q) => positive[Math.min(m - 1, Math.floor(q * m))];
  const breaks = [...new Set([positive[0], at(0.25), at(0.5), at(0.75)])];
  strictlyIncreasing(breaks, "count breaks");
  return { breaks, n: valued.length, nNull: cells.length - valued.length };
}

/** One place-export breaks file from the committed export (its parsed JSON and bytes) and the county table. */
export function exportBreaksFile(e, exported, exportBytes, counties) {
  const { breaks, n, nNull } = countBreaks(exportCells(exported, counties, e.feature, e.year));
  const src = exported.meta.source;
  return {
    schema: "breaks/1",
    layer: e.layer,
    measure: e.feature,
    period: e.period,
    valueType: e.valueType,
    method: "zero-bin-quartile-nearest-rank",
    rule: METHODS["zero-bin-quartile-nearest-rank"],
    breaks,
    n,
    nNull,
    universe: e.universe,
    source: {
      url: src.layer,
      retrievedAt: src.fetchedAt,
      lastModified: src.serviceDataLastEdit ?? null,
      pages: src.pages.map((p) => ({ url: p.url, sha256: p.sha256, lastModified: p.lastModified, rows: p.rows })),
    },
    input: { path: e.file, sha256: sha256(exportBytes) },
  };
}

// ---------------------------------------------------------------- every file

/**
 * Every breaks file as {path relative to apps/map: bytes}, computed from the committed inputs alone:
 * the PLACES input files under data/breaks/inputs and the four committed place exports.
 * @param {string} [root] apps/map
 * @returns {Map<string, string>}
 */
export function buildAll(root = ROOT) {
  const out = new Map();
  for (const measure of Object.keys(PLACES_MEASURES)) {
    const bytes = readFileSync(path.join(root, BREAKS, "inputs/health", `${measure}.json`));
    out.set(`${BREAKS}/health/${measure}.json`, serialize(placesBreaksFile(measure, JSON.parse(bytes.toString("utf8")), bytes)));
  }
  const counties = JSON.parse(readFileSync(path.join(root, COUNTIES), "utf8")).rows.map((r) => r.geoid);
  for (const e of EXPORTS) {
    const bytes = readFileSync(path.join(root, e.file));
    out.set(`${BREAKS}/${e.layer}/${e.feature}.json`, serialize(exportBreaksFile(e, JSON.parse(bytes.toString("utf8")), bytes, counties)));
  }
  return out;
}

// ---------------------------------------------------------------- fetching

let lastStart = 0;

/** GET with a descriptive User-Agent, request starts at least MIN_GAP_MS apart, three tries. */
async function politeFetch(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      const body = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { body, retrievedAt: new Date().toISOString(), lastModified: res.headers.get("last-modified") };
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      process.stderr.write(`retry ${attempt} of ${url}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

async function fetchPlaces(root) {
  const inputs = [];
  for (const measure of Object.keys(PLACES_MEASURES)) {
    const url = countyMeasureUrl(measure);
    const fetched = await politeFetch(url);
    const input = placesInput(measure, url, fetched.body, fetched);
    process.stderr.write(`${measure}: ${input.source.rows} rows, ${input.values.length} counties, sha256 ${input.source.sha256}\n`);
    inputs.push(input);
  }
  // Written together, after every pull succeeded, so a failed run leaves the committed inputs as they were.
  mkdirSync(path.join(root, BREAKS, "inputs/health"), { recursive: true });
  for (const input of inputs) writeFileSync(path.join(root, BREAKS, "inputs/health", `${input.measure}.json`), serializeInput(input));
}

async function recompute(measure, root) {
  if (!Object.hasOwn(PLACES_MEASURES, measure)) throw new Error(`unknown PLACES measure ${measure}`);
  const committed = JSON.parse(readFileSync(path.join(root, BREAKS, "health", `${measure}.json`), "utf8"));
  const fetched = await politeFetch(committed.source.url);
  const got = sha256(fetched.body);
  const published = parsePlaces(JSON.parse(fetched.body.toString("utf8")), "county").filter((r) => r.measure === measure).map((r) => r.value).filter((x) => x != null);
  const breaks = quintiles(published);
  const same = got === committed.source.sha256 && JSON.stringify(breaks) === JSON.stringify(committed.breaks) && published.length === committed.n;
  process.stdout.write(
    `${JSON.stringify({ url: committed.source.url, committedRetrievedAt: committed.source.retrievedAt, committedSha256: committed.source.sha256, fetchedSha256: got, committedBreaks: committed.breaks, recomputedBreaks: breaks, committedN: committed.n, recomputedN: published.length, match: same }, null, 2)}\n`,
  );
  return same ? 0 : 1;
}

async function main(argv) {
  const root = ROOT;
  const rc = argv.indexOf("--recompute");
  if (rc >= 0) return recompute(argv[rc + 1], root);
  const offline = argv.includes("--offline");
  const check = argv.includes("--check");
  if (check && !offline) throw new Error("--check needs --offline");
  if (!offline) await fetchPlaces(root);
  let unchanged = 0;
  let changed = 0;
  let created = 0;
  for (const [rel, bytes] of buildAll(root)) {
    const file = path.join(root, rel);
    const before = existsSync(file) ? sha256(readFileSync(file)) : null;
    const after = sha256(bytes);
    if (before === after) unchanged++;
    else if (before == null) created++;
    else changed++;
    process.stdout.write(`${before === after ? "same   " : before == null ? "new    " : "CHANGED"} ${rel} sha256 ${before ?? "-"} -> ${after}\n`);
    if (!check && before !== after) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  }
  process.stdout.write(`${unchanged + changed + created} breaks files: ${unchanged} unchanged, ${changed} changed, ${created} new${check ? " (check only, nothing written)" : ""}\n`);
  return check && changed + created > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
