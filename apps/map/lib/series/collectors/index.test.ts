import { describe, expect, it } from "vitest";
import { byId, COLLECTORS, describeCollectors } from "./index";
import { SOURCES } from "@/lib/provenance/sources";

describe("collector registry", () => {
  it("has unique ids and complete descriptions that cite registered sources", () => {
    const ids = COLLECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["port-vessels", "cargo-flights", "gauges", "reservoirs", "quakes"]);
    for (const d of describeCollectors()) {
      expect(d.id).toMatch(/^[a-z0-9-]+$/);
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.seriesPrefix.startsWith("snapshot:")).toBe(true);
      expect(d.sources.length).toBeGreaterThan(0);
      for (const s of d.sources) expect(SOURCES[s]).toBeDefined();
      expect(d.note.length).toBeGreaterThan(20);
    }
  });
  it("looks up by id", () => {
    expect(byId("quakes")?.title).toBe("Earthquakes, past day");
    expect(byId("nope")).toBeUndefined();
  });
});
