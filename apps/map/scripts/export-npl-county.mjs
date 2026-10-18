// National Priorities List sites per county and year, as a candidate
// vector-places tower (docs/place-towers.md). Writes
// lib/catalog/data/npl-county.json, served as-is by
// /api/catalog?op=place-export&collection=npl-status.
//
//   node scripts/export-npl-county.mjs
//
// Source: EPA's "Superfund National Priorities List (NPL) Sites with Status
// Information" FeatureServer/0 (keyless ArcGIS), every row, paginated. One
// row is one site (distinct Site_EPA_ID is checked). Dates are EPA's
// MM/DD/YYYY strings, read strictly; an unreadable date is null, never guessed.
//
// County join: (State, County) to a 5-digit FIPS by name against
// lib/places/data/counties.json (TIGERweb ACS2023, 3,222 counties). It fails
// closed: a name that matches no county, or is ambiguous (a bare name where
// the state has both "<X> County" and "<X> city"), is left out and listed.
// The County string is matched whole first ("Lewis and Clark" is one county);
// only when that fails is it split into a list, on "," and "/" only.
// Connecticut's NPL rows name legacy counties, which ACS2023 replaced with
// planning regions, so they do not match and are listed.
//
// Zero vs missing: the NPL list is complete for the United States, so a
// county with no site in a year has a true 0 for that year (zero_vs_missing:
// "complete-census"). But a state with any unmatched site cannot say which of
// its counties that site is in, so every county of that state is null for
// every feature (reason join:unmatched_site_in_state). Places outside the
// 3,222 (territories other than Puerto Rico) are not in the export.
//
// Completeness: the distinct EPA IDs read must equal the service's own
// returnCountOnly on the same query, or nothing is written.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LAYER = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Superfund_National_Priorities_List_(NPL)_Sites_with_Status_Information/FeatureServer/0";
const FIELDS = ["Site_EPA_ID", "State", "County", "Status", "Proposed_Date", "Listing_Date", "Construction_Completion_Date", "Deletion_Date", "Latitude", "Longitude"];
const YEARS = Array.from({ length: 11 }, (_, i) => 2015 + i);
const FEATURES = ["npl_active", "npl_listed_in_year", "npl_deleted_in_year", "npl_construction_complete_cum"];
const PAGE = 1000;
const UA = "Mozilla/5.0 (compatible; eye-atlas-export/1.0)";
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function getJson(params) {
  const url = `${LAYER}/query?${new URLSearchParams({ f: "json", ...params })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = JSON.parse(text);
      if (j.error) throw new Error(JSON.stringify(j.error));
      return { url, j, sha256: sha(text), lastModified: res.headers.get("last-modified") };
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** EPA's MM/DD/YYYY to ISO; null when unreadable. */
function mdy(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** EPA's County strings can carry HTML entities ("Pe&ntilde;uelas"); decode the named and numeric ones before matching. */
const ENTITIES = { amp: "&", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", uuml: "ü", apos: "'", quot: '"' };
const decodeEntities = (s) => String(s ?? "").replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : (ENTITIES[e] ?? m)));

const norm = (s) =>
  decodeEntities(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bste\.?\s/g, "sainte ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+(county|parish|borough|census area|city and borough|municipality|municipio)$/, "")
    .replace(/\s+/g, " ")
    .trim();

// ------------------------------------------------------------------ counties
const counties = JSON.parse(readFileSync(path.resolve("lib/places/data/counties.json"), "utf8"));
// The NPL list names states in full ("Alabama"); counties.json carries both the name and USPS code.
const stateKey = new Map();
for (const c of counties.rows) {
  stateKey.set(c.stusab.toUpperCase(), c.stusab);
  stateKey.set(c.stateName.toUpperCase(), c.stusab);
}
const keyOf = (state) => stateKey.get(String(state ?? "").trim().toUpperCase()) ?? null;
const byState = new Map();
for (const c of counties.rows) {
  const k = c.stusab;
  if (!byState.has(k)) byState.set(k, new Map());
  const m = byState.get(k);
  const n = norm(c.name);
  m.set(n, m.has(n) ? "ambiguous" : c.geoid);
  // "Du Page" / "DuPage", "La Salle" / "LaSalle": the same name without spaces, kept only when unique.
  const ns = `nospace:${n.replace(/ /g, "")}`;
  m.set(ns, m.has(ns) ? "ambiguous" : c.geoid);
}

/** All counties of a state, by USPS code. */
const countiesOf = (st) => counties.rows.filter((c) => c.stusab === st).map((c) => c.geoid);

function one(m, n) {
  // A bare name where the state has both "<X> County" and "<X> city" cannot be placed.
  if (m.has(`${n} city`) && m.has(n)) return { geoid: null, reason: "ambiguous_county_or_city", candidates: [m.get(n), m.get(`${n} city`)] };
  const g = m.get(n) ?? m.get(`nospace:${n.replace(/ /g, "")}`) ?? (n.endsWith(" city") ? undefined : m.get(`${n} city`));
  if (!g) return { geoid: null, reason: "no_name_match", candidates: null };
  if (g === "ambiguous") return { geoid: null, reason: "ambiguous", candidates: null };
  return { geoid: g, reason: null, candidates: null };
}

/**
 * A site's county FIPS, or why not and which counties it could be in (candidates; null means
 * any county of its state). A site EPA lists in several counties ("Kern, Los Angeles, San
 * Bernardino") is not placed in one: its candidates are the counties named.
 */
function fips(state, county) {
  const st = keyOf(state);
  const m = byState.get(st);
  if (!m) return { geoid: null, reason: "state_not_in_counties", candidates: [] };
  // The whole string first: "Lewis and Clark" (MT) and "King and Queen" (VA) are one county each,
  // so "and" is never a separator. Lists are split only on "," and "/".
  const whole = norm(county);
  if (whole) {
    const w = one(m, whole);
    if (w.geoid) return w;
  }
  const parts = decodeEntities(county).split(/[,/]/).map(norm).filter(Boolean);
  if (!parts.length) return { geoid: null, reason: "no_county", candidates: countiesOf(st) };
  if (parts.length === 1) {
    const r = one(m, parts[0]);
    return r.geoid || r.candidates ? r : { ...r, candidates: countiesOf(st) };
  }
  const each = parts.map((p) => one(m, p));
  const known = each.every((r) => r.geoid || r.candidates);
  return { geoid: null, reason: "multi_county", candidates: known ? [...new Set(each.flatMap((r) => (r.geoid ? [r.geoid] : r.candidates)))] : countiesOf(st) };
}

// ------------------------------------------------------------------ pull
const where = "1=1";
const count = await getJson({ where, returnCountOnly: "true" });
const expected = count.j.count;
const pages = [];
const rows = [];
for (let offset = 0; ; offset += PAGE) {
  const p = await getJson({ where, outFields: FIELDS.join(","), returnGeometry: "false", orderByFields: "Site_EPA_ID", resultOffset: String(offset), resultRecordCount: String(PAGE) });
  pages.push({ url: p.url, sha256: p.sha256, lastModified: p.lastModified, rows: p.j.features.length });
  rows.push(...p.j.features.map((f) => f.attributes));
  if (!p.j.exceededTransferLimit && p.j.features.length < PAGE) break;
}
const fetchedAt = new Date().toISOString();
const ids = new Set(rows.map((r) => r.Site_EPA_ID));
if (ids.size !== rows.length) throw new Error(`${rows.length} rows but ${ids.size} distinct EPA IDs`);
if (ids.size !== expected) throw new Error(`read ${ids.size} sites, the service counts ${expected}; nothing written`);

// ------------------------------------------------------------------ join and series
const unmatched = [];
const nulled = new Map();
const far = [];
const perCounty = new Map();
let neverListed = 0;
let badDates = 0;
const centroid = new Map(counties.rows.map((c) => [c.geoid, [c.lon, c.lat]]));
const km = ([a, b], [c, d]) => {
  const r = Math.PI / 180;
  const x = Math.sin(((d - b) * r) / 2) ** 2 + Math.cos(b * r) * Math.cos(d * r) * Math.sin(((c - a) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
for (const r of rows) {
  const listed = mdy(r.Listing_Date);
  const deleted = mdy(r.Deletion_Date);
  const cc = mdy(r.Construction_Completion_Date);
  for (const f of ["Listing_Date", "Deletion_Date", "Construction_Completion_Date"]) if (r[f] != null && String(r[f]).trim() && !mdy(r[f])) badDates++;
  if (!listed) neverListed++;
  const j = fips(r.State, r.County);
  if (!j.geoid) {
    const whole = j.candidates && j.candidates.length && j.candidates.length === countiesOf(keyOf(r.State)).length;
    unmatched.push({ epaId: r.Site_EPA_ID, state: r.State ?? null, county: r.County ?? null, reason: j.reason, candidates: whole ? `every county of ${keyOf(r.State)}` : j.candidates });
    for (const g of j.candidates ?? []) nulled.set(g, whole ? "join:unmatched_site_in_state" : `join:${j.reason}`);
    continue;
  }
  if (Number.isFinite(r.Longitude) && Number.isFinite(r.Latitude)) {
    const d = km([r.Longitude, r.Latitude], centroid.get(j.geoid));
    if (d > 150) far.push({ epaId: r.Site_EPA_ID, geoid: j.geoid, km: Math.round(d) });
  }
  if (!perCounty.has(j.geoid)) perCounty.set(j.geoid, []);
  perCounty.get(j.geoid).push({ id: r.Site_EPA_ID, listed, deleted, cc });
}

if (unmatched.length > ids.size / 10) throw new Error(`${unmatched.length} of ${ids.size} sites unmatched; the join is broken, nothing written`);

const yearEnd = (y) => `${y}-12-31`;
const inYear = (d, y) => d != null && d.startsWith(`${y}-`);
const places = [];
const values = [];
const reasons = {};
for (const c of counties.rows) {
  const g = c.geoid;
  if (nulled.has(g)) {
    reasons[g] = nulled.get(g);
    continue;
  }
  const sites = perCounty.get(g) ?? [];
  if (!sites.length) continue; // a true 0 everywhere; listed by the header rule, not row by row
  places.push(g);
  values.push(
    YEARS.map((y) => [
      sites.filter((s) => s.listed && s.listed <= yearEnd(y) && (!s.deleted || s.deleted > yearEnd(y))).length,
      sites.filter((s) => inYear(s.listed, y)).length,
      sites.filter((s) => inYear(s.deleted, y)).length,
      sites.filter((s) => s.cc && s.cc <= yearEnd(y)).length,
    ]),
  );
}
const siteIds = Object.fromEntries(places.map((g) => [g, perCounty.get(g).map((s) => s.id).sort()]));

const out = {
  meta: {
    what: "National Priorities List sites per county and year (2015-2025): active (listed by Dec 31 and not deleted by then), listed in the year, deleted in the year, construction complete by Dec 31 (cumulative).",
    source: { name: "EPA Superfund National Priorities List (NPL) Sites with Status Information", layer: LAYER, query: { where, outFields: FIELDS, orderByFields: "Site_EPA_ID", page: PAGE }, pages, fetchedAt, serviceDataLastEdit: null },
    counties: { file: "lib/places/data/counties.json", source: counties.meta.source, pulled: counties.meta.pulled, count: counties.rows.length },
    join: "(State, County) to FIPS by normalised name; fails closed (unmatched and ambiguous names are listed, never guessed). Connecticut's NPL rows name legacy counties and do not match ACS2023 planning regions.",
    zero_vs_missing: "complete-census",
    zeroRule: "A county in counties.json that is not in `places` and not in `nullPlaces` has 0 for every feature and year: the NPL list is complete for the United States.",
    nullRule: "A county a site could be in but was not placed in is null for every feature and year, listed in `nullPlaces` with the reason: join:multi_county (EPA lists the site in several counties, all named), join:ambiguous_county_or_city (a bare name where the state has both the county and the independent city), or join:unmatched_site_in_state (the name, or any one name in a multi-county list, matched nothing, so the site could be in any county of its state and every county of that state is null, e.g. Connecticut's legacy counties and Alaska's Outer Ketchikan). A county string is matched whole first, so a single county named with 'and' (Lewis and Clark, MT; King and Queen, VA) is one county; lists are split only on commas and slashes.",
    years: YEARS,
    features: FEATURES,
    counts: {
      serviceCount: expected,
      sitesRead: ids.size,
      matched: ids.size - unmatched.length,
      unmatched: unmatched.length,
      neverListed,
      unreadableDates: badDates,
      matchedFartherThan150kmFromCountyCentroid: far.length,
      places: places.length,
      nullPlaces: Object.keys(reasons).length,
    },
    unmatched,
    farMatches: far,
    generatedBy: "scripts/export-npl-county.mjs",
  },
  places,
  /** value[p][y][f], in the order of places, meta.years and meta.features. */
  value: values,
  nullPlaces: reasons,
  /** The EPA IDs counted for each place, so any number can be re-derived. */
  siteIds,
};
// serviceDataLastEdit from the layer's own ?f=json
try {
  const info = await fetch(`${LAYER}?f=json`, { headers: { "user-agent": UA } }).then((r) => r.json());
  const t = info?.editingInfo?.dataLastEditDate;
  out.meta.source.serviceDataLastEdit = Number.isFinite(t) ? new Date(t).toISOString() : null;
} catch {
  out.meta.source.serviceDataLastEdit = null;
}
const file = path.resolve("lib/catalog/data/npl-county.json");
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(JSON.stringify(out.meta.counts, null, 1));
console.log(`unmatched sample: ${JSON.stringify(unmatched.slice(0, 12))}`);
console.log(`wrote ${file}`);
