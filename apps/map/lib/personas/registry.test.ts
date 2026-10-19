import { describe, expect, it } from "vitest";
import { PERSONAS, PERSONA_BY_ID, isPersonaId, personaFromWords } from "./registry";
import { LAYER_IDS } from "@/lib/layers/types";
import { PRESETS } from "@/lib/explore/presets";

describe("persona registry", () => {
  it("has unique ids, valid layers, real presets and a full nav", () => {
    const ids = new Set(PERSONAS.map((p) => p.id));
    expect(ids.size).toBe(PERSONAS.length);
    const layerSet = new Set<string>(LAYER_IDS);
    const presetIds = new Set(PRESETS.map((p) => p.id));
    for (const p of PERSONAS) {
      for (const l of p.layers) expect(layerSet.has(l), `${p.id} layer ${l}`).toBe(true);
      for (const l of p.heavy ?? []) expect(p.layers).toContain(l);
      for (const pr of p.presets) expect(presetIds.has(pr), `${p.id} preset ${pr}`).toBe(true);
      expect(new Set(p.nav).size).toBe(p.nav.length);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.who.length).toBeGreaterThan(0);
      expect(Math.abs(p.start.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.start.lon)).toBeLessThanOrEqual(180);
    }
  });
  it("maps words to lenses", () => {
    expect(personaFromWords("I am a realtor")?.id).toBe("realestate");
    expect(personaFromWords("switch to hydrologist")?.id).toBe("water");
    expect(personaFromWords("economist please")?.id).toBe("economist");
    expect(personaFromWords("day trader")?.id).toBe("trader");
    expect(personaFromWords("nothing here")).toBeNull();
  });
  it("guards ids", () => {
    expect(isPersonaId("water")).toBe(true);
    expect(isPersonaId("plumber")).toBe(false);
    expect(PERSONA_BY_ID.explorer.open).toBeUndefined();
  });
});
