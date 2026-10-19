"use client";
// Tiled imagery for picture layers (the H1 hook on LayerStyle).
//
// A LayerStyle may return TileSpecs; the renderer turns each into a Cesium
// imagery layer on a Web Mercator tiling scheme:
//
//   xyz   a URL template: {z}/{x}/{y} caches (USGS relief, NOAA sea level rise),
//         this app's /api/terrain renders, or an ArcGIS ImageServer exportImage
//         asked for the tile's projected box through Cesium's own
//         {westProjected},{southProjected},{eastProjected},{northProjected} tags
//         (so a renderingRule, which Cesium's ArcGIS provider cannot pass, can)
//   wms   an OGC WMS GetMap (NRCS soils), EPSG:3857 boxes
//
// with an opacity the viewer can change, a camera-height gate (the renderer
// shows the layer only inside [minHeight, maxHeight]), a credit, a floor below
// which levels are drawn empty without a request (the service draws nothing
// there, and Cesium would otherwise ask for them from far tiles), nearest
// magnification for class rasters, an "ink" pass for dark line art and a
// "shade" pass for a light hillshade.
//
// A sparse cache (USGS relief, worldwide to level 8 and only around the US
// deeper; NOAA's sea level rise, only along US coasts) answers 404 where it
// publishes no tile. With `sparse` that is not a failure: Cesium keeps drawing
// the nearest ancestor it has, the 404 is not counted toward "tiles failing",
// and that tile is not asked for again while the layer is on. Only that tile:
// a 404 says nothing about the tiles under it (USGS relief has holes at level
// 9 inside the US, San Antonio, Kansas, the Colorado Rockies, with levels
// 10-13 published under them; probed 2026-09-26). Switching the layer off and
// on forgets them, which is also the answer to a 404 that was only a blip.
//
// Telling a 404 apart needs its HTTP status, which only an XHR carries (an
// <img> error has none), and Cesium loads tiles through <img> on browsers whose
// createImageBitmap takes no options (WebKit: Safari, every iOS browser); so a
// sparse provider carries a discard policy that never discards, which makes
// Cesium fetch each tile as a blob over XHR on every browser. Both caches send
// Access-Control-Allow-Origin on their 404s (probed 2026-09-26), so the XHR
// sees the status.
//
// Cesium clamps any level below a provider's `minimumLevel` UP to it, which
// from a tilted view means thousands of tiles; so `minimumLevel` is never set
// on the provider: the floor is handled here by answering a blank tile.

import type * as CesiumNS from "cesium";
import { getCesium } from "./cesium";
import { hexRgb, inkToTint, shadeToAlpha } from "@/lib/terrain/webmercator";

export interface TileSpec {
  /** Identity: a spec with a new key replaces the layer's imagery. */
  key: string;
  kind: "xyz" | "wms";
  /** xyz: the URL template; wms: the service endpoint. */
  url: string;
  /** wms: LAYERS. */
  layers?: string;
  /** wms: extra GetMap parameters (format, transparent, version are set). */
  wmsParameters?: Record<string, string>;
  tileSize?: 256 | 512;
  /** Deepest level the source publishes; Cesium magnifies it beyond. */
  maximumLevel: number;
  /** Levels below this are drawn empty without asking the source. */
  floorLevel?: number;
  /** Only request inside [west, south, east, north] degrees. */
  rectangle?: [number, number, number, number];
  credit: string;
  /** Default opacity, 0..1 (the viewer's slider overrides it). */
  alpha: number;
  /** Camera-height gate in metres: drawn only while the camera is at or below maxHeight (and at or above minHeight). */
  maxHeight?: number;
  minHeight?: number;
  /** Class rasters (land cover, hazard classes): magnify without smoothing. */
  nearest?: boolean;
  /** Dark lines on a light opaque background -> these lines in this colour on transparent. */
  ink?: string;
  /** A light, opaque hillshade -> only its shading, a multiply over what is under it (flat, lit ground goes clear). Ignored with `ink`. */
  shade?: boolean;
  /** xyz only: a cache that answers 404 where it publishes no tile; a 404 then means "no tile here", not a failure. */
  sparse?: boolean;
  /** Stacking among picture layers; higher draws on top. */
  z: number;
}

export type TileHealth = { failing: false } | { failing: true; message: string };

/** Whether the camera height is inside a spec's gate. */
export function inHeightGate(spec: Pick<TileSpec, "minHeight" | "maxHeight">, height: number): boolean {
  if (spec.maxHeight != null && height > spec.maxHeight) return false;
  if (spec.minHeight != null && height < spec.minHeight) return false;
  return true;
}

let blank: HTMLCanvasElement | null = null;
function blankTile(): HTMLCanvasElement {
  if (!blank) {
    blank = document.createElement("canvas");
    blank.width = 1;
    blank.height = 1;
  }
  return blank;
}

// ---------------------------------------------------------------- sparse caches

/** Most tiles a sparse layer remembers as unpublished (the oldest is forgotten first). */
const ABSENT_MAX = 4096;

export function tileKey(x: number, y: number, level: number): string {
  return `${level}/${x}/${y}`;
}

/** Remember a tile the cache answered 404 for (at most ABSENT_MAX, the oldest forgotten first). */
export function rememberAbsent(absent: Set<string>, x: number, y: number, level: number, max = ABSENT_MAX): void {
  const key = tileKey(x, y, level);
  absent.delete(key);
  absent.add(key);
  while (absent.size > max) absent.delete(absent.values().next().value as string);
}

/** The HTTP status of a failed tile, as Cesium reports it (TileProviderError.error). */
export function tileErrorStatus(err: unknown): number | undefined {
  const s = (err as { error?: { statusCode?: unknown } } | null)?.error?.statusCode;
  return typeof s === "number" ? s : undefined;
}

// ---------------------------------------------------------------- repaint

type Img = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
type PixelPass = (rgba: Uint8ClampedArray) => void;

/**
 * Run a pixel pass over a tile. Cesium decodes imagery to an ImageBitmap
 * already flipped for upload (and WebGL ignores UNPACK_FLIP_Y for bitmaps), but
 * flips a canvas or an <img> as it uploads it; so a bitmap in comes back as a
 * bitmap of the same orientation, anything else as a canvas, and the tile is
 * never upside down.
 */
async function repaint(img: Img, pass: PixelPass): Promise<Img> {
  const w = (img as { width: number }).width;
  const h = (img as { height: number }).height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return img;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  pass(data.data);
  ctx.putImageData(data, 0, 0);
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) return createImageBitmap(c);
  return c;
}

function pixelPass(spec: TileSpec): PixelPass | null {
  if (spec.ink) {
    const rgb = hexRgb(spec.ink);
    return (px) => void inkToTint(px, rgb);
  }
  if (spec.shade) return (px) => void shadeToAlpha(px);
  return null;
}

type RequestImage = (x: number, y: number, level: number, request?: CesiumNS.Request) => Promise<unknown> | undefined;

/**
 * Build the imagery layer for a spec (not yet added to the globe). `health`
 * hears when tiles start failing (three failures with no success between) and
 * when one loads again.
 */
export function createTileLayer(spec: TileSpec, health?: (h: TileHealth) => void): CesiumNS.ImageryLayer {
  const C = getCesium();
  const tilingScheme = new C.WebMercatorTilingScheme();
  const size = spec.tileSize ?? 256;
  const rectangle = spec.rectangle ? C.Rectangle.fromDegrees(...spec.rectangle) : undefined;
  const credit = new C.Credit(spec.credit);
  const sparse = spec.sparse === true && spec.kind === "xyz";
  const provider: CesiumNS.ImageryProvider =
    spec.kind === "wms"
      ? new C.WebMapServiceImageryProvider({
          url: spec.url,
          layers: spec.layers ?? "",
          parameters: { transparent: true, format: "image/png", ...(spec.wmsParameters ?? {}) },
          tilingScheme,
          tileWidth: size,
          tileHeight: size,
          maximumLevel: spec.maximumLevel,
          rectangle,
          credit,
          enablePickFeatures: false,
        })
      : new C.UrlTemplateImageryProvider({
          url: spec.url,
          tilingScheme,
          tileWidth: size,
          tileHeight: size,
          maximumLevel: spec.maximumLevel,
          rectangle,
          credit,
          enablePickFeatures: false,
          // With any discard policy set, ImageryProvider.loadImage asks for the tile as a blob
          // (preferBlob), which goes over XHR on every browser, so a 404 reaches errorEvent with
          // its status. NeverTileDiscardPolicy is always ready and discards nothing, and Chromium
          // still gets the same flipped ImageBitmap as without it.
          ...(sparse ? { tileDiscardPolicy: new C.NeverTileDiscardPolicy() } : {}),
        });

  const target = provider as unknown as { requestImage: RequestImage };
  const base: RequestImage = target.requestImage.bind(provider);
  const pass = pixelPass(spec);
  const absent = new Set<string>();
  let fails = 0;
  let failing = false;
  target.requestImage = (x, y, level, request) => {
    if (spec.floorLevel != null && level < spec.floorLevel) return Promise.resolve(blankTile());
    // A tile the cache already said it does not publish: fail without asking, and Cesium keeps the ancestor.
    if (sparse && absent.has(tileKey(x, y, level))) {
      return Promise.reject(Object.assign(new Error("no tile published here"), { statusCode: 404 }));
    }
    const p = base(x, y, level, request);
    if (!p) return p;
    return p.then((img) => {
      fails = 0;
      if (failing) {
        failing = false;
        health?.({ failing: false });
      }
      return pass && img ? repaint(img as Img, pass) : img;
    });
  };
  // With a listener attached Cesium stops writing each failed tile to the console; three
  // failures with no success between them is reported as the layer failing. A sparse
  // cache's 404 is "no tile here", not a failure.
  provider.errorEvent.addEventListener((err: CesiumNS.TileProviderError) => {
    if (sparse && tileErrorStatus(err) === 404) {
      rememberAbsent(absent, err.x, err.y, err.level);
      return;
    }
    fails++;
    if (!failing && fails >= 3) {
      failing = true;
      const e = err?.error as { statusCode?: number; message?: string } | undefined;
      const why = e?.statusCode ? `HTTP ${e.statusCode}` : (err?.message ?? "tile request failed").slice(0, 80);
      health?.({ failing: true, message: `tiles failing: ${why}` });
    }
  });

  const layer = new C.ImageryLayer(provider, { alpha: spec.alpha });
  if (spec.nearest) layer.magnificationFilter = C.TextureMagnificationFilter.NEAREST;
  return layer;
}

/** Picture layers on the globe with their stacking order, so toggling order never changes what covers what. */
const stack: Array<{ layer: CesiumNS.ImageryLayer; z: number }> = [];

/** Add below every picture layer with a higher `z`, above the rest. */
export function addOrdered(viewer: CesiumNS.Viewer, layer: CesiumNS.ImageryLayer, z: number): void {
  const coll = viewer.imageryLayers;
  let index = coll.length;
  for (const e of stack) {
    if (e.z > z && coll.contains(e.layer)) index = Math.min(index, coll.indexOf(e.layer));
  }
  coll.add(layer, index);
  stack.push({ layer, z });
}

export function removeOrdered(viewer: CesiumNS.Viewer, layer: CesiumNS.ImageryLayer): void {
  const i = stack.findIndex((e) => e.layer === layer);
  if (i >= 0) stack.splice(i, 1);
  if (!viewer.isDestroyed() && viewer.imageryLayers.contains(layer)) viewer.imageryLayers.remove(layer, true);
}
