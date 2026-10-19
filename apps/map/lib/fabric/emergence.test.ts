import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { computeVitals, heatColor, isPhysical, vitalsKey } from "./emergence";
import { clampFieldBbox, FIELD_POVS, FIELD_SPECS, fieldOffset, kindForScale, parseField } from "./field";
import { basinFromBundle, centroidPathKm, parseBasinTable, walkDownstream, type BasinTable } from "./downstream";
import { ringCentroid, ringsArea, haversineKm } from "./geo";
import type { ConstructNode } from "./types";
import { riseProgress } from "@/lib/globe/constructStyles";
import { parseIntent } from "@/lib/voice/intent";

const sq = (x0: number, y0: number, s: number) => [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]];

const unit = (id: string, rings: number[][][], areaKm2?: number): ConstructNode => ({
  id,
  kind: "county",
  domain: "civic",
  name: id,
  facts: {},
  links: [],
  source: "census-tigerweb",
  rings,
  areaKm2,
});

const pt = (layer: string, id: string, lon: number, lat: number, extra: Record<string, unknown> = {}) =>
  ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat, 0] }, properties: { id, layer, name: id, source: "t", ...extra } }) as unknown as LayerFeature;

describe("the scale ladder", () => {
  it("lets finer constructs emerge as the camera descends", () => {
    expect(kindForScale("hydrologic", 12_000_000)).toBe("huc2");
    expect(kindForScale("hydrologic", 3_000_000)).toBe("huc4");
    expect(kindForScale("hydrologic", 400_000)).toBe("huc8");
    expect(kindForScale("hydrologic", 20_000)).toBe("huc12");
    expect(kindForScale("civic", 5_000_000)).toBe("state");
    expect(kindForScale("civic", 300_000)).toBe("county");
    expect(kindForScale("civic", 30_000)).toBe("place");
    expect(kindForScale("representation", 1_000_000)).toBe("cd");
    expect(kindForScale("representation", 50_000)).toBe("sldl");
  });
  it("only ever picks kinds it can fetch", () => {
    for (const pov of FIELD_POVS) for (const h of [1e3, 1e4, 1e5, 3e5, 1e6, 3e6, 1e7, 3e7]) expect(FIELD_SPECS[kindForScale(pov, h)], `${pov}@${h}`).toBeDefined();
  });
  it("clamps a bbox to the kind's span around its centre and snaps it", () => {
    const b = clampFieldBbox("tract", [-100, 25, -90, 35]);
    expect(b[2] - b[0]).toBeLessThanOrEqual(0.8 + 1e-9);
    expect((b[0] + b[2]) / 2).toBeCloseTo(-95, 0);
    expect(clampFieldBbox("tract", [-95.41, 29.7, -94.6, 30.5])).toEqual(clampFieldBbox("tract", [-95.4, 29.71, -94.59, 30.49]));
    expect(clampFieldBbox("state", [-170, -80, 170, 80])).toEqual([-180, -85, 180, 85]);
    // A small view gets a small box, not the kind's widest.
    const small = clampFieldBbox("county", [-98, 30, -97.5, 30.4]);
    expect(small[2] - small[0]).toBeLessThan(1);
    expect(small[2] - small[0]).toBeGreaterThanOrEqual(0.5);
    expect(fieldOffset([-100, 28, -94, 33])).toBeCloseTo(0.015, 3);
    expect(fieldOffset([0, 0, 0.1, 0.1])).toBe(0.0005);
  });
});

describe("parseField", () => {
  it("reads TIGERweb units with land area, internal point and outline", () => {
    const u = parseField("county", {
      features: [
        { attributes: { GEOID: "48453", NAME: "Travis County", AREALAND: "2575354868", INTPTLAT: "+30.2395263", INTPTLON: "-097.6910527" }, geometry: { rings: sq(-98, 30, 0.5) } },
        { attributes: { GEOID: null, NAME: "no code" } },
      ],
    });
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ id: "county:48453", name: "Travis County, TX", areaBasis: "land", anchor: [-97.6910527, 30.2395263] });
    expect(u[0].areaKm2).toBeCloseTo(2575.35, 1);
  });
  it("reads WBD total area and computes a centroid when none is published", () => {
    const u = parseField("huc8", { features: [{ attributes: { huc8: "12090205", name: "Austin-Travis Lakes", areasqkm: 3213.91 }, geometry: { rings: sq(-98, 30, 1) } }] });
    expect(u[0]).toMatchObject({ id: "huc8:12090205", areaKm2: 3213.91, areaBasis: "total" });
    expect(u[0].anchor![0]).toBeCloseTo(-97.5, 5);
    expect(u[0].anchor![1]).toBeCloseTo(30.5, 5);
  });
  it("merges ecoregion parts and labels a computed area as computed", () => {
    const u = parseField("eco3", {
      features: [
        { attributes: { US_L3CODE: "32", US_L3NAME: "Texas Blackland Prairies" }, geometry: { rings: sq(-98, 30, 1) } },
        { attributes: { US_L3CODE: "32", US_L3NAME: "Texas Blackland Prairies" }, geometry: { rings: sq(-96, 31, 1) } },
      ],
    });
    expect(u).toHaveLength(1);
    expect(u[0].rings).toHaveLength(2);
    expect(u[0].facts["area basis"]).toMatch(/computed/);
    expect(u[0].areaKm2).toBeGreaterThan(18_000);
    expect(u[0].areaKm2).toBeLessThan(26_000);
  });
});

describe("geometry used by the field", () => {
  it("computes a plausible area and centroid for a one-degree square at 30°N", () => {
    const a = ringsArea(sq(-98, 30, 1));
    // 111.32 km * 111.32 km * cos(30.5°) ≈ 10,680 km².
    expect(a).toBeGreaterThan(10_500);
    expect(a).toBeLessThan(10_900);
    expect(ringCentroid(sq(-98, 30, 1))).toEqual([-97.5, 30.5]);
    expect(haversineKm([-97.74, 30.27], [-96.8, 32.78])).toBeGreaterThan(280);
    expect(haversineKm([-97.74, 30.27], [-96.8, 32.78])).toBeLessThan(300);
  });
});

describe("emergence", () => {
  const a = unit("county:a", sq(0, 0, 1), 1000);
  const b = unit("county:b", sq(2, 0, 1), 4000);
  const c = unit("county:c", sq(4, 0, 1), 1000);
  const features = [
    pt("water", "g1", 0.2, 0.2),
    pt("water", "g2", 0.4, 0.4),
    pt("aircraft", "ac1", 0.5, 0.5),
    pt("water", "g3", 2.5, 0.5),
    pt("companies", "co1", 2.6, 0.6),
    pt("aircraft", "ac2", 2.7, 0.7),
    pt("traffic", "car", 0.5, 0.5, { simulated: true }),
    pt("weather", "wx", 0.5, 0.5),
    pt("constructs", "here", 0.5, 0.5),
    { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { id: "p", layer: "realestate", name: "p", source: "t", anchor: [0.5, 0.5] } } as unknown as LayerFeature,
  ];
  it("counts only physical points, never simulated ones", () => {
    expect(features.filter(isPhysical).map((f) => f.properties.id)).toEqual(["g1", "g2", "ac1", "g3", "co1", "ac2"]);
  });
  it("gives each construct counts by layer, a density and a relative heat", () => {
    const v = computeVitals([a, b, c], features, "all", "count");
    expect(v.get("county:a")).toMatchObject({ total: 3, byLayer: { water: 2, aircraft: 1 }, value: 3, rank: 0, heat: 1 });
    expect(v.get("county:b")?.total).toBe(3);
    expect(v.get("county:c")).toMatchObject({ total: 0, value: 0, heat: 0 });
    expect(v.get("county:a")?.density).toBeCloseTo(3, 5);
  });
  it("lets density stop big units winning by size", () => {
    const v = computeVitals([a, b, c], features, "all", "density");
    expect(v.get("county:a")!.value).toBeCloseTo(3, 5);
    expect(v.get("county:b")!.value).toBeCloseTo(0.75, 5);
    expect(v.get("county:a")!.rank).toBe(0);
    expect(v.get("county:b")!.heat).toBeCloseTo(Math.sqrt(0.25), 5);
  });
  it("can be lit by one layer alone", () => {
    const v = computeVitals([a, b, c], features, "companies", "count");
    expect(v.get("county:b")).toMatchObject({ value: 1, heat: 1, rank: 0 });
    expect(v.get("county:a")!.value).toBe(0);
  });
  it("counts a binned fires cell as the detections it stands for, not as one", () => {
    // Over 5,000 hotspots in view the fires layer draws one point per cell with extra.count.
    const binned = pt("fires", "cell", 0.6, 0.6, { extra: { count: 120 } });
    const single = pt("fires", "hot", 0.7, 0.7, { extra: { count: 1 } });
    const v = computeVitals([a, b, c], [...features, binned, single], "fires", "count");
    expect(v.get("county:a")).toMatchObject({ value: 121, byLayer: { water: 2, aircraft: 1, fires: 121 }, total: 124 });
    // Only fires carries a count; the same field on another layer is not read.
    const other = computeVitals([a], [pt("water", "odd", 0.5, 0.5, { extra: { count: 50 } })], "all", "count");
    expect(other.get("county:a")?.total).toBe(1);
  });
  it("fingerprints only what is drawn and ramps colour with heat", () => {
    const v = computeVitals([a, b, c], features, "all", "count");
    expect(vitalsKey(v)).toBe("county:a=3.00|county:b=3.00");
    expect(heatColor(0)).toBe("#475569");
    expect(heatColor(1)).toBe("#f97316");
    expect(heatColor(0.6)).toBe("#facc15");
    expect(heatColor(5)).toBe("#f97316");
  });
});

describe("downstream", () => {
  // Two basins: 1209 flows into 1210, which reaches the ocean.
  const tables: Record<string, BasinTable> = {
    "1209": parseBasinTable({
      features: [
        { attributes: { huc12: "120900000001", tohuc: "120900000002", name: "Top", areasqkm: 100 }, geometry: { rings: sq(-98, 30, 0.1) } },
        { attributes: { HUC12: "120900000002", ToHUC: "121000000001", Name: "Middle", AreaSqKm: 150 }, geometry: { rings: sq(-97, 29.5, 0.1) } },
        { attributes: { huc12: "not-a-huc", tohuc: "x", name: "junk" } },
      ],
    }),
    "1210": parseBasinTable({ features: [{ attributes: { huc12: "121000000001", tohuc: "OCEAN", name: "Bay", areasqkm: 50 }, geometry: { rings: sq(-96, 28.5, 0.1) } }] }),
  };
  const loads: string[] = [];
  const load = async (h: string) => {
    loads.push(h);
    return tables[h] ?? new Map();
  };
  it("walks ToHUC across basins to the terminal", async () => {
    const d = await walkDownstream("120900000001", load);
    expect(d.steps.map((s) => s.name)).toEqual(["Top", "Middle", "Bay"]);
    expect(d.steps.map((s) => s.hop)).toEqual([0, 1, 2]);
    expect(d.terminal).toBe("ocean");
    expect(d.basins).toEqual(["1209", "1210"]);
    expect(d.totalAreaKm2).toBe(300);
    expect(d.next).toBeUndefined();
    expect(d.truncated).toBe(false);
    expect(loads).toEqual(["1209", "1210"]);
    expect(tables["1209"].has("not-a-huc")).toBe(false);
  });
  it("stops honestly: missing unit, loop, hop cap, time budget", async () => {
    expect((await walkDownstream("999900000001", load)).terminal).toBe("unknown");
    const loop: BasinTable = new Map([
      ["111100000001", { huc12: "111100000001", to: "111100000002", name: "a" }],
      ["111100000002", { huc12: "111100000002", to: "111100000001", name: "b" }],
    ]);
    expect((await walkDownstream("111100000001", async () => loop)).terminal).toBe("loop in WBD ToHUC");
    const capped = await walkDownstream("120900000001", load, { maxHops: 1 });
    expect(capped).toMatchObject({ truncated: true, terminal: "", next: "120900000002" });
    // Continuing from `next` finishes the walk.
    const rest = await walkDownstream(capped.next!, load);
    expect(rest.steps.map((s) => s.name)).toEqual(["Middle", "Bay"]);
    expect(rest.terminal).toBe("ocean");
    // A basin that fails mid-walk ends the leg with a cursor rather than an error.
    const flaky = async (h: string) => {
      if (h === "1210") throw new Error("504");
      return tables[h];
    };
    expect(await walkDownstream("120900000001", flaky)).toMatchObject({ truncated: true, next: "121000000001", terminal: "" });
    await expect(walkDownstream("121000000001", flaky)).rejects.toThrow("504");
    // Past the budget, a leg stops before loading a new basin, never inside a loaded one.
    let t = 0;
    const slow = await walkDownstream("120900000001", load, { budgetMs: 5, now: () => (t += 10) });
    expect(slow).toMatchObject({ truncated: true, next: "121000000001" });
    expect(slow.steps.map((s) => s.name)).toEqual(["Top", "Middle"]);
  });
});

describe("basinFromBundle", () => {
  it("reads the compact bundled drainage table and walks it", async () => {
    const bundle = { pulled: "2026-09-22", complete: true, basins: { "1209": "120900000001>120900000002|120900000002>OCEAN|garbage", "1601": "160100000001>CLOSED_BASIN" } };
    expect((await walkDownstream("160100000001", async (h) => basinFromBundle(bundle, h) ?? new Map())).terminal).toBe("closed basin");
    const t = basinFromBundle(bundle, "1209")!;
    expect(t.size).toBe(2);
    expect(t.get("120900000002")).toEqual({ huc12: "120900000002", to: "OCEAN", name: "120900000002" });
    expect(basinFromBundle(bundle, "0101")).toBeNull();
    const d = await walkDownstream("120900000001", async (h) => basinFromBundle(bundle, h) ?? new Map());
    expect(d).toMatchObject({ terminal: "ocean", truncated: false });
    expect(d.steps).toHaveLength(2);
  });
});

describe("centroidPathKm", () => {
  it("sums straight lines between the centroids it has, skipping gaps", () => {
    expect(centroidPathKm([])).toBe(0);
    const km = centroidPathKm([[-97.74, 30.27], undefined, [-96.8, 32.78]]);
    expect(km).toBeGreaterThan(280);
    expect(km).toBeLessThan(300);
  });
});

describe("rise animation and voice", () => {
  it("raises strata from the ground, staggered by tier", () => {
    expect(riseProgress(undefined, 3, 0)).toBe(1);
    expect(riseProgress(1000, 0, 1000)).toBe(0);
    expect(riseProgress(1000, 0, 1000 + 700)).toBeGreaterThan(0.8);
    expect(riseProgress(1000, 10, 1000 + 700)).toBe(0);
    expect(riseProgress(1000, 0, 1000 + 5000)).toBe(1);
  });
  it("hears where the water goes", () => {
    expect(parseIntent("where does the water go")).toEqual({ command: "trace_downstream", args: { place: undefined } });
    expect(parseIntent("trace the water from Austin")).toEqual({ command: "trace_downstream", args: { place: "austin" } });
    expect(parseIntent("show construct field")?.args).toMatchObject({ layer: "field" });
  });
  it("hears Ascend and Compare", () => {
    expect(parseIntent("Ascend")).toEqual({ command: "ascend", args: { place: undefined } });
    expect(parseIntent("powers of ten over Corpus Christi")).toEqual({ command: "ascend", args: { place: "corpus christi" } });
    expect(parseIntent("compare with Portland Texas")).toEqual({ command: "compare_places", args: { place: "portland texas" } });
    expect(parseIntent("compare Corpus Christi with Rockport")).toEqual({ command: "compare_places", args: { from: "corpus christi", place: "rockport" } });
  });
});
