import { describe, expect, it } from "vitest";
import {
  cellLonLat,
  currentColor,
  liveCells,
  sampleFlow,
  windColor,
  type FlowGrid,
} from "./flowField";

function toyGrid(): FlowGrid {
  // 2x3 grid: lats 0,10 ; lons -180,-170,-160
  return {
    asof: "2026-10-10T00:00:00Z",
    source: "test",
    grid: { lat0: 0, lon0: -180, dlat: 10, dlon: 10, nlat: 2, nlon: 3 },
    u: [1, 2, 3, 4, 5, 6],
    v: [0, 0, 0, 0, 0, 0],
  };
}

describe("sampleFlow", () => {
  it("returns exact corner values", () => {
    const s = sampleFlow(toyGrid(), -180, 0);
    expect(s).toMatchObject({ u: 1, v: 0 });
  });

  it("bilinearly interpolates the interior", () => {
    // halfway between u=1 (-180,0) and u=2 (-170,0)
    const s = sampleFlow(toyGrid(), -175, 0);
    expect(s!.u).toBeCloseTo(1.5, 9);
    // centre of the four cells around (-175, 5): (1+2+4+5)/4
    const c = sampleFlow(toyGrid(), -175, 5);
    expect(c!.u).toBeCloseTo(3, 9);
  });

  it("wraps longitude across the antimeridian", () => {
    const a = sampleFlow(toyGrid(), 190, 0); // == -170
    const b = sampleFlow(toyGrid(), -170, 0);
    expect(a!.u).toBeCloseTo(b!.u, 9);
  });

  it("returns null outside the latitude range", () => {
    expect(sampleFlow(toyGrid(), -170, 95)).toBeNull();
    expect(sampleFlow(toyGrid(), -170, -95)).toBeNull();
  });

  it("returns null when any corner is missing", () => {
    const g = toyGrid();
    g.u[0] = null;
    expect(sampleFlow(g, -178, 2)).toBeNull();
  });

  it("carries sst through when present", () => {
    const g = toyGrid();
    g.sst = [10, 20, 30, 40, 50, 60];
    const s = sampleFlow(g, -175, 5);
    expect(s!.sst).toBeCloseTo(30, 9);
  });
});

describe("colour ramps", () => {
  it("wind: calm is dim, strong is opaque", () => {
    expect(windColor(0).alpha).toBeLessThan(windColor(25).alpha);
    expect(windColor(-5).alpha).toBe(windColor(0).alpha); // clamped, never NaN
  });

  it("wind: hue moves blue -> red with speed", () => {
    const slow = windColor(2).rgb;
    const fast = windColor(32).rgb;
    expect(slow[2]).toBeGreaterThan(slow[0]); // blue-dominant
    expect(fast[0]).toBeGreaterThan(fast[2]); // red-dominant
  });

  it("currents: cold blue vs warm red, still water fades", () => {
    const cold = currentColor(2, 1);
    const warm = currentColor(30, 1);
    expect(cold.rgb[2]).toBeGreaterThan(cold.rgb[0]);
    expect(warm.rgb[0]).toBeGreaterThan(warm.rgb[2]);
    expect(currentColor(20, 0).alpha).toBeLessThan(currentColor(20, 2).alpha);
    expect(currentColor(null, 1).alpha).toBeGreaterThan(0); // unknown sst still draws
  });
});

describe("liveCells / cellLonLat", () => {
  it("skips null cells and locates cell centres", () => {
    const g = toyGrid();
    g.u[4] = null;
    const cells = liveCells(g);
    expect(cells).not.toContain(4);
    expect(cells).toHaveLength(5);
    expect(cellLonLat(g, 0)).toEqual([-180, 0]);
    expect(cellLonLat(g, 5)).toEqual([-160, 10]);
  });
});
