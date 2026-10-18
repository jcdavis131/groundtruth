// Builds the static inputs of the trade layer from their public sources:
//
//   lib/economy/data/wpi.json        NGA World Port Index (Pub 150), slimmed
//   lib/economy/data/countries.json  Natural Earth 110m admin-0 polygons + label points
//   lib/economy/data/bts_ports.json  BTS Port Performance port ids matched to a
//                                    World Port Index position (provenance kept)
//
// Ports and coastlines do not move, so these ride in the repo with the date
// they were pulled; everything that changes (statistics) is fetched live by
// app/api/economy. Re-run to refresh:  node scripts/economy-data.mjs
//
// Nothing here is typed in by hand. A BTS port gets a position only when
// exactly one US World Port Index entry carries its city name; the rest are
// geocoded through Nominatim (one request per second) and stamped as such;
// river districts that name no city are left out rather than pinned to a town.
//
// The User-Agent comes from lib/server/ua.ts so the routes and this script
// send the same one. Node 22.18+ / 23.6+ strips the (absent) types when it
// imports the .ts file; Node 24.1 prints an ExperimentalWarning for it.

import fs from "node:fs";
import path from "node:path";
import { USER_AGENT as UA } from "../lib/server/ua.ts";

const OUT = path.resolve("lib/economy/data");
fs.mkdirSync(OUT, { recursive: true });

const WPI_URL = "https://msi.nga.mil/api/publications/download?key=16920959/SFH00000/UpdatedPub150.csv&type=download";
const NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const BTS_PORTS_URL = "https://data.bts.gov/resource/5rpz-kgm9.json?$select=port_id,port_name,state,count(*)&$group=port_id,port_name,state&$limit=400";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function get(url, accept = "text/csv") {
  const r = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

const today = new Date().toISOString().slice(0, 10);

// ---- World Port Index
console.log("WPI: downloading");
const wpiText = (await (await get(WPI_URL)).text()).replace(/^﻿/, "");
const wpiRows = parseCsv(wpiText);
const H = wpiRows[0];
const col = (name) => {
  const i = H.indexOf(name);
  if (i < 0) throw new Error("WPI column missing: " + name);
  return i;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" ? n : null;
};
const depth = (v) => {
  const n = num(v);
  return n && n > 0 ? n : null;
};
const yes = (v) => String(v).trim().toLowerCase() === "yes";
const FACILITIES = [
  ["Facilities - Wharves", "wharves"],
  ["Facilities - Anchorage", "anchorage"],
  ["Facilities - Ro-Ro", "ro-ro"],
  ["Facilities - Solid Bulk", "solid bulk"],
  ["Facilities - Liquid Bulk", "liquid bulk"],
  ["Facilities - Container", "container"],
  ["Facilities - Breakbulk", "breakbulk"],
  ["Facilities - Oil Terminal", "oil terminal"],
  ["Facilities - LNG Terminal", "LNG terminal"],
  ["Cranes - Fixed", "fixed cranes"],
  ["Cranes - Mobile", "mobile cranes"],
  ["Cranes - Floating", "floating cranes"],
  ["Cranes Container", "container cranes"],
  ["Railway", "railway"],
  ["Dry Dock", "dry dock"],
];
const SIZE = { "Very Small": "very small", Small: "small", Medium: "medium", Large: "large" };
const ports = [];
for (const r of wpiRows.slice(1)) {
  if (r.length < H.length - 1) continue;
  const lat = num(r[col("Latitude")]);
  const lon = num(r[col("Longitude")]);
  if (lat == null || lon == null) continue;
  const size = SIZE[r[col("Harbor Size")].trim()] ?? null;
  const facilities = FACILITIES.filter(([c]) => yes(r[col(c)])).map(([, label]) => label);
  ports.push({
    id: Number(r[col("World Port Index Number")]),
    name: r[col("Main Port Name")].trim(),
    alt: r[col("Alternate Port Name")].trim() || undefined,
    locode: r[col("UN/LOCODE")].trim() || undefined,
    country: r[col("Country Code")].trim(),
    region: r[col("Region Name")].trim(),
    water: r[col("World Water Body")].trim() || undefined,
    lat,
    lon,
    size,
    type: r[col("Harbor Type")].trim() || undefined,
    use: r[col("Harbor Use")].trim() || undefined,
    shelter: r[col("Shelter Afforded")].trim() || undefined,
    channelM: depth(r[col("Channel Depth (m)")]),
    anchorageM: depth(r[col("Anchorage Depth (m)")]),
    cargoPierM: depth(r[col("Cargo Pier Depth (m)")]),
    oilM: depth(r[col("Oil Terminal Depth (m)")]),
    lngM: depth(r[col("Liquified Natural Gas Terminal Depth (m)")]),
    maxLengthM: depth(r[col("Maximum Vessel Length (m)")]),
    maxDraftM: depth(r[col("Maximum Vessel Draft (m)")]),
    tidalRangeM: depth(r[col("Tidal Range (m)")]),
    facilities,
    repairs: r[col("Repairs")].trim() || undefined,
    firstPortOfEntry: yes(r[col("First Port of Entry")]) || undefined,
    pilotageCompulsory: yes(r[col("Pilotage - Compulsory")]) || undefined,
    vts: yes(r[col("Vessel Traffic Service")]) || undefined,
    chart: r[col("Standard Nautical Chart")].trim() || undefined,
  });
}
fs.writeFileSync(path.join(OUT, "wpi.json"), JSON.stringify({ source: "NGA World Port Index (Pub 150)", url: WPI_URL, pulled: today, ports }));
console.log(`WPI: ${ports.length} ports -> lib/economy/data/wpi.json`);

// ---- Natural Earth countries
console.log("Natural Earth: downloading");
const ne = await (await get(NE_URL, "application/json")).json();
const countries = ne.features.map((f) => {
  const p = f.properties;
  const iso3 = p.ISO_A3 !== "-99" ? p.ISO_A3 : p.ADM0_A3;
  return {
    type: "Feature",
    properties: {
      name: p.NAME,
      nameLong: p.NAME_LONG,
      iso3,
      iso2: p.ISO_A2_EH,
      wb: p.WB_A2 !== "-99" ? p.WB_A2 : undefined,
      lx: p.LABEL_X,
      ly: p.LABEL_Y,
      pop: p.POP_EST,
      popYear: p.POP_YEAR,
      continent: p.CONTINENT,
    },
    geometry: f.geometry,
  };
});
fs.writeFileSync(
  path.join(OUT, "countries.json"),
  JSON.stringify({ source: "Natural Earth 1:110m admin 0 countries (public domain)", url: NE_URL, pulled: today, type: "FeatureCollection", features: countries }),
);
console.log(`Natural Earth: ${countries.length} countries -> lib/economy/data/countries.json`);

// ---- BTS Port Performance ports -> positions
//
// A BTS row names a port authority, not a harbour ("Virginia, VA, Port of").
// The crosswalk below maps an authority name to the harbour city the World
// Port Index lists; it is a naming table, not a coordinate. Each city is then
// geocoded (Nominatim, city level) and the WPI entry nearest that city within
// 150 km supplies the position. A city with no WPI entry keeps the geocoded
// city point and says so. Districts that name no city are left out.
console.log("BTS: port list");
const bts = await (await get(BTS_PORTS_URL, "application/json")).json();
const usPorts = ports.filter((p) => p.country === "United States" || p.country === "Puerto Rico");
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const AUTHORITY_CITY = {
  "New York, NY & NJ": ["New York", "NY"],
  "PortMiami, FL": ["Miami", "FL"],
  "Virginia, VA, Port of": ["Norfolk", "VA"],
  "South Louisiana, LA, Port of": ["LaPlace", "LA"],
  "Toledo-Lucas County Port, OH": ["Toledo", "OH"],
  "Duluth-Superior, MN and WI": ["Duluth", "MN"],
  "South Jersey Port, NJ": ["Camden", "NJ"],
  "Alaska, AK Port of": ["Anchorage", "AK"],
  "Cleveland-Cuyahoga Port, OH": ["Cleveland", "OH"],
  "Greater Baton Rouge, LA Port of": ["Baton Rouge", "LA"],
  "Lake Charles Harbor District, LA": ["Lake Charles", "LA"],
  "Port of Palm Beach District, FL": ["Riviera Beach", "FL"],
  "Philadelphia Regional Port, PA": ["Philadelphia", "PA"],
  "Tampa Port Authority, FL": ["Tampa", "FL"],
  "Houston Port Authority, TX": ["Houston", "TX"],
  "St. Louis, MO and IL": ["St. Louis", "MO"],
  "Pittsburgh, PA Port of": ["Pittsburgh", "PA"],
  "Port Freeport, TX": ["Freeport", "TX"],
  "Honolulu, O'ahu, HI": ["Honolulu", "HI"],
};
const STATE_RE = /,\s*([A-Z]{2})(?:\s*(?:&|and)\s*[A-Z]{2})*\s*$/;
function cityOf(name) {
  let s = name
    .replace(/\b(port of|port authority|port district|harbor district|regional port|port commission|ports? of|of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  const m = s.match(STATE_RE);
  s = s.replace(STATE_RE, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return [s, m ? m[1] : ""];
}
const DISTRICT_RE = /waterway|mid-america|mid-ohio|tristate|statistical area|northern indiana|southern indiana|cincinnati|two harbors|plaquemines|new bourbon/i;
const matched = [];
const seen = new Set();
async function geocode(q) {
  await new Promise((r) => setTimeout(r, 1100));
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us,pr&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  const j = res.ok ? await res.json() : [];
  return j[0] ? { lon: Number(j[0].lon), lat: Number(j[0].lat), name: j[0].display_name } : null;
}
const km = (a, b) => {
  const d2r = Math.PI / 180;
  const x = (b.lon - a.lon) * d2r * Math.cos(((a.lat + b.lat) / 2) * d2r);
  const y = (b.lat - a.lat) * d2r;
  return Math.sqrt(x * x + y * y) * 6371;
};
for (const b of bts) {
  if (DISTRICT_RE.test(b.port_name)) {
    console.log(`  skip (district, no single city): ${b.port_id} ${b.port_name}`);
    continue;
  }
  const [city, st] = AUTHORITY_CITY[b.port_name] ?? cityOf(b.port_name);
  if (!city || !st) {
    console.log(`  skip (no city): ${b.port_id} ${b.port_name}`);
    continue;
  }
  const key = `${city}|${st}`;
  const g = await geocode(`${city}, ${st}`);
  if (!g) {
    console.log(`  NOT placed (geocode failed): ${b.port_id} ${b.port_name}`);
    continue;
  }
  const cityN = norm(city);
  const hits = usPorts
    .filter((p) => norm(p.name) === cityN || norm(p.alt ?? "") === cityN || norm(p.name).startsWith(cityN + " "))
    .map((p) => ({ p, d: km(g, p) }))
    .filter((h) => h.d < 150)
    .sort((a, b2) => a.d - b2.d);
  if (hits.length) {
    const p = hits[0].p;
    matched.push({ portId: b.port_id, name: b.port_name, state: b.state, city, lon: p.lon, lat: p.lat, wpi: p.id, locode: p.locode, position: `World Port Index #${p.id} (${p.name})` });
    console.log(`  WPI: ${b.port_name} -> ${p.name} #${p.id} (${hits[0].d.toFixed(0)} km from city)`);
  } else {
    matched.push({ portId: b.port_id, name: b.port_name, state: b.state, city, lon: g.lon, lat: g.lat, position: `city of ${city}, ${st} (Nominatim); no World Port Index entry` });
    console.log(`  city: ${b.port_name} -> ${g.name.slice(0, 70)}`);
  }
  seen.add(key);
}
fs.writeFileSync(path.join(OUT, "bts_ports.json"), JSON.stringify({ source: "BTS Port Performance Freight Statistics port ids (data.bts.gov/resource/5rpz-kgm9)", pulled: today, ports: matched }, null, 1));
console.log(`BTS: ${matched.length} ports placed -> lib/economy/data/bts_ports.json`);
