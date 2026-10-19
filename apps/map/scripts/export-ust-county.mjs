// EPA UST Finder's county counts as two candidate vector-places towers
// (docs/place-towers.md). Writes lib/catalog/data/ust-releases-county.json and
// lib/catalog/data/ust-facilities-county.json, served as-is by
// /api/catalog?op=place-export&collection=ust-releases-county|ust-facilities-county.
//
//   node scripts/export-ust-county.mjs
//
// Source: UST Finder FeatureServer (keyless ArcGIS), layer 3 Releases_by_County
// and layer 2 Facilities_by_County, every row. Only these county aggregates
// are read: the point layers (0 and 1) are never requested, because many sites
// are private homes. POPULATION is not exported (Puerto Rico's rows carry -99;
// vector-places has its own population tower).
//
// Form: static. UST Finder is a composite of state records as of 2018-2021
// (tribal records to October 2025), one value per county, not a year series,
// and nothing is carried across years. value[place][feature].
//
// County join: the layers carry no FIPS code. Each county in
// lib/places/data/counties.json (TIGERweb ACS2023, 3,222) is looked up by
// state and normalised name among the UST rows; a name must match exactly one
// row, and a row may serve only one county. A county with no row is null
// (join:no_source_row): Connecticut's nine planning regions (UST Finder has
// the eight legacy counties) and Alaska's Chugach and Copper River (UST Finder
// has their predecessor, Valdez-Cordova). Nothing is split or summed across
// geographies. As a check, each county's Census internal point must fall in
// the polygon of the UST row its name matched; a county whose point lands in
// another row's polygon is null (join:name_point_disagree).
//
// Zero vs missing: every county has a row, so there is no absent row to call
// 0. A 0 the layer publishes is kept as published (zero_vs_missing
// "as-published") and listed in meta.publishedZeros: the composite is only as
// complete as each state's records. A field the layer leaves null is null for
// that county (nullCells, source:null_in_county_layer), never 0. The releases
// layer never publishes a 0 for Open_Count or No_Further_Action_Count, so many
// of those nulls are probably 0s (a county whose release count equals its
// no-further-action count has nothing left open); they stay null, and
// meta.nullPattern gives the evidence so vector-places can decide. Null cells
// are counted by state in meta.counts.nullCellsByState: the missingness is
// concentrated, not random.
//
// Completeness: rows read must equal each layer's returnCountOnly, the two
// layers must name the same counties, and places + nullPlaces must be all
// 3,222 counties, or nothing is written.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nameIndex, norm, stateOf, pointIn, polygon } from "../lib/places/countyJoin.ts";

const SERVICE = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/UST_Finder_Feature_Layer_2eb/FeatureServer";
const PAGE = 2000;
const UA = "Mozilla/5.0 (compatible; eye-atlas-export/1.0)";
const sha = (s) => createHash("sha256").update(s).digest("hex");

const EXPORTS = {
  releases: {
    collection: "ust-releases-county",
    layer: 3,
    nameField: "County",
    fields: ["OBJECTID", "County", "State", "Release_Count", "Open_Count", "No_Further_Action_Count"],
    features: [
      ["ust_release_count", "Release_Count"],
      ["ust_open_release_count", "Open_Count"],
      ["ust_nfa_release_count", "No_Further_Action_Count"],
    ],
    what: "EPA UST Finder's reported leaking underground storage tank releases per county: all releases, open releases, and releases the state closed with no further action. State records as of 2018-2021 (tribal to October 2025); one static value per county.",
    file: "lib/catalog/data/ust-releases-county.json",
  },
  facilities: {
    collection: "ust-facilities-county",
    layer: 2,
    nameField: "NAME",
    fields: ["OBJECTID", "NAME", "State", "Facility_Count", "Open_USTs", "Closed_USTs", "TOS_USTs"],
    features: [
      ["ust_facility_count", "Facility_Count"],
      ["ust_open_tanks", "Open_USTs"],
      ["ust_closed_tanks", "Closed_USTs"],
      ["ust_tos_tanks", "TOS_USTs"],
    ],
    what: "EPA UST Finder's underground storage tank facilities per county, and their tanks: open, closed, and temporarily out of service. State records as of 2018-2021; one static value per county.",
    file: "lib/catalog/data/ust-facilities-county.json",
  },
};

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(90_000) });
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
const q = (layer, params) => `${SERVICE}/${layer}/query?${new URLSearchParams({ f: "json", ...params })}`;

async function pullAll(layer, params) {
  const pages = [];
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const p = await getJson(q(layer, { where: "1=1", orderByFields: "OBJECTID", resultOffset: String(offset), resultRecordCount: String(PAGE), ...params }));
    pages.push({ url: p.url, sha256: p.sha256, lastModified: p.lastModified, rows: p.j.features.length });
    features.push(...p.j.features);
    if (!p.j.exceededTransferLimit && p.j.features.length < PAGE) break;
  }
  return { pages, features };
}

/** A published count: a non-negative integer, else null (never 0). */
const count = (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

// ------------------------------------------------------------------ pull
const counties = JSON.parse(readFileSync(path.resolve("lib/places/data/counties.json"), "utf8"));
const ix = nameIndex(counties.rows);
const service = await getJson(`${SERVICE}?f=json`);
const pulled = {};
for (const [k, x] of Object.entries(EXPORTS)) {
  const expected = (await getJson(q(x.layer, { where: "1=1", returnCountOnly: "true" }))).j.count;
  const { pages, features } = await pullAll(x.layer, { outFields: x.fields.join(","), returnGeometry: "false" });
  const rows = features.map((f) => f.attributes);
  if (new Set(rows.map((r) => r.OBJECTID)).size !== rows.length) throw new Error(`${k}: duplicate OBJECTIDs`);
  if (rows.length !== expected) throw new Error(`${k}: read ${rows.length} rows, the service counts ${expected}; nothing written`);
  const info = (await getJson(`${SERVICE}/${x.layer}?f=json`)).j;
  const t = info?.editingInfo?.dataLastEditDate;
  pulled[k] = { rows, pages, expected, dataLastEdit: Number.isFinite(t) ? new Date(t).toISOString() : null };
}
// The releases layer's county outlines, about 100 m generalised, for the internal-point check only (not exported).
const geo = await pullAll(EXPORTS.releases.layer, { outFields: "OBJECTID", returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.001", geometryPrecision: "4" });
const fetchedAt = new Date().toISOString();
const polys = geo.features.filter((f) => f.geometry?.rings?.length).map((f) => polygon(String(f.attributes.OBJECTID), f.geometry.rings));

// ------------------------------------------------------------------ join
/** Per layer: state -> normalised name -> row (or "ambiguous"). */
function rowIndex(rows, nameField) {
  const m = new Map();
  const unstated = [];
  for (const r of rows) {
    const st = stateOf(ix, r.State);
    if (!st) {
      unstated.push({ objectId: r.OBJECTID, county: r[nameField], state: r.State });
      continue;
    }
    if (!m.has(st)) m.set(st, new Map());
    const s = m.get(st);
    for (const key of [norm(r[nameField]), `nospace:${norm(r[nameField]).replace(/ /g, "")}`]) s.set(key, s.has(key) ? "ambiguous" : r);
  }
  return { m, unstated };
}
const rel = rowIndex(pulled.releases.rows, "County");
const fac = rowIndex(pulled.facilities.rows, "NAME");
if (rel.unstated.length || fac.unstated.length) throw new Error(`rows with a state not in counties.json: ${JSON.stringify([...rel.unstated, ...fac.unstated])}`);

function lookup(idx, c) {
  const s = idx.m.get(c.stusab);
  if (!s) return null;
  const n = norm(c.name);
  const r = s.get(n);
  if (r && r !== "ambiguous") return r;
  if (r === "ambiguous") return "ambiguous";
  const r2 = s.get(`nospace:${n.replace(/ /g, "")}`);
  if (r2) return r2;
  // Virginia's independent cities are mostly named bare ("Norton", "Suffolk"). The bare name is
  // taken for "<X> city" only when the state has no "<X> County" it could also mean.
  if (n.endsWith(" city")) {
    const bare = n.slice(0, -" city".length);
    if (!ix.byState.get(c.stusab)?.has(bare)) return s.get(bare) ?? null;
  }
  return null;
}

const nullPlaces = {};
const matched = new Map(); // geoid -> { rel, fac }
const usedRel = new Set();
const usedFac = new Set();
const disagree = [];
let pointAgree = 0;
const pointOutside = [];
for (const c of counties.rows) {
  const r = lookup(rel, c);
  const f = lookup(fac, c);
  if (r === "ambiguous" || f === "ambiguous") {
    nullPlaces[c.geoid] = "join:ambiguous_name";
    continue;
  }
  if (!r || !f) {
    nullPlaces[c.geoid] = "join:no_source_row";
    continue;
  }
  if (r.OBJECTID !== f.OBJECTID && norm(r.County) !== norm(f.NAME)) throw new Error(`${c.geoid}: release and facility rows name different counties`);
  if (usedRel.has(r.OBJECTID) || usedFac.has(f.OBJECTID)) throw new Error(`${c.geoid}: a UST row would serve two counties (${r.County}, ${r.State})`);
  usedRel.add(r.OBJECTID);
  usedFac.add(f.OBJECTID);
  const hit = pointIn(polys, c.lon, c.lat);
  if (hit.length === 0) pointOutside.push(c.geoid);
  else if (!hit.includes(String(r.OBJECTID))) {
    disagree.push({ geoid: c.geoid, county: c.name, ustRow: r.OBJECTID, pointIn: hit.map(Number) });
    nullPlaces[c.geoid] = "join:name_point_disagree";
    continue;
  } else pointAgree++;
  matched.set(c.geoid, { rel: r, fac: f });
}
const unusedRows = pulled.releases.rows.filter((r) => !usedRel.has(r.OBJECTID)).map((r) => ({ objectId: r.OBJECTID, county: r.County, state: r.State }));
if (matched.size + Object.keys(nullPlaces).length !== counties.rows.length) throw new Error("places + nullPlaces is not every county");
if (Object.keys(nullPlaces).length > 50) throw new Error(`${Object.keys(nullPlaces).length} counties null; the join is broken, nothing written`);

// ------------------------------------------------------------------ write
for (const [k, x] of Object.entries(EXPORTS)) {
  const places = [];
  const value = [];
  const nullCells = {};
  const sourceIds = {};
  const publishedZeros = [];
  const nullByFeature = Object.fromEntries(x.features.map(([f]) => [f, 0]));
  for (const c of counties.rows) {
    const m = matched.get(c.geoid);
    if (!m) continue;
    const row = m[k === "releases" ? "rel" : "fac"];
    places.push(c.geoid);
    sourceIds[c.geoid] = row.OBJECTID;
    value.push(
      x.features.map(([f, field]) => {
        const v = count(row[field]);
        if (v == null) {
          (nullCells[c.geoid] ??= {})[f] = "source:null_in_county_layer";
          nullByFeature[f]++;
        } else if (v === 0) publishedZeros.push({ geoid: c.geoid, feature: f });
        return v;
      }),
    );
  }
  const stusab = new Map(counties.rows.map((c) => [c.geoid, c.stusab]));
  // Null cells by feature and state (most-null state first), and published zeros by feature.
  const nullByState = Object.fromEntries(x.features.map(([f]) => [f, {}]));
  for (const [g, cells] of Object.entries(nullCells)) for (const f of Object.keys(cells)) nullByState[f][stusab.get(g)] = (nullByState[f][stusab.get(g)] ?? 0) + 1;
  for (const f of Object.keys(nullByState)) nullByState[f] = Object.fromEntries(Object.entries(nullByState[f]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const zerosByFeature = Object.fromEntries(x.features.map(([f]) => [f, publishedZeros.filter((z) => z.feature === f).length]));
  // A state whose every county is null for a feature reported nothing for it (e.g. release status in Kentucky).
  const stateWide = [];
  for (const [f] of x.features) {
    const byState = new Map();
    for (const g of places) {
      const st = counties.rows.find((c) => c.geoid === g).stusab;
      const e = byState.get(st) ?? { n: 0, nulls: 0 };
      e.n++;
      if (nullCells[g]?.[f]) e.nulls++;
      byState.set(st, e);
    }
    for (const [st, e] of byState) if (e.nulls === e.n) stateWide.push({ state: st, feature: f, counties: e.n });
  }
  const wholeState = (f) => new Set(stateWide.filter((w) => w.feature === f).map((w) => w.state));
  let nullPattern = null;
  let nullCellNote;
  if (k === "releases") {
    // Release_Count is never null; Open_Count and No_Further_Action_Count are never 0. Where all three are
    // published, open + no further action never exceeds the release count, so release == NFA leaves 0 open.
    const [R, O, N] = [0, 1, 2];
    const wsOpen = wholeState("ust_open_release_count");
    const wsNfa = wholeState("ust_nfa_release_count");
    const e = {
      openNull: 0,
      openNullOutsideWholeStateNulls: 0,
      openNullOutsideWholeStateNullsReleaseEqualsNfa: 0,
      nfaNull: 0,
      nfaNullOutsideWholeStateNulls: 0,
      nfaNullOutsideWholeStateNullsOpenEqualsRelease: 0,
      bothNull: 0,
      releaseZeroWithNullStatus: [],
      allPublished: 0,
      openPlusNfaEqualsRelease: 0,
      openPlusNfaBelowRelease: 0,
      openPlusNfaAboveRelease: 0,
    };
    places.forEach((g, i) => {
      const v = value[i];
      const st = stusab.get(g);
      if (v[O] == null) {
        e.openNull++;
        if (!wsOpen.has(st)) {
          e.openNullOutsideWholeStateNulls++;
          if (v[N] != null && v[N] === v[R]) e.openNullOutsideWholeStateNullsReleaseEqualsNfa++;
        }
      }
      if (v[N] == null) {
        e.nfaNull++;
        if (!wsNfa.has(st)) {
          e.nfaNullOutsideWholeStateNulls++;
          if (v[O] != null && v[O] === v[R]) e.nfaNullOutsideWholeStateNullsOpenEqualsRelease++;
        }
      }
      if (v[O] == null && v[N] == null) e.bothNull++;
      if (v[R] === 0 && (v[O] == null || v[N] == null)) e.releaseZeroWithNullStatus.push(g);
      if (v[R] != null && v[O] != null && v[N] != null) {
        e.allPublished++;
        const t = v[O] + v[N];
        if (t === v[R]) e.openPlusNfaEqualsRelease++;
        else if (t < v[R]) e.openPlusNfaBelowRelease++;
        else e.openPlusNfaAboveRelease++;
      }
    });
    nullPattern = { publishedZerosByFeature: zerosByFeature, ...e };
    const others = (f, skip) => Object.entries(nullByState[f]).filter(([st]) => !skip.has(st));
    const oOpen = others("ust_open_release_count", wsOpen);
    const oNfa = others("ust_nfa_release_count", wsNfa);
    const fmt = (xs) => xs.map(([st, n]) => `${st} ${n}`).join(", ");
    nullCellNote =
      `The layer never publishes a 0 for Open_Count or No_Further_Action_Count (${zerosByFeature.ust_open_release_count + zerosByFeature.ust_nfa_release_count} zeros in either field, against ${e.openNull} and ${e.nfaNull} nulls), so a null in these two fields most likely means 0 for many counties. The nulls are kept, not filled: the export does not decide it, and missingness is not random. ` +
      `Open releases: ${e.openNull} nulls, ${e.openNull - e.openNullOutsideWholeStateNulls} of them every county of ${[...wsOpen].join(", ")} (no open count reported) and ${e.openNullOutsideWholeStateNulls} in ${oOpen.length} other states (${fmt(oOpen)}); in ${e.openNullOutsideWholeStateNullsReleaseEqualsNfa} of those ${e.openNullOutsideWholeStateNulls} the release count equals the no-further-action count, which leaves 0 open. ` +
      `No further action: ${e.nfaNull} nulls, ${e.nfaNull - e.nfaNullOutsideWholeStateNulls} of them every county of ${[...wsNfa].join(", ")} and ${e.nfaNullOutsideWholeStateNulls} elsewhere (${fmt(oNfa)}); in ${e.nfaNullOutsideWholeStateNullsOpenEqualsRelease} of those the open count equals the release count, which leaves 0 closed with no further action. ` +
      `Where all three are published (${e.allPublished} counties), open + no further action equals the release count in ${e.openPlusNfaEqualsRelease}, is below it in ${e.openPlusNfaBelowRelease} (releases of another status) and is never above it. ` +
      `${e.releaseZeroWithNullStatus.length} counties publish 0 releases with a null status count (${e.releaseZeroWithNullStatus.join(", ")}${e.releaseZeroWithNullStatus.includes("15005") ? "; 15005 is Kalawao, HI" : ""}), where the status counts can only be 0. Evidence in nullPattern.`;
  } else {
    const fmtState = (f) => Object.entries(nullByState[f]).map(([st, n]) => `${st} ${n}`).join(", ") || "none";
    const partial = [...new Set(Object.values(nullByState).flatMap((o) => Object.keys(o)))].filter((st) => !stateWide.some((w) => w.state === st)).sort();
    nullCellNote =
      `Null cells by feature and state: open tanks ${fmtState("ust_open_tanks")}; closed tanks ${fmtState("ust_closed_tanks")}; temporarily out of service ${fmtState("ust_tos_tanks")}. ` +
      `Null in every county: ${[...new Set(stateWide.map((w) => w.state))].join(", ") || "none"}; in some counties only: ${partial.join(", ") || "none"} (which counties: nullCells). Kept null, never 0.`;
  }
  const p = pulled[k];
  const out = {
    meta: {
      collection: x.collection,
      what: x.what,
      form: "static",
      asOf: "state records as of 2018-2021; tribal records to October 2025 (the service's own description)",
      years: null,
      features: x.features.map(([f]) => f),
      featureFields: Object.fromEntries(x.features),
      source: {
        name: "EPA UST Finder (Office of Underground Storage Tanks, Office of Research and Development, ASTSWMO)",
        service: SERVICE,
        serviceDescription: String(service.j.serviceDescription ?? "").trim() || null,
        layer: `${SERVICE}/${x.layer}`,
        query: { where: "1=1", outFields: x.fields, orderByFields: "OBJECTID", page: PAGE },
        pages: p.pages,
        geometryCheck: { layer: `${SERVICE}/${EXPORTS.releases.layer}`, maxAllowableOffset: 0.001, pages: geo.pages },
        fetchedAt,
        serviceDataLastEdit: p.dataLastEdit,
      },
      counties: { file: "lib/places/data/counties.json", source: counties.meta.source, pulled: counties.meta.pulled, count: counties.rows.length },
      join: "Each county in counties.json is looked up by state and normalised name among the layer's rows (no FIPS in the layer); a name must match exactly one row and a row serves one county. Checked by point: the county's Census internal point must fall in the polygon of the row its name matched.",
      zero_vs_missing: "as-published",
      zeroRule: "Every county has a row, so no 0 is inferred from an absent row. A 0 is the layer's own published 0 (listed in publishedZeros); the composite is only as complete as each state's records, so vector-places may treat a published 0 as observed or mask it.",
      nullRule: "A county with no UST row is null for every feature (nullPlaces, join:no_source_row): Connecticut's nine planning regions (UST Finder has the eight legacy counties) and Alaska's Chugach and Copper River (UST Finder has their predecessor, Valdez-Cordova, listed in unusedSourceRows). A county whose internal point lands in another row's polygon is null (join:name_point_disagree). A field the layer leaves null is null for that county and feature (nullCells, source:null_in_county_layer), never 0; stateWideNulls lists states where it is null for every county, counts.nullCellsByState every state with a null cell, and nullCellNote what the nulls most likely mean.",
      nullCellNote,
      counts: {
        serviceCount: p.expected,
        rowsRead: p.rows.length,
        places: places.length,
        nullPlaces: Object.keys(nullPlaces).length,
        nullCells: Object.values(nullCells).reduce((a, o) => a + Object.keys(o).length, 0),
        nullCellsByFeature: nullByFeature,
        nullCellsByState: nullByState,
        publishedZeros: publishedZeros.length,
        unusedSourceRows: unusedRows.length,
        internalPointInMatchedRow: pointAgree,
        internalPointInNoRow: pointOutside.length,
        nameAndPointDisagree: disagree.length,
      },
      observedShare: Object.fromEntries(x.features.map(([f]) => [f, Number(((places.length - nullByFeature[f]) / counties.rows.length).toFixed(4))])),
      stateWideNulls: stateWide,
      ...(nullPattern ? { nullPattern } : {}),
      publishedZeros,
      unusedSourceRows: unusedRows,
      pointOutside,
      disagree,
      generatedBy: "scripts/export-ust-county.mjs",
    },
    places,
    /** value[p][f], in the order of places and meta.features; null where nullCells gives the reason. */
    value,
    nullPlaces,
    nullCells,
    /** The UST Finder OBJECTID each county's values were read from. */
    sourceIds,
  };
  writeFileSync(path.resolve(x.file), JSON.stringify(out) + "\n");
  console.log(x.collection, JSON.stringify(out.meta.counts), JSON.stringify(out.meta.observedShare));
  console.log(" stateWide", JSON.stringify(stateWide));
}
console.log("nullPlaces", JSON.stringify(nullPlaces));
console.log("unused", JSON.stringify(unusedRows));
console.log("disagree", JSON.stringify(disagree), "outside", JSON.stringify(pointOutside));
