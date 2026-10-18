// Network code for /api/terrain and /api/soil. Server only. Every upstream is
// read with plain GETs (SDA with its documented POST) under this app's
// User-Agent, through a per-host politeness gate, with resets, timeouts and
// 5xx retried (lib/server/net.ts) and 4xx and 429 never retried.
//
// Rendered tiles are kept in a small in-process cache (bounded by count) for
// the repeats one instance sees; the edge cache in front of the route is what
// keeps every viewer after the first off the publisher's server.

import { polite, upstream, UpstreamError } from "@/lib/server/upstream";
import { retrying } from "@/lib/server/net";
import { NLCD_LAYER, NLCD_WMS, RENDER_PRODUCTS, SDA_TABULAR, DEP_IMAGE, WHP_IMAGE, type RenderProductId } from "./products";
import { parseNlcdFeatureInfo, parseSlopeIdentify, parseWhpIdentify, type ClassAnswer } from "./classes";
import { mapunitSql, parseComponents, parseSoilPoint, pointSql, soilAnswer, type SdaJson, type SoilAnswer, type SoilComponent } from "./soil";

// ---------------------------------------------------------------- tiles

export interface TileImage {
  body: Uint8Array;
  contentType: string;
  upstreamUrl: string;
}

const TILE_CACHE_MAX = 160;
const TILE_TTL_MS = 24 * 3600_000;
const tiles = new Map<string, { value: TileImage; at: number }>();
const tileInflight = new Map<string, Promise<TileImage>>();

function tileHit(key: string): TileImage | null {
  const e = tiles.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TILE_TTL_MS) {
    tiles.delete(key);
    return null;
  }
  tiles.delete(key);
  tiles.set(key, e);
  return e.value;
}

function tileStore(key: string, value: TileImage) {
  tiles.set(key, { value, at: Date.now() });
  while (tiles.size > TILE_CACHE_MAX) tiles.delete(tiles.keys().next().value as string);
}

/**
 * One rendered tile. The publisher's answer must be an image: ArcGIS answers a
 * bad request with a 200 and a JSON body, and GeoServer with an XML exception,
 * so anything that is not image/* is a failure here, never passed on.
 */
export async function renderTile(product: RenderProductId, z: number, x: number, y: number): Promise<TileImage> {
  const p = RENDER_PRODUCTS[product];
  const key = `${product}/${z}/${x}/${y}`;
  const hit = tileHit(key);
  if (hit) return hit;
  let job = tileInflight.get(key);
  if (!job) {
    const url = p.upstreamUrl(x, y, z);
    job = retrying(async () => {
      const res = await polite(p.gate, p.intervalMs, 30_000, () => upstream(p.gate, url, { timeoutMs: p.timeoutMs, headers: { accept: "image/png,image/*;q=0.9" } }));
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const body = new Uint8Array(await res.arrayBuffer());
      if (!type.startsWith("image/")) {
        const text = new TextDecoder().decode(body.slice(0, 300)).replace(/\s+/g, " ").trim();
        // 415, not 5xx: an error body is the same on every try, so it is not retried (the caller still gets a 502).
        throw new UpstreamError(p.gate, 415, `${p.gate}: answered ${type || "no content type"} instead of an image: ${text.slice(0, 120)}`);
      }
      return { body, contentType: type, upstreamUrl: url };
      // Two tries at most: two 25 s attempts still end inside the route's 60 s.
    }, 2)
      .then((v) => {
        tileStore(key, v);
        return v;
      })
      .finally(() => tileInflight.delete(key));
    tileInflight.set(key, job);
  }
  return job;
}

// ---------------------------------------------------------------- point answers

async function getJson<T>(gate: string, intervalMs: number, url: string, timeoutMs = 15_000): Promise<T> {
  return retrying(async () => {
    const res = await polite(gate, intervalMs, 30_000, () => upstream(gate, url, { timeoutMs }));
    const j = (await res.json()) as T & { error?: { code?: number; message?: string } };
    if (j && typeof j === "object" && "error" in j && j.error) throw new UpstreamError(gate, j.error.code ?? 502, `${gate}: ${j.error.message ?? "error"}`);
    return j;
  }, 2);
}

function identifyUrl(base: string, lon: number, lat: number, renderingRule?: string): string {
  const qs = new URLSearchParams({
    geometry: JSON.stringify({ x: Number(lon.toFixed(6)), y: Number(lat.toFixed(6)), spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    returnGeometry: "false",
    returnCatalogItems: "false",
    f: "json",
  });
  if (renderingRule) qs.set("renderingRule", JSON.stringify({ rasterFunction: renderingRule }));
  return `${base}/identify?${qs.toString()}`;
}

export interface PointClass {
  value: ClassAnswer | null;
  upstreamUrl: string;
}

/** The WHP 2023 class at a point (USFS ImageServer identify). */
export async function whpAt(lon: number, lat: number): Promise<PointClass> {
  const url = identifyUrl(WHP_IMAGE, lon, lat);
  return { value: parseWhpIdentify(await getJson("usfs-whp", 200, url)), upstreamUrl: url };
}

/** The NLCD 2021 class at a point: GetFeatureInfo on the centre pixel of a 3 × 3 window about 36 m across. */
export async function nlcdAt(lon: number, lat: number): Promise<PointClass> {
  const d = 0.0005;
  const bbox = [lon - d, lat - d, lon + d, lat + d].map((v) => v.toFixed(6)).join(",");
  const url = `${NLCD_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${NLCD_LAYER}&QUERY_LAYERS=${NLCD_LAYER}&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=3&HEIGHT=3&X=1&Y=1&INFO_FORMAT=application/json`;
  return { value: parseNlcdFeatureInfo(await getJson("mrlc", 100, url, 20_000)), upstreamUrl: url };
}

/** Slope in degrees at a point, as 3DEP's "Slope Degrees" function computes it. */
export async function slopeAt(lon: number, lat: number): Promise<{ degrees: number | null; upstreamUrl: string }> {
  const url = identifyUrl(DEP_IMAGE, lon, lat, "Slope Degrees");
  return { degrees: parseSlopeIdentify(await getJson("usgs-3dep", 60, url, 20_000)), upstreamUrl: url };
}

// ---------------------------------------------------------------- soils (SDA)

async function sda(query: string): Promise<SdaJson> {
  return retrying(async () => {
    const res = await polite("nrcs-sda", 250, 30_000, () =>
      upstream("nrcs-sda", SDA_TABULAR, {
        method: "POST",
        // A point takes two queries, each at most two tries: 12 s keeps the whole answer inside 60 s (SDA answers in well under 1 s).
        timeoutMs: 12_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, format: "JSON+COLUMNNAME" }),
      }),
    );
    return (await res.json()) as SdaJson;
  }, 2);
}

/** Step 1 and 2 for a point; null when no SSURGO map unit is mapped there. */
export async function soilAt(lon: number, lat: number): Promise<SoilAnswer | null> {
  const mapUnit = parseSoilPoint(await sda(pointSql(lon, lat)));
  if (!mapUnit) return null;
  return soilAnswer(mapUnit, await soilComponents(mapUnit.mukey));
}

/** Step 2 alone: the components of one map unit with their NCCPI. */
export async function soilComponents(mukey: string): Promise<SoilComponent[]> {
  return parseComponents(await sda(mapunitSql(mukey)));
}
