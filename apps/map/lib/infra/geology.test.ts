// Macrostrat's geologic_units/map answers captured 2026-09-26: the Pikes Peak
// batholith west of Colorado Springs (three map scales), central Paris (a unit
// with no name on its map) and an empty answer.

import { describe, expect, it } from "vitest";
import { ageRange, parseMacrostrat } from "./geology";
import pikes from "./fixtures/macrostrat-pikes-peak.json";
import paris from "./fixtures/macrostrat-paris.json";
import empty from "./fixtures/macrostrat-empty.json";

describe("parseMacrostrat", () => {
  it("keeps Macrostrat's order, most detailed map first, each citing its map", () => {
    const a = parseMacrostrat(pikes);
    expect(a.license).toBe("CC-BY 4.0");
    expect(a.units.map((u) => u.name)).toEqual([
      "Rocks of Pikes Peak Batholith (1000-m.y. age group)",
      "Mesoproterozoic plutonic: granite",
      "Paleoproterozoic crystalline metamorphic rocks",
    ]);
    const u = a.units[0];
    expect(u.age).toBe("Mesoproterozoic");
    expect(u.lith).toBe("Major:{granite,alkali feldspar granite}, Minor:{quartz monzonite}");
    expect(u.source).toMatch(/^Horton, J\.D\., C\.A\. San Juan, and D\.B\. Stoeser\. The State Geologic Map Compilation/);
    expect(ageRange(u)).toBe("1,000 to 1,600 million years");
  });
  it("leaves a name the map does not give empty, and joins a range of ages", () => {
    const u = parseMacrostrat(paris).units[0];
    expect(u.name).toBeUndefined();
    expect(u.age).toBe("Late Pleistocene to Ionian");
  });
  it("answers no units for an empty answer, and refuses one it does not understand", () => {
    expect(parseMacrostrat(empty).units).toEqual([]);
    expect(() => parseMacrostrat({ error: "x" })).toThrow(/Macrostrat/);
  });
});
