import { afterEach, describe, expect, it, vi } from "vitest";
import * as Cesium from "cesium";

// The real CesiumJS, loaded in Node, stands in for the lazy browser loader.
vi.mock("./cesium", async () => {
  const C = await import("cesium");
  return { getCesium: () => C, loadCesium: async () => C };
});

import { createTileLayer, inHeightGate, rememberAbsent, tileErrorStatus, tileKey, type TileHealth, type TileSpec } from "./tiles";

describe("tile errors", () => {
  it("reads the HTTP status Cesium attaches to a failed tile", () => {
    // TileProviderError.error is the RequestErrorEvent of the XHR that failed.
    expect(tileErrorStatus({ error: { statusCode: 404 } })).toBe(404);
    expect(tileErrorStatus({ error: { statusCode: 503 } })).toBe(503);
    expect(tileErrorStatus({ error: new Cesium.RequestErrorEvent(404) })).toBe(404);
  });

  it("has no status for a network error, a decode failure or nothing at all", () => {
    expect(tileErrorStatus({ error: new Error("Failed to fetch") })).toBeUndefined();
    expect(tileErrorStatus({ error: { statusCode: "404" } })).toBeUndefined();
    expect(tileErrorStatus({})).toBeUndefined();
    expect(tileErrorStatus(undefined)).toBeUndefined();
    expect(tileErrorStatus(null)).toBeUndefined();
  });
});

describe("sparse caches", () => {
  it("remembers exactly the tile that was a 404, not the tiles under it", () => {
    // USGS relief: level 9 over San Antonio is a 404 while level 10 under it is published (probed 2026-09-26).
    const absent = new Set<string>();
    rememberAbsent(absent, 115, 212, 9);
    expect(absent.has(tileKey(115, 212, 9))).toBe(true);
    expect(absent.has(tileKey(231, 424, 10))).toBe(false);
    expect(absent.has(tileKey(57, 106, 8))).toBe(false);
  });

  it("forgets the oldest tile past its cap, and a repeat counts as fresh", () => {
    const absent = new Set<string>();
    rememberAbsent(absent, 0, 0, 5, 2);
    rememberAbsent(absent, 1, 0, 5, 2);
    rememberAbsent(absent, 0, 0, 5, 2);
    rememberAbsent(absent, 2, 0, 5, 2);
    expect([...absent]).toEqual([tileKey(0, 0, 5), tileKey(2, 0, 5)]);
  });
});

describe("sparse provider", () => {
  const spec = (over: Partial<TileSpec> = {}): TileSpec => ({
    key: "t",
    kind: "xyz",
    url: "https://tiles.example.test/{z}/{y}/{x}",
    maximumLevel: 13,
    credit: "test",
    alpha: 1,
    z: 0,
    ...over,
  });
  type Wrapped = { requestImage: (x: number, y: number, level: number) => Promise<unknown> | undefined };
  const provider = (layer: Cesium.ImageryLayer) => layer.imageryProvider as unknown as Cesium.ImageryProvider & Wrapped;

  afterEach(() => vi.restoreAllMocks());

  it("asks for a sparse cache's tiles as a blob, the XHR path whose 404 carries its status on every browser", async () => {
    // Without preferBlob, Cesium loads through <img> where createImageBitmap takes no options (WebKit),
    // and an <img> error has no status.
    const fetchImage = vi.spyOn(Cesium.Resource.prototype, "fetchImage").mockImplementation(() => Promise.reject(new Cesium.RequestErrorEvent(404)));
    await expect(provider(createTileLayer(spec({ sparse: true }))).requestImage(1, 2, 9)).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchImage.mock.calls[0][0]).toMatchObject({ preferBlob: true, preferImageBitmap: true, flipY: true });
  });

  it("leaves every other picture layer on Cesium's default image path", async () => {
    const fetchImage = vi.spyOn(Cesium.Resource.prototype, "fetchImage").mockImplementation(() => Promise.reject(new Cesium.RequestErrorEvent(500)));
    const layer = createTileLayer(spec());
    expect(provider(layer).tileDiscardPolicy).toBeUndefined();
    await expect(provider(layer).requestImage(1, 2, 9)).rejects.toBeDefined();
    expect(fetchImage.mock.calls[0][0]).not.toHaveProperty("preferBlob");
  });

  it("never discards a tile it received", () => {
    const policy = provider(createTileLayer(spec({ sparse: true }))).tileDiscardPolicy;
    expect(policy.isReady()).toBe(true);
    expect(policy.shouldDiscardImage({} as HTMLImageElement)).toBe(false);
  });

  it("takes a 404 as 'no tile here': not a failure, and that tile is not asked for again", async () => {
    const fetchImage = vi.spyOn(Cesium.Resource.prototype, "fetchImage").mockImplementation(() => Promise.reject(new Cesium.RequestErrorEvent(404)));
    const health: TileHealth[] = [];
    const p = provider(createTileLayer(spec({ sparse: true }), (h) => health.push(h)));
    for (const x of [1, 2, 3, 4]) p.errorEvent.raiseEvent({ x, y: 2, level: 9, error: new Cesium.RequestErrorEvent(404) });
    expect(health).toEqual([]);
    await expect(p.requestImage(1, 2, 9)).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchImage).not.toHaveBeenCalled();
    await expect(p.requestImage(1, 3, 9)).rejects.toBeDefined();
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("still reports a server failure", () => {
    const health: TileHealth[] = [];
    const p = provider(createTileLayer(spec({ sparse: true }), (h) => health.push(h)));
    for (const x of [1, 2, 3]) p.errorEvent.raiseEvent({ x, y: 2, level: 9, error: new Cesium.RequestErrorEvent(503) });
    expect(health).toEqual([{ failing: true, message: "tiles failing: HTTP 503" }]);
  });
});

describe("height gate", () => {
  it("draws only inside [minHeight, maxHeight]", () => {
    expect(inHeightGate({ maxHeight: 1000 }, 1000)).toBe(true);
    expect(inHeightGate({ maxHeight: 1000 }, 1001)).toBe(false);
    expect(inHeightGate({ minHeight: 10 }, 9)).toBe(false);
    expect(inHeightGate({}, 1e9)).toBe(true);
  });
});
