// Bundle integrity for the energy data layers: ERCOT prices, US state
// electricity prices, global generation mix, data centers. Real source data,
// provenance present, values sane, coverage caveats stated.

import { describe, expect, it } from "vitest";
import {
  datacentersBundle,
  ercotBundle,
  globalGenerationBundle,
  usElectricityBundle,
} from "./energy";

describe("ercot bundle", () => {
  it("has RTM + DAM hub/zone points with sane prices", () => {
    const b = ercotBundle();
    expect(b.rtm.points.length).toBeGreaterThanOrEqual(13);
    expect(b.dam.points.length).toBeGreaterThanOrEqual(13);
    for (const p of [...b.rtm.points, ...b.dam.points]) {
      expect(Number.isFinite(p.price_usd_mwh)).toBe(true);
      expect(p.price_usd_mwh).toBeGreaterThan(-500);
      expect(p.price_usd_mwh).toBeLessThan(10000);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    }
    expect(b.meta.sources["ERCOT MIS public reports"]).toBeTruthy();
  });

  it("has weather-zone load for all eight zones", () => {
    const b = ercotBundle();
    expect(b.load.zones.length).toBe(8);
    for (const z of b.load.zones) {
      expect(z.load_mw).toBeGreaterThan(0);
    }
  });
});

describe("us electricity bundle", () => {
  it("covers 50 states + DC with sane residential prices", () => {
    const b = usElectricityBundle();
    expect(Object.keys(b.states).length).toBe(51);
    for (const [code, s] of Object.entries(b.states)) {
      expect(s.residential, code).not.toBeNull();
      expect(s.residential!).toBeGreaterThan(1);
      expect(s.residential!).toBeLessThan(60);
      expect(s.history_residential.length).toBeGreaterThan(20);
    }
    expect(b.asof_year).toBeGreaterThanOrEqual(2024);
    expect(b.meta.sources["U.S. EIA State Energy Data System (SEDS)"]).toBeTruthy();
  });
});

describe("global generation bundle", () => {
  it("lists top countries with fuel shares summing near 100", () => {
    const b = globalGenerationBundle();
    expect(b.countries.length).toBeGreaterThan(20);
    for (const c of b.countries.slice(0, 10)) {
      expect(c.total_twh).toBeGreaterThan(0);
      const share = c.fuels.reduce((a, f) => a + f.share_pct, 0);
      expect(share).toBeGreaterThan(50);
      expect(share).toBeLessThan(110);
    }
    expect(b.meta.sources["Ember Electricity Data Explorer"]).toBeTruthy();
  });
});

describe("datacenters bundle", () => {
  it("has operating + construction points with valid coordinates", () => {
    const b = datacentersBundle();
    expect(b.operating.length).toBeGreaterThan(1000);
    for (const dc of [...b.operating.slice(0, 500), ...b.construction]) {
      expect(Math.abs(dc.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(dc.lon)).toBeLessThanOrEqual(180);
      expect(dc.name.length).toBeGreaterThan(0);
    }
  });

  it("states the coverage caveats honestly", () => {
    const b = datacentersBundle();
    const caveats = (b.meta.coverage_caveats ?? []).join(" ");
    expect(caveats).toMatch(/no complete/i);
    expect(caveats).toMatch(/floor/i);
  });
});
