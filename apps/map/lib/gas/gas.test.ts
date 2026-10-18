// Bundle integrity for the gas-price data layers: real EIA weekly data,
// nine states + national, provenance present, values sane.

import { describe, expect, it } from "vitest";
import { GAS_STATES, gasForecasts, gasPrices, stateForecastList, statePriceList } from "./gas";

const STATES = [...GAS_STATES];

describe("gas price bundle", () => {
  it("covers the national series and nine states", () => {
    const b = gasPrices();
    expect(Number.isFinite(b.national.current)).toBe(true);
    expect(b.national.current).toBeGreaterThan(0.5);
    expect(b.national.current).toBeLessThan(10);
    for (const code of STATES) {
      const s = b.states[code];
      expect(s, code).toBeDefined();
      expect(Number.isFinite(s.current)).toBe(true);
      expect(s.current).toBeGreaterThan(0.5);
      expect(s.current).toBeLessThan(10);
    }
  });

  it("carries weekly history in ascending date order", () => {
    const b = gasPrices();
    for (const s of [b.national, ...STATES.map((c) => b.states[c])]) {
      expect(s.history.length).toBeGreaterThan(100);
      for (let i = 1; i < s.history.length; i++) {
        expect(s.history[i][0] >= s.history[i - 1][0]).toBe(true);
      }
      const last = s.history[s.history.length - 1];
      expect(Math.abs(last[1] - s.current)).toBeLessThan(1e-9);
    }
  });

  it("has centroids and provenance", () => {
    const b = gasPrices();
    for (const code of STATES) {
      const c = b.centroids[code];
      expect(c, code).toBeDefined();
      expect(c[0]).toBeGreaterThanOrEqual(-180);
      expect(c[0]).toBeLessThanOrEqual(180);
      expect(c[1]).toBeGreaterThanOrEqual(-90);
      expect(c[1]).toBeLessThanOrEqual(90);
    }
    expect(b.meta.sources).toBeDefined();
    expect(Object.keys(b.meta.sources).length).toBeGreaterThan(0);
    expect(b.meta.freshness).toMatch(/weekly/i);
    expect(b.meta.provenance.length).toBeGreaterThan(20);
  });

  it("exposes nine priced states", () => {
    const list = statePriceList();
    expect(list).toHaveLength(9);
    expect(new Set(list.map((s) => s.code)).size).toBe(9);
  });
});

describe("gas forecast bundle", () => {
  it("carries walk-forward honesty metrics per series", () => {
    const b = gasForecasts();
    expect(b.national.maeTrailing).toBeGreaterThan(0);
    expect(b.national.maeTrailing).toBeLessThan(1);
    expect(b.national.dirAccTrailing).toBeGreaterThan(0);
    expect(b.national.dirAccTrailing).toBeLessThanOrEqual(1);
    for (const code of STATES) {
      const f = b.states[code];
      expect(f, code).toBeDefined();
      // A series too short to model reports null, never a fabricated number.
      if (f.predNext != null) {
        expect(Number.isFinite(f.predNext)).toBe(true);
        expect(f.maeTrailing).toBeGreaterThan(0);
      }
    }
  });

  it("lists only modelable states", () => {
    for (const s of stateForecastList()) {
      expect(Number.isFinite(s.predNext)).toBe(true);
      expect(Number.isFinite(s.maeTrailing)).toBe(true);
    }
  });
});
