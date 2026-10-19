// Record a world_context fixture: run the tool against a live deployment, keep every route reply it
// asked for, trim each to the fields lib/mcp/world.ts reads, and write
// lib/mcp/__fixtures__/world/<name>.json for the invariant in world.test.ts.
//
//   node scripts/world-record.mjs <name> '<input json>' [base]
//   node scripts/world-record.mjs mobile_01097 '{"fips":"01097"}'
//   node scripts/world-record.mjs collegeville_pa_pt '{"lon":-75.4516,"lat":40.1856}' https://<preview>
//   node scripts/world-record.mjs mobile_01097 --fill
//
// --fill keeps an existing fixture's recorded replies, fetches live only the routes the tool now
// asks for that it lacks (a new topic, or a moved point), drops routes it no longer asks for, and
// lists what it added under "filled". That keeps a recording (or a stated derivation) as it was.
//
// base defaults to https://www.arxiviq.com. A preview behind deployment protection needs
// VERCEL_BYPASS in the environment (sent as x-vercel-protection-bypass, never written anywhere).
// The tool is compiled the same way scripts/mcp-stdio.mjs compiles it (run that once with
// --manifest first); the county point comes from the bundled county table, as in production.
//
// Trimming never changes what the tool sees: it keeps every field world.ts reads and drops the
// rest (addresses, websites, free text, water system names, geometry of records the tool does
// not use, and of a service area all but the polygon part holding the point). Live NWS items are kept only when they touch the search box, water features only
// when their service area holds the point; the tool ignores the others.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, inputJson, baseArg] = process.argv.slice(2);
if (!name || !inputJson || !/^[a-z0-9_]+$/.test(name)) {
  console.error("usage: node scripts/world-record.mjs <name> '<input json>' [base] | <name> --fill [base]");
  process.exit(2);
}
const fill = inputJson === "--fill";
const file = path.join(root, "lib", "mcp", "__fixtures__", "world", `${name}.json`);
const old = fill ? JSON.parse(readFileSync(file, "utf8")) : null;
const base = (baseArg || "https://www.arxiviq.com").replace(/\/+$/, "");
const input = fill ? old.input : JSON.parse(inputJson);

const out = path.join(root, ".tmp-mcp");
const { worldContext } = await import(pathToFileURL(path.join(out, "world.js")).href);
const { toolByName } = await import(pathToFileURL(path.join(out, "tools.js")).href);

const counties = JSON.parse(readFileSync(path.join(root, "lib", "places", "data", "counties.json"), "utf8"));
const rows = new Map(counties.rows.map((c) => [c.geoid, c]));
const countyPoint = (fips) => {
  const c = rows.get(fips);
  return c ? { lon: c.lon, lat: c.lat, pulled: counties.meta.pulled ?? null } : null;
};

const headers = { accept: "application/json", "user-agent": "groundtruth-world-record/0.1" };
if (process.env.VERCEL_BYPASS) headers["x-vercel-protection-bypass"] = process.env.VERCEL_BYPASS;

const routes = {};
const added = [];
const fetchJson = async (p) => {
  if (old?.routes[p]) {
    routes[p] = old.routes[p];
    return { status: old.routes[p].status, body: structuredClone(old.routes[p].body), url: "http://t" + p };
  }
  added.push(p);
  const url = base + p;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(55_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: "non-JSON reply", text: text.slice(0, 200) };
  }
  routes[p] = { status: res.status, body };
  return { status: res.status, body, url };
};

const parsed = toolByName("world_context").inputSchema.parse(input);
const reply = await worldContext(parsed, { fetchJson, countyPoint });
const place = reply.payload.place ?? {};

// ---- trimming -------------------------------------------------------------------

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const prov = (list) => (Array.isArray(list) ? list.map((x) => ({ source: pick(x.source ?? {}, ["id", "publisher", "url"]), ...pick(x, ["upstreamUrl", "retrievedAt"]) })) : list);
const box = Array.isArray(place.searchBox) ? place.searchBox : null;
const touches = (b) => box && Array.isArray(b) && b.length === 4 && box[0] <= b[2] && box[2] >= b[0] && box[1] <= b[3] && box[3] >= b[1];
const inside = (lon, lat) => box && lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];

function ringsIn(v, acc = []) {
  if (Array.isArray(v[0]) && typeof v[0][0] === "number") acc.push(v);
  else for (const x of v) if (Array.isArray(x)) ringsIn(x, acc);
  return acc;
}
function contains(coords, lon, lat) {
  let ins = false;
  for (const ring of ringsIn(coords))
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins;
    }
  return ins;
}

const NODE_FACTS = ["special flood hazard area", "FIRM panel", "drains to", "type"];
const SCREEN_VALUES = ["name", "geoid", "state", "metro", "home.latest", "home.yoyPct", "home.asOf", "rent.latest", "jobs.emp", "jobs.avgWeeklyWage", "jobs.period", "jobs.suppressed"];
const NRI_KEYS = /^(STCOFIPS|COUNTY|STATEABBRV|POPULATION|RISK_SCORE|RISK_RATNG|EAL_VALT|EAL_RATNG|SOVI_SCORE|SOVI_RATNG|NRI_VER|[A-Z]{4}_RISKR)$/;
const DAM_DETAILS = ["hazard potential", "condition assessment", "year completed", "owner type"];

function trim(p, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const d = body.data ?? {};
  const keep = { ...pick(body, ["error", "generatedAt", "truncated", "pulled", "bundle"]), provenance: prov(body.provenance) };
  if (p.startsWith("/api/screen")) keep.data = { rows: (d.rows ?? []).map((r) => ({ name: r.name, geo: r.geo, values: pick(r.values ?? {}, SCREEN_VALUES) })) };
  else if (p.startsWith("/api/fabric?op=stack"))
    keep.data = {
      // lon/lat are the snapped point the fabric read at; record URLs for point queries are built from it.
      point: pick(d.point ?? {}, ["lon", "lat", "elevationM"]),
      nodes: (d.nodes ?? []).map((n) => ({ ...pick(n, ["kind", "name", "code", "source"]), facts: pick(n.facts ?? {}, NODE_FACTS) })),
      ...pick(d, ["failed", "coverage"]),
    };
  else if (p.startsWith("/api/fabric?op=field")) keep.data = { units: (d.units ?? []).map((u) => pick(u, ["code", "name", "rings"])), ...pick(d, ["truncated"]) };
  else if (p.startsWith("/api/hazards?op=nri")) keep.data = { row: Object.fromEntries(Object.entries(d.row ?? {}).filter(([k]) => NRI_KEYS.test(k))) };
  else if (p.startsWith("/api/hazards?op=history"))
    keep.data = {
      ...pick(d, ["fips", "declarationRows", "droughtNow", "missing", "failed"]),
      declarations: (d.declarations ?? []).map((x) => pick(x, ["disasterNumber", "declarationType", "declarationDate", "incidentType", "declarationTitle", "designatedArea", "filedUnder"])),
    };
  else if (p.startsWith("/api/live"))
    keep.data = {
      items: (d.items ?? []).filter((x) => touches(x.bbox) || inside(x.lon, x.lat)).map((x) => pick(x, ["kind", "title", "subtitle", "lon", "lat", "bbox", "time", "until", "url"])),
      ...pick(d, ["failed", "unmapped"]),
    };
  else if (p.startsWith("/api/civic?op=svi")) keep.data = { row: pick(d.row ?? {}, ["fips", "rpl"]) };
  else if (p.startsWith("/api/infra"))
    keep.data = {
      features: (d.features ?? [])
        .filter((f) => inside(f.geometry?.coordinates?.[0], f.geometry?.coordinates?.[1]))
        .map((f) => ({
          geometry: { coordinates: f.geometry.coordinates.slice(0, 2) },
          properties: {
            ...pick(f.properties ?? {}, ["id", "name"]),
            details: pick(f.properties?.details ?? {}, p.includes("op=dams") ? DAM_DETAILS : ["type", "owner type"]),
            extra: pick(f.properties?.extra ?? {}, ["status", "cms", "embedText"]),
          },
        })),
    };
  else if (p.startsWith("/api/companies")) keep.data = { features: (d.features ?? []).map((f) => ({ properties: { extra: pick(f.properties?.extra ?? {}, ["cik", "ticker", "exchange"]) } })) };
  else if (p.startsWith("/api/releases")) keep.data = { ...pick(d, ["from", "to"]), releases: (d.releases ?? []).map((x) => pick(x, ["id", "sourceId", "title", "precision", "window", "scheduleUrl"])) };
  else if (p.startsWith("/api/catalog")) keep.data = { hits: (d.hits ?? []).map((h) => pick(h, ["id", "title", "score"])), ...pick(d, ["matched"]) };
  else if (p.startsWith("/api/water")) {
    const pt = place.point;
    Object.assign(keep, pick(body, ["coverage", "bbox", "polygons"]));
    // Of each service area that holds the point, only the polygon part holding it: its outer ring and any
    // hole that holds the point (none, when it is inside). Containment, all the tool reads, is unchanged.
    const holding = (poly) => {
      const [outer, ...holes] = poly;
      return contains([outer], pt.lon, pt.lat) ? [outer, ...holes.filter((h) => contains([h], pt.lon, pt.lat))] : null;
    };
    const part = (g) => {
      const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map(holding).filter(Boolean);
      return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
    };
    keep.data = {
      features: (d.features ?? [])
        .filter((f) => pt && f.properties?.extra?.placement === "service-area" && /Polygon$/.test(f.geometry?.type ?? "") && contains(f.geometry.coordinates, pt.lon, pt.lat))
        .map((f) => ({ geometry: part(f.geometry), properties: { id: f.properties.id, details: pick(f.properties.details ?? {}, ["population served"]), extra: f.properties.extra } })),
    };
  } else keep.data = d;
  return keep;
}

// A kept reply is written back as recorded (it was trimmed when it was first written).
const trimmed = Object.fromEntries(Object.entries(routes).map(([p, r]) => [p, old?.routes[p] ? r : { status: r.status, body: trim(p, r.body) }]));
mkdirSync(path.dirname(file), { recursive: true });
const from = baseArg ? "the PR preview deployment of this branch" : base;
const head = old ? { ...old, routes: undefined } : { recorded: new Date().toISOString(), from, input };
if (old && added.length) head.filled = [...(old.filled ?? []), { at: new Date().toISOString(), from, routes: added }];
writeFileSync(file, JSON.stringify({ ...head, routes: trimmed }, null, 1) + "\n");
if (old) console.log(`kept ${Object.keys(routes).length - added.length}, added ${added.length}: ${added.join(" ")}`);
const items = Object.values(reply.payload.topics ?? {}).reduce((n, s) => n + (s.items?.length ?? 0), 0);
console.log(`${name}: status ${reply.status}, ${Object.keys(routes).length} routes, ${items} items -> ${path.relative(root, file)}`);
