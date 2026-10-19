"use client";
// Keyless terrain (H2): AWS Terrain Tiles in the terrarium encoding, decoded in
// the browser. One tile cache feeds two things: the globe's 3D surface (a
// CustomHeightmapTerrainProvider) and the measure tool's elevation profile.
//
// The globe asks for Cesium's geographic tiles (two at level 0, so the poles
// are covered); each is filled with a 65 × 65 grid sampled bilinearly from the
// Web Mercator terrarium tiles under it, at the terrarium zoom equal to the
// geographic level (at most 15, about 4.8 m a pixel at the equator; deeper
// geographic levels sample zoom 15 more finely). Beyond ±85.05° the edge row
// of the Mercator square holds.
//
// Rendering rule: terrarium carries ETOPO1 bathymetry, so the sea floor is
// several kilometres below sea level, and ships and every layer drawn at 0 m
// would float over a drained ocean. The globe's surface therefore draws any
// height below 0 m at 0 m. It is a drawing rule only: the elevation profile and
// every number shown report the tile's own value, below zero included.
//
// Tiles are fetched with at most MAX_ACTIVE requests in flight; past twice
// that the terrain callback answers `undefined`, which tells Cesium to ask
// again later (it is a throttle, never "no data").
//
// A failed fetch is taken as transient first. The failed attempt resolves
// `undefined` (ask again later) and that tile waits 1, 2 and then 4 s before
// its next try; a 429 or 503 makes every tile wait. A tile below level 0 that
// still fails after the third retry is left to Cesium, which draws it from its
// parent. A level-0 tile has no parent, and Cesium draws nothing of its half of
// the globe (no imagery, no picture layer) until it is built; both halves are
// sampled from the one terrarium tile 0/0/0. So a level-0 tile that still fails
// is drawn flat, as the smooth globe with Terrain off would draw it, and the
// provider reports it once (setTerrain then swaps back to the smooth globe and
// logs a warning). The globe is therefore blank at most for the retries, about
// 7 s plus four fetches, as it is on first load.

import type * as CesiumNS from "cesium";
import { getCesium } from "@/lib/globe/cesium";
import { TERRARIUM, TERRARIUM_MAX_ZOOM } from "./products";
import { bilinear, decodeTerrarium, lonLatToTile } from "./webmercator";
import type { HeightTile } from "./profile";

const SIZE = 256;
const GRID = 65;
const MAX_ACTIVE = 8;
const CACHE_MAX = 128;

const cache = new Map<string, HeightTile>();
const inflight = new Map<string, Promise<HeightTile>>();
const queue: Array<() => void> = [];
let active = 0;

function remember(key: string, t: HeightTile) {
  cache.delete(key);
  cache.set(key, t);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

function slot(): Promise<void> {
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => {
    active++;
    resolve();
  }));
}

function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

/** Pixels of an image, colour-managed off so the encoded bytes survive decoding untouched. */
async function pixels(blob: Blob): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("no 2d canvas");
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  } finally {
    bmp.close();
  }
}

/** One decoded terrarium tile (heights in metres, north row first), cached. */
export function terrariumTile(z: number, x: number, y: number): Promise<HeightTile> {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return Promise.resolve(hit);
  }
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      await slot();
      try {
        const url = TERRARIUM.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
        const res = await fetch(url);
        if (!res.ok) throw Object.assign(new Error(`terrain tile ${key}: HTTP ${res.status}`), { status: res.status });
        const rgba = await pixels(await res.blob());
        const t: HeightTile = { size: SIZE, heights: decodeTerrarium(rgba, SIZE, SIZE) };
        remember(key, t);
        return t;
      } finally {
        release();
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Tiles in flight or queued (the terrain callback throttles on it). */
export function terrariumBusy(): number {
  return inflight.size;
}

/** Heights for one geographic tile rectangle (degrees), GRID × GRID, north row first, below-zero drawn at zero. */
async function gridFor(west: number, south: number, east: number, north: number, level: number): Promise<Float32Array> {
  const z = Math.max(0, Math.min(TERRARIUM_MAX_ZOOM, level));
  const n = 2 ** z;
  const [fx0, fy0] = lonLatToTile(west, north, z);
  const [fx1, fy1] = lonLatToTile(east, south, z);
  const x0 = Math.max(0, Math.floor(fx0));
  const x1 = Math.min(n - 1, Math.floor(fx1 - 1e-9));
  const y0 = Math.max(0, Math.floor(fy0));
  const y1 = Math.min(n - 1, Math.floor(fy1 - 1e-9));
  const tiles = new Map<string, HeightTile>();
  const jobs: Promise<void>[] = [];
  for (let tx = x0; tx <= Math.max(x0, x1); tx++) {
    for (let ty = y0; ty <= Math.max(y0, y1); ty++) {
      jobs.push(terrariumTile(z, tx, ty).then((t) => void tiles.set(`${tx}/${ty}`, t)));
    }
  }
  await Promise.all(jobs);
  const out = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    const lat = north - ((north - south) * j) / (GRID - 1);
    for (let i = 0; i < GRID; i++) {
      const lon = west + ((east - west) * i) / (GRID - 1);
      const [fx, fy] = lonLatToTile(lon, lat, z);
      const tx = Math.max(x0, Math.min(Math.max(x0, x1), Math.floor(fx)));
      const ty = Math.max(y0, Math.min(Math.max(y0, y1), Math.floor(fy)));
      const t = tiles.get(`${tx}/${ty}`)!;
      const h = bilinear(t.heights, t.size, t.size, (fx - tx) * t.size, (fy - ty) * t.size);
      out[j * GRID + i] = h > 0 ? h : 0;
    }
  }
  return out;
}

export const TERRAIN_CREDIT =
  "Terrain: AWS Terrain Tiles (Mapzen/Tilezen terrarium): USGS 3DEP, SRTM, GMTED2010, ETOPO1 and other sources (see About)";

// ---------------------------------------------------------------- retries

/** How long a tile waits after each failed attempt: three retries, then it gives up. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
const RETRY_KEYS_MAX = 512;

export interface RetryGate {
  /** True while this tile, or every tile after a 429 or 503, is waiting to try again. */
  waiting(key: string): boolean;
  /** A failed attempt: "retry" after the next delay, or "give-up" once the retries are spent (the tile then starts afresh). */
  fail(key: string, status?: number): "retry" | "give-up";
  /** A success: the tile's failures are forgotten. */
  ok(key: string): void;
}

/** Per-tile backoff on the wall clock (`now`), plus a pause for the whole host when it answers 429 or 503. */
export function createRetryGate(now: () => number = Date.now, delays: readonly number[] = RETRY_DELAYS_MS): RetryGate {
  const tiles = new Map<string, { fails: number; until: number }>();
  let hostUntil = 0;
  return {
    waiting(key) {
      const t = now();
      if (t < hostUntil) return true;
      const e = tiles.get(key);
      return e != null && t < e.until;
    },
    fail(key, status) {
      const fails = (tiles.get(key)?.fails ?? 0) + 1;
      const until = now() + delays[Math.min(fails, delays.length) - 1];
      // The host asked for less traffic: every tile waits, not only this one.
      if (status === 429 || status === 503) hostUntil = Math.max(hostUntil, until);
      tiles.delete(key);
      if (fails > delays.length) return "give-up";
      tiles.set(key, { fails, until });
      while (tiles.size > RETRY_KEYS_MAX) tiles.delete(tiles.keys().next().value as string);
      return "retry";
    },
    ok(key) {
      tiles.delete(key);
    },
  };
}

/** The HTTP status a failed fetch carries, if it got that far. */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

export type GridFn = (x: number, y: number, level: number) => Promise<Float32Array>;

export interface TerrainCallbackOptions {
  /** True while too many tiles are in flight: answer "ask again later" without fetching. */
  busy?: () => boolean;
  gate?: RetryGate;
  /** Called once, when a level-0 tile still fails after every retry and is drawn flat. */
  onRootLost?: (err: unknown) => void;
}

/**
 * The provider's answer for one geographic tile:
 *   undefined             ask again later (throttled, or waiting after a failure)
 *   resolves undefined    this attempt failed; ask again later
 *   resolves a grid       heights, GRID × GRID
 *   rejects               a tile below level 0 still failing after every retry (Cesium draws it from its parent)
 * A level-0 tile still failing after every retry resolves a grid of zeros, the smooth globe.
 */
export function terrainCallback(grid: GridFn, opts: TerrainCallbackOptions = {}) {
  const gate = opts.gate ?? createRetryGate();
  let lost = false;
  return (x: number, y: number, level: number): Promise<Float32Array | undefined> | undefined => {
    if (opts.busy?.()) return undefined;
    const key = `${level}/${x}/${y}`;
    if (gate.waiting(key)) return undefined;
    return grid(x, y, level).then(
      (g) => {
        gate.ok(key);
        return g;
      },
      (err: unknown) => {
        if (gate.fail(key, statusOf(err)) === "retry") return undefined;
        if (level > 0) throw err;
        if (!lost) {
          lost = true;
          opts.onRootLost?.(err);
        }
        return new Float32Array(GRID * GRID);
      },
    );
  };
}

export interface TerrariumTerrainOptions {
  /** A level-0 tile could not be fetched after every retry (it is drawn flat); called once. */
  onUnreachable?: (err: unknown) => void;
}

type RequestGeometry = (x: number, y: number, level: number, request?: CesiumNS.Request) => Promise<CesiumNS.TerrainData> | undefined;

/** The keyless terrain provider. */
export function createTerrariumTerrain(opts: TerrariumTerrainOptions = {}): CesiumNS.TerrainProvider {
  const C = getCesium();
  const scheme = new C.GeographicTilingScheme();
  const d = C.Math.toDegrees;
  const answer = terrainCallback(
    (x, y, level) => {
      const r = scheme.tileXYToRectangle(x, y, level);
      return gridFor(d(r.west), d(r.south), d(r.east), d(r.north), level);
    },
    { busy: () => terrariumBusy() > MAX_ACTIVE * 2, onRootLost: opts.onUnreachable },
  );
  const provider = new C.CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme: scheme,
    credit: new C.Credit(TERRAIN_CREDIT),
    // Not called: requestTileGeometry is replaced below.
    callback: () => undefined,
  });
  // CustomHeightmapTerrainProvider wraps whatever its callback's promise resolves in
  // HeightmapTerrainData, so the callback has no way to say "that attempt failed, ask again
  // later". Cesium does: a requestTileGeometry promise that resolves undefined puts the tile
  // back to UNLOADED and it is requested again (GlobeSurfaceTile requestTileGeometry, 1.145).
  (provider as unknown as { requestTileGeometry: RequestGeometry }).requestTileGeometry = (x, y, level) => {
    const p = answer(x, y, level);
    if (!p) return undefined;
    return p.then((g) => (g ? new C.HeightmapTerrainData({ buffer: g, width: GRID, height: GRID }) : undefined)) as Promise<CesiumNS.TerrainData>;
  };
  return provider;
}
