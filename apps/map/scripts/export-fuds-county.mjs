// USACE Formerly Used Defense Sites properties per county, as a candidate
// vector-places tower (docs/place-towers.md). Writes
// lib/catalog/data/fuds-county.json, served as-is by
// /api/catalog?op=place-export&collection=fuds-properties.
//
//   node scripts/export-fuds-county.mjs
//
// Source: USACE's FUDS FeatureServer layer 1 (property points, FY2024 data,
// keyless ArcGIS), every row. Only FUDSUNIQUEPROPERTYNUMBER, STATUS, COUNTY,
// STATE and FISCALYEAR are requested, plus each point's geometry for the
// county join; CURRENTOWNER, FEATUREDESCRIPTION and the name fields never
// are. The artifact carries property numbers per county and no coordinates
// (a property can be a private farm or home).
//
// Form: static, the FY2024 inventory only. FISCALYEAR is the inventory's data
// year, the same on every row, not a history.
//
// County join, from USACE's own point and county string:
// - the point is placed in a county by point-in-polygon against TIGERweb
//   Generalized_ACS2023 Counties 500K (the vintage of counties.json; fetched
//   here, not committed);
// - the county string is joined by name (lib/places/countyJoin.ts, failing
//   closed as for NPL);
// - the county string places it when it matches one county (USACE's county
//   field is the property's county); the point is then only checked, and a
//   point in another county is listed (meta.pointDisagreements), not dropped;
// - the point decides when it is in exactly one county of the property's
//   state and the string is blank, names no county, or could name more than
//   one: a name that is both a county and an independent city (ST LOUIS,
//   FAIRFAX, RICHMOND, BALTIMORE: e.g. B07MO0988, "ST LOUIS", goes to St.
//   Louis city, 29510, by its point) or a list of counties, when the point is
//   in one of the counties named (meta.counts.joinMethod.pointOnlyByNameReason);
// - otherwise it is not placed, and the counties it could be in are null
//   (the named ones, or every county of its state when the name says nothing);
// - a property with a state but no county string and no point is unlocated:
//   USACE places it in no county, so it is in no county's count (meta.unlocated).
// Properties in places outside counties.json (territories other than Puerto
// Rico, Palau, Micronesia) are counted and left out.
//
// Zero vs missing: the FUDS inventory is USACE's complete list of program
// properties, so a county with no property USACE locates in it is a true 0,
// except where an unplaced property could be (nullPlaces). Unlocated
// properties are listed by state, and the strict alternative's coverage is
// reported beside it (meta.counts.strictRule), for reference. Cam approved
// this zero rule on 2026-10-16 (meta.zeroRuleStatus).
//
// counts.placed is every property the join put in a county, including those
// in a county later nulled by another property (Connecticut's planning
// regions, Chugach and Copper River, and Baltimore County, Baltimore city and
// Anne Arundel; meta.placedThenNulled); counts.counted is what propertyIds holds.
//
// Completeness: distinct property numbers read must equal the service's
// returnCountOnly less exact duplicate rows (a duplicate must be identical in
// every requested field and its point, or nothing is written).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SUCCESSORS, joinName, nameIndex, nearName, norm, pointIn, polygon, stateOf } from "../lib/places/countyJoin.ts";

const LAYER = "https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/fuds/FeatureServer/1";
const COUNTIES_500K = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/State_County/MapServer/11";
const FIELDS = ["OBJECTID", "FUDSUNIQUEPROPERTYNUMBER", "STATUS", "COUNTY", "STATE", "FISCALYEAR"];
const FEATURES = ["fuds_properties", "fuds_properties_with_projects", "fuds_properties_with_open_projects"];
const STATUS = {
  "Properties without projects": { projects: false, open: false },
  "Properties with projects": { projects: true, open: true },
  "Properties with all projects at site closeout": { projects: true, open: false },
};
const UA = "Mozilla/5.0 (compatible; eye-atlas-export/1.0)";
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
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

async function pullAll(base, params, page) {
  const pages = [];
  const features = [];
  for (let offset = 0; ; offset += page) {
    const p = await getJson(`${base}/query?${new URLSearchParams({ f: "json", where: "1=1", resultOffset: String(offset), resultRecordCount: String(page), ...params })}`);
    pages.push({ url: p.url, sha256: p.sha256, lastModified: p.lastModified, rows: p.j.features.length });
    features.push(...p.j.features);
    if (!p.j.exceededTransferLimit && p.j.features.length < page) break;
  }
  return { pages, features };
}

// ------------------------------------------------------------------ pull
const counties = JSON.parse(readFileSync(path.resolve("lib/places/data/counties.json"), "utf8"));
const ix = nameIndex(counties.rows);
const stateOfGeoid = new Map(counties.rows.map((c) => [c.geoid, c.stusab]));

const expected = (await getJson(`${LAYER}/query?${new URLSearchParams({ f: "json", where: "1=1", returnCountOnly: "true" })}`)).j.count;
const props = await pullAll(LAYER, { outFields: FIELDS.join(","), returnGeometry: "true", outSR: "4326", orderByFields: "OBJECTID" }, 5000);
const layerInfo = (await getJson(`${LAYER}?f=json`)).j;
const geo = await pullAll(COUNTIES_500K, { outFields: "GEOID", returnGeometry: "true", outSR: "4326", geometryPrecision: "5", orderByFields: "GEOID" }, 1000);
const fetchedAt = new Date().toISOString();
const known = new Set(counties.rows.map((c) => c.geoid));
const polys = geo.features.filter((f) => known.has(f.attributes.GEOID) && f.geometry?.rings?.length).map((f) => polygon(f.attributes.GEOID, f.geometry.rings));
geo.features.length = 0;
const missingPolys = counties.rows.filter((c) => !polys.some((p) => p.geoid === c.geoid)).map((c) => c.geoid);
if (missingPolys.length) throw new Error(`no 500K outline for ${missingPolys.join(", ")}`);

// ------------------------------------------------------------------ dedupe
if (props.features.length !== expected) throw new Error(`read ${props.features.length} rows, the service counts ${expected}; nothing written`);
const byId = new Map();
const duplicates = [];
for (const f of props.features) {
  const a = f.attributes;
  const pt = f.geometry && Number.isFinite(f.geometry.x) && Number.isFinite(f.geometry.y) ? [f.geometry.x, f.geometry.y] : null;
  const rec = { id: a.FUDSUNIQUEPROPERTYNUMBER, status: a.STATUS ?? null, county: a.COUNTY ?? null, state: a.STATE ?? null, fy: a.FISCALYEAR ?? null, pt };
  if (!rec.id) throw new Error(`OBJECTID ${a.OBJECTID}: no property number`);
  const prev = byId.get(rec.id);
  if (prev) {
    if (JSON.stringify(prev) !== JSON.stringify(rec)) throw new Error(`${rec.id}: duplicate rows differ`);
    duplicates.push(rec.id);
    continue;
  }
  byId.set(rec.id, rec);
}
const properties = [...byId.values()];
const fiscalYears = [...new Set(properties.map((p) => p.fy))];

// ------------------------------------------------------------------ join
const placed = new Map(); // geoid -> property ids
const nulled = new Map(); // geoid -> reason
const unplaced = [];
const outside = { count: 0, byState: {} };
const method = { name: 0, nameAndPointAgree: 0, nameWithPointInOtherCounty: 0, nameWithPointInNoCountyOfState: 0, nameWithoutPoint: 0, pointOnly: 0, pointOnlyByNameReason: {}, nameOneEditAway: 0 };
const nearNames = [];
const pointDisagreements = [];
const unlocated = [];
const unknownStatus = [];
const adjacency = new Map(counties.rows.map((c) => [c.geoid, c.adj ?? []]));
const nullFor = (geoids, reason) => {
  for (const g of geoids) if (nulled.get(g) !== "join:unplaced_property_in_state") nulled.set(g, reason);
};
for (const p of properties) {
  const st = stateOf(ix, p.state);
  if (!st) {
    outside.count++;
    outside.byState[p.state] = (outside.byState[p.state] ?? 0) + 1;
    continue;
  }
  if (!(p.status in STATUS)) unknownStatus.push(p.id);
  const all = ix.countiesOf.get(st);
  const n = joinName(ix, st, p.county);
  const hits = p.pt ? pointIn(polys, p.pt[0], p.pt[1]).filter((g) => stateOfGeoid.get(g) === st) : [];
  let g = null;
  if (n.geoid) {
    // USACE's county field is the property's county; the point is a location on it, only checked.
    g = n.geoid;
    method.name++;
    if (!p.pt) method.nameWithoutPoint++;
    else if (hits.length !== 1) method.nameWithPointInNoCountyOfState++;
    else if (hits[0] === g) method.nameAndPointAgree++;
    else {
      method.nameWithPointInOtherCounty++;
      pointDisagreements.push({ id: p.id, named: g, pointIn: hits[0], adjacent: adjacency.get(g).includes(hits[0]) });
    }
  } else if (n.reason === "no_county" && hits.length === 0) {
    // No county string, and no point or a point in no county of the state (open sea, a remote
    // island): USACE locates it in no county, so it is in no county's count (meta.unlocated).
    unlocated.push({ id: p.id, state: st, why: p.pt ? "point_in_no_county" : "no_point" });
    continue;
  } else if (hits.length === 1 && (n.reason === "no_county" || n.reason === "no_name_match" || (n.candidates ?? []).includes(hits[0]))) {
    g = hits[0];
    method.pointOnly++;
    method.pointOnlyByNameReason[n.reason] = (method.pointOnlyByNameReason[n.reason] ?? 0) + 1;
  } else if (n.reason === "no_name_match" && hits.length === 0 && nearName(ix, st, p.county)) {
    // A misspelling one edit from exactly one county of the state ("SCHUYKILL"); every use is listed.
    g = nearName(ix, st, p.county);
    method.nameOneEditAway++;
    nearNames.push({ id: p.id, county: p.county, geoid: g });
  } else {
    const successors = SUCCESSORS[`${st}|${norm(p.county)}`];
    const cands = successors ?? (n.candidates && n.candidates.length ? [...new Set([...n.candidates, ...hits])] : all);
    const whole = cands.length >= all.length;
    unplaced.push({ id: p.id, state: st, county: p.county, reason: `${p.pt ? (hits.length ? "point_outside_named" : "point_in_no_county") : "no_point"}+${n.reason}`, candidates: whole ? `every county of ${st}` : cands });
    if (whole) for (const c of all) nulled.set(c, "join:unplaced_property_in_state");
    else nullFor(cands, successors ? "join:predecessor_county" : `join:${n.reason}`);
    continue;
  }
  if (!placed.has(g)) placed.set(g, []);
  placed.get(g).push(p);
}
if (unknownStatus.length) throw new Error(`STATUS outside the three published values on ${unknownStatus.length} properties: ${unknownStatus.slice(0, 5).join(", ")}`);

const places = [];
const value = [];
const propertyIds = {};
for (const c of counties.rows) {
  if (nulled.has(c.geoid)) continue;
  const ps = placed.get(c.geoid) ?? [];
  if (!ps.length) continue; // a true 0, by the header rule
  places.push(c.geoid);
  value.push([ps.length, ps.filter((p) => STATUS[p.status].projects).length, ps.filter((p) => STATUS[p.status].open).length]);
  propertyIds[c.geoid] = ps.map((p) => p.id).sort();
}
const nullPlaces = Object.fromEntries([...nulled].sort());
const reasonCounts = {};
for (const r of nulled.values()) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
const nullStates = {};
for (const [g, r] of nulled) if (r === "join:unplaced_property_in_state") nullStates[stateOfGeoid.get(g)] = true;
// What the NPL-style strict rule would give: every county of a state with an unlocated property null too.
const strictNull = new Set(nulled.keys());
for (const u of unlocated) for (const c of ix.countiesOf.get(u.state)) strictNull.add(c);
const strict = { nullPlaces: strictNull.size, observedShare: Number(((counties.rows.length - strictNull.size) / counties.rows.length).toFixed(4)), statesEntirelyNull: [...new Set(unlocated.map((u) => u.state))].sort() };
const unlocatedByState = {};
for (const u of unlocated) (unlocatedByState[u.state] ??= []).push(u.id);
const placedCount = [...placed.values()].reduce((a, v) => a + v.length, 0);
const countedCount = Object.values(propertyIds).reduce((a, v) => a + v.length, 0);
// Placed by the join but in a county another property nulled, so in no county's count.
const placedThenNulled = {};
for (const [g, ps] of placed) if (nulled.has(g)) placedThenNulled[g] = ps.length;
const placedThenNulledByState = {};
for (const [g, n] of Object.entries(placedThenNulled)) placedThenNulledByState[stateOfGeoid.get(g)] = (placedThenNulledByState[stateOfGeoid.get(g)] ?? 0) + n;
if (placedCount - countedCount !== Object.values(placedThenNulled).reduce((a, n) => a + n, 0)) throw new Error("placed - counted is not the placed-then-nulled properties");
const inScope = properties.length - outside.count;
const t = layerInfo?.editingInfo?.dataLastEditDate;

const out = {
  meta: {
    collection: "fuds-properties",
    what: "USACE Formerly Used Defense Sites properties per county, FY2024 inventory: all properties, properties with cleanup projects, and properties with projects not all at site closeout. A program status, not a finding of contamination.",
    form: "static",
    asOf: `FUDS inventory, fiscal year ${fiscalYears.join(", ")} (USACE calls it preliminary)`,
    years: null,
    features: FEATURES,
    featureRule: {
      fuds_properties: "distinct FUDS property numbers USACE locates in the county: by its county field, or by its point where the field is blank, names no county, or could name more than one (a county-or-independent-city name such as ST LOUIS, or a list) and the point is in one of them",
      fuds_properties_with_projects: "of those, STATUS 'Properties with projects' or 'Properties with all projects at site closeout'",
      fuds_properties_with_open_projects: "of those, STATUS 'Properties with projects' (not all at site closeout)",
    },
    source: {
      name: "USACE Formerly Used Defense Sites (FUDS), property points",
      layer: LAYER,
      query: { where: "1=1", outFields: FIELDS, returnGeometry: true, outSR: 4326, orderByFields: "OBJECTID" },
      pages: props.pages,
      countyOutlines: { layer: COUNTIES_500K, query: { outFields: "GEOID", geometryPrecision: 5 }, pages: geo.pages, note: "fetched for the point-in-county join only; not committed" },
      fetchedAt,
      serviceDataLastEdit: Number.isFinite(t) ? new Date(t).toISOString() : null,
    },
    counties: { file: "lib/places/data/counties.json", source: counties.meta.source, pulled: counties.meta.pulled, count: counties.rows.length },
    join: "USACE's COUNTY string by name (lib/places/countyJoin.ts, failing closed); where it is blank or names no county, USACE's point in a TIGERweb ACS2023 500K county outline of the property's state; where it could name more than one county (a name that is both a county and an independent city, such as ST LOUIS, FAIRFAX, RICHMOND or BALTIMORE, or a list of counties), the point decides when it is in one of them (e.g. B07MO0988, 'ST LOUIS', to St. Louis city 29510; counts.joinMethod.pointOnlyByNameReason), and otherwise those counties are null; with neither, a single name one edit from exactly one county of the state (a misspelling such as SCHUYKILL; each listed in nearNames); never the nearest county. Where both are given and differ, the name is kept and the pair is listed in pointDisagreements (as NPL keeps and lists far matches): a large property's point can sit in a neighbouring county.",
    zero_vs_missing: "complete-census",
    zeroRule: `A county in counties.json that is not in \`places\` and not in \`nullPlaces\` has 0 for every feature, and that 0 means no property USACE locates in this county: a true 0 for located properties, because the FUDS inventory is USACE's complete list of program properties. Properties for which USACE publishes a state but no county string, and no point in a county (no point at all, or a point at sea or on a remote island), are in no county's count; they are listed in \`unlocated\` by state (${unlocated.length} of ${inScope} in-scope properties, ${((unlocated.length / inScope) * 100).toFixed(1)}%), and a county's 0 does not rule them out. The strict alternative, every county of a state with an unlocated property null, gives an observed share of ${strict.observedShare} instead of this rule's ${Number(((counties.rows.length - nulled.size) / counties.rows.length).toFixed(4))}; it is in counts.strictRule for reference. This rule is approved (zeroRuleStatus).`,
    zeroRuleStatus: "approved: Cam decided on 2026-10-16 to keep the zeros (0 = no property USACE locates in this county); counts.strictRule is kept for reference",
    nullRule: "A county an unplaced property could be in is null for every feature (nullPlaces): join:multi_county or join:ambiguous_county_or_city (the counties named, plus the county its point is in when that is another), join:predecessor_county (a county that no longer exists: Census's successors, e.g. Valdez-Cordova to Chugach and Copper River), or join:unplaced_property_in_state (a county string that matches nothing and no point in a county of the state: every county of its state is null). The strict alternative, every county of a state with an unlocated property null too, is reported in counts.strictRule.",
    counts: {
      serviceCount: expected,
      rowsRead: props.features.length,
      duplicateRows: duplicates.length,
      properties: properties.length,
      outsideCounties: outside.count,
      inScope,
      placed: placedCount,
      counted: countedCount,
      placedThenNulled: placedCount - countedCount,
      placedThenNulledByState,
      unplaced: unplaced.length,
      unlocated: unlocated.length,
      joinMethod: method,
      pointDisagreements: pointDisagreements.length,
      pointDisagreementsAdjacent: pointDisagreements.filter((d) => d.adjacent).length,
      strictRule: strict,
      places: places.length,
      nullPlaces: nulled.size,
      nullPlacesByReason: reasonCounts,
      statesEntirelyNull: Object.keys(nullStates).sort(),
    },
    observedShare: Number(((counties.rows.length - nulled.size) / counties.rows.length).toFixed(4)),
    duplicates,
    outside: outside.byState,
    unplaced,
    unlocated: unlocatedByState,
    pointDisagreements,
    nearNames,
    placedThenNulled,
    generatedBy: "scripts/export-fuds-county.mjs",
  },
  places,
  /** value[p][f], in the order of places and meta.features. */
  value,
  nullPlaces,
  /** The FUDS property numbers counted for each place, so any number can be re-derived. */
  propertyIds,
};
writeFileSync(path.resolve("lib/catalog/data/fuds-county.json"), JSON.stringify(out) + "\n");
console.log(JSON.stringify(out.meta.counts, null, 1), out.meta.observedShare);
const ur = {};
for (const u of unplaced) ur[u.reason] = (ur[u.reason] ?? 0) + 1;
console.log("unplaced by reason", JSON.stringify(ur));
console.log("unplaced sample", JSON.stringify(unplaced.slice(0, 15)));
