// The legend contract: the legend is computed from the same functions that
// paint, so what it shows cannot drift from what the field draws.

import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { computeVitals, heatColor, NOT_LOADED, fmtValue, type Coverage, type Measure, type Normalise, type Vitals } from "./emergence";
import { setVitals } from "./emergenceState";
import { FLOW_CLASSES, FLOW_CLASS_ORDER } from "./condition";
import { legendFor, rampColorAt } from "./legend";
import { fieldStyle } from "@/lib/globe/fieldStyles";
import { indexLegend, type IndexLayer } from "@/lib/globe/indexStyles";
import { NRI_CLASSES, NRI_COLORS, NRI_NO_RATING_EDGE } from "@/lib/hazards/nri";
import { PLACES_BIN_COLORS } from "@/lib/civic/places";
import { SVI_BIN_COLORS, SVI_BIN_LABELS, SVI_BREAKS, SVI_NO_RANK_EDGE } from "@/lib/civic/svi";
import { BROADBAND_BIN_COLORS, BROADBAND_NO_DATA_EDGE, binLabelsFor, breaksFor } from "@/lib/civic/broadband";
import { WRC_BIN_COLORS, WRC_BIN_LABELS, WRC_BREAKS, WRC_NO_RANK_EDGE } from "@/lib/hazards/wrc";
import { HOUSING_BIN_COLORS, HOUSING_NO_DATA_EDGE, SUPPRESSED_LEGEND, housingBinLabels, housingBreaks } from "@/lib/civic/housing";

/** A small seeded generator (mulberry32), so a failure names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REASONS = ["schools not loaded here: outside the loaded box", "schools not loaded here: record limit reached", "no area known for this unit, so no density"];

/** Vitals the way computeVitals leaves them: null value unless complete, heat the square root of value over the complete maximum. */
function randomVitals(seed: number, normalise: Normalise): Map<string, Vitals> {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 14);
  const rows: Array<{ id: string; value: number | null; coverage: Coverage; reason?: string }> = [];
  for (let i = 0; i < n; i++) {
    const id = `county:${String(i).padStart(3, "0")}`;
    const k = r();
    if (k < 0.3) rows.push({ id, value: null, coverage: k < 0.15 ? "none" : "partial", reason: REASONS[Math.floor(r() * REASONS.length)] });
    else rows.push({ id, value: r() < 0.2 ? 0 : Math.round(r() * 5000) / (normalise === "density" ? 10 : 1), coverage: "complete" });
  }
  const max = Math.max(0, ...rows.map((x) => x.value ?? 0));
  const sorted = [...rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || (a.id < b.id ? -1 : 1));
  const out = new Map<string, Vitals>();
  for (const x of rows) {
    out.set(x.id, {
      total: x.value ?? 0,
      byLayer: {},
      density: null,
      value: x.value,
      heat: x.value != null && max > 0 ? Math.sqrt(x.value / max) : 0,
      coverage: x.coverage,
      ...(x.reason ? { reason: x.reason } : {}),
      rank: sorted.findIndex((s) => s.id === x.id),
      display: x.value == null ? "not loaded" : x.value > 0 ? fmtValue(x.value) : "",
    });
  }
  return out;
}

const colorOnMap = (id: string): string => fieldStyle.colorFor!({ properties: { id } } as unknown as LayerFeature);

describe("legendFor: the legend contains every colour the field paints", () => {
  const cases: Array<[Measure, Normalise]> = [["all", "count"], ["all", "density"], ["schools", "density"]];
  for (const [measure, normalise] of cases) {
    it(`200 seeded random maps, ${measure} / ${normalise}: each painted colour is an entry or lies on the ramp the entries define`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const vitals = randomVitals(seed * 7919 + (normalise === "density" ? 1 : 0), normalise);
        setVitals(vitals, `legend-test-${seed}`, seed);
        const legend = legendFor(vitals, measure, normalise);
        const entryColors = new Set(legend.entries.map((e) => e.color));
        for (const [id, v] of vitals) {
          const painted = colorOnMap(id);
          const ok = entryColors.has(painted) || (v.value != null && painted === rampColorAt(legend.entries, v.heat));
          expect(ok, `seed ${seed}, ${id}: painted ${painted}, heat ${v.heat}, entries ${[...entryColors].join(",")}`).toBe(true);
          // A unit with no value is painted as not loaded, never as a ramp colour.
          if (v.value == null) expect(painted, `seed ${seed}, ${id}`).toBe(NOT_LOADED);
        }
      }
    });
  }
  it("the ramp the entries define is heatColor itself, at 200 heats", () => {
    const vitals = randomVitals(5, "count");
    vitals.set("county:top", { total: 40, byLayer: {}, density: null, value: 40, heat: 1, coverage: "complete", rank: 0, display: "40" });
    const legend = legendFor(vitals, "all", "count");
    expect(legend.entries.some((e) => e.kind === "ramp")).toBe(true);
    const r = rng(11);
    for (let i = 0; i < 200; i++) {
      const h = r();
      expect(rampColorAt(legend.entries, h), `heat ${h}`).toBe(heatColor(h));
    }
  });
});

describe("legendFor: the not-loaded entry and the maximum", () => {
  it("has exactly one not-loaded entry iff some unit has a null value, and counts those units", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const vitals = randomVitals(seed, "density");
      const nulls = [...vitals.values()].filter((v) => v.value == null);
      const legend = legendFor(vitals, "all", "density");
      const entries = legend.entries.filter((e) => e.kind === "not-loaded");
      expect(entries.length, `seed ${seed}`).toBe(nulls.length > 0 ? 1 : 0);
      if (entries.length) expect(entries[0].color).toBe(NOT_LOADED);
      expect(legend.notLoaded.count, `seed ${seed}`).toBe(nulls.length);
      expect(Object.values(legend.notLoaded.reasons).reduce((a, b) => a + b, 0), `seed ${seed}`).toBe(nulls.length);
    }
  });
  it("max is the largest complete value, named, with its display equal to fmtValue; partial units never set it", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const vitals = randomVitals(seed, "count");
      const names = (id: string) => `Unit ${id}`;
      const complete = [...vitals.entries()].filter(([, v]) => v.coverage === "complete" && v.value != null && v.value > 0);
      const legend = legendFor(vitals, "all", "count", names);
      if (!complete.length) {
        expect(legend.max, `seed ${seed}`).toBeNull();
        continue;
      }
      const top = Math.max(...complete.map(([, v]) => v.value!));
      expect(legend.max, `seed ${seed}`).not.toBeNull();
      expect(legend.max!.value).toBe(top);
      expect(legend.max!.display).toBe(fmtValue(top));
      expect(vitals.get(legend.max!.id)!.value).toBe(top);
      expect(legend.max!.name).toBe(names(legend.max!.id));
    }
  });
  it("a partial unit with a large floor never sets the maximum, even if it carries a value", () => {
    const base = randomVitals(3, "count");
    base.set("county:zzz", { total: 999999, byLayer: {}, density: null, value: 999999, heat: 1, coverage: "partial", rank: 0, display: "x" });
    base.set("county:yyy", { total: 5, byLayer: {}, density: null, value: 5, heat: 0, coverage: "complete", rank: 1, display: "5.0" });
    const legend = legendFor(base, "all", "count");
    expect(legend.max).not.toBeNull();
    expect(legend.max!.id).not.toBe("county:zzz");
    expect(legend.max!.value).toBeLessThan(999999);
  });
  it("counts the reasons", () => {
    const v = randomVitals(1, "count");
    for (const [id, x] of v) v.set(id, { ...x, value: null, coverage: "none", reason: "a" });
    v.set("county:q", { total: 0, byLayer: {}, density: null, value: null, heat: 0, coverage: "partial", rank: 0, display: "not loaded", reason: "b" });
    const legend = legendFor(v, "all", "count");
    expect(legend.notLoaded.reasons).toEqual({ a: v.size - 1, b: 1 });
  });
  it("labels the ramp by inverting the square-root scale, at the four stops", () => {
    const vitals = new Map<string, Vitals>([
      ["county:48201", { total: 1204, byLayer: {}, density: null, value: 1204, heat: 1, coverage: "complete", rank: 0, display: "1,204" }],
      ["county:48453", { total: 10, byLayer: {}, density: null, value: 10, heat: Math.sqrt(10 / 1204), coverage: "complete", rank: 1, display: "10" }],
    ]);
    const legend = legendFor(vitals, "all", "count", (id) => (id === "county:48201" ? "Harris County" : id));
    const ramp = legend.entries.filter((e) => e.kind === "ramp");
    expect(ramp.map((e) => e.heat)).toEqual([0, 0.25, 0.6, 1]);
    expect(ramp.map((e) => e.color)).toEqual([0, 0.25, 0.6, 1].map(heatColor));
    expect(ramp[0].label).toBe("0");
    for (const e of ramp.slice(1)) expect(e.label, `heat ${e.heat}`).toBe(fmtValue(1204 * e.heat! ** 2));
    // The label at a stop is the value whose heat is that stop.
    for (const e of ramp) expect(Math.sqrt((1204 * e.heat! ** 2) / 1204)).toBeCloseTo(e.heat!, 12);
    expect(ramp[3].label).toBe("1,204");
    expect(legend.max).toEqual({ id: "county:48201", name: "Harris County", value: 1204, display: "1,204" });
    expect(legend.units).toBe("count");
  });
  it("names its units from the normalisation", () => {
    expect(legendFor(randomVitals(2, "count"), "all", "count").units).toBe("count");
    expect(legendFor(randomVitals(2, "density"), "all", "density").units).toBe("per 1,000 km²");
  });
  it("draws no ramp when no unit has a value, and only the not-loaded entry", () => {
    const v = randomVitals(1, "count");
    for (const [id, x] of v) v.set(id, { ...x, value: null, heat: 0, coverage: "none", reason: "r" });
    const legend = legendFor(v, "all", "count");
    expect(legend.entries.map((e) => e.kind)).toEqual(["not-loaded"]);
    expect(legend.max).toBeNull();
  });
  it("streamflow: the entries are the flow classes, and the maximum is not a count", () => {
    const v = randomVitals(4, "count");
    const legend = legendFor(v, "streamflow", "count");
    const classes = legend.entries.filter((e) => e.kind === "class");
    expect(classes.map((e) => e.color)).toEqual(FLOW_CLASS_ORDER.map((c) => FLOW_CLASSES[c].color));
    expect(legend.max).toBeNull();
    expect(legend.units).toBe("percentile against normal for today");
  });
});

// ---- the real vitals, so the legend is checked against computeVitals and not only against shaped fixtures

const sq = (x0: number, y0: number, s: number) => [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]];
const unit = (id: string, rings: number[][][], areaKm2?: number) => ({ id, kind: "county" as const, domain: "civic" as const, name: id, facts: {}, links: [], source: "census-tigerweb" as const, rings, areaKm2 });
const school = (id: string, lon: number, lat: number) =>
  ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat, 0] }, properties: { id, layer: "schools", name: id, source: "t" } }) as unknown as LayerFeature;
const loadedBox = (layer: string, w: number, s: number, e: number, n: number) =>
  ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: { id: `${layer}:loaded-box`, layer, name: "Loaded area", kind: "loaded-box", source: "this app", extra: {} } }) as unknown as LayerFeature;

describe("legendFor over computeVitals", () => {
  it("one loaded unit and one outside the loaded box", () => {
    const nodes = [unit("county:A", sq(0, 0, 1), 100), unit("county:B", sq(5, 5, 1), 100)];
    const features = [loadedBox("schools", -1, -1, 2, 2), school("s1", 0.5, 0.5), school("s2", 0.6, 0.6)];
    const vitals = computeVitals(nodes, features, "schools", "count", undefined, ["schools"]);
    setVitals(vitals, "real", 1);
    const legend = legendFor(vitals, "schools", "count", (id) => id.replace("county:", "County "));
    expect(legend.max).toEqual({ id: "county:A", name: "County A", value: 2, display: "2.0" });
    expect(legend.notLoaded.count).toBe(1);
    expect(legend.entries.filter((e) => e.kind === "not-loaded")).toHaveLength(1);
    for (const id of vitals.keys()) expect(legend.entries.map((e) => e.color)).toContain(colorOnMap(id));
  });
});

// ---- the index layers

const BIN_CASES: Array<{ layer: IndexLayer; measure?: number; colors: readonly string[]; labels: readonly string[]; breaks: readonly number[]; edge: string }> = [
  { layer: "vulnerability", colors: SVI_BIN_COLORS, labels: SVI_BIN_LABELS, breaks: SVI_BREAKS, edge: SVI_NO_RANK_EDGE },
  { layer: "wildfirerisk", colors: WRC_BIN_COLORS, labels: WRC_BIN_LABELS, breaks: WRC_BREAKS, edge: WRC_NO_RANK_EDGE },
  ...([0, 1, 2, 3] as const).map((m) => ({ layer: "broadband" as const, measure: m, colors: BROADBAND_BIN_COLORS, labels: binLabelsFor(m), breaks: breaksFor(m), edge: BROADBAND_NO_DATA_EDGE })),
  ...([0, 1] as const).map((m) => ({ layer: "housing" as const, measure: m, colors: HOUSING_BIN_COLORS, labels: housingBinLabels(m), breaks: housingBreaks(m), edge: HOUSING_NO_DATA_EDGE })),
];

describe("indexLegend: the index layers' legends come from their own bin colours and breaks", () => {
  for (const c of BIN_CASES) {
    const name = `${c.layer}${c.measure != null ? ` measure ${c.measure}` : ""}`;
    it(`${name}: each bin colour has an entry with its interval text`, () => {
      const entries = indexLegend(c.layer, { measure: c.measure });
      const fills = entries.filter((e) => e.kind === "class");
      c.colors.forEach((color, i) => {
        const e = fills.find((x) => x.color === color && x.label === c.labels[i]);
        expect(e, `bin ${i} ${color}`).toBeDefined();
        // The interval text names the break that opens it.
        if (i > 0) expect(c.labels[i], `bin ${i}`).toContain(String(c.breaks[i - 1]));
      });
    });
    it(`${name}: the no-data edge appears only as an outline entry`, () => {
      const entries = indexLegend(c.layer, { measure: c.measure });
      expect(entries.filter((e) => e.kind === "outline").map((e) => e.color)).toEqual([c.edge]);
      const asFill = entries.filter((e) => e.kind !== "outline" && e.color === c.edge);
      // HUD's suppressed tracts are a grey fill of their own, drawn at 0.3 alpha, and named as such.
      if (c.layer === "housing") expect(asFill.map((e) => e.label)).toEqual([SUPPRESSED_LEGEND]);
      else expect(asFill).toEqual([]);
    });
  }
  it("NRI: FEMA's five rating names, each with the colour the map paints it, and the no-rating edge as an outline", () => {
    const entries = indexLegend("riskindex");
    const fills = entries.filter((e) => e.kind === "class");
    expect(fills.map((e) => e.label)).toEqual([...NRI_CLASSES]);
    expect(fills.map((e) => e.color)).toEqual(NRI_CLASSES.map((c) => NRI_COLORS[c]));
    expect(entries.filter((e) => e.kind === "outline").map((e) => e.color)).toEqual([NRI_NO_RATING_EDGE]);
    expect(fills.some((e) => e.color === NRI_NO_RATING_EDGE)).toBe(false);
  });
  it("PLACES: five bins; with the view's quintile breaks the labels carry the break values, without them the labels say fifths", () => {
    const plain = indexLegend("health");
    const plainFills = plain.filter((e) => e.kind === "class");
    expect(plainFills.map((e) => e.color)).toEqual([...PLACES_BIN_COLORS]);
    expect(plainFills[0].label).toContain("lowest");
    expect(plainFills[4].label).toContain("highest");
    const withBreaks = indexLegend("health", { placesBreaks: [10, 20, 30, 40] });
    expect(withBreaks.filter((e) => e.kind === "class").map((e) => e.label)).toEqual(["under 10 %", "10 to 20 %", "20 to 30 %", "30 to 40 %", "40 % or more"]);
  });
});
