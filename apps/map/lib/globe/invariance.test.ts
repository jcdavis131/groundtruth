// Pan-invariance of every styled index layer: a feature's class is a function of its own value, not of
// which other features happen to be in view, and a null value is never filled with a scale colour.
//
// The layer list is the *Style exports of indexStyles.ts, so a new styled layer with no adapter below
// fails the first test instead of going unchecked. Each adapter builds features through the layer's own
// join (joinHealthTracts, joinSviCounties, ...), not through a copy of its binning. Two views share
// half their features with the same values; the other half is skewed (every value at the top of the
// range), which moves any break computed from the rows in view.
//
// Not covered, by design: the construct field (fieldStyle). Its heat is the square root of a unit's value
// over the largest complete unit in view, and its legend names that unit ("scaled to ...", legend.test.ts).

import { describe, expect, it } from "vitest";
import type { CountyOutline } from "@/lib/layers/areas";
import type { LayerFeature } from "@/lib/layers/types";
import type { ConstructNode } from "@/lib/fabric/types";
import { placesBreaks } from "@/lib/breaks";
import { BROADBAND_BIN_COLORS, bdcRow, joinBroadbandCounties, type BdcRow } from "@/lib/civic/broadband";
import { buildHousing, HOUSING_BIN_COLORS, HOUSING_SUPPRESSED_FILL } from "@/lib/civic/housing";
import { binOf, PLACES_BIN_COLORS, quintiles } from "@/lib/civic/places";
import { joinSviCounties, SVI_BIN_COLORS, sviRow, type SviRow } from "@/lib/civic/svi";
import { joinCounties, NRI_CLASSES, NRI_COLORS, nriRow, type NriRow } from "@/lib/hazards/nri";
import { joinWrcCounties, WRC_BIN_COLORS, wrcRow, type WrcRow } from "@/lib/hazards/wrc";
import { joinHealthCounties, joinHealthTracts, type HealthExtra, type HealthRow } from "@/lib/layers/health";
import fabricTracts from "@/lib/civic/fixtures/fabric-tract-hartford.json";
import * as indexStyles from "./indexStyles";
import type { LayerStyle } from "./renderer";

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

interface Cell {
  id: string;
  /** In the layer's own units (percent, percentile, providers); null: no value. */
  value: number | null;
}

interface Adapter {
  name: string;
  ids: readonly string[];
  /** The top of the layer's value range; cells are drawn from 0 to span. */
  span: number;
  featureId(id: string): string;
  /** The features the layer's own join builds for these cells. */
  build(cells: readonly Cell[]): LayerFeature[];
  /** The class a feature is drawn in: its bin, or its rating. */
  classOf(f: LayerFeature): number | string | null;
  /** The colours of the layer's scale. */
  scale: readonly string[];
  /** The one colour a null value may be filled with (HUD's suppressed grey), or null: a null value is not filled at all. */
  nullFill: string | null;
}

const present = <T>(x: T | null | undefined): x is T => x != null;
const binOfFeature = (f: LayerFeature): number | null => (f.properties.extra as { bin: number | null }).bin;

function square(k: number): { type: "Polygon"; coordinates: number[][][] } {
  const x = (k % 8) * 0.5;
  const y = Math.floor(k / 8) * 0.5;
  return { type: "Polygon", coordinates: [[[x, y], [x + 0.4, y], [x + 0.4, y + 0.4], [x, y + 0.4], [x, y]]] };
}

const COUNTY_IDS = Array.from({ length: 40 }, (_, i) => String(20001 + i));
const OUTLINES: CountyOutline[] = COUNTY_IDS.map((geoid, i): CountyOutline => ({
  geoid,
  name: `County ${geoid}`,
  stusab: "XX",
  feature: { type: "Feature", geometry: square(i), properties: { id: geoid, layer: "health", name: `County ${geoid}`, source: "test" } },
}));

const TRACT_UNITS = (fabricTracts as unknown as { data: { units: ConstructNode[] } }).data.units;
const TRACT_IDS = TRACT_UNITS.map((u) => u.code).filter((c): c is string => typeof c === "string" && /^\d{11}$/.test(c));
const HOUSING_IDS = Array.from({ length: 40 }, (_, i) => String(10000000000 + i));

const healthRow = (fips: string, value: number): HealthRow => ({ fips, name: null, state: "XX", value, low: null, high: null, year: 2023, population: null });
const valued = (cells: readonly Cell[]): Array<{ id: string; value: number }> => cells.filter((c): c is { id: string; value: number } => c.value != null);

const healthCounties: Adapter = {
  name: "counties",
  ids: COUNTY_IDS,
  span: 30,
  featureId: (id) => `places:county:${id}`,
  build: (cells) => joinHealthCounties(OUTLINES, valued(cells).map((c) => healthRow(c.id, c.value)), "DIABETES", placesBreaks("DIABETES").breaks).features as LayerFeature[],
  classOf: binOfFeature,
  scale: PLACES_BIN_COLORS,
  nullFill: null,
};

const healthTracts: Adapter = {
  name: "tracts",
  ids: TRACT_IDS,
  span: 30,
  featureId: (id) => `places:tract:${id}`,
  build: (cells) => joinHealthTracts(TRACT_UNITS, valued(cells).map((c) => healthRow(c.id, c.value)), "DIABETES", new Set(["09110"])).features as LayerFeature[],
  classOf: binOfFeature,
  scale: PLACES_BIN_COLORS,
  nullFill: null,
};

const vulnerability: Adapter = {
  name: "counties",
  ids: COUNTY_IDS,
  span: 100,
  featureId: (id) => `svi:county:${id}`,
  build: (cells) => {
    const rows = cells
      .map((c) => {
        const rpl = c.value == null ? -999 : c.value / 100;
        return sviRow({ FIPS: c.id, COUNTY: `County ${c.id}`, STATE: "Test", ST_ABBR: "XX", RPL_THEMES: rpl, RPL_THEME1: rpl, RPL_THEME2: rpl, RPL_THEME3: rpl, RPL_THEME4: rpl, F_TOTAL: 1 });
      })
      .filter(present) as SviRow[];
    return joinSviCounties(OUTLINES, rows, 0).features as LayerFeature[];
  },
  classOf: binOfFeature,
  scale: SVI_BIN_COLORS,
  nullFill: null,
};

const broadband: Adapter = {
  name: "counties",
  ids: COUNTY_IDS,
  span: 60,
  featureId: (id) => `broadband:county:${id}`,
  build: (cells) => {
    const rows = cells.map((c) => bdcRow({ GEOID: c.id, TotalBSLs: c.value == null ? 0 : 100, UniqueProviders: c.value == null ? 0 : Math.round(c.value) })).filter(present) as BdcRow[];
    return joinBroadbandCounties(OUTLINES, rows, 3).features as LayerFeature[];
  },
  classOf: binOfFeature,
  scale: BROADBAND_BIN_COLORS,
  nullFill: null,
};

const wildfirerisk: Adapter = {
  name: "counties",
  ids: COUNTY_IDS,
  span: 100,
  featureId: (id) => `wrc:county:${id}`,
  build: (cells) => {
    const rows = cells.map((c) => wrcRow({ GEOID: c.id, NAMELSAD: `County ${c.id}`, STUSPS: "XX", RISK_NATIO: c.value == null ? " " : c.value })).filter(present) as WrcRow[];
    return joinWrcCounties(OUTLINES, rows, 0, "national").features as LayerFeature[];
  },
  classOf: binOfFeature,
  scale: WRC_BIN_COLORS,
  nullFill: null,
};

const riskindex: Adapter = {
  name: "counties",
  ids: COUNTY_IDS,
  span: 100,
  featureId: (id) => `nri:county:${id}`,
  build: (cells) => {
    const rows: NriRow[] = cells.map((c) => nriRow({ STCOFIPS: c.id, COUNTY: `County ${c.id}`, STATEABBRV: "XX", RISK_RATNG: c.value == null ? "Not Applicable" : NRI_CLASSES[Math.min(4, Math.floor(c.value / 20))] }));
    return joinCounties(OUTLINES, rows, "composite").features as LayerFeature[];
  },
  classOf: (f) => (f.properties.extra as { rating: string | null }).rating,
  scale: NRI_CLASSES.map((c) => NRI_COLORS[c]),
  nullFill: null,
};

const housing: Adapter = {
  name: "voucher tracts",
  ids: HOUSING_IDS,
  span: 60,
  featureId: (id) => `housing:hcv:${id}`,
  build: (cells) => {
    const hcv = cells.map((c) => ({
      geometry: square(HOUSING_IDS.indexOf(c.id)),
      // HUD omits a suppressed tract's voucher count: no HCV_PUBLIC, so the tract has no value.
      properties: c.value == null ? { GEOID: c.id } : { GEOID: c.id, HCV_PUBLIC: 20, HCV_PUBLIC_PCT: c.value },
    }));
    return buildHousing(hcv, [], 0).features as LayerFeature[];
  },
  classOf: binOfFeature,
  scale: HOUSING_BIN_COLORS,
  // The one declared exception: a suppressed tract is a grey on no scale, named in the legend (legend.test.ts).
  nullFill: HOUSING_SUPPRESSED_FILL,
};

const STYLES = Object.entries(indexStyles).filter(([k]) => k.endsWith("Style")) as unknown as Array<[string, LayerStyle]>;

const ADAPTERS: Record<string, Adapter[]> = {
  riskindexStyle: [riskindex],
  healthStyle: [healthCounties, healthTracts],
  vulnerabilityStyle: [vulnerability],
  broadbandStyle: [broadband],
  wildfireriskStyle: [wildfirerisk],
  housingStyle: [housing],
};

/** Two views over the same ids: A with every value, B with the even-position features unchanged and the rest at the top of the range. */
function views(a: Adapter, seed: number): { A: Cell[]; B: Cell[]; common: string[] } {
  const r = rng(seed);
  const value = new Map(a.ids.map((id) => [id, Math.floor(r() * a.span * 10) / 10] as const));
  const top = (a.span * 10 - 1) / 10;
  return {
    A: a.ids.map((id) => ({ id, value: value.get(id) as number })),
    B: a.ids.map((id, i) => ({ id, value: i % 2 === 0 ? (value.get(id) as number) : top })),
    common: a.ids.filter((_, i) => i % 2 === 0),
  };
}

/** Problems with the claim "the same feature, in two different in-view sets, gets the same class". */
function invarianceViolations(a: Adapter, seed: number): string[] {
  const { A, B, common } = views(a, seed);
  const classes = (cells: Cell[]) => new Map(a.build(cells).map((f) => [f.properties.id, a.classOf(f)] as const));
  const inA = classes(A);
  const inB = classes(B);
  const out: string[] = [];
  for (const id of common) {
    const fid = a.featureId(id);
    if (!inA.has(fid) || !inB.has(fid)) out.push(`${fid}: missing from a view`);
    else if (inA.get(fid) !== inB.get(fid)) out.push(`${fid}: class ${String(inA.get(fid))} in one view, ${String(inB.get(fid))} in the other`);
  }
  return out;
}

/** Problems with the claim "a null value never yields a fill colour" (and a value always yields one on the scale). */
function nullViolations(a: Adapter, style: LayerStyle, seed: number): string[] {
  const r = rng(seed);
  const cells: Cell[] = a.ids.map((id, i) => ({ id, value: i % 3 === 0 ? null : Math.floor(r() * a.span * 10) / 10 }));
  const byId = new Map(a.build(cells).map((f) => [f.properties.id, f] as const));
  const out: string[] = [];
  for (const c of cells) {
    const f = byId.get(a.featureId(c.id));
    if (!f) {
      out.push(`${c.id}: no feature`);
      continue;
    }
    const fills = style.polygons?.(f) ?? [];
    if (c.value == null) {
      if (a.nullFill == null && fills.length > 0) out.push(`${c.id}: a null value is filled`);
      if (a.nullFill != null && (fills.length === 0 || fills.some((p) => p.color !== a.nullFill))) out.push(`${c.id}: a null value is not filled with the declared ${a.nullFill}`);
      if (a.scale.includes(style.colorFor?.(f) ?? "")) out.push(`${c.id}: a null value is coloured with a scale colour`);
      if (a.classOf(f) != null) out.push(`${c.id}: a null value has class ${String(a.classOf(f))}`);
    } else if (fills.length === 0 || fills.some((p) => !a.scale.includes(p.color ?? ""))) {
      out.push(`${c.id}: value ${c.value} has no fill on the scale`);
    }
  }
  return out;
}

describe("pan-invariance of every styled index layer", () => {
  it("has an adapter for every *Style export of indexStyles.ts and none for a layer that is gone", () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(ADAPTERS).sort()).toEqual(STYLES.map(([k]) => k).sort());
  });

  for (const [name, style] of STYLES) {
    for (const a of ADAPTERS[name] ?? []) {
      it(`${name} / ${a.name}: the same feature in two different in-view sets gets the same class`, () => {
        for (const seed of [1, 2, 3]) {
          const { A } = views(a, seed);
          // Not vacuous: the first view spans at least three classes.
          expect(new Set(a.build(A).map(a.classOf)).size, `seed ${seed}`).toBeGreaterThanOrEqual(3);
          expect(invarianceViolations(a, seed), `seed ${seed}`).toEqual([]);
        }
      });

      it(`${name} / ${a.name}: a null value never yields a fill colour`, () => {
        if (a.nullFill != null) expect(a.scale).not.toContain(a.nullFill);
        for (const seed of [1, 2, 3]) expect(nullViolations(a, style, seed), `seed ${seed}`).toEqual([]);
      });
    }
  }

  it("health: every county and tract is binned on the committed national county breaks", () => {
    const national = placesBreaks("DIABETES").breaks;
    for (const a of [healthCounties, healthTracts]) {
      for (const f of a.build(views(a, 4).A)) {
        const x = f.properties.extra as HealthExtra;
        expect(x.breaks, a.name).toEqual(national);
        expect(x.bin, a.name).toBe(binOf(x.value, national));
      }
    }
  });

  it("the check sees binning on the rows in view: quintiles of the loaded rows, as joinHealthTracts once did, fail it", () => {
    const relative: Adapter = {
      ...healthTracts,
      build: (cells) => {
        const rows = valued(cells);
        const breaks = quintiles(rows.map((c) => c.value));
        return rows.map((c) => ({ ...OUTLINES[0].feature, properties: { ...OUTLINES[0].feature.properties, id: `places:tract:${c.id}`, extra: { bin: binOf(c.value, breaks) } } }));
      },
    };
    expect(invarianceViolations(relative, 1).length).toBeGreaterThan(0);
  });

  it("the check sees a null value filled with a scale colour", () => {
    const style: LayerStyle = { ...(indexStyles.healthStyle as LayerStyle), polygons: () => [{ rings: [], color: PLACES_BIN_COLORS[0] }] };
    expect(nullViolations(healthTracts, style, 1).length).toBeGreaterThan(0);
  });
});
