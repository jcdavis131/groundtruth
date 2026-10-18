// Builds the offline place manifest: the three tables under lib/places/data
// that turn a county FIPS, a CBSA code or a USPS abbreviation into an
// identity - name, state, internal point, membership, neighbours - with zero
// network calls at request time.
//
//   node scripts/places-data.mjs --offline   states.json + metros.json, no network at all
//   node scripts/places-data.mjs             the full pull: counties, CBSA membership,
//                                            adjacency and Zillow region ids (needs egress)
//
// Why two modes. States (52) and metros (393) are derivable from what the
// repo already holds: the state table is public knowledge and lives inline
// below, and every metro is a row of lib/economy/data/msa_index.json. Both
// therefore ship COMPLETE and no build ever needs a host with egress to have
// them. Counties, metro membership, adjacency and the Zillow region ids are
// not derivable; they come from the full pull, which writes counties.json
// with complete:true and fills metros.json counties[] and zillowRegionId.
//
// Nothing here stamps a timestamp unless it actually pulled something, so
// --offline is byte-idempotent (run it twice, git diff is empty) and it
// preserves whatever an earlier network pull wrote into metros.json.
//
// Sources of the full pull, each checked against the live service on
// 2026-09-30:
//   - counties: TIGERweb Generalized_ACS2023/State_County layer 13 (Counties
//     20M), 3,222 rows: the 3,144 county equivalents of the 50 states and DC
//     (Connecticut as its nine planning regions, 09110-09190) plus the 78
//     Puerto Rico municipios. Layers 11 and 12 carry 13 more rows, the island
//     areas, which the state table below does not name anyway.
//   - CBSA membership: OMB's July 2023 delineation, list1_2023.xlsx, read with
//     the stdlib zip + XML reader below. Membership is published, not
//     inferred, so it comes from this file and nothing else.
//   - a cross-check of that membership: point-in-polygon of each county's
//     Census internal point (INTPTLON/INTPTLAT, full precision) against
//     TIGERweb Generalized_ACS2023/CBSA layers 21 (Metropolitan Statistical
//     Areas 20M) and 25 (Micropolitan Statistical Areas 20M), unioned. Layer 0
//     is a "Labels" group that 400s, and the 500K layers 7 and 8 return no
//     geometry, which is why the 20M pair is used.
//   - adjacency: the Census county adjacency file, 2023 vintage to match the
//     January 2023 county layer and the July 2023 delineation (the 2024 file
//     differs only by dropping the Juneau-Petersburg pair and adding Midway).
//   - Zillow region ids: the union of Zillow's metro ZHVI and ZORI files (the
//     same two files lib/economy/sources.ts reads at request time), matched by
//     name; a metro whose 2023 title no longer names Zillow's row is matched
//     only when Zillow's county file puts exactly the same counties in it.
//
// If a layer id or a URL moves, change the constant here; every one of them
// is printed into the manifest meta so a page can cite how it was built.
//
// Ethics: places only. No addresses, no parcels, no people.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");
const OUT_DIR = path.resolve("lib/places/data");
const MSA_INDEX = path.resolve("lib/economy/data/msa_index.json");
const UA = "embedding-atlas/0.1 (+https://eye.jcamd.com; open-source globe)";

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/State_County/MapServer";
const COUNTY_LAYER = 13; // Counties 20M; matches TIGER_LAYER.county["20M"] in lib/economy/sources.ts
const CBSA_SERVICE = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/CBSA/MapServer";
const CBSA_METRO_LAYER = 21; // Metropolitan Statistical Areas 20M (393 features)
const CBSA_MICRO_LAYER = 25; // Micropolitan Statistical Areas 20M (542 features)
const OMB_LIST1_URL = "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx";
const ADJACENCY_URL = "https://www2.census.gov/geo/docs/reference/county_adjacency/county_adjacency2023.txt";
const ZILLOW_BASE = "https://files.zillowstatic.com/research/public_csvs";
// The same three files lib/economy/sources.ts ZILLOW_FILES names; RegionIDs are shared across them.
const ZILLOW_METRO_CSVS = {
  zhvi: `${ZILLOW_BASE}/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
  zori: `${ZILLOW_BASE}/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv`,
};
const ZILLOW_COUNTY_CSV = `${ZILLOW_BASE}/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`;

/** The point-in-polygon check is generalized geometry against a published list; a handful of coastal misses is noise, more is a parse error. */
const MAX_PIP_DISAGREEMENTS = 10;
/** Decimal places kept on a county's internal point: about 11 m, which is more than a county-level identity needs. */
const POINT_DP = 4;

// The 50 states, DC and Puerto Rico. lon/lat is an approximate geographic
// centre, used only for hub ordering and as a last-resort fallback point; two
// decimals is deliberate, because a centroid precise to the metre would imply
// a precision this table does not have.
const STATES = [
  ["01", "AL", "Alabama", -86.83, 32.79],
  ["02", "AK", "Alaska", -152.0, 64.0],
  ["04", "AZ", "Arizona", -111.66, 34.29],
  ["05", "AR", "Arkansas", -92.44, 34.9],
  ["06", "CA", "California", -119.45, 37.18],
  ["08", "CO", "Colorado", -105.55, 38.99],
  ["09", "CT", "Connecticut", -72.73, 41.62],
  ["10", "DE", "Delaware", -75.51, 38.99],
  ["11", "DC", "District of Columbia", -77.02, 38.9],
  ["12", "FL", "Florida", -81.69, 28.63],
  ["13", "GA", "Georgia", -83.44, 32.65],
  ["15", "HI", "Hawaii", -156.37, 20.25],
  ["16", "ID", "Idaho", -114.66, 44.39],
  ["17", "IL", "Illinois", -89.2, 40.07],
  ["18", "IN", "Indiana", -86.28, 39.91],
  ["19", "IA", "Iowa", -93.5, 42.07],
  ["20", "KS", "Kansas", -98.38, 38.48],
  ["21", "KY", "Kentucky", -85.3, 37.53],
  ["22", "LA", "Louisiana", -91.96, 31.07],
  ["23", "ME", "Maine", -69.24, 45.37],
  ["24", "MD", "Maryland", -76.79, 39.04],
  ["25", "MA", "Massachusetts", -71.8, 42.26],
  ["26", "MI", "Michigan", -85.41, 44.35],
  ["27", "MN", "Minnesota", -94.31, 46.28],
  ["28", "MS", "Mississippi", -89.66, 32.74],
  ["29", "MO", "Missouri", -92.48, 38.37],
  ["30", "MT", "Montana", -109.65, 47.05],
  ["31", "NE", "Nebraska", -99.68, 41.53],
  ["32", "NV", "Nevada", -116.65, 39.33],
  ["33", "NH", "New Hampshire", -71.58, 43.69],
  ["34", "NJ", "New Jersey", -74.66, 40.19],
  ["35", "NM", "New Mexico", -106.11, 34.42],
  ["36", "NY", "New York", -75.5, 42.95],
  ["37", "NC", "North Carolina", -79.39, 35.54],
  ["38", "ND", "North Dakota", -100.47, 47.45],
  ["39", "OH", "Ohio", -82.79, 40.29],
  ["40", "OK", "Oklahoma", -97.51, 35.58],
  ["41", "OR", "Oregon", -120.56, 43.94],
  ["42", "PA", "Pennsylvania", -77.8, 40.87],
  ["44", "RI", "Rhode Island", -71.56, 41.68],
  ["45", "SC", "South Carolina", -80.9, 33.86],
  ["46", "SD", "South Dakota", -100.23, 44.45],
  ["47", "TN", "Tennessee", -86.35, 35.86],
  ["48", "TX", "Texas", -99.34, 31.49],
  ["49", "UT", "Utah", -111.68, 39.33],
  ["50", "VT", "Vermont", -72.66, 44.07],
  ["51", "VA", "Virginia", -78.87, 37.52],
  ["53", "WA", "Washington", -120.44, 47.38],
  ["54", "WV", "West Virginia", -80.61, 38.64],
  ["55", "WI", "Wisconsin", -89.74, 44.62],
  ["56", "WY", "Wyoming", -107.55, 42.99],
  ["72", "PR", "Puerto Rico", -66.47, 18.22],
].map(([fips, usps, name, lon, lat]) => ({ fips, usps, name, lon, lat }));

// ---------------------------------------------------------------- files

/** One row per line: a 3,000-row table stays reviewable in a diff. */
function writeTable(file, meta, rows) {
  const body = rows.map((r) => "    " + JSON.stringify(r)).join(",\n");
  const text = `{\n  "meta": ${JSON.stringify(meta, null, 2).replace(/\n/g, "\n  ")},\n  "rows": [\n${body}\n  ]\n}\n`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), text);
  console.log(`wrote ${file}: ${rows.length} rows, ${Buffer.byteLength(text)} bytes`);
}

function readTable(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- network

const gates = new Map();
async function polite(name, minIntervalMs) {
  const g = gates.get(name) ?? { next: 0 };
  gates.set(name, g);
  const now = Date.now();
  const slot = Math.max(now, g.next);
  g.next = slot + minIntervalMs;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

/** `as` is "json", "text" or "buffer". Retries with backoff; throws the last error. */
async function get(name, url, { as = "json", retries = 3, minIntervalMs = 150, timeoutMs = 120_000 } = {}) {
  const accept = as === "json" ? "application/json" : as === "text" ? "text/csv,text/plain,*/*" : "*/*";
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await polite(name, minIntervalMs);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept }, signal: ctl.signal });
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status} for ${url}`);
      if (as === "json") return await r.json();
      if (as === "text") return await r.text();
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Every feature of an ArcGIS layer, paged by resultOffset until the server stops adding rows. */
async function pageAll(service, layer, params, pageSize = 2000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const qs = new URLSearchParams({ where: "1=1", f: "json", outSR: "4326", ...params, resultOffset: String(offset), resultRecordCount: String(pageSize) });
    const j = await get("tigerweb", `${service}/${layer}/query?${qs}`);
    if (j.error) throw new Error(`TIGERweb ${service} layer ${layer}: ` + (j.error.message ?? "error"));
    const feats = j.features ?? [];
    out.push(...feats);
    console.log(`  ${service.split("/").slice(-2)[0]}/${layer}: ${out.length} features`);
    if (feats.length === 0 || (!j.exceededTransferLimit && feats.length < pageSize)) break;
  }
  return out;
}

// ---------------------------------------------------------------- xlsx

/**
 * The entries of a zip archive, by name. Reads the central directory, which
 * is authoritative for sizes even when the local headers defer them to a data
 * descriptor, and inflates with node's own zlib. Enough for an .xlsx; no
 * zip64, no encryption, both of which an OMB spreadsheet never uses.
 */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive: no end-of-central-directory record");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < entries; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 8) out.set(name, zlib.inflateRawSync(data));
    else if (method === 0) out.set(name, Buffer.from(data));
    else throw new Error(`zip: ${name} uses compression method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function xmlText(s) {
  return s.replace(/&(lt|gt|quot|apos|amp|#[0-9]+|#x[0-9a-fA-F]+);/g, (_, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }[e];
  });
}

/** The visible text of a <si> or <is> body: every <t>, minus phonetic (<rPh>) runs. */
function runText(body) {
  return [...body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join("");
}

/**
 * One worksheet of an .xlsx as an array of rows of strings (null for an empty
 * cell), found by sheet name through workbook.xml and its relationships.
 * Shared strings, inline strings and literal values are all read as text, so
 * a FIPS code keeps its leading zero exactly as the file stores it.
 */
function readXlsxSheet(buf, sheetName) {
  const parts = unzip(buf);
  const part = (name) => {
    const b = parts.get(name);
    if (!b) throw new Error(`xlsx: missing ${name}`);
    return b.toString("utf8");
  };
  const workbook = part("xl/workbook.xml");
  const rels = part("xl/_rels/workbook.xml.rels");
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: xmlText(m[1].match(/\bname="([^"]*)"/)?.[1] ?? ""),
    rid: m[1].match(/\br:id="([^"]*)"/)?.[1] ?? "",
  }));
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new Error(`xlsx: no sheet named ${JSON.stringify(sheetName)} (have ${sheets.map((s) => s.name).join(", ")})`);
  const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => a.match(/\bId="([^"]*)"/)?.[1] === sheet.rid);
  const target = rel?.match(/\bTarget="([^"]*)"/)?.[1];
  if (!target) throw new Error(`xlsx: no relationship for sheet ${sheetName}`);
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const shared = parts.has("xl/sharedStrings.xml") ? [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1])) : [];

  const rows = [];
  for (const rm of part(sheetPath).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cm[1].match(/\br="([A-Z]+)[0-9]+"/)?.[1];
      if (!ref) continue;
      let col = 0;
      for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
      const type = cm[1].match(/\bt="(\w+)"/)?.[1];
      const body = cm[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = null;
      if (type === "s") value = v == null ? null : (shared[Number(v)] ?? null);
      else if (type === "inlineStr") value = runText(body);
      else if (v != null) value = xmlText(v);
      while (row.length < col - 1) row.push(null);
      row[col - 1] = value;
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- OMB delineation

const OMB_HEADER = [
  "CBSA Code",
  "Metropolitan Division Code",
  "CSA Code",
  "CBSA Title",
  "Metropolitan/Micropolitan Statistical Area",
  "Metropolitan Division Title",
  "CSA Title",
  "County/County Equivalent",
  "State Name",
  "FIPS State Code",
  "FIPS County Code",
  "Central/Outlying County",
];
const METRO = "Metropolitan Statistical Area";
const MICRO = "Micropolitan Statistical Area";

/** list1_2023.xlsx -> CBSA code -> { title, kind, counties }. Fails on any row it cannot account for. */
function parseOmbList1(rows) {
  const head = rows.findIndex((r) => r[0] === "CBSA Code");
  if (head < 0) throw new Error("list1: no 'CBSA Code' header row");
  const header = rows[head].slice(0, OMB_HEADER.length);
  if (JSON.stringify(header) !== JSON.stringify(OMB_HEADER)) throw new Error(`list1: header ${JSON.stringify(header)} is not ${JSON.stringify(OMB_HEADER)}`);
  const col = Object.fromEntries(OMB_HEADER.map((h, i) => [h, i]));
  const cbsas = new Map();
  const countyCbsa = new Map();
  for (const row of rows.slice(head + 1)) {
    const code = row[0];
    if (!code || !/^[0-9]{5}$/.test(code)) continue; // the notes and source lines under the table
    const fips = `${row[col["FIPS State Code"]] ?? ""}${row[col["FIPS County Code"]] ?? ""}`;
    if (!/^[0-9]{5}$/.test(fips)) throw new Error(`list1: bad county code in ${JSON.stringify(row)}`);
    const kind = row[col["Metropolitan/Micropolitan Statistical Area"]];
    if (kind !== METRO && kind !== MICRO) throw new Error(`list1: CBSA ${code} has kind ${JSON.stringify(kind)}`);
    const title = row[col["CBSA Title"]];
    const c = cbsas.get(code) ?? { title, kind, counties: [] };
    if (c.title !== title || c.kind !== kind) throw new Error(`list1: rows for CBSA ${code} disagree on title or kind`);
    if (countyCbsa.has(fips)) throw new Error(`list1: county ${fips} is listed in ${countyCbsa.get(fips)} and ${code}`);
    countyCbsa.set(fips, code);
    c.counties.push(fips);
    cbsas.set(code, c);
  }
  for (const c of cbsas.values()) c.counties.sort();
  return { cbsas, countyCbsa };
}

// ---------------------------------------------------------------- geometry

/**
 * Even-odd ray casting over every ring of an esriJSON polygon. Holes need no
 * special case: a point inside a hole crosses its boundary an extra time and
 * flips back out.
 */
function pointInRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function bboxOf(rings) {
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

const round = (x, dp) => Number(x.toFixed(dp));

// ---------------------------------------------------------------- parsing

/** "Austin-Round Rock-San Marcos, TX" -> "austin|TX". Mirrors metroShortKey in lib/economy/sources.ts. */
function metroShortKey(name) {
  const m = name.match(/^([^,]+),\s*([A-Z]{2})/);
  if (!m) return name;
  return `${m[1].split(/[-/]/)[0].trim().toLowerCase()}|${m[2]}`;
}

/** "Kansas City, MO-KS" -> ["MO","KS"]. */
function statesOf(name) {
  const suffix = name.split(",").pop() ?? "";
  return suffix
    .trim()
    .split("-")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
}

/** One CSV line. `limit` stops after that many cells, which keeps a 300-column Zillow row cheap when only the identity columns are wanted. */
function splitCsvLine(line, limit = Infinity) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
      if (out.length >= limit) return out;
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * The Census county adjacency file has been published both tab-delimited
 * (name, geoid, neighbour name, neighbour geoid, with continuation rows whose
 * first two cells are blank) and pipe-delimited with every cell populated.
 * Reading the 5-digit codes positionally out of each line handles both, and a
 * line carrying one code is a continuation of the county above it.
 */
function parseAdjacency(txt) {
  const adj = new Map();
  let current = null;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const codes = line
      .split(/\t|\|/)
      .map((c) => c.trim().replace(/^"|"$/g, ""))
      .filter((c) => /^[0-9]{5}$/.test(c));
    if (codes.length === 0) continue;
    let neighbour;
    if (codes.length >= 2) {
      current = codes[0];
      neighbour = codes[1];
    } else {
      neighbour = codes[0];
    }
    if (!current || neighbour === current) continue;
    if (!adj.has(current)) adj.set(current, new Set());
    adj.get(current).add(neighbour);
  }
  // Adjacency is a symmetric relation; the file is not always symmetric about it.
  for (const [a, set] of [...adj]) {
    for (const b of set) {
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(b).add(a);
    }
  }
  return adj;
}

// ---------------------------------------------------------------- builders

function buildStates() {
  writeTable(
    "states.json",
    {
      source: "Hand-maintained table of the 50 states, the District of Columbia and Puerto Rico (FIPS, USPS, name, approximate centre).",
      complete: true,
      pulled: null,
      count: STATES.length,
      note: "Public knowledge, not a pull. Centroids are approximate to two decimals and are used for hub ordering and fallback points only.",
    },
    STATES,
  );
  return STATES;
}

function buildMetros(enrich) {
  const index = JSON.parse(fs.readFileSync(MSA_INDEX, "utf8"));
  const previous = new Map();
  for (const r of readTable("metros.json")?.rows ?? []) previous.set(r.cbsa, r);
  const rows = index
    .map((m) => {
      const prior = previous.get(m.id);
      const extra = enrich?.rows.get(m.id);
      return {
        cbsa: m.id,
        name: m.name,
        short: metroShortKey(m.name),
        states: statesOf(m.name),
        counties: extra?.counties ?? prior?.counties ?? [],
        lon: m.lon,
        lat: m.lat,
        zillowRegionId: extra ? extra.zillowRegionId : (prior?.zillowRegionId ?? null),
        zillowMatchedBy: extra ? extra.zillowMatchedBy : (prior?.zillowMatchedBy ?? null),
      };
    })
    .sort((a, b) => a.cbsa.localeCompare(b.cbsa));
  const priorMeta = readTable("metros.json")?.meta ?? {};
  const meta = {
    source: "lib/economy/data/msa_index.json (BLS OEWS metropolitan areas, with TIGERweb centroids).",
    complete: true,
    pulled: enrich ? enrich.pulled : (priorMeta.pulled ?? null),
    count: rows.length,
    matchedToZillow: rows.filter((r) => r.zillowRegionId).length,
  };
  const membership = enrich ? enrich.membershipSource : priorMeta.membershipSource;
  const zillow = enrich ? enrich.zillowSource : priorMeta.zillowSource;
  const unmatched = enrich ? enrich.zillowUnmatched : priorMeta.zillowUnmatched;
  if (membership) meta.membershipSource = membership;
  if (zillow) meta.zillowSource = zillow;
  if (unmatched) meta.zillowUnmatched = unmatched;
  meta.note = meta.pulled
    ? "Identity from the OEWS index; counties[] from OMB's July 2023 delineation; zillowRegionId from the Zillow match described in zillowSource. A null zillowRegionId is listed in zillowUnmatched with the reason."
    : "Identity only. counties[] and zillowRegionId are filled by the network pull; they are empty and null in an offline build.";
  writeTable("metros.json", meta, rows);
  return rows;
}

// ---------------------------------------------------------------- the pull

async function pullOmb() {
  console.log("omb: " + OMB_LIST1_URL);
  const buf = await get("census", OMB_LIST1_URL, { as: "buffer" });
  const { cbsas, countyCbsa } = parseOmbList1(readXlsxSheet(buf, "List 1"));
  const metros = [...cbsas.values()].filter((c) => c.kind === METRO).length;
  console.log(`  ${cbsas.size} CBSAs (${metros} metropolitan, ${cbsas.size - metros} micropolitan), ${countyCbsa.size} counties, ${buf.length} bytes`);
  return { cbsas, countyCbsa, bytes: buf.length };
}

async function pullCounties() {
  const byFips = new Map(STATES.map((s) => [s.fips, s]));
  console.log("counties: TIGERweb layer " + COUNTY_LAYER);
  const feats = await pageAll(TIGER, COUNTY_LAYER, {
    outFields: "GEOID,NAME,INTPTLAT,INTPTLON",
    returnGeometry: "false",
    orderByFields: "GEOID",
  });
  const counties = [];
  for (const f of feats) {
    const a = f.attributes ?? {};
    const geoid = String(a.GEOID ?? "");
    const state = byFips.get(geoid.slice(0, 2));
    const lon = Number(a.INTPTLON);
    const lat = Number(a.INTPTLAT);
    if (!/^[0-9]{5}$/.test(geoid) || !state || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      console.warn("  skipped unusable county row " + JSON.stringify(a));
      continue;
    }
    // Full precision is kept for the point-in-polygon check and rounded on write.
    counties.push({ geoid, name: String(a.NAME), stusab: state.usps, stateFips: state.fips, stateName: state.name, lon, lat, cbsa: null, adj: [] });
  }
  counties.sort((a, b) => a.geoid.localeCompare(b.geoid));
  return counties;
}

/** Assigns every county its OMB CBSA, then checks that assignment against the polygons. Throws on anything that says the files do not line up. */
async function assignCbsa(counties, omb, metroIds) {
  const known = new Set(counties.map((c) => c.geoid));
  const missing = [...omb.countyCbsa.keys()].filter((g) => !known.has(g));
  if (missing.length) throw new Error(`list1 names ${missing.length} counties the county layer does not: ${missing.join(", ")}`);
  const ombMetros = [...omb.cbsas].filter(([, c]) => c.kind === METRO).map(([code]) => code);
  const notInIndex = ombMetros.filter((c) => !metroIds.has(c));
  const notInOmb = [...metroIds].filter((c) => !ombMetros.includes(c));
  if (notInIndex.length || notInOmb.length) {
    throw new Error(`OMB metropolitan codes and msa_index ids disagree: only in OMB ${JSON.stringify(notInIndex)}, only in msa_index ${JSON.stringify(notInOmb)}`);
  }
  for (const c of counties) c.cbsa = omb.countyCbsa.get(c.geoid) ?? null;

  console.log(`cbsa cross-check: TIGERweb ${CBSA_SERVICE} layers ${CBSA_METRO_LAYER} + ${CBSA_MICRO_LAYER}`);
  const polys = [];
  for (const layer of [CBSA_METRO_LAYER, CBSA_MICRO_LAYER]) {
    for (const f of await pageAll(CBSA_SERVICE, layer, { outFields: "GEOID,NAME", returnGeometry: "true" })) {
      const rings = f.geometry?.rings;
      const geoid = String(f.attributes?.GEOID ?? "");
      if (!rings?.length || !/^[0-9]{5}$/.test(geoid)) continue;
      polys.push({ cbsa: geoid, rings, bbox: bboxOf(rings) });
    }
  }
  if (polys.length !== omb.cbsas.size) throw new Error(`TIGERweb returned ${polys.length} CBSA polygons; list1 has ${omb.cbsas.size} CBSAs`);
  const disagreements = [];
  for (const c of counties) {
    const hits = polys
      .filter((p) => c.lon >= p.bbox[0] && c.lon <= p.bbox[2] && c.lat >= p.bbox[1] && c.lat <= p.bbox[3] && pointInRings(c.lon, c.lat, p.rings))
      .map((p) => p.cbsa);
    if (hits.length > 1 || (hits[0] ?? null) !== c.cbsa) disagreements.push(`${c.geoid} ${c.name}, ${c.stusab}: polygon ${hits.join("+") || "none"}, OMB ${c.cbsa ?? "none"}`);
  }
  console.log(`  ${polys.length} polygons, ${disagreements.length} disagreements with OMB`);
  for (const d of disagreements) console.log("    " + d);
  if (disagreements.length > MAX_PIP_DISAGREEMENTS) {
    throw new Error(`point-in-polygon disagrees with list1 for ${disagreements.length} counties (tolerance ${MAX_PIP_DISAGREEMENTS}); check the parse before trusting either`);
  }
  return { polygons: polys.length, disagreements: disagreements.length };
}

async function pullAdjacency(counties) {
  console.log("adjacency: " + ADJACENCY_URL);
  const adj = parseAdjacency(await get("census", ADJACENCY_URL, { as: "text" }));
  const known = new Set(counties.map((c) => c.geoid));
  for (const c of counties) c.adj = [...(adj.get(c.geoid) ?? [])].filter((g) => known.has(g)).sort();
  const isolated = counties.filter((c) => c.adj.length === 0);
  console.log(`  ${counties.length - isolated.length} counties with neighbours; ${isolated.length} without: ${isolated.map((c) => `${c.geoid} ${c.name}, ${c.stusab}`).join("; ")}`);
  return isolated.length;
}

/** Zillow's metro rows from the ZHVI and ZORI files, by RegionID, with the files each appears in. */
async function pullZillowMetroRows() {
  const regions = new Map();
  for (const [file, url] of Object.entries(ZILLOW_METRO_CSVS)) {
    console.log(`zillow ${file} metros: ${url}`);
    const lines = (await get("zillow", url, { as: "text" })).split(/\r?\n/);
    const header = splitCsvLine(lines[0]);
    const iId = header.indexOf("RegionID");
    const iName = header.indexOf("RegionName");
    const iType = header.indexOf("RegionType");
    if (iId < 0 || iName < 0 || iType < 0) throw new Error(`zillow ${file}: header lacks RegionID/RegionName/RegionType`);
    let n = 0;
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const cells = splitCsvLine(line, Math.max(iId, iName, iType) + 1);
      if (cells[iType] !== "msa") continue;
      const id = cells[iId];
      const name = cells[iName];
      const prior = regions.get(id);
      if (prior && prior.name !== name) throw new Error(`zillow: RegionID ${id} is "${prior.name}" in ${prior.files.join("+")} and "${name}" in ${file}`);
      regions.set(id, { id, name, files: [...(prior?.files ?? []), file] });
      n++;
    }
    console.log(`  ${n} msa rows`);
  }
  return regions;
}

/** Zillow's county file: county GEOID -> the Zillow metro title it files that county under. */
async function pullZillowCountyMetros() {
  console.log("zillow county metros: " + ZILLOW_COUNTY_CSV);
  const lines = (await get("zillow", ZILLOW_COUNTY_CSV, { as: "text" })).split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const iType = header.indexOf("RegionType");
  const iMetro = header.indexOf("Metro");
  const iSt = header.indexOf("StateCodeFIPS");
  const iCo = header.indexOf("MunicipalCodeFIPS");
  if ([iType, iMetro, iSt, iCo].some((i) => i < 0)) throw new Error("zillow county file: header lacks RegionType/Metro/StateCodeFIPS/MunicipalCodeFIPS");
  const limit = Math.max(iType, iMetro, iSt, iCo) + 1;
  const out = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = splitCsvLine(line, limit);
    if (cells[iType] !== "county" || !cells[iMetro]) continue;
    const geoid = cells[iSt].padStart(2, "0") + cells[iCo].padStart(3, "0");
    if (/^[0-9]{5}$/.test(geoid)) out.set(geoid, cells[iMetro]);
  }
  console.log(`  ${out.size} counties carry a Zillow metro title`);
  return out;
}

const withoutCt = (set) => new Set([...set].filter((g) => !g.startsWith("09")));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Resolves each OEWS metro to a Zillow RegionID.
 *
 *   exact     Zillow's RegionName is the OEWS title verbatim.
 *   short     Zillow's "principal city, ST" is the OEWS title's first principal
 *             city and first state ("Austin, TX" for "Austin-Round Rock-San
 *             Marcos, TX"). No short key is shared by two Zillow rows today;
 *             one that ever is resolves to nothing rather than to the first.
 *   counties  neither name matches, because the 2023 delineation retitled the
 *             metro, but Zillow's county file files EXACTLY the counties OMB
 *             puts in it under one Zillow metro (St. Mary's County, MD is
 *             Zillow's "California, MD" and OMB's "Lexington Park, MD").
 *
 * The county file is also the wrong-entity guard: a name match whose Zillow
 * counties share nothing with OMB's is refused outright. Connecticut is left
 * out of that comparison, because Zillow still files it by its eight old
 * counties and the 2023 delineation uses the nine planning regions.
 */
function matchZillow(index, omb, regions, countyMetro) {
  const byName = new Map();
  const byShort = new Map();
  for (const r of regions.values()) {
    byName.set(r.name, byName.has(r.name) ? null : r);
    const k = metroShortKey(r.name);
    byShort.set(k, byShort.has(k) ? null : r);
  }
  const titleToRegion = (title) => byName.get(title) ?? byShort.get(metroShortKey(title)) ?? null;
  const countiesOfRegion = new Map();
  for (const [geoid, title] of countyMetro) {
    const r = titleToRegion(title);
    if (!r) continue;
    if (!countiesOfRegion.has(r.id)) countiesOfRegion.set(r.id, new Set());
    countiesOfRegion.get(r.id).add(geoid);
  }

  const out = new Map();
  const used = new Map();
  const drift = [];
  const unchecked = [];
  for (const m of index) {
    const ombSet = new Set(omb.cbsas.get(m.id)?.counties ?? []);
    let region = byName.get(m.name) ?? null;
    let by = region ? "exact" : null;
    if (!region) {
      region = byShort.get(metroShortKey(m.name)) ?? null;
      if (region) by = "short";
    }
    if (region) {
      const z = withoutCt(countiesOfRegion.get(region.id) ?? new Set());
      const o = withoutCt(ombSet);
      if (z.size && o.size && ![...z].some((g) => o.has(g))) {
        throw new Error(`zillow: ${m.id} "${m.name}" matched "${region.name}" (${region.id}) by ${by}, but Zillow files none of OMB's counties under it`);
      }
      if (z.size && o.size && !sameSet(z, o)) drift.push(`${m.id} ${m.name}`);
      if (!z.size || !o.size) unchecked.push(`${m.id} ${m.name}`);
    } else {
      const o = withoutCt(ombSet);
      const candidates = o.size === ombSet.size ? [...countiesOfRegion].filter(([, z]) => sameSet(withoutCt(z), o) && z.size === o.size) : [];
      if (candidates.length === 1) {
        region = regions.get(candidates[0][0]);
        by = "counties";
      }
    }
    if (region) {
      if (used.has(region.id)) throw new Error(`zillow: RegionID ${region.id} matched both ${used.get(region.id)} and ${m.id}`);
      used.set(region.id, m.id);
    }
    out.set(m.id, { zillowRegionId: region?.id ?? null, zillowMatchedBy: region ? by : null, files: region?.files ?? [] });
  }

  const unmatched = [];
  for (const m of index) {
    if (out.get(m.id).zillowRegionId) continue;
    const ombCounties = omb.cbsas.get(m.id)?.counties ?? [];
    if (statesOf(m.name).includes("PR")) {
      unmatched.push({ cbsa: m.id, name: m.name, reason: "Zillow publishes no Puerto Rico metro." });
      continue;
    }
    const filed = ombCounties.filter((g) => countyMetro.has(g)).map((g) => `${g} under "${countyMetro.get(g)}"`);
    const absent = ombCounties.filter((g) => !countyMetro.has(g));
    const parts = [];
    if (filed.length) parts.push(`Zillow files ${filed.join(", ")}`);
    if (absent.length) parts.push(`Zillow's county file has no row for ${absent.join(", ")}`);
    unmatched.push({ cbsa: m.id, name: m.name, reason: `No Zillow metro has this 2023 delineation's counties: ${parts.join("; ")}.` });
  }
  return { out, drift, unchecked, unmatched };
}

// ---------------------------------------------------------------- main

async function main() {
  buildStates();

  if (OFFLINE) {
    buildMetros(null);
    const seed = readTable("counties.json");
    console.log(`counties.json left alone: ${seed?.rows?.length ?? 0} rows, complete=${seed?.meta?.complete ?? "unknown"}`);
    return;
  }

  const index = JSON.parse(fs.readFileSync(MSA_INDEX, "utf8"));
  const metroIds = new Set(index.map((m) => m.id));

  // Every network read happens before anything is written, so a failure
  // part-way leaves both tables as they were rather than one of them updated.
  const omb = await pullOmb();
  const counties = await pullCounties();
  const check = await assignCbsa(counties, omb, metroIds);
  const isolated = await pullAdjacency(counties);
  const regions = await pullZillowMetroRows();
  const countyMetro = await pullZillowCountyMetros();
  const zillow = matchZillow(index, omb, regions, countyMetro);

  const existing = readTable("counties.json")?.rows ?? [];
  if (existing.length && counties.length < existing.length * 0.98) {
    throw new Error(`refusing to shrink counties.json from ${existing.length} to ${counties.length} (more than 2 percent below)`);
  }
  const withCbsa = counties.filter((c) => c.cbsa).length;
  if (withCbsa < 1100) {
    throw new Error(`refusing to write counties.json: only ${withCbsa} counties landed in a CBSA (expected at least 1100)`);
  }

  const membership = new Map();
  for (const c of counties) if (c.cbsa) membership.set(c.cbsa, (membership.get(c.cbsa) ?? 0) + 1);
  const metroCounties = counties.filter((c) => c.cbsa && metroIds.has(c.cbsa)).length;
  console.log(`cbsa membership: ${membership.size} CBSAs, ${withCbsa} counties (${metroCounties} metropolitan, ${withCbsa - metroCounties} micropolitan)`);

  const metroCount = [...omb.cbsas.values()].filter((c) => c.kind === METRO).length;
  const cbsaMethod =
    `OMB July 2023 delineation (${OMB_LIST1_URL}): ${withCbsa} counties in ${omb.cbsas.size} CBSAs, ${metroCount} metropolitan and ${omb.cbsas.size - metroCount} micropolitan; cbsa holds either kind, and only the metropolitan codes have a metro page. ` +
    `Cross-checked by point-in-polygon of each county's Census internal point (INTPTLON/INTPTLAT) against ${CBSA_SERVICE} layers ${CBSA_METRO_LAYER} (Metropolitan Statistical Areas 20M) and ${CBSA_MICRO_LAYER} (Micropolitan Statistical Areas 20M), ${check.polygons} polygons: ${check.disagreements} disagreements.`;
  const pulled = new Date().toISOString().slice(0, 10);
  writeTable(
    "counties.json",
    {
      source: `TIGERweb ${TIGER} layer ${COUNTY_LAYER} (Counties 20M: the 50 states, DC and Puerto Rico; Connecticut as planning regions); adjacency from ${ADJACENCY_URL}.`,
      complete: true,
      pulled,
      count: counties.length,
      withCbsa,
      withoutNeighbours: isolated,
      cbsaMethod,
      note: `Places only: name, state, Census internal point (${POINT_DP} decimals), CBSA membership and neighbouring counties. No addresses, no parcels, no people.`,
    },
    counties.map((c) => ({ ...c, lon: round(c.lon, POINT_DP), lat: round(c.lat, POINT_DP) })),
  );

  const counts = { exact: 0, short: 0, counties: 0, none: 0 };
  const onlyIn = { zhvi: 0, zori: 0 };
  for (const z of zillow.out.values()) {
    counts[z.zillowMatchedBy ?? "none"]++;
    if (z.files.length === 1) onlyIn[z.files[0]]++;
  }
  console.log(`zillow: ${JSON.stringify(counts)}; matched rows only in ZHVI ${onlyIn.zhvi}, only in ZORI ${onlyIn.zori}`);
  // Not a failure: Zillow files counties by an older delineation, and its county file only has rows where it publishes a value.
  console.log(`zillow: ${zillow.drift.length} name matches whose Zillow county list differs from OMB's but overlaps it: ${zillow.drift.join("; ")}`);
  console.log(`zillow: ${zillow.unchecked.length} name matches the county guard could not check (no comparable county rows): ${zillow.unchecked.join("; ")}`);
  for (const u of zillow.unmatched) console.log(`  unmatched ${u.cbsa} ${u.name}: ${u.reason}`);

  const enrich = {
    pulled,
    membershipSource: `OMB list1_2023.xlsx (${OMB_LIST1_URL}), metropolitan rows; ${metroCount} of ${metroCount} metros carry counties.`,
    zillowSource:
      `Union of ${ZILLOW_METRO_CSVS.zhvi} and ${ZILLOW_METRO_CSVS.zori}. exact: RegionName equals the title (${counts.exact}); short: first principal city and state (${counts.short}); ` +
      `counties: ${ZILLOW_COUNTY_CSV} files exactly OMB's counties under one Zillow metro (${counts.counties}). Wrong-entity guard: a name match whose Zillow counties share none of OMB's is refused.`,
    zillowUnmatched: zillow.unmatched,
    rows: new Map(index.map((m) => [m.id, { ...zillow.out.get(m.id), counties: omb.cbsas.get(m.id)?.counties ?? [] }])),
  };
  const rows = buildMetros(enrich);
  const empty = rows.filter((r) => r.counties.length === 0);
  if (empty.length) throw new Error(`metros.json: ${empty.length} metros have no counties: ${empty.map((r) => r.cbsa).join(", ")}`);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e?.message ?? e));
  process.exit(1);
});
