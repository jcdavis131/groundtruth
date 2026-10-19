// Layer contract for the gas price + forecast layers: registered, fetchable,
// honest metadata on every feature.

import { describe, expect, it } from "vitest";
import { LAYER_BY_ID, LAYERS } from "./index";
import type { FetchContext } from "./types";
import { gasForecastLayer } from "./gasForecast";
import { gasPricesLayer } from "./gasPrices";

const ctx: FetchContext = {
  keys: {},
  view: { lon: -98, lat: 39, height: 5_000_000, heading: 0, pitch: -90 },
  now: Date.now(),
  options: {},
};

describe("gas layers registration", () => {
  it("registers both layers with unique ids", () => {
    const ids = LAYERS.map((l) => l.id);
    expect(ids).toContain("gasprices");
    expect(ids).toContain("gasforecast");
    expect(new Set(ids).size).toBe(ids.length);
    expect(LAYER_BY_ID["gasprices"]).toBe(gasPricesLayer);
    expect(LAYER_BY_ID["gasforecast"]).toBe(gasForecastLayer);
  });

  it("keeps the estimate caption on the forecast layer", () => {
    expect(gasForecastLayer.estimate).toMatch(/forecast/i);
    expect(gasPricesLayer.estimate).toBeUndefined();
  });
});

describe("gasPrices fetch", () => {
  it("returns nine state point features with provenance", async () => {
    const r = await gasPricesLayer.fetch(ctx);
    expect(r.collection.features).toHaveLength(9);
    for (const f of r.collection.features) {
      expect(f.geometry.type).toBe("Point");
      expect(f.properties.layer).toBe("gasprices");
      expect(f.properties.source).toMatch(/Energy Information Administration/);
      expect(f.properties.details?.["Regular"]).toMatch(/\$/);
    }
    expect(r.note).toMatch(/EIA weekly/);
    expect(r.note).toMatch(/as of \d{4}-\d{2}-\d{2}/);
    expect(r.meta?.provenance).toBeDefined();
  });
});

describe("gasForecast fetch", () => {
  it("returns forecast features carrying their trailing error", async () => {
    const r = await gasForecastLayer.fetch(ctx);
    expect(r.collection.features.length).toBeGreaterThan(0);
    for (const f of r.collection.features) {
      expect(f.properties.layer).toBe("gasforecast");
      const d = f.properties.details ?? {};
      expect(d["Predicted next print"]).toMatch(/\$/);
      expect(d["Trailing MAE"]).toMatch(/\$/);
      expect(d["Direction accuracy"]).toMatch(/%/);
    }
    // The honesty pattern: the note never shows a forecast without its error.
    expect(r.note).toMatch(/MAE/);
  });
});
