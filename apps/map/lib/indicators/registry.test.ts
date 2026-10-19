import { describe, expect, it } from "vitest";
import { INDICATOR_IDS, INDICATORS, indicatorById, indicatorsInCategory } from "./registry";
import { INDICATOR_CATEGORIES, indicatorMeta } from "./types";
import { SOURCES } from "@/lib/provenance/sources";
import { LAYER_IDS } from "@/lib/layers/types";

describe("indicator registry", () => {
  it("has at least 14 indicators with unique kebab-case ids", () => {
    expect(INDICATORS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(INDICATOR_IDS).size).toBe(INDICATORS.length);
    for (const id of INDICATOR_IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it("every indicator names a source in SOURCES, a category, a unit and a reason", () => {
    for (const ind of INDICATORS) {
      expect(SOURCES[ind.source], ind.id).toBeDefined();
      expect(INDICATOR_CATEGORIES).toContain(ind.category);
      expect(ind.unit.length, ind.id).toBeGreaterThan(0);
      expect(ind.seriesId.length, ind.id).toBeGreaterThan(0);
      expect(ind.title.length, ind.id).toBeGreaterThan(0);
      expect(ind.whyItMatters.split(/[.!?]\s|[.!?]$/).filter(Boolean).length, `${ind.id} whyItMatters should be 1-2 sentences`).toBeLessThanOrEqual(3);
      expect(ind.whyItMatters, ind.id).not.toMatch(/\b(you should|recommend|buy now|sell now|investors should)\b/i);
      expect(typeof ind.fetch).toBe("function");
    }
  });
  it("every threshold has a level, a valid operator, a finite value and a label; conventions say so", () => {
    for (const ind of INDICATORS) {
      for (const th of ind.thresholds) {
        expect(["watch", "alert"]).toContain(th.level);
        expect(["<", ">", "<=", ">="]).toContain(th.op);
        expect(Number.isFinite(th.value), `${ind.id} ${th.label}`).toBe(true);
        expect(th.label.length, ind.id).toBeGreaterThan(0);
        expect(th.citation?.length ?? 0, `${ind.id} threshold "${th.label}" needs a citation`).toBeGreaterThan(0);
        if (/convention/i.test(th.citation ?? "")) expect(th.label, `${ind.id} "${th.label}"`).toMatch(/convention/i);
        if (th.on) expect(["value", "yoyPct", "yoyAbs"]).toContain(th.on);
      }
    }
  });
  it("related layers and fly-to targets are valid", () => {
    for (const ind of INDICATORS) {
      for (const l of ind.relatedLayers ?? []) expect(LAYER_IDS, ind.id).toContain(l);
      if (ind.flyTo) {
        expect(Math.abs(ind.flyTo.lon)).toBeLessThanOrEqual(180);
        expect(Math.abs(ind.flyTo.lat)).toBeLessThanOrEqual(90);
        expect(ind.flyTo.height).toBeGreaterThan(1000);
      }
      if (ind.geo?.lon != null) expect(Math.abs(ind.geo.lon)).toBeLessThanOrEqual(180);
    }
  });
  it("covers the brief's named signals", () => {
    for (const id of ["mississippi-memphis-stage", "mississippi-stlouis-stage", "laredo-trucks", "la-lb-container-teu", "ships-awaiting-berth", "shanghai-la-rate", "diesel-price", "mortgage-30y", "housing-starts", "building-permits", "unemployment-rate", "wti-crude", "texas-reservoirs-pct-full", "hoover-releases", "trade-balance", "retail-sales", "case-shiller"]) {
      expect(indicatorById(id), id).toBeDefined();
    }
    const memphis = indicatorById("mississippi-memphis-stage")!;
    expect(memphis.thresholds.some((t) => t.op === ">=" && t.value === 34 && t.level === "alert")).toBe(true);
    expect(memphis.thresholds.some((t) => t.op === "<=" && t.value === -5 && t.level === "watch")).toBe(true);
    expect(indicatorById("unemployment-rate")!.thresholds[0]).toMatchObject({ on: "yoyAbs", op: ">=", value: 0.5 });
    expect(indicatorById("hoover-releases")!.title).toMatch(/below Hoover Dam/);
  });
  it("lookups", () => {
    expect(indicatorById("nope")).toBeUndefined();
    expect(indicatorsInCategory("water").every((i) => i.category === "water")).toBe(true);
    expect(indicatorsInCategory("water").length).toBeGreaterThanOrEqual(5);
    const meta = indicatorMeta(INDICATORS[0]);
    expect("fetch" in meta).toBe(false);
    expect(JSON.parse(JSON.stringify(meta)).id).toBe(INDICATORS[0].id);
  });
});
