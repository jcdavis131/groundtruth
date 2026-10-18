import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LAYER_IDS } from "@/lib/layers/types";
import { AIRNOW_ENABLED } from "@/lib/air/airnow";
import { INFRA_GROUP_TITLE, PRESETS, PRESET_GROUPS, presetShare, presetTarget, type Preset } from "./presets";

describe("Explore presets", () => {
  // The whole layer registry is a cold dynamic import (every layer module and its
  // styles). Under a full parallel suite on a loaded box it alone ran past the
  // 5 s per-test default. Load it once here, with a setup budget, so the tests
  // below time only what they check.
  let layers: typeof import("@/lib/layers");
  let infra: typeof import("@/lib/layers/infra");
  beforeAll(async () => {
    [layers, infra] = await Promise.all([import("@/lib/layers"), import("@/lib/layers/infra")]);
  }, 60_000);

  it("have unique ids and real layers, and every one sits in a gallery group", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    const layers = new Set<string>(LAYER_IDS);
    for (const p of PRESETS) for (const l of p.layers) expect(layers.has(l), `${p.id} ${l}`).toBe(true);
    expect(PRESET_GROUPS.flatMap((g) => g.presets)).toHaveLength(PRESETS.length);
    expect(PRESET_GROUPS.find((g) => g.title === "Hazards & land")?.presets.map((p) => p.id)).toEqual([
      "largest-fire",
      "hazards-world",
      "sa-floodplain",
      "mitchell-lake",
      "government-canyon",
    ]);
    expect(PRESET_GROUPS.find((g) => g.title === "Zoning & permits")?.presets.map((p) => p.id)).toEqual([
      "seattle-zoning",
      "chicago-loop-permits",
      "denver-civic-zoning",
      "houston-channel-permits",
      "midtown-licences",
    ]);
    expect(PRESET_GROUPS.find((g) => g.title === "Terrain & soils")?.presets.map((p) => p.id)).toEqual([
      "brackenridge-contours",
      "bexar-soils",
      "front-range-whp",
      "galveston-slr",
    ]);
    expect(PRESET_GROUPS.find((g) => g.title === INFRA_GROUP_TITLE)?.presets.map((p) => p.id)).toEqual([
      "round-rock-grid",
      "ship-channel-pipelines",
      "texas-power",
      "kansas-city-rail",
      "okc-sections",
      "bay-area-faults",
      "seattle-landslides",
      "highland-lakes-dams",
      "texas-airports",
      "pikes-peak-geology",
      "la-freeway-cams",
      // Only while the operator has turned AirNow on (lib/air/airnow.ts).
      ...(AIRNOW_ENABLED ? ["us-air-quality"] : []),
      "world-events",
    ]);
    expect(PRESET_GROUPS.find((g) => g.title === "Parcels & ownership")?.presets.map((p) => p.id)).toEqual(["alamo-parcel", "houston-city-hall", "helena-capitol"]);
  });

  it("open a parcel's dossier at the target, below the height lot lines draw at", () => {
    for (const p of PRESETS.filter((x) => x.parcel)) {
      expect(p.layers).toContain("parcels");
      expect(p.height).toBeLessThanOrEqual(2_000);
      expect(presetShare(p).parcel).toEqual({ lat: p.lat, lon: p.lon });
    }
  });

  it("put each infrastructure preset below the height its first layer draws at", () => {
    const { LAYER_BY_ID } = layers;
    const { tierFor, TRANSMISSION_TIERS, PIPELINE_TIERS, PLANT_TIERS, RAIL_TIERS, PLSS_TIERS, FAULT_TIERS, LANDSLIDE_TIERS, DAM_TIERS, AIRPORT_TIERS } = infra;
    const tiers: Record<string, Parameters<typeof tierFor>[0]> = {
      transmission: TRANSMISSION_TIERS,
      pipelines: PIPELINE_TIERS,
      plants: PLANT_TIERS,
      rail: RAIL_TIERS,
      plss: PLSS_TIERS,
      faults: FAULT_TIERS,
      landslides: LANDSLIDE_TIERS,
      dams: DAM_TIERS,
      airports: AIRPORT_TIERS,
    };
    for (const p of PRESETS.filter((x) => x.group === "infrastructure")) {
      const first = p.layers[0];
      expect(LAYER_BY_ID[first], p.id).toBeDefined();
      if (tiers[first]) expect(tierFor(tiers[first], p.height), `${p.id} at ${p.height} m`).not.toBeNull();
    }
    expect(presetShare(PRESETS.find((p) => p.id === "pikes-peak-geology")!).ground).toEqual({ lon: -104.95, lat: 38.85 });
  });

  it("carry a terrain preset's ground point, terrain and scenario into its link", () => {
    const soils = presetShare(PRESETS.find((p) => p.id === "bexar-soils")!);
    expect(soils.ground).toEqual({ lon: -98.45, lat: 29.28 });
    expect(soils.layers).toContain("soils");
    expect(presetShare(PRESETS.find((p) => p.id === "front-range-whp")!).terrain).toBe(1.5);
    expect(presetShare(PRESETS.find((p) => p.id === "galveston-slr")!).slr).toBe(3);
  });

  it("land the civic layers below the heights they draw at", async () => {
    const { ZONING_OUTLINE_MAX_M } = await import("@/lib/layers/zoning");
    const { PERMITS_MAX_M } = await import("@/lib/layers/permits");
    const { LICENCES_MAX_M } = await import("@/lib/layers/licences");
    const { ENV_MAX_M } = await import("@/lib/layers/envpermits");
    const max: Record<string, number> = { zoning: ZONING_OUTLINE_MAX_M, permits: PERMITS_MAX_M, licences: LICENCES_MAX_M, envpermits: ENV_MAX_M };
    for (const p of PRESETS.filter((x) => x.group === "civic")) for (const l of p.layers) if (max[l]) expect(p.height, `${p.id} ${l}`).toBeLessThanOrEqual(max[l]);
  });
});

describe("presetTarget", () => {
  const fixed: Preset = { id: "t", title: "T", region: "R", blurb: "", lon: 1, lat: 2, height: 3000, layers: ["wildfire"] };
  afterEach(() => vi.unstubAllGlobals());

  it("is the fixed place for a preset that does not move", async () => {
    expect(await presetTarget(fixed)).toEqual(presetShare(fixed));
  });

  it("goes where a moving preset resolves to, and falls back to the fixed place when it cannot", async () => {
    const moving = { ...fixed, resolve: async () => ({ lon: 10, lat: 20, sel: { layer: "wildfire" as const, id: "wfigs:X" } }) };
    expect(await presetTarget(moving)).toMatchObject({ lon: 10, lat: 20, h: 3000, layers: ["wildfire"], sel: { layer: "wildfire", id: "wfigs:X" } });
    expect(await presetTarget({ ...fixed, resolve: async () => null })).toEqual(presetShare(fixed));
    expect(await presetTarget({ ...fixed, resolve: () => Promise.reject(new Error("down")) })).toEqual(presetShare(fixed));
  });

  it("resolves the largest fire to the WFIGS wildfire perimeter with the most acres, never a prescribed burn", async () => {
    const perim = (id: string, type: string, acres: number, lon: number, anchor?: [number, number]) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[lon, 40], [lon + 0.5, 40], [lon + 0.5, 40.5], [lon, 40]]] },
      properties: { id, layer: "wildfire", name: id, source: "NIFC WFIGS", anchor, extra: { type, acres, hasPerimeter: true } },
    });
    const features = [perim("rx", "RX", 90_000, -110), perim("big", "WF", 50_000, -120, [-119.8, 40.2]), perim("small", "WF", 900, -115)];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { type: "FeatureCollection", features } }), { status: 200 })));
    const p = PRESETS.find((x) => x.id === "largest-fire")!;
    const s = await presetTarget(p);
    expect(s.sel).toEqual({ layer: "wildfire", id: "big" });
    expect([s.lon, s.lat]).toEqual([-119.8, 40.2]);
    expect(s.layers).toEqual(p.layers);
  });
});
