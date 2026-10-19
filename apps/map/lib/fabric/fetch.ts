// Server side of the place fabric: ask every upstream about one point in
// parallel, parse what answered, list what did not, assemble the stack.
// Used by /api/fabric; the parsing and ordering live in parse.ts / graph.ts.

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import type { SourceId } from "@/lib/provenance/sources";
import countriesJson from "@/lib/economy/data/countries.json";
import { bboxContains, geojsonRings, ringCentroid, ringsBbox, ringsContain, roundRings, type BBox } from "./geo";
import { assembleFabric } from "./graph";
import { enrichFabricWithWiki } from "./wiki";
import {
  countryNodes,
  federalNodes,
  parseEcoregions,
  parseElevation,
  parseNfhl,
  parseNws,
  parseTiger,
  parseWbd,
  TIGER_COARSE,
  TIGER_FINE,
  type CountryIn,
  type IdentifyResponse,
  type NwsNamed,
  type NwsPoints,
} from "./parse";
import type { ConstructEdge, ConstructKind, ConstructNode, Fabric } from "./types";
import { FIELD_SPECS, fieldOffset, parseField, type ArcQueryResponse, type BBox as BBoxT, type FieldService, type FieldSpec } from "./field";
import { basinFromBundle, parseBasinTable, walkDownstream, type BasinTable, type BundledDrainage, type DownstreamResult } from "./downstream";
import { buildIndex, HUC_LEVELS, upstream, type DrainageIndex, type HucLevel, type Upstream } from "./upstream";

export const TIGER_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
export const WBD_URL = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer";
export const ECO_URL = "https://geodata.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer";
export const NFHL_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
export const NWS_URL = "https://api.weather.gov";
export const EPQS_URL = "https://epqs.nationalmap.gov/v1/json";

/**
 * An ArcGIS identify URL for one point. `offset` is maxAllowableOffset in
 * degrees (server-side generalisation); omit it for attributes only.
 */
export function identifyUrl(base: string, lon: number, lat: number, layers: number[], offset?: number): string {
  const q = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: `all:${layers.join(",")}`,
    tolerance: "0",
    mapExtent: `${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`,
    imageDisplay: "400,400,96",
    returnGeometry: offset != null ? "true" : "false",
    f: "json",
  });
  if (offset != null) q.set("maxAllowableOffset", String(offset));
  return `${base}/identify?${q.toString()}`;
}

async function identify(name: string, url: string, timeoutMs: number): Promise<IdentifyResponse> {
  const j = await polite(name, 100, 30_000, () => upstreamJson<IdentifyResponse>(name, url, { timeoutMs }));
  if (j.error) throw new Error(`${name}: ${j.error.message ?? "identify failed"}`);
  return j;
}

interface CountryIndexEntry {
  c: CountryIn;
  rings: number[][][];
  bbox: BBox;
}
let countryIndex: CountryIndexEntry[] | null = null;

/** The Natural Earth country under a point, from the bundled 1:110m table. */
export function countryAt(lon: number, lat: number): { country: CountryIn; rings: number[][][] } | null {
  if (!countryIndex) {
    countryIndex = [];
    for (const c of (countriesJson as unknown as { features: CountryIn[] }).features) {
      const rings = geojsonRings(c.geometry);
      const bbox = ringsBbox(rings);
      if (bbox) countryIndex.push({ c, rings, bbox });
    }
  }
  for (const e of countryIndex) if (bboxContains(e.bbox, lon, lat) && ringsContain(e.rings, lon, lat)) return { country: e.c, rings: roundRings(e.rings, 3) };
  return null;
}

/** Is the point plausibly served by the US-only upstreams (50 states, PR, territories)? */
export function inUsReach(lon: number, lat: number): boolean {
  return (lat >= 17 && lat <= 72 && lon >= -180 && lon <= -64) || (lat >= 13 && lat <= 21 && lon >= 144 && lon <= 146.5) || (lat >= -15 && lat <= -10 && lon >= -172 && lon <= -168);
}

export interface FabricOptions {
  geometry: boolean;
}

interface Part {
  nodes: ConstructNode[];
  edges: ConstructEdge[];
  elevationM?: number;
  /** Further sources this part answered for (the federal lists ride on TIGERweb's state). */
  also?: SourceId[];
}

/** How long one upstream's answer for a point is kept. Boundaries change yearly at most. */
const PART_TTL_MS = 6 * 3600_000;

/**
 * After an upstream fails, callers skip it for this long and report it as
 * missing straight away, so one hung service (FEMA's is intermittently slow)
 * does not add its whole timeout to every stack until it recovers.
 */
const COOL_DOWN_MS = 5 * 60_000;
const coolDown = new Map<SourceId, { until: number; error: string }>();

async function withCoolDown(source: SourceId, run: () => Promise<Part>): Promise<Part> {
  const c = coolDown.get(source);
  if (c && c.until > Date.now()) throw new Error(`${c.error} (not retried for ${Math.ceil((c.until - Date.now()) / 60_000)} min)`);
  try {
    const part = await run();
    coolDown.delete(source);
    return part;
  } catch (err) {
    coolDown.set(source, { until: Date.now() + COOL_DOWN_MS, error: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    throw err;
  }
}

/**
 * Everything the fabric knows about one point. Never throws for an upstream
 * failure; lists it in `failed`. Each upstream's answer is cached on its own,
 * so a slow or failing service is retried next time without asking the ones
 * that already answered again.
 */
export async function fetchFabric(lon: number, lat: number, opts: FabricOptions): Promise<Fabric> {
  const g = opts.geometry;
  const nodes: ConstructNode[] = [];
  const edges: ConstructEdge[] = [];
  const answered: SourceId[] = [];
  const failed: { source: SourceId; error: string }[] = [];
  let elevationM: number | undefined;

  const country = countryAt(lon, lat);
  if (country) {
    nodes.push(...countryNodes(country.country, g ? country.rings : undefined));
    answered.push("natural-earth");
  }

  const tasks: Array<{ source: SourceId; run: () => Promise<Part> }> = [];
  if (inUsReach(lon, lat)) {
    tasks.push(
      {
        source: "census-tigerweb",
        run: async () => {
          const [fine, coarse] = await Promise.all([
            identify("tigerweb", identifyUrl(TIGER_URL, lon, lat, TIGER_FINE, g ? 0.002 : undefined), 20_000),
            identify("tigerweb", identifyUrl(TIGER_URL, lon, lat, TIGER_COARSE, g ? 0.02 : undefined), 20_000),
          ]);
          const got = [...parseTiger(fine), ...parseTiger(coarse)];
          const state = got.find((n) => n.kind === "state");
          const fed = state?.code ? federalNodes(state.code) : { nodes: [], edges: [] };
          return { nodes: [...got, ...fed.nodes], edges: fed.edges, also: fed.nodes.length ? ["federal-regions"] : [] };
        },
      },
      {
        source: "usgs-wbd",
        run: async () => {
          const [small, large] = await Promise.all([
            identify("usgs-wbd", identifyUrl(WBD_URL, lon, lat, [4, 5, 6], g ? 0.002 : undefined), 20_000),
            identify("usgs-wbd", identifyUrl(WBD_URL, lon, lat, [1, 2, 3], g ? 0.02 : undefined), 20_000),
          ]);
          const a = parseWbd(small);
          const b = parseWbd(large);
          return { nodes: [...a.nodes, ...b.nodes], edges: [...a.edges, ...b.edges] };
        },
      },
      {
        source: "epa-ecoregions",
        run: async () => ({ nodes: parseEcoregions(await identify("epa-ecoregions", identifyUrl(ECO_URL, lon, lat, [7, 11], g ? 0.01 : undefined), 15_000)), edges: [] }),
      },
      {
        source: "fema-nfhl",
        // Flood zones are a node only: their polygons are large and intricate.
        // The service is intermittently slow, so it gets the shortest leash.
        run: async () => ({ nodes: parseNfhl(await identify("fema-nfhl", identifyUrl(NFHL_URL, lon, lat, [3, 22, 28]), 10_000)), edges: [] }),
      },
      {
        source: "nws-api",
        run: async () => {
          const pts = await polite("nws", 100, 30_000, () =>
            upstreamJson<NwsPoints>("nws", `${NWS_URL}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { timeoutMs: 12_000, headers: { accept: "application/geo+json" } }),
          );
          const zoneUrl = pts.properties?.forecastZone;
          const cwa = pts.properties?.cwa;
          const [zone, office] = await Promise.all([
            zoneUrl?.startsWith(NWS_URL) ? upstreamJson<NwsNamed>("nws", zoneUrl, { timeoutMs: 8_000 }).catch(() => null) : null,
            cwa ? upstreamJson<NwsNamed>("nws", `${NWS_URL}/offices/${encodeURIComponent(cwa)}`, { timeoutMs: 8_000 }).catch(() => null) : null,
          ]);
          return parseNws(pts, lon, lat, zone, office);
        },
      },
      {
        source: "usgs-epqs",
        run: async () => ({
          nodes: [],
          edges: [],
          elevationM: parseElevation(await upstreamJson<{ value?: string }>("usgs-epqs", `${EPQS_URL}?x=${lon}&y=${lat}&units=Meters&wkid=4326`, { timeoutMs: 12_000 })),
        }),
      },
    );
  }

  const settled = await Promise.allSettled(tasks.map((t) => cached(`fabric-part:${t.source}:${lon},${lat}:${g ? 1 : 0}`, PART_TTL_MS, () => withCoolDown(t.source, t.run))));
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      const part = s.value.value;
      nodes.push(...part.nodes);
      edges.push(...part.edges);
      if (part.elevationM != null) elevationM = part.elevationM;
      answered.push(tasks[i].source, ...(part.also ?? []));
    } else {
      failed.push({ source: tasks[i].source, error: s.reason instanceof Error ? s.reason.message.slice(0, 160) : String(s.reason) });
    }
  });

  return enrichFabricWithWiki(assembleFabric({ lon, lat, elevationM, nodes, edges, answered, failed }), lon, lat);
}

// ------------------------------------------------------------------ field

const SERVICE_URL = { tiger: TIGER_URL, wbd: WBD_URL, eco: ECO_URL } as const;
const SERVICE_SOURCE: Record<FieldService, SourceId> = { tiger: "census-tigerweb", wbd: "usgs-wbd", eco: "epa-ecoregions" };

/** ArcGIS layer query by envelope, generalised to the bbox. */
export function fieldQueryUrl(spec: FieldSpec, bbox: BBoxT): string {
  const q = new URLSearchParams({
    geometry: bbox.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    maxAllowableOffset: String(fieldOffset(bbox)),
    geometryPrecision: "4",
    outSR: "4326",
    resultRecordCount: "500",
    f: "json",
  });
  return `${SERVICE_URL[spec.service]}/${spec.layer}/query?${q.toString()}`;
}

export interface FieldResult {
  kind: ConstructKind;
  bbox: BBoxT;
  units: ConstructNode[];
  /** The upstream stopped at its record limit; units at the edge of the view may be missing. */
  truncated: boolean;
  source: SourceId;
}

const FIELD_TTL_MS = 24 * 3600_000;

/** Every unit of one kind in a bbox (already clamped by the caller). */
export async function fetchField(kind: ConstructKind, bbox: BBoxT): Promise<FieldResult> {
  const spec = FIELD_SPECS[kind];
  if (!spec) throw new Error(`not a field kind: ${kind}`);
  const r = await cached(`fabric-field:${kind}:${bbox.join(",")}`, FIELD_TTL_MS, async () => {
    const name = spec.service === "tiger" ? "tigerweb" : spec.service === "wbd" ? "usgs-wbd" : "epa-ecoregions";
    const res = await polite(name, 100, 30_000, () => upstreamJson<ArcQueryResponse>(name, fieldQueryUrl(spec, bbox), { timeoutMs: 45_000 }));
    if (res.error) throw new Error(`${name}: ${res.error.message ?? "query failed"}`);
    return { kind, bbox, units: parseField(kind, res), truncated: !!res.exceededTransferLimit, source: SERVICE_SOURCE[spec.service] };
  });
  return r.value;
}

// ------------------------------------------------------------------ downstream

const BASIN_TTL_MS = 30 * 24 * 3600_000;

/** Every HUC-12 in one HUC-4 with its ToHUC, attributes only, one page. */
export function basinQueryUrl(huc4: string, offset = 0): string {
  const q = new URLSearchParams({
    where: `huc12 LIKE '${huc4}%'`,
    outFields: "huc12,tohuc,name,areasqkm",
    returnGeometry: "false",
    orderByFields: "huc12",
    resultOffset: String(offset),
    resultRecordCount: "2000",
    f: "json",
  });
  return `${WBD_URL}/6/query?${q.toString()}`;
}

/** WBD answers 504 when a cold query outlasts its gateway; the same query usually answers on a second try. */
async function wbdOnce<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const go = () => polite("usgs-wbd", 100, 30_000, () => upstreamJson<T>("usgs-wbd", url, { timeoutMs: 40_000, ...init }));
  try {
    return await go();
  } catch (err) {
    if (err instanceof Error && /\b50[234]\b/.test(err.message)) return go();
    throw err;
  }
}

let bundle: Promise<BundledDrainage | null> | null = null;

/** The bundled national drainage table, loaded once per process and only by the downstream op. */
function drainageBundle(): Promise<BundledDrainage | null> {
  bundle ??= import("./data/huc12-tohuc.json").then(
    (m) => (m.default ?? m) as unknown as BundledDrainage,
    () => null,
  );
  return bundle;
}

export async function loadBasin(huc4: string): Promise<BasinTable> {
  if (!/^\d{4}$/.test(huc4)) throw new Error(`bad HUC-4 ${huc4}`);
  const b = await drainageBundle();
  const fromBundle = b ? basinFromBundle(b, huc4) : null;
  if (fromBundle) return fromBundle;
  const r = await cached(`wbd-basin:${huc4}`, BASIN_TTL_MS, async () => {
    const table: BasinTable = new Map();
    for (let offset = 0; offset < 20_000; offset += 2000) {
      const res = await wbdOnce<ArcQueryResponse>(basinQueryUrl(huc4, offset));
      if (res.error) throw new Error(`usgs-wbd: ${res.error.message ?? "basin query failed"}`);
      for (const [k, v] of parseBasinTable(res)) table.set(k, v);
      if (!res.exceededTransferLimit) break;
    }
    return table;
  });
  return r.value;
}

/** The HUC-12 under a point, from the identify service. */
export async function huc12At(lon: number, lat: number): Promise<{ huc12: string; name: string } | null> {
  const r = await cached(`wbd-huc12-at:${lon},${lat}`, BASIN_TTL_MS, async () => {
    const res = await identify("usgs-wbd", identifyUrl(WBD_URL, lon, lat, [6]), 12_000);
    const n = parseWbd(res).nodes.find((x) => x.kind === "huc12");
    return n?.code ? { huc12: n.code, name: n.name } : null;
  });
  return r.value;
}

/** Most HUC-12 codes one outline call takes. */
export const OUTLINE_BATCH = 100;

/** Generalised outlines and their centroids for up to OUTLINE_BATCH HUC-12s (POST: the IN list is long). */
export interface OutlineBatch {
  outlines: Record<string, number[][][]>;
  centroids: Record<string, [number, number]>;
  /** Name and area as WBD publishes them (the bundled drainage table carries codes only). */
  names: Record<string, string>;
  areas: Record<string, number>;
}

export async function huc12Outlines(codes: string[]): Promise<OutlineBatch> {
  const clean = [...new Set(codes.filter((c) => /^\d{12}$/.test(c)))].sort().slice(0, OUTLINE_BATCH);
  const r = await cached(`wbd-outlines:${clean.join(",")}`, BASIN_TTL_MS, async () => {
    const body = new URLSearchParams({
      where: `huc12 IN (${clean.map((c) => `'${c}'`).join(",")})`,
      outFields: "huc12,name,areasqkm",
      returnGeometry: "true",
      maxAllowableOffset: "0.004",
      geometryPrecision: "4",
      outSR: "4326",
      f: "json",
    });
    const res = await wbdOnce<ArcQueryResponse>(`${WBD_URL}/6/query`, {
      method: "POST",
      body: body.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    if (res.error) throw new Error(`usgs-wbd: ${res.error.message ?? "outline query failed"}`);
    const outlines: Record<string, number[][][]> = {};
    const centroids: Record<string, [number, number]> = {};
    const names: Record<string, string> = {};
    const areas: Record<string, number> = {};
    for (const f of res.features ?? []) {
      const a = Object.fromEntries(Object.entries(f.attributes ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const code = String(a.huc12 ?? "");
      if (a.name != null) names[code] = String(a.name);
      if (Number.isFinite(Number(a.areasqkm))) areas[code] = Number(a.areasqkm);
      if (!f.geometry?.rings?.length) continue;
      const rings = roundRings(f.geometry.rings);
      outlines[code] = rings;
      const c = ringCentroid(rings);
      if (c) centroids[code] = [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
    }
    return { outlines, centroids, names, areas };
  });
  return r.value;
}

export type { DownstreamResult } from "./downstream";

/**
 * One leg of the walk: from the HUC-12 under a point, or `from` a HUC-12 a
 * previous leg stopped at. Stops at `budgetMs` so a serverless call finishes.
 */
export async function fetchDownstream(start: { lon: number; lat: number } | { from: string }, opts: { budgetMs?: number } = {}): Promise<DownstreamResult | null> {
  let huc12: string;
  let startName: string;
  if ("from" in start) {
    huc12 = start.from;
    startName = start.from;
  } else {
    const at = await huc12At(start.lon, start.lat);
    if (!at) return null;
    huc12 = at.huc12;
    startName = at.name;
  }
  // Worst case inside a 60 s function: identify 12 s + budget 6 s + one cold basin 40 s.
  const walk = await walkDownstream(huc12, loadBasin, { budgetMs: opts.budgetMs ?? 6_000 });
  if ("from" in start && walk.steps[0]) startName = walk.steps[0].name;
  return { ...walk, ...("from" in start ? {} : { point: start }), startName };
}

// ------------------------------------------------------------------ upstream

let index: Promise<DrainageIndex | null> | null = null;

/** The reversed national drainage table, built once per process from the bundle. */
function drainageIndex(): Promise<DrainageIndex | null> {
  index ??= drainageBundle().then((b) => (b?.complete ? buildIndex(b) : null));
  return index;
}

export interface UpstreamResult extends Upstream {
  point?: { lon: number; lat: number };
  startName: string;
}

/** The catchment of the HUC-12 under a point (or of a given HUC-12), from the bundled table. */
export async function fetchUpstream(start: { lon: number; lat: number } | { huc12: string }): Promise<UpstreamResult | null> {
  const idx = await drainageIndex();
  if (!idx) throw new Error("the upstream walk needs the bundled national drainage table (scripts/wbd-data.mjs)");
  let huc12: string;
  let startName: string;
  if ("huc12" in start) {
    huc12 = start.huc12;
    startName = `HUC ${start.huc12}`;
  } else {
    const at = await huc12At(start.lon, start.lat);
    if (!at) return null;
    huc12 = at.huc12;
    startName = at.name;
  }
  const u = upstream(huc12, idx);
  if (!u) return null;
  return { ...u, ...("huc12" in start ? {} : { point: start }), startName };
}

/** Generalisation per level: coarse units are big, so their outlines can be coarser. */
const LEVEL_OFFSET: Record<HucLevel, string> = { 2: "0.03", 4: "0.015", 6: "0.008", 8: "0.005", 10: "0.004", 12: "0.004" };

/** Most codes one units call takes with outlines, and without (names and areas only). */
export const UNITS_BATCH = 100;
export const UNITS_BATCH_ATTRS = 500;

/**
 * Outlines, names and published areas for WBD units of any level (2 to 12
 * digits), one query per level. With `geometry: false` only names and areas
 * come back, which is cheap enough for a few hundred units at once.
 */
export async function wbdUnits(codes: string[], opts: { geometry?: boolean } = {}): Promise<OutlineBatch> {
  const geometry = opts.geometry ?? true;
  const clean = [...new Set(codes.filter((c) => /^\d{2,12}$/.test(c) && c.length % 2 === 0))].sort().slice(0, geometry ? UNITS_BATCH : UNITS_BATCH_ATTRS);
  const byLevel = new Map<HucLevel, string[]>();
  for (const c of clean) {
    const l = c.length as HucLevel;
    byLevel.set(l, [...(byLevel.get(l) ?? []), c]);
  }
  const out: OutlineBatch = { outlines: {}, centroids: {}, names: {}, areas: {} };
  await Promise.all(
    [...byLevel].map(async ([level, list]) => {
      const r = await cached(`wbd-units:${geometry ? 1 : 0}:${list.join(",")}`, BASIN_TTL_MS, async () => {
        const field = `huc${level}`;
        const body = new URLSearchParams({
          where: `${field} IN (${list.map((c) => `'${c}'`).join(",")})`,
          outFields: `${field},name,areasqkm`,
          returnGeometry: String(geometry),
          ...(geometry ? { maxAllowableOffset: LEVEL_OFFSET[level], geometryPrecision: "4", outSR: "4326" } : {}),
          f: "json",
        });
        const layer = HUC_LEVELS.indexOf(level) + 1;
        const res = await wbdOnce<ArcQueryResponse>(`${WBD_URL}/${layer}/query`, {
          method: "POST",
          body: body.toString(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
        if (res.error) throw new Error(`usgs-wbd: ${res.error.message ?? "unit query failed"}`);
        const part: OutlineBatch = { outlines: {}, centroids: {}, names: {}, areas: {} };
        for (const f of res.features ?? []) {
          const a = Object.fromEntries(Object.entries(f.attributes ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
          const code = String(a[field] ?? "");
          if (!code) continue;
          if (a.name != null) part.names[code] = String(a.name);
          if (Number.isFinite(Number(a.areasqkm))) part.areas[code] = Number(a.areasqkm);
          if (!f.geometry?.rings?.length) continue;
          const rings = roundRings(f.geometry.rings);
          part.outlines[code] = rings;
          const c = ringCentroid(rings);
          if (c) part.centroids[code] = [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
        }
        return part;
      });
      Object.assign(out.outlines, r.value.outlines);
      Object.assign(out.centroids, r.value.centroids);
      Object.assign(out.names, r.value.names);
      Object.assign(out.areas, r.value.areas);
    }),
  );
  return out;
}

