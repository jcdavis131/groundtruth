import { describe, expect, it } from "vitest";
import type { FetchContext } from "./types";
import { bandKey, contoursLayer, GROUND_LAYERS, reliefLayer, sealevelLayer, seaLevelFeet, soilsLayer, TERRAIN_LAYERS } from "./terrain";
import { LAYER_IDS } from "./types";
import { LAYER_LABEL_PRIORITY } from "@/lib/globe/labelBudget";

const ctx = (height: number, options: Record<string, unknown> = {}): FetchContext => ({
  keys: {},
  view: { lon: -98.47, lat: 29.46, height, heading: 0, pitch: -60 },
  now: 1_000,
  options,
});

describe("picture layers", () => {
  it("make no request of their own and report a picture with no feature count", async () => {
    const r = await soilsLayer.fetch(ctx(9_000));
    expect(r.collection.features).toEqual([]);
    expect(r.meta).toMatchObject({ picture: true, count: 0 });
    expect(r.note).toMatch(/click the ground/);
  });

  it("say where to descend to above their height band, and refetch only when the band is crossed", async () => {
    expect((await contoursLayer.fetch(ctx(10_000))).note).toBe("descend below 4 km for this picture");
    expect((await contoursLayer.fetch(ctx(3_000))).note).not.toMatch(/descend/);
    const key = bandKey(4_000);
    expect(key({ ...ctx(3_000).view })).toBe(key({ ...ctx(1_000).view, lon: 10 }));
    expect(key(ctx(5_000).view)).toBe("above");
    // Relief has no band: it draws from orbit to the ground.
    expect(reliefLayer.viewDependent).toBe(false);
  });

  it("draw the sea level scenario from settings, only one NOAA publishes, 3 ft by default", async () => {
    expect(seaLevelFeet({ seaLevelFt: 6 })).toBe(6);
    expect(seaLevelFeet({ seaLevelFt: 12 })).toBe(3);
    expect(seaLevelFeet({})).toBe(3);
    const r = await sealevelLayer.fetch(ctx(40_000, { seaLevelFt: 6 }));
    expect(r.meta?.seaLevelFt).toBe(6);
    expect(r.note).toMatch(/^6 ft above MHHW/);
  });

  it("are registered ids with a label priority, and every ground layer is one of them or an imagery picture with a label priority", () => {
    for (const l of TERRAIN_LAYERS) {
      expect(LAYER_IDS).toContain(l.id);
      expect(LAYER_LABEL_PRIORITY[l.id]).toBeDefined();
    }
    // Historic imagery and topo maps answer a ground click too (capture dates, sheets) but are their own modules.
    const imagery = ["wayback", "topo", "hydro", "naip"];
    for (const g of GROUND_LAYERS) {
      if (imagery.includes(g)) expect(LAYER_LABEL_PRIORITY[g], g).toBeDefined();
      else expect(TERRAIN_LAYERS.map((l) => l.id)).toContain(g);
    }
  });
});
