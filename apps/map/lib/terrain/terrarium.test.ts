import { describe, expect, it, vi } from "vitest";
import { createRetryGate, RETRY_DELAYS_MS, terrainCallback, type GridFn } from "./terrarium";

const GRID_CELLS = 65 * 65;

/** A grid function that fails `failures` times (with an optional HTTP status), then answers `grid`. */
function flaky(failures: number, status?: number) {
  const grid = new Float32Array(GRID_CELLS).fill(123);
  let calls = 0;
  const fn = vi.fn<GridFn>(() => {
    calls++;
    if (calls <= failures) return Promise.reject(Object.assign(new Error("terrain tile 0/0/0: HTTP " + (status ?? "network")), { status }));
    return Promise.resolve(grid);
  });
  return { fn, grid };
}

function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

describe("keyless terrain callback", () => {
  it("defers a level-0 tile whose fetch fails once, instead of rejecting, then retries after 1 s", async () => {
    const c = clock();
    const { fn, grid } = flaky(1, 503);
    const cb = terrainCallback(fn, { gate: createRetryGate(c.now) });

    const first = cb(0, 0, 0);
    expect(first).toBeDefined();
    // Resolves undefined, which Cesium reads as "ask again later"; a rejection would leave the globe blank.
    await expect(first).resolves.toBeUndefined();

    // Waiting: answered at once, no fetch.
    expect(cb(0, 0, 0)).toBeUndefined();
    c.t = 999;
    expect(cb(0, 0, 0)).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);

    c.t = RETRY_DELAYS_MS[0];
    await expect(cb(0, 0, 0)).resolves.toBe(grid);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("waits 1, 2 and 4 s, then draws a level-0 tile flat and reports it once", async () => {
    const c = clock();
    const { fn } = flaky(Infinity);
    const onRootLost = vi.fn();
    const cb = terrainCallback(fn, { gate: createRetryGate(c.now), onRootLost });

    for (const delay of RETRY_DELAYS_MS) {
      await expect(cb(0, 0, 0)).resolves.toBeUndefined();
      c.t += delay - 1;
      expect(cb(0, 0, 0)).toBeUndefined();
      c.t += 1;
    }
    const last = await cb(0, 0, 0);
    expect(last).toBeInstanceOf(Float32Array);
    expect(last).toHaveLength(GRID_CELLS);
    expect(last!.every((h) => h === 0)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    expect(onRootLost).toHaveBeenCalledTimes(1);

    // The other level-0 tile gives up too; the report is not repeated.
    for (const delay of RETRY_DELAYS_MS) {
      await cb(1, 0, 0);
      c.t += delay;
    }
    await expect(cb(1, 0, 0)).resolves.toHaveLength(GRID_CELLS);
    expect(onRootLost).toHaveBeenCalledTimes(1);
  });

  it("lets a deeper tile that still fails reject, so Cesium draws it from its parent", async () => {
    const c = clock();
    const { fn } = flaky(Infinity);
    const onRootLost = vi.fn();
    const cb = terrainCallback(fn, { gate: createRetryGate(c.now), onRootLost });
    for (const delay of RETRY_DELAYS_MS) {
      await expect(cb(5, 3, 3)).resolves.toBeUndefined();
      c.t += delay;
    }
    await expect(cb(5, 3, 3)).rejects.toThrow(/HTTP/);
    expect(onRootLost).not.toHaveBeenCalled();
  });

  it("pauses every tile after a 429 or 503, not only the one that got it", async () => {
    const c = clock();
    const gate = createRetryGate(c.now);
    const a = terrainCallback(flaky(1, 503).fn, { gate });
    await a(0, 0, 1);
    const other = flaky(0);
    const b = terrainCallback(other.fn, { gate });
    expect(b(1, 0, 1)).toBeUndefined();
    expect(other.fn).not.toHaveBeenCalled();
    c.t = RETRY_DELAYS_MS[0];
    await expect(b(1, 0, 1)).resolves.toBe(other.grid);
  });

  it("does not pause other tiles for a plain network failure", async () => {
    const c = clock();
    const gate = createRetryGate(c.now);
    await terrainCallback(flaky(1).fn, { gate })(0, 0, 1);
    const other = flaky(0);
    await expect(terrainCallback(other.fn, { gate })(1, 0, 1)).resolves.toBe(other.grid);
  });

  it("answers 'ask again later' without fetching while too many tiles are in flight", () => {
    const { fn } = flaky(0);
    const cb = terrainCallback(fn, { busy: () => true });
    expect(cb(0, 0, 0)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it("forgets a tile's failures once it loads", async () => {
    const c = clock();
    const gate = createRetryGate(c.now);
    const cb = terrainCallback(flaky(1).fn, { gate });
    await cb(2, 1, 2);
    c.t = RETRY_DELAYS_MS[0];
    await cb(2, 1, 2);
    // A new failure starts again at the first delay, not the second.
    gate.fail("2/2/1");
    expect(gate.waiting("2/2/1")).toBe(true);
    c.t += RETRY_DELAYS_MS[0];
    expect(gate.waiting("2/2/1")).toBe(false);
  });
});
