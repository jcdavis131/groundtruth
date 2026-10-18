// Builds the two bundled snapshots behind the Power plants layer:
//
//   lib/infra/data/plants-eia860m.json   EIA-860M, every US generator of 1 MW or more,
//                                        grouped by plant: operating and planned capacity
//                                        by technology, the plant's position, county and
//                                        state, and the EIA entity that reports it
//   lib/infra/data/nuclear-wikidata.json Wikidata (CC0) nuclear power plants outside the
//                                        United States: position, country, status labels,
//                                        and the best-rank nameplate capacity statements
//                                        with their dates and method, where Wikidata has them
//
// Both change monthly at most, so they ride in the repo with the date they were
// pulled and the file or query they came from; /api/infra?op=plants serves them by
// box. Re-run to refresh:  node scripts/infra-data.mjs  (or add `eia` or `nuclear`
// to rebuild only that snapshot).
//
// Nothing here is typed in by hand. The EIA workbook is read cell by cell (a
// minimal .xlsx reader below: the zip's central directory, deflate, the shared
// strings and the sheet XML); a cell EIA left blank stays blank. The newest
// monthly file is the newest one the EIA-860M page links under /xls/ that
// answers 200 with a workbook (the page lists months that are not published yet,
// which redirect). Wikidata's own labels are used as they are, in English where
// Wikidata has an English label, else the first of the listed languages.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const UA = "embedding-atlas/0.1 (+https://github.com/jcdavis131/gods-eye-view; open-source globe)";
const OUT = path.resolve("lib/infra/data");
fs.mkdirSync(OUT, { recursive: true });

const EIA_PAGE = "https://www.eia.gov/electricity/data/eia860m/";
const WDQS = "https://query.wikidata.org/sparql";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// ------------------------------------------------------------------ minimal xlsx reader

/** Entries of a zip archive by name -> { method, compSize, offset } from its central directory. */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf, entries, name) {
  const e = entries.get(name);
  if (!e) throw new Error(`zip has no ${name}`);
  const lh = e.localOffset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("bad local header");
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip method ${e.method}`);
}

const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unxml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENT[e.toLowerCase()],
  );
}

function sharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = "";
    for (const t of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += t[1];
    out.push(unxml(s));
  }
  return out;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Rows of a worksheet as arrays of cell text ("" for an empty cell), in sheet order. */
function sheetRows(xml, strings) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) ?? [])[1];
      if (!ref) continue;
      const type = (attrs.match(/\bt="(\w+)"/) ?? [])[1];
      const inner = cm[2] ?? "";
      let v = "";
      if (type === "s") {
        const idx = (inner.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        v = idx != null ? strings[Number(idx)] ?? "" : "";
      } else if (type === "inlineStr") {
        v = unxml([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      } else {
        const val = (inner.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        v = val != null ? unxml(val) : "";
      }
      row[colIndex(ref)] = v;
    }
    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = "";
    rows.push(row);
  }
  return rows;
}

function workbookSheets(buf) {
  const entries = zipEntries(buf);
  const wb = zipRead(buf, entries, "xl/workbook.xml").toString("utf8");
  const rels = zipRead(buf, entries, "xl/_rels/workbook.xml.rels").toString("utf8");
  const strings = entries.has("xl/sharedStrings.xml") ? sharedStrings(zipRead(buf, entries, "xl/sharedStrings.xml").toString("utf8")) : [];
  const target = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) target.set(m[1], m[2]);
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) target.set(m[2], m[1]);
  const sheets = new Map();
  for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    const t = target.get(m[2]);
    if (t) sheets.set(unxml(m[1]), () => sheetRows(zipRead(buf, entries, t.startsWith("/") ? t.slice(1) : `xl/${t}`).toString("utf8"), strings));
  }
  return sheets;
}

// ------------------------------------------------------------------ EIA-860M

async function newestWorkbook() {
  const html = await (await fetch(EIA_PAGE, { headers: { "user-agent": UA } })).text();
  const links = [...new Set([...html.matchAll(/\/electricity\/data\/eia860m\/xls\/([a-z]+)_generator(\d{4})\.xlsx/g)].map((m) => `${m[1]}|${m[2]}`))]
    .map((k) => {
      const [month, year] = k.split("|");
      return { month, year: Number(year), m: MONTHS.indexOf(month), url: `https://www.eia.gov/electricity/data/eia860m/xls/${month}_generator${year}.xlsx` };
    })
    .filter((x) => x.m >= 0)
    .sort((a, b) => b.year - a.year || b.m - a.m);
  for (const l of links) {
    const res = await fetch(l.url, { headers: { "user-agent": UA }, redirect: "manual" });
    if (res.status !== 200) {
      console.log(`  ${l.month} ${l.year}: ${res.status}, not published yet`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.readUInt32LE(0) !== 0x04034b50) {
      console.log(`  ${l.month} ${l.year}: not a workbook`);
      continue;
    }
    return { ...l, buf, lastModified: res.headers.get("last-modified") };
  }
  throw new Error("no EIA-860M generator workbook answered");
}

const num = (s) => {
  if (s == null || String(s).trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const txt = (s) => (s == null || String(s).trim() === "" ? undefined : String(s).trim());
const r1 = (n) => Math.round(n * 10) / 10;

function headerIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) if (rows[i][0] === "Entity ID") return i;
  throw new Error("EIA sheet: no header row starting 'Entity ID'");
}

function columns(header, names) {
  const out = {};
  for (const n of names) {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`EIA sheet: no column '${n}'`);
    out[n] = i;
  }
  return out;
}

async function buildPlants() {
  const wbk = await newestWorkbook();
  console.log(`EIA-860M: ${wbk.month} ${wbk.year} (${(wbk.buf.length / 1e6).toFixed(1)} MB)`);
  const sheets = workbookSheets(wbk.buf);
  const tables = {};
  let asOf;
  for (const name of ["Operating", "Planned"]) {
    const read = sheets.get(name);
    if (!read) throw new Error(`EIA workbook has no '${name}' sheet`);
    const rows = read();
    if (name === "Operating") asOf = (rows[0]?.[0] ?? "").replace(/^.*as of\s*/i, "").trim() || undefined;
    const h = headerIndex(rows);
    tables[name] = { header: rows[h], rows: rows.slice(h + 1).filter((r) => /^\d+$/.test(String(r[0] ?? "").trim())) };
  }
  const COLS = ["Entity ID", "Entity Name", "Plant ID", "Plant Name", "Plant State", "County", "Balancing Authority Code", "Sector", "Generator ID", "Nameplate Capacity (MW)", "Technology", "Status", "Latitude", "Longitude"];
  const techs = [];
  const entities = [];
  const sectors = [];
  const statuses = [];
  const idx = (arr, v) => {
    if (v == null) return -1;
    let i = arr.indexOf(v);
    if (i < 0) {
      i = arr.length;
      arr.push(v);
    }
    return i;
  };
  const plants = new Map();
  let noPosition = 0;
  for (const sheet of ["Operating", "Planned"]) {
    const { header, rows } = tables[sheet];
    const c = columns(header, sheet === "Planned" ? [...COLS, "Planned Operation Month", "Planned Operation Year"] : [...COLS, "Operating Year"]);
    for (const r of rows) {
      const id = num(r[c["Plant ID"]]);
      if (id == null) continue;
      let p = plants.get(id);
      if (!p) {
        p = {
          id,
          name: txt(r[c["Plant Name"]]),
          state: txt(r[c["Plant State"]]),
          county: txt(r[c["County"]]),
          lat: num(r[c["Latitude"]]),
          lon: num(r[c["Longitude"]]),
          entity: idx(entities, txt(r[c["Entity Name"]])),
          sector: idx(sectors, txt(r[c["Sector"]])),
          ba: txt(r[c["Balancing Authority Code"]]),
          op: new Map(),
          planned: new Map(),
          status: new Map(),
          firstYear: undefined,
          plannedYear: undefined,
        };
        plants.set(id, p);
      }
      // A position from either sheet (planned plants carry one too).
      if (p.lat == null) p.lat = num(r[c["Latitude"]]);
      if (p.lon == null) p.lon = num(r[c["Longitude"]]);
      const mw = num(r[c["Nameplate Capacity (MW)"]]);
      const tech = idx(techs, txt(r[c["Technology"]]) ?? "not reported");
      const bucket = sheet === "Operating" ? p.op : p.planned;
      const cur = bucket.get(tech) ?? { mw: 0, n: 0, unreported: 0 };
      cur.n++;
      if (mw == null) cur.unreported++;
      else cur.mw += mw;
      bucket.set(tech, cur);
      if (sheet === "Operating") {
        const st = idx(statuses, txt(r[c["Status"]]) ?? "not reported");
        p.status.set(st, (p.status.get(st) ?? 0) + 1);
        const y = num(r[c["Operating Year"]]);
        if (y != null && (p.firstYear == null || y < p.firstYear)) p.firstYear = y;
      } else {
        const y = num(r[c["Planned Operation Year"]]);
        if (y != null && (p.plannedYear == null || y < p.plannedYear)) p.plannedYear = y;
      }
    }
  }
  const rows = [];
  for (const p of [...plants.values()].sort((a, b) => a.id - b.id)) {
    if (p.lat == null || p.lon == null || (p.lat === 0 && p.lon === 0)) {
      noPosition++;
      continue;
    }
    const pack = (m) => [...m.entries()].sort((a, b) => b[1].mw - a[1].mw).map(([t, v]) => [t, r1(v.mw), v.n, v.unreported]);
    const opMw = r1([...p.op.values()].reduce((s, v) => s + v.mw, 0));
    const plannedMw = r1([...p.planned.values()].reduce((s, v) => s + v.mw, 0));
    rows.push([
      p.id,
      p.name ?? null,
      p.state ?? null,
      p.county ?? null,
      Number(p.lat.toFixed(5)),
      Number(p.lon.toFixed(5)),
      p.entity,
      p.sector,
      p.ba ?? null,
      opMw,
      pack(p.op),
      [...p.status.entries()].map(([s, n]) => [s, n]),
      p.firstYear ?? null,
      plannedMw,
      pack(p.planned),
      p.plannedYear ?? null,
    ]);
  }
  const doc = {
    source: "U.S. Energy Information Administration, Form EIA-860M (Preliminary Monthly Electric Generator Inventory)",
    file: wbk.url,
    inventoryAsOf: asOf ?? `${wbk.month} ${wbk.year}`,
    lastModified: wbk.lastModified,
    pulled: new Date().toISOString().slice(0, 10),
    note: "Generators of 1 MW or more, grouped by EIA plant id. Capacities are nameplate MW summed over a plant's generators on the Operating and Planned sheets; a generator with no nameplate value is counted in n and in 'unreported', never as 0 MW.",
    columns: ["plantId", "name", "state", "county", "lat", "lon", "entity", "sector", "balancingAuthority", "operatingMW", "operatingByTech[tech,MW,n,unreported]", "operatingStatus[status,n]", "firstOperatingYear", "plannedMW", "plannedByTech[tech,MW,n,unreported]", "firstPlannedYear"],
    techs,
    entities,
    sectors,
    statuses,
    plantsWithoutPosition: noPosition,
    plants: rows,
  };
  const file = path.join(OUT, "plants-eia860m.json");
  fs.writeFileSync(file, JSON.stringify(doc));
  console.log(`  ${rows.length} plants (${noPosition} without a position left out), ${(fs.statSync(file).size / 1e6).toFixed(2)} MB -> ${file}`);
}

// ------------------------------------------------------------------ Wikidata nuclear plants

// wdt: answers best-rank values only (a preferred statement hides the normal ones).
// Capacity statements are the same: several P2109 statements on a plant are
// Wikidata's figures for the whole plant at different times (P585 point in time,
// P580 start, P582 end) or by a named method (P459), not one per unit, and an
// editor marks the current one preferred. So only best-rank statements are read
// (wikibase:BestRank: the preferred ones when there are any, else the normal
// ones; never deprecated), each with its date qualifiers at the precision
// Wikidata states them (pqv: gives the precision; a year is returned as
// YYYY-01-01) and its method. The OPTIONAL joins multiply the rows (coordinates x
// countries x statuses x capacity statements x qualifiers), so every field is
// collected as a set of distinct values, never counted by rows.
const NUCLEAR_QUERY = `
SELECT ?p ?pLabel ?c ?country ?countryLabel ?statusLabel ?capSt ?watts ?pit ?pitP ?start ?startP ?end ?endP ?methodLabel WHERE {
  ?p wdt:P31/wdt:P279* wd:Q134447; wdt:P625 ?c.
  OPTIONAL { ?p wdt:P17 ?country }
  OPTIONAL { ?p wdt:P5817 ?status }
  OPTIONAL {
    ?p p:P2109 ?capSt.
    ?capSt a wikibase:BestRank; psn:P2109/wikibase:quantityAmount ?watts.
    OPTIONAL { ?capSt pqv:P585 ?pitV. ?pitV wikibase:timeValue ?pit; wikibase:timePrecision ?pitP. }
    OPTIONAL { ?capSt pqv:P580 ?startV. ?startV wikibase:timeValue ?start; wikibase:timePrecision ?startP. }
    OPTIONAL { ?capSt pqv:P582 ?endV. ?endV wikibase:timeValue ?end; wikibase:timePrecision ?endP. }
    OPTIONAL { ?capSt pq:P459 ?method }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,fr,de,es,ja,zh,ru,uk,ko,pt,it,sv,cs,fi,nl". }
}`;

/**
 * A Wikidata time at the precision Wikidata states it: day (11) YYYY-MM-DD, month
 * (10) YYYY-MM, year (9) YYYY, decade (8) YYY0s. Coarser, or unparseable: null,
 * and the caller counts it (a century is not a date to order capacities by).
 */
function wdTime(value, precision) {
  const m = /^(-?\d{1,})-(\d\d)-(\d\d)T/.exec(value ?? "");
  const p = Number(precision);
  if (!m) return null;
  const y = m[1].replace(/^(-?)0+(?=\d{4})/, "$1");
  if (p >= 11) return `${y}-${m[2]}-${m[3]}`;
  if (p === 10) return `${y}-${m[2]}`;
  if (p === 9) return y;
  if (p === 8) return `${y.slice(0, -1)}0s`;
  return null;
}

/** Coordinates as distinct "lon lat" values, sorted west to east (then south to north), so the drawn one is fixed. */
function distinctCoords(set) {
  return [...set]
    .map((k) => k.split(" ").map(Number))
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

async function buildNuclear() {
  const url = `${WDQS}?format=json&query=${encodeURIComponent(NUCLEAR_QUERY)}`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const j = await res.json();
  const byQ = new Map();
  const coarseDates = new Set();
  for (const b of j.results.bindings) {
    const q = b.p.value.replace(/^.*\//, "");
    let e = byQ.get(q);
    if (!e) {
      e = { q, name: undefined, coords: new Set(), countries: new Set(), countryQs: new Set(), status: new Set(), caps: new Map() };
      byQ.set(q, e);
    }
    const label = b.pLabel?.value;
    // The label service answers the bare Q-id when no listed language has a label.
    if (label && label !== q) e.name = label;
    const m = (b.c?.value ?? "").match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
    if (m) e.coords.add(`${Number(m[1])} ${Number(m[2])}`);
    if (b.country) {
      e.countryQs.add(b.country.value.replace(/^.*\//, ""));
      if (b.countryLabel?.value) e.countries.add(b.countryLabel.value);
    }
    if (b.statusLabel?.value) e.status.add(b.statusLabel.value);
    // Keyed by statement: the row product repeats each one (once per qualifier combination).
    if (b.capSt?.value && b.watts?.value != null && Number.isFinite(Number(b.watts.value))) {
      let st = e.caps.get(b.capSt.value);
      if (!st) e.caps.set(b.capSt.value, (st = { watts: Number(b.watts.value), pit: new Set(), start: new Set(), end: new Set(), method: new Set() }));
      for (const [k, v, p] of [["pit", b.pit, b.pitP], ["start", b.start, b.startP], ["end", b.end, b.endP]]) {
        if (!v?.value) continue;
        const t = wdTime(v.value, p?.value);
        if (t) st[k].add(t);
        else coarseDates.add(`${q} ${k} ${v.value} precision ${p?.value}`);
      }
      // The label service answers the bare Q-id when no listed language has a label.
      const method = b.methodLabel?.value;
      if (method && !/^Q\d+$/.test(method)) st.method.add(method);
    }
  }
  if (coarseDates.size) console.warn(`  ${coarseDates.size} capacity date qualifiers coarser than a decade, left out: ${[...coarseDates].join("; ")}`);
  const rows = [];
  let us = 0;
  let noCountry = 0;
  for (const e of [...byQ.values()].sort((a, b) => a.q.localeCompare(b.q))) {
    if (e.countryQs.has("Q30")) {
      us++;
      continue;
    }
    if (!e.countryQs.size) noCountry++;
    const coords = distinctCoords(e.coords);
    if (!coords.length) continue;
    const [lon, lat] = coords[0];
    // Every best-rank capacity statement, as [MW, point in time, start, end, method]: which
    // one sizes the plant is decided where it is drawn (wikidataCapacity in lib/infra/plants.ts).
    // A qualifier given more than once on one statement keeps every value ("a, b").
    const one = (s) => (s.size ? [...s].sort().join(", ") : null);
    const caps = [...e.caps.values()]
      .map((st) => [Math.round(st.watts / 1e4) / 100, one(st.pit), one(st.start), one(st.end), one(st.method)])
      .sort((a, b) => b[0] - a[0] || String(a.slice(1)).localeCompare(String(b.slice(1))));
    rows.push([e.q, e.name ?? null, Number(lon.toFixed(5)), Number(lat.toFixed(5)), [...e.countries].sort().join(" / ") || null, [...e.status].sort(), caps, coords.length]);
  }
  const doc = {
    source: "Wikidata (CC0), items that are an instance of nuclear power plant (Q134447) or a subclass, with a coordinate location",
    query: NUCLEAR_QUERY.trim(),
    endpoint: WDQS,
    pulled: new Date().toISOString().slice(0, 10),
    note: "Plants in the United States (country Q30) are left out: the layer shows them from EIA-860M. Status labels (P5817) and nameplate capacity (P2109) only where Wikidata has them; completeness is Wikidata's. capacities[] holds one [MW, pointInTime, start, end, method] per best-rank P2109 statement (the preferred ones when a plant has any, else the normal ones): MW from Wikidata's normalised watts, the dates from its P585, P580 and P582 qualifiers at the precision Wikidata states (YYYY-MM-DD, YYYY-MM, YYYY, or a decade as YYY0s), the method the label of its P459 qualifier, null where the statement has none. coordinateCount is the number of distinct best-rank coordinate locations (P625); when there are several, lon/lat is the westernmost.",
    columns: ["qid", "name", "lon", "lat", "country", "status[]", "capacities[]", "coordinateCount"],
    leftOutInUS: us,
    withoutCountry: noCountry,
    plants: rows,
  };
  const file = path.join(OUT, "nuclear-wikidata.json");
  fs.writeFileSync(file, JSON.stringify(doc));
  console.log(`Wikidata: ${rows.length} plants outside the US (${us} US left out, ${noCountry} with no country) -> ${file}`);
}

// `node scripts/infra-data.mjs` rebuilds both; `... eia` or `... nuclear` rebuilds one.
const only = process.argv[2];
if (only && only !== "eia" && only !== "nuclear") throw new Error(`unknown snapshot ${only}: eia | nuclear`);
if (!only || only === "eia") await buildPlants();
if (!only || only === "nuclear") await buildNuclear();
