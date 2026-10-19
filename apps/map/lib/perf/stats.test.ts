import { describe, expect, it } from "vitest";
import { parsePerf } from "./flag";
import { FRAME_BUDGET_MS, frameStats, percentile, Ring } from "./stats";
import { cameraAt, PERF_PRESETS, RUN_MS } from "./views";

describe("percentile", () => {
  it("is null for no values and the value itself for one", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
  });

  it("interpolates between the closest ranks", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 25)).toBe(20);
    expect(percentile([10, 20], 50)).toBe(15);
    expect(percentile(xs, 95)).toBeCloseTo(48, 10);
  });

  it("clamps p to 0-100", () => {
    expect(percentile([1, 2, 3], -5)).toBe(1);
    expect(percentile([1, 2, 3], 500)).toBe(3);
  });
});

describe("frameStats", () => {
  it("reports nothing, not zero, with no frames", () => {
    expect(frameStats([])).toEqual({ frames: 0, dropped: 0, p50: null, p95: null, overBudget: null, mean: null });
  });

  it("gives p50, p95 and the share over 16.7 ms, from unsorted deltas", () => {
    // 18 frames at 16 ms, 2 at 40 ms.
    const deltas = [40, ...Array(9).fill(16), 40, ...Array(9).fill(16)];
    const s = frameStats(deltas);
    expect(s.frames).toBe(20);
    expect(s.p50).toBe(16);
    expect(s.overBudget).toBe(0.1);
    // rank 0.95 * 19 = 18.05 falls between the two 40 ms frames.
    expect(s.p95).toBe(40);
    // One slow frame in 20: rank 18.05 sits 5% of the way from rank 18 (16 ms) to rank 19 (40 ms).
    expect(frameStats([...Array(19).fill(16), 40]).p95).toBeCloseTo(16 + (40 - 16) * 0.05, 10);
    expect(s.mean).toBeCloseTo((18 * 16 + 80) / 20, 10);
  });

  it("counts a frame of exactly the budget as on time", () => {
    expect(frameStats([FRAME_BUDGET_MS, FRAME_BUDGET_MS + 0.1]).overBudget).toBe(0.5);
  });

  it("drops hidden-tab gaps over a second and ignores junk", () => {
    const s = frameStats([16, 17, 5000, Number.NaN, -3, 16]);
    expect(s.frames).toBe(3);
    expect(s.dropped).toBe(1);
    expect(s.p50).toBe(16);
  });

  it("does not reorder the caller's array", () => {
    const xs = [30, 10, 20];
    frameStats(xs);
    expect(xs).toEqual([30, 10, 20]);
  });
});

describe("Ring", () => {
  it("keeps the latest values, oldest first", () => {
    const r = new Ring(3);
    for (const x of [1, 2]) r.push(x);
    expect(r.values()).toEqual([1, 2]);
    for (const x of [3, 4, 5]) r.push(x);
    expect(r.size).toBe(3);
    expect(r.values()).toEqual([3, 4, 5]);
    r.clear();
    expect(r.values()).toEqual([]);
  });
});

describe("parsePerf", () => {
  it("is off unless perf=1", () => {
    expect(parsePerf("")).toEqual({ on: false, view: null });
    expect(parsePerf("?perf=0&view=austin")).toEqual({ on: false, view: null });
    expect(parsePerf("?view=austin")).toEqual({ on: false, view: null });
  });

  it("reads a known view and ignores an unknown one", () => {
    expect(parsePerf("?perf=1")).toEqual({ on: true, view: null });
    expect(parsePerf("?perf=1&view=texas")).toEqual({ on: true, view: "texas" });
    expect(parsePerf("perf=1&view=mars")).toEqual({ on: true, view: null });
  });
});

describe("the scripted paths", () => {
  it("each runs the full 10 s and starts and ends on its keyframes", () => {
    for (const p of Object.values(PERF_PRESETS)) {
      expect(p.path[0].at).toBe(0);
      expect(p.path[p.path.length - 1].at * 1000).toBe(RUN_MS);
      const key = (k: (typeof p.path)[number]) => ({ lon: k.lon, lat: k.lat, h: k.h, hd: k.hd, p: k.p });
      expect(cameraAt(p.path, -1)).toEqual(key(p.path[0]));
      expect(cameraAt(p.path, 99)).toEqual(key(p.path[p.path.length - 1]));
    }
  });

  it("keeps Austin under the 25 km schools ceiling all the way", () => {
    for (let t = 0; t <= 10; t += 0.1) expect(cameraAt(PERF_PRESETS.austin.path, t).h).toBeLessThan(25_000);
  });

  it("moves height on a log scale and turns the short way round", () => {
    const path = [
      { at: 0, lon: 0, lat: 0, h: 1_000, hd: 350, p: -50 },
      { at: 1, lon: 0, lat: 0, h: 100_000, hd: 10, p: -50 },
    ];
    const mid = cameraAt(path, 0.5);
    expect(mid.h).toBeCloseTo(10_000, 6);
    expect(mid.hd).toBeCloseTo(0, 6);
  });
});
