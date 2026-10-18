/// <reference lib="webworker" />
// Turbidity worker: Sentinel-2 L2A scene -> per-chip turbidity estimates.
//
// Runs entirely in the browser. It asks Earth Search (STAC) for recent
// low-cloud scenes over the requested window, checks the scene classification
// over the *window* (a 40 % cloudy tile can be clear over one lake, and the
// other way round), range-reads the five bands it needs straight from the
// public COG bucket at an overview level matched to the window size, applies
// the explainer's water mask, runs the Dogliotti (2015) physics teacher on
// every water pixel and aggregates 640 m chips (64 x 64 native 10 m pixels)
// into median / p10 / p90 over the chip's largest connected water body.
//
// Before trusting a scene it repeats the explainer's DN -> reflectance sanity
// check: dark-water B8A must sit in [0, 0.08], vegetated land NDVI > 0.2 and
// fewer than 5 % of reflectances negative. Both conventions (DN/10000 and
// (DN-1000)/10000) are tried; the one that passes is used and reported.

import { fromUrl, type GeoTIFF, type GeoTIFFImage } from "geotiff";
import { chipStats, isWater, SCL_INVALID, turbidityFnu, type ChipStats } from "./dogliotti";
import { lonLatToUtm, utmToLonLat, zoneFromEpsg, type UtmZone } from "./utm";

export interface TurbidityRequest {
  type: "run";
  id: number;
  /** [west, south, east, north] degrees. */
  bbox: [number, number, number, number];
  /** Latest acceptable scene time, epoch ms (mission clock). */
  before: number;
  /** Look-back window, days. */
  lookbackDays: number;
  maxCloud: number;
  /** Target ground resolution in metres (10, 20, 40, 80, 160). */
  resolution: number;
}

export interface Chip {
  /** Chip grid indices in the scene's UTM grid. */
  i: number;
  j: number;
  lon: number;
  lat: number;
  /** Chip footprint corners, lon/lat, for the info panel. */
  west: number;
  south: number;
  east: number;
  north: number;
  stats: ChipStats;
  totalPixels: number;
  /** Water pixels in the chip before the connected-component filter. */
  waterPixels: number;
  /** Number of separate water bodies found in the chip. */
  components: number;
}

export interface SceneInfo {
  id: string;
  datetime: string;
  cloud: number;
  /** Cloud + shadow fraction of the classified pixels inside the window. */
  localCloud: number;
  platform: string;
  epsg: number;
  zone: UtmZone;
  /** Chip grid origin (UTM metres) and chip size. */
  originE: number;
  originN: number;
  chipM: number;
  pixelM: number;
  overview: number;
  convention: "DN/10000" | "(DN-1000)/10000";
  check: { darkWaterB8A: number; landNdvi: number; negativeFraction: number; pass: boolean };
  stacUrl: string;
  bandsRead: string[];
  bytesRead: number;
  /** Scenes inspected before this one was chosen, newest first. */
  candidates: Array<{ id: string; datetime: string; localCloud: number }>;
}

export type TurbidityResponse =
  | { type: "result"; id: number; scene: SceneInfo; chips: Chip[]; window: [number, number, number, number]; elapsedMs: number }
  | { type: "empty"; id: number; reason: string; searched: number }
  | { type: "error"; id: number; error: string };

interface StacAsset {
  href: string;
  "raster:bands"?: Array<{ scale?: number; offset?: number }>;
}
interface StacItem {
  id: string;
  properties: {
    datetime: string;
    "eo:cloud_cover"?: number;
    platform?: string;
    "proj:epsg"?: number;
    "proj:code"?: string;
    "s2:processing_baseline"?: string;
  };
  bbox?: number[];
  geometry?: { type: string; coordinates: number[][][] | number[][][][] };
  assets: Record<string, StacAsset>;
}

const STAC = "https://earth-search.aws.element84.com/v1/search";
const CHIP_PX = 64; // native 10 m pixels per chip side
const MAX_READ_PX = 1400; // per band, per side
const MAX_CANDIDATES = 5;
const LOCAL_CLOUD_OK = 0.15;
const MIN_WATER_FRACTION = 0.012;
const CLOUDY_SCL = new Set([3, 8, 9, 10]);

let bytes = 0;

interface Band {
  image: GeoTIFFImage;
  level: number;
  /** Geotransform derived from the full-resolution IFD (overviews carry none). */
  ox: number;
  oy: number;
  rx: number;
  ry: number;
}

interface Window {
  data: Uint16Array | Uint8Array | Float32Array;
  w: number;
  h: number;
  x0: number;
  y0: number;
  rx: number;
  ry: number;
  ox: number;
  oy: number;
}

async function readWindow(band: Band, e0: number, n0: number, e1: number, n1: number): Promise<Window> {
  const { image, ox, oy, rx, ry } = band;
  const W = image.getWidth();
  const H = image.getHeight();
  const x0 = Math.max(0, Math.floor((e0 - ox) / rx));
  const x1 = Math.min(W, Math.ceil((e1 - ox) / rx));
  const y0 = Math.max(0, Math.floor((n1 - oy) / ry));
  const y1 = Math.min(H, Math.ceil((n0 - oy) / ry));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return { data: new Uint16Array(0), w: 0, h: 0, x0, y0, rx, ry, ox, oy };
  const r = (await image.readRasters({ window: [x0, y0, x1, y1] })) as unknown as Array<Uint16Array | Uint8Array | Float32Array>;
  bytes += r[0].byteLength;
  return { data: r[0], w, h, x0, y0, rx, ry, ox, oy };
}

/**
 * Pick the overview whose ground resolution is the coarsest not coarser than
 * `target`. Only the first IFD carries the geotransform; an overview's is the
 * base one scaled by the size ratio.
 */
async function imageFor(tiff: GeoTIFF, target: number): Promise<Band> {
  const base = await tiff.getImage(0);
  const [ox, oy] = base.getOrigin();
  const [bx, byAbs] = base.getResolution();
  const brx = Math.abs(bx);
  const bry = Math.abs(byAbs);
  const count = await tiff.getImageCount();
  let best: Band = { image: base, level: 0, ox, oy, rx: brx, ry: -bry };
  for (let i = 1; i < count; i++) {
    const image = await tiff.getImage(i);
    const scale = base.getWidth() / image.getWidth();
    const res = brx * scale;
    if (res <= target + 1e-6) best = { image, level: i, ox, oy, rx: res, ry: -bry * scale };
    else break;
  }
  return best;
}

function pointInFootprint(lon: number, lat: number, item: StacItem): boolean {
  const g = item.geometry;
  if (!g) return true;
  const rings: number[][][] =
    g.type === "Polygon" ? (g.coordinates as number[][][]) : (g.coordinates as number[][][][]).map((p) => p[0]);
  const inside = (ring: number[][]) => {
    let ok = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ok = !ok;
    }
    return ok;
  };
  return rings.some(inside);
}

/** Cloud + shadow share of the classified pixels in an SCL window. */
function localCloudFraction(S: Window): number {
  let cloudy = 0;
  let valid = 0;
  const d = S.data;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    if (v === 0) continue;
    valid++;
    if (CLOUDY_SCL.has(v)) cloudy++;
  }
  return valid ? cloudy / valid : 1;
}

/** Largest 4-connected component of a square mask; returns member indices. */
function largestComponent(mask: Uint8Array, side: number): { members: number[]; components: number } {
  const seen = new Uint8Array(mask.length);
  let best: number[] = [];
  let components = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    components++;
    const members: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      members.push(k);
      const i = Math.floor(k / side);
      const j = k % side;
      const nb = [i > 0 ? k - side : -1, i < side - 1 ? k + side : -1, j > 0 ? k - 1 : -1, j < side - 1 ? k + 1 : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (members.length > best.length) best = members;
  }
  return { members: best, components };
}

export async function run(req: TurbidityRequest): Promise<TurbidityResponse> {
  const t0 = performance.now();
  bytes = 0;
  const [w, s, e, n] = req.bbox;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const before = new Date(req.before);
  const after = new Date(req.before - req.lookbackDays * 86_400_000);
  const body = {
    collections: ["sentinel-2-l2a"],
    intersects: { type: "Point", coordinates: [cx, cy] },
    datetime: `${after.toISOString()}/${before.toISOString()}`,
    query: { "eo:cloud_cover": { lt: req.maxCloud } },
    sortby: [{ field: "properties.datetime", direction: "desc" }],
    limit: 20,
  };
  const res = await fetch(STAC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`STAC ${res.status}`);
  const fc = (await res.json()) as { features: StacItem[] };
  const items = (fc.features ?? []).filter(
    (it) => pointInFootprint(cx, cy, it) && it.assets.red && it.assets.nir08 && it.assets.scl && it.assets.green && it.assets.nir,
  );
  if (items.length === 0) {
    return {
      type: "empty",
      id: req.id,
      reason: `no Sentinel-2 scene under ${req.maxCloud}% cloud in the ${req.lookbackDays} days before the mission clock`,
      searched: fc.features?.length ?? 0,
    };
  }

  const open = (item: StacItem, key: string) => fromUrl(item.assets[key].href, { allowFullFile: false });
  const sclRes = Math.max(20, req.resolution);

  // Window in UTM (all candidates share the tile's CRS), clipped to a readable size.
  const epsgOf = (it: StacItem) => Number(String(it.properties["proj:epsg"] ?? it.properties["proj:code"] ?? "").replace(/\D/g, ""));
  const epsg = epsgOf(items[0]);
  const zone = zoneFromEpsg(epsg);
  if (!zone) throw new Error(`unsupported CRS EPSG:${epsg}`);
  const corners = [lonLatToUtm(w, s, zone), lonLatToUtm(e, s, zone), lonLatToUtm(w, n, zone), lonLatToUtm(e, n, zone)];
  let e0 = Math.min(...corners.map((c) => c[0]));
  let e1 = Math.max(...corners.map((c) => c[0]));
  let n0 = Math.min(...corners.map((c) => c[1]));
  let n1 = Math.max(...corners.map((c) => c[1]));
  const maxM = MAX_READ_PX * req.resolution;
  const [ce, cn] = lonLatToUtm(cx, cy, zone);
  if (e1 - e0 > maxM) {
    e0 = ce - maxM / 2;
    e1 = ce + maxM / 2;
  }
  if (n1 - n0 > maxM) {
    n0 = cn - maxM / 2;
    n1 = cn + maxM / 2;
  }

  // Scene choice by cloud over the window, newest first.
  const candidates: SceneInfo["candidates"] = [];
  let chosen: { item: StacItem; scl: Band; S: Window; localCloud: number } | null = null;
  for (const item of items.slice(0, MAX_CANDIDATES)) {
    if (epsgOf(item) !== epsg) continue;
    const sclT = await open(item, "scl");
    const scl = await imageFor(sclT, sclRes);
    const S = await readWindow(scl, e0, n0, e1, n1);
    if (S.w === 0 || S.h === 0) continue;
    const localCloud = localCloudFraction(S);
    candidates.push({ id: item.id, datetime: item.properties.datetime, localCloud });
    if (!chosen || localCloud < chosen.localCloud) chosen = { item, scl, S, localCloud };
    if (localCloud <= LOCAL_CLOUD_OK) break;
  }
  if (!chosen) return { type: "empty", id: req.id, reason: "window falls outside every candidate scene", searched: items.length };
  const { item, S } = chosen;

  const [redT, greenT, nirT, nir08T] = await Promise.all(["red", "green", "nir", "nir08"].map((k) => open(item, k)));
  const red = await imageFor(redT, req.resolution);
  const green = await imageFor(greenT, req.resolution);
  const nir = await imageFor(nirT, req.resolution);
  const nir08 = await imageFor(nir08T, sclRes);
  const [R, G, N, N8] = await Promise.all([
    readWindow(red, e0, n0, e1, n1),
    readWindow(green, e0, n0, e1, n1),
    readWindow(nir, e0, n0, e1, n1),
    readWindow(nir08, e0, n0, e1, n1),
  ]);
  if (R.w === 0 || R.h === 0) return { type: "empty", id: req.id, reason: "window falls outside the scene tile", searched: items.length };

  // Nearest-neighbour lookup of a coarser band at a fine-grid pixel.
  const sampler = (b: Window) => (i: number, j: number): number => {
    const ex = R.ox + (R.x0 + j + 0.5) * R.rx;
    const ny = R.oy + (R.y0 + i + 0.5) * R.ry;
    const jj = Math.floor((ex - b.ox) / b.rx) - b.x0;
    const ii = Math.floor((ny - b.oy) / b.ry) - b.y0;
    if (ii < 0 || jj < 0 || ii >= b.h || jj >= b.w) return NaN;
    return b.data[ii * b.w + jj];
  };
  const same = (b: Window) => b.rx === R.rx && b.x0 === R.x0 && b.y0 === R.y0 && b.w === R.w;
  const sG = same(G) ? (i: number, j: number) => G.data[i * G.w + j] : sampler(G);
  const sN = same(N) ? (i: number, j: number) => N.data[i * N.w + j] : sampler(N);
  const sN8 = same(N8) ? (i: number, j: number) => N8.data[i * N8.w + j] : sampler(N8);
  const sS = same(S) ? (i: number, j: number) => S.data[i * S.w + j] : sampler(S);

  // DN -> reflectance convention check (explainer section 4).
  const conventions: Array<{ name: SceneInfo["convention"]; off: number }> = [
    { name: "DN/10000", off: 0 },
    { name: "(DN-1000)/10000", off: -0.1 },
  ];
  const checks: Array<{ conv: (typeof conventions)[number]; check: SceneInfo["check"] }> = [];
  let passing: (typeof checks)[number] | null = null;
  for (const conv of conventions) {
    const b8a: number[] = [];
    const ndvi: number[] = [];
    let neg = 0;
    let tot = 0;
    const step = Math.max(1, Math.floor((R.w * R.h) / 60_000));
    for (let k = 0; k < R.w * R.h; k += step) {
      const i = Math.floor(k / R.w);
      const j = k % R.w;
      const dR = R.data[k];
      const dN = sN(i, j);
      const dN8 = sN8(i, j);
      const sc = sS(i, j);
      if (!dR || !dN || !dN8) continue;
      const rR = dR / 10000 + conv.off;
      const rN = dN / 10000 + conv.off;
      const rN8 = dN8 / 10000 + conv.off;
      tot++;
      if (rR < 0 || rN < 0) neg++;
      if (sc === 6) b8a.push(rN8);
      else if (sc === 4) ndvi.push((rN - rR) / (rN + rR));
    }
    b8a.sort((a, b) => a - b);
    ndvi.sort((a, b) => a - b);
    const q = (v: number[], p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : NaN);
    const darkWaterB8A = q(b8a, 0.5);
    const landNdvi = q(ndvi, 0.5);
    const negativeFraction = tot ? neg / tot : 1;
    const pass =
      (Number.isNaN(darkWaterB8A) || (darkWaterB8A >= 0 && darkWaterB8A <= 0.08)) &&
      (Number.isNaN(landNdvi) || landNdvi > 0.2) &&
      negativeFraction < 0.05;
    const c = { conv, check: { darkWaterB8A, landNdvi, negativeFraction, pass } };
    checks.push(c);
    if (pass && !passing) passing = c;
  }
  const picked = passing ?? checks[0];
  const off = picked.conv.off;

  // Chip grid anchored on the scene's UTM origin so chips are stable across views.
  const chipM = CHIP_PX * 10;
  const originE = R.ox;
  const originN = R.oy;
  const pixelM = R.rx;
  const chipPx = Math.max(1, Math.round(chipM / pixelM));
  const jOff = R.x0 % chipPx;
  const iOff = R.y0 % chipPx;
  const cols = Math.ceil((R.w + jOff) / chipPx);
  const rows = Math.ceil((R.h + iOff) / chipPx);
  const buckets: Array<{ idx: number[]; t: number[] } | undefined> = new Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  for (let i = 0; i < R.h; i++) {
    const ci = Math.floor((i + iOff) / chipPx);
    const li = (i + iOff) % chipPx;
    for (let j = 0; j < R.w; j++) {
      const cj = Math.floor((j + jOff) / chipPx);
      const lj = (j + jOff) % chipPx;
      const b = ci * cols + cj;
      counts[b]++;
      const dR = R.data[i * R.w + j];
      const dG = sG(i, j);
      const dN = sN(i, j);
      const dN8 = sN8(i, j);
      const sc = sS(i, j);
      if (!dR || !dG || !dN || !(dN8 > 0) || Number.isNaN(sc) || SCL_INVALID.has(sc)) continue;
      const rG = dG / 10000 + off;
      const rN = dN / 10000 + off;
      if (!isWater(sc, rG, rN)) continue;
      const rR = dR / 10000 + off;
      const rN8 = dN8 / 10000 + off;
      const t = turbidityFnu(rR, rN8);
      if (!Number.isFinite(t)) continue;
      const bucket = (buckets[b] ??= { idx: [], t: [] });
      bucket.idx.push(li * chipPx + lj);
      bucket.t.push(t);
    }
  }
  // 25 water pixels per 64x64 chip at 10 m, scaled to the overview's pixel size.
  const minWater = Math.max(4, Math.round((25 * chipPx * chipPx) / (CHIP_PX * CHIP_PX)));
  const chips: Chip[] = [];
  const mask = new Uint8Array(chipPx * chipPx);
  for (let ci = 0; ci < rows; ci++) {
    for (let cj = 0; cj < cols; cj++) {
      const b = ci * cols + cj;
      const bucket = buckets[b];
      if (!bucket || bucket.t.length < minWater) continue;
      if (bucket.t.length / counts[b] < MIN_WATER_FRACTION) continue;
      mask.fill(0);
      for (const k of bucket.idx) mask[k] = 1;
      const cc = largestComponent(mask, chipPx);
      if (cc.members.length < minWater) continue;
      const keep = new Set(cc.members);
      const vals: number[] = [];
      for (let q = 0; q < bucket.idx.length; q++) if (keep.has(bucket.idx[q])) vals.push(bucket.t[q]);
      const stats = chipStats(vals, counts[b]);
      if (!stats) continue;
      const gi = Math.floor((R.y0 + ci * chipPx - iOff) / chipPx);
      const gj = Math.floor((R.x0 + cj * chipPx - jOff) / chipPx);
      const ew = originE + gj * chipM;
      const nn = originN - gi * chipM;
      const [lon, lat] = utmToLonLat(ew + chipM / 2, nn - chipM / 2, zone);
      const [wl, sl] = utmToLonLat(ew, nn - chipM, zone);
      const [el, nl] = utmToLonLat(ew + chipM, nn, zone);
      chips.push({
        i: gi,
        j: gj,
        lon,
        lat,
        west: wl,
        south: sl,
        east: el,
        north: nl,
        stats,
        totalPixels: counts[b],
        waterPixels: bucket.t.length,
        components: cc.components,
      });
    }
  }
  const [ww, ss] = utmToLonLat(R.ox + R.x0 * R.rx, R.oy + (R.y0 + R.h) * R.ry, zone);
  const [ee, nn2] = utmToLonLat(R.ox + (R.x0 + R.w) * R.rx, R.oy + R.y0 * R.ry, zone);
  const scene: SceneInfo = {
    id: item.id,
    datetime: item.properties.datetime,
    cloud: item.properties["eo:cloud_cover"] ?? NaN,
    localCloud: chosen.localCloud,
    platform: item.properties.platform ?? "sentinel-2",
    epsg,
    zone,
    originE,
    originN,
    chipM,
    pixelM,
    overview: red.level,
    convention: picked.conv.name,
    check: picked.check,
    stacUrl: `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${item.id}`,
    bandsRead: ["B04", "B03", "B08", "B8A", "SCL"],
    bytesRead: bytes,
    candidates,
  };
  return { type: "result", id: req.id, scene, chips, window: [ww, ss, ee, nn2], elapsedMs: performance.now() - t0 };
}

// Also importable from Node (scripts/turbidity-check.mjs) for offline validation.
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  self.onmessage = async (e: MessageEvent<TurbidityRequest>) => {
    const req = e.data;
    if (req.type !== "run") return;
    try {
      self.postMessage(await run(req));
    } catch (err) {
      self.postMessage({ type: "error", id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies TurbidityResponse);
    }
  };
}
