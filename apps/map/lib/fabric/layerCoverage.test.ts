// The construct field knows what a view-loaded layer covered only if the layer says so. Water,
// companies, banks and aircraft each draw the box they loaded (kind "loaded-box"), so a unit
// inside it reads complete and a unit outside it reads not loaded, never "none here".
// Every route answer below is empty: what is under test is the box, not the records.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeVitals } from "./emergence";
import type { ConstructNode } from "./types";
import { waterLayer } from "@/lib/layers/water";
import { companiesLayer } from "@/lib/layers/companies";
import { banksLayer } from "@/lib/layers/banks";
import { aircraftLayer } from "@/lib/layers/aircraft";
import type { FetchContext, LayerDefinition, LayerFeature } from "@/lib/layers/types";

const LON = -97.74;
const LAT = 30.27;
const ctx = (height: number): FetchContext => ({ keys: {}, view: { lon: LON, lat: LAT, height, heading: 0, pitch: -90 }, now: 0, options: {} });

const sq = (x0: number, y0: number, s: number) => [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]];
const unit = (id: string, x0: number, y0: number): ConstructNode => ({ id, kind: "county", domain: "civic", name: id, facts: {}, links: [], source: "census-tigerweb", rings: sq(x0, y0, 0.1), areaKm2: 100 });
// A small unit at the camera target, and one 15 degrees east of it.
const here = unit("county:here", LON - 0.05, LAT - 0.05);
const away = unit("county:away", LON + 15, LAT);

const fc = { type: "FeatureCollection", features: [] };
const answer = (url: string): unknown => {
  if (url.startsWith("/data/ne_")) return fc;
  if (url.startsWith("/api/water?op=gauges")) return { data: [], returned: 0 };
  if (url.startsWith("/api/water")) return { data: [] };
  if (url.startsWith("/api/companies")) return { data: fc, count: 0, capped: false };
  if (url.startsWith("/api/finance?op=banks")) return { data: fc, counties: 3, sodYear: 2025 };
  if (url.startsWith("/api/aircraft")) return { data: { ac: [], states: [] } };
  throw new Error(`unexpected ${url}`);
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(answer(url)), { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function vitalsFor(layer: LayerDefinition, height: number) {
  const r = await layer.fetch(ctx(height));
  const fs = r.collection.features as LayerFeature[];
  return computeVitals([here, away], fs, layer.id as never, "count", undefined, [layer.id]);
}

describe("view-loaded layers report the box they loaded", () => {
  for (const [layer, height] of [
    [waterLayer, 200_000],
    [companiesLayer, 200_000],
    [banksLayer, 100_000],
    [aircraftLayer, 100_000],
  ] as const) {
    it(`${layer.id}: a unit inside the loaded box reads complete, one outside reads not loaded`, async () => {
      const v = await vitalsFor(layer, height);
      expect(v.get("county:here")).toMatchObject({ value: 0, coverage: "complete" });
      expect(v.get("county:away")).toMatchObject({ value: null, coverage: "none" });
      expect(v.get("county:away")!.reason).toMatch(new RegExp(`${layer.id} not loaded here`));
    });
  }

  it("aircraft reports the box inside its query radius, never the radius's bounding box", async () => {
    const r = await aircraftLayer.fetch(ctx(100_000));
    const box = r.collection.features.find((f) => f.properties.kind === "loaded-box");
    expect(box?.geometry.type).toBe("Polygon");
    const ring = (box!.geometry as { coordinates: number[][][] }).coordinates[0];
    const halfLatDeg = (Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]))) / 2;
    // 100 km height asks for max(40, 100,000 * 1.2 / 1,852) ≈ 64.8 nm ≈ 120 km; the inscribed square's half side is r / sqrt 2.
    const radiusKm = (Math.max(40, (100_000 * 1.2) / 1852) * 1852) / 1000;
    expect(halfLatDeg * 111.2).toBeLessThanOrEqual(radiusKm / Math.SQRT2 + 0.5);
    expect(halfLatDeg * 111.2).toBeGreaterThan(radiusKm / Math.SQRT2 - 2);
  });

  it("water above the gauge height and a capped companies answer do not read complete", async () => {
    const high = await vitalsFor(waterLayer, 2_000_000);
    expect(high.get("county:here")!.value).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith("/api/companies") ? { data: fc, count: 2000, capped: true } : answer(url)), { status: 200 })),
    );
    const capped = await vitalsFor(companiesLayer, 200_000);
    expect(capped.get("county:here")).toMatchObject({ value: null, coverage: "partial" });
    expect(capped.get("county:here")!.reason).toMatch(/record limit/);
  });
});
