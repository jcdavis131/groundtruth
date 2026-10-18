import { describe, expect, it } from "vitest";
import { groupLayers, erroringLayers } from "./groups";
import { LAYERS } from "./index";
import type { LayerDefinition, LayerId } from "./types";

function def(id: LayerId, defaultEnabled = false): LayerDefinition {
  return {
    id,
    label: id.toUpperCase(),
    description: id,
    color: "#fff",
    updateIntervalMs: 60000,
    defaultEnabled,
    attribution: "test",
    fetch: async () => ({ collection: { type: "FeatureCollection", features: [] }, source: "test", fetchedAt: 0 }),
  };
}

const A = def("aircraft");
const B = def("ships", true);
const C = def("satellites");
const D = def("earthquakes");
const ALL = [A, B, C, D];

describe("groupLayers", () => {
  it("leads with the lens's layers and defers the rest", () => {
    const g = groupLayers(ALL, { lens: ["aircraft", "satellites"] });
    expect(g.primary.map((l) => l.id)).toEqual(["aircraft", "satellites"]);
    expect(g.more.map((l) => l.id)).toEqual(["ships", "earthquakes"]);
  });

  it("keeps layers the visitor switched on, even outside the lens", () => {
    const g = groupLayers(ALL, { lens: ["aircraft"], on: { earthquakes: true } });
    expect(g.primary.map((l) => l.id)).toEqual(["aircraft", "earthquakes"]);
    expect(g.more.map((l) => l.id)).toEqual(["ships", "satellites"]);
  });

  it("preserves registry order inside each group", () => {
    const g = groupLayers(ALL, { lens: ["earthquakes", "aircraft"] });
    expect(g.primary.map((l) => l.id)).toEqual(["aircraft", "earthquakes"]);
  });

  it("ignores layers explicitly switched off", () => {
    const g = groupLayers(ALL, { lens: ["aircraft"], on: { satellites: false } });
    expect(g.primary.map((l) => l.id)).toEqual(["aircraft"]);
  });

  it("falls back to the default-on layers with no lens and nothing on", () => {
    const g = groupLayers(ALL);
    expect(g.primary.map((l) => l.id)).toEqual(["ships"]);
    expect(g.more.map((l) => l.id)).toEqual(["aircraft", "satellites", "earthquakes"]);
  });

  it("shows everything rather than an empty panel", () => {
    const g = groupLayers([A, C, D]);
    expect(g.primary).toHaveLength(3);
    expect(g.more).toHaveLength(0);
  });

  it("never drops or duplicates a layer", () => {
    const g = groupLayers(LAYERS, { lens: ["water", "trade"], on: { aircraft: true } });
    const ids = [...g.primary, ...g.more].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(LAYERS.map((l) => l.id).sort());
  });

  it("covers the whole registry for every lens layer set", () => {
    const sets: LayerId[][] = [[], ["companies"], LAYERS.map((l) => l.id)];
    for (const lens of sets) {
      const g = groupLayers(LAYERS, { lens });
      expect(g.primary.length + g.more.length).toBe(LAYERS.length);
    }
  });

  it("offers no simulated layer on the globe (Traffic (sim) is off the list)", () => {
    expect(LAYERS.filter((l) => l.simulated).map((l) => l.id)).toEqual([]);
    expect(LAYERS.map((l) => l.id)).not.toContain("traffic");
  });
});

describe("erroringLayers", () => {
  it("reports only enabled layers whose fetch failed", () => {
    const on = { aircraft: true, ships: true, satellites: false };
    const status = { aircraft: { error: "403" }, ships: {}, satellites: { error: "500" } };
    const out = erroringLayers(ALL, on, status);
    expect(out.map((e) => e.layer.id)).toEqual(["aircraft"]);
    expect(out[0].error).toBe("403");
  });

  it("is empty when nothing is broken", () => {
    expect(erroringLayers(ALL, { aircraft: true }, {})).toEqual([]);
  });
});
