// Layer contract for the energy layers: registered, fetchable,
// honest metadata on every feature.

import { describe, expect, it } from "vitest";
import { LAYER_BY_ID, LAYERS } from "./index";
import type { FetchContext } from "./types";
import { ercotPricesLayer } from "./ercotPrices";
import { usElectricityPricesLayer } from "./usElectricityPrices";
import { globalGenerationLayer } from "./globalGeneration";
import { datacentersLayer } from "./datacenters";

const ctx: FetchContext = {
  keys: {},
  view: { lon: -98, lat: 39, height: 5_000_000, heading: 0, pitch: -90 },
  now: Date.now(),
  options: {},
};

describe("energy layers registration", () => {
  it("registers all four layers with unique ids", () => {
    const ids = LAYERS.map((l) => l.id);
    for (const id of ["ercotprices", "uselectricity", "globalgeneration", "datacenters"] as const) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(LAYER_BY_ID["ercotprices"]).toBe(ercotPricesLayer);
    expect(LAYER_BY_ID["uselectricity"]).toBe(usElectricityPricesLayer);
    expect(LAYER_BY_ID["globalgeneration"]).toBe(globalGenerationLayer);
    expect(LAYER_BY_ID["datacenters"]).toBe(datacentersLayer);
  });

  it("keeps the coverage caveat on the datacenters layer", () => {
    expect(datacentersLayer.description).toMatch(/floor, not a census/i);
  });

  it("refreshes ERCOT on a 15-minute cadence", () => {
    expect(ercotPricesLayer.updateIntervalMs).toBe(15 * 60_000);
  });
});

describe("ercotPrices fetch", () => {
  it("returns hub/zone point features with provenance", async () => {
    const r = await ercotPricesLayer.fetch(ctx);
    expect(r.collection.features.length).toBeGreaterThanOrEqual(13);
    for (const f of r.collection.features) {
      expect(f.geometry.type).toBe("Point");
      expect(f.properties.layer).toBe("ercotprices");
      expect(f.properties.source).toBe("ERCOT");
    }
    expect(r.note).toMatch(/snapshot/);
  });
});

describe("usElectricityPrices fetch", () => {
  it("returns 51 state point features", async () => {
    const r = await usElectricityPricesLayer.fetch(ctx);
    expect(r.collection.features).toHaveLength(51);
    for (const f of r.collection.features) {
      expect(f.properties.layer).toBe("uselectricity");
    }
  });
});

describe("globalGeneration fetch", () => {
  it("returns country point features with fuel details", async () => {
    const r = await globalGenerationLayer.fetch(ctx);
    expect(r.collection.features.length).toBeGreaterThan(20);
    const f = r.collection.features[0];
    expect(f.properties.details?.["Total"]).toMatch(/TWh/);
  });
});

describe("datacenters fetch", () => {
  it("returns operating + construction features with the coverage note", async () => {
    const r = await datacentersLayer.fetch(ctx);
    expect(r.collection.features.length).toBeGreaterThan(1000);
    expect(r.note).toMatch(/floor, not a census/);
    const kinds = new Set(r.collection.features.map((f) => f.properties.kind));
    expect(kinds.has("operating")).toBe(true);
  });
});
