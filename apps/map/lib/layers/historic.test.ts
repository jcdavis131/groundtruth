import { describe, expect, it } from "vitest";
import { HISTORIC_BOUNDARY_MAX_M, HISTORIC_MAX_HEIGHT_M, historicLayer, historicRequest, historicViewKey } from "./historic";

const view = (height: number, lon = -77.03, lat = 38.89) => ({ lon, lat, height, heading: 0, pitch: -90 });

describe("historic places layer", () => {
  it("loads points below 25 km and adds boundaries only below 10 km", () => {
    expect(HISTORIC_MAX_HEIGHT_M).toBe(25_000);
    expect(HISTORIC_BOUNDARY_MAX_M).toBe(10_000);
    expect(historicViewKey(view(30_000))).toBe("above");
    expect(historicViewKey(view(20_000))).toMatch(/,mid$/);
    expect(historicViewKey(view(5_000))).toMatch(/,near$/);
    expect(historicRequest(view(20_000))).not.toContain("polygons=1");
    expect(historicRequest(view(5_000))).toContain("&polygons=1");
    expect(historicRequest(view(5_000))).not.toContain("nhl=1");
    expect(historicRequest(view(5_000), true)).toMatch(/&polygons=1&nhl=1$/);
  });

  it("asks the same box for every view in one grid cell, so viewers share the route's cache", () => {
    expect(historicRequest(view(5_000, -77.031, 38.891))).toBe(historicRequest(view(5_000, -77.029, 38.889)));
    expect(historicRequest(view(5_000))).toMatch(/^\/api\/land\?op=historic&bbox=-?\d+\.\d{4},/);
  });

  it("asks nothing above 25 km and says why", async () => {
    const r = await historicLayer.fetch({ keys: {}, view: view(40_000), now: 0, options: {} });
    expect(r.collection.features).toEqual([]);
    expect(r.note).toMatch(/below 25 km/);
  });
});
