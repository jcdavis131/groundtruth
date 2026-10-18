// "What's here": the pure parts. The survey answer is read from BLM's own
// township and section polygons captured in Oklahoma City (2026-09-26).

import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import type { Fabric } from "@/lib/fabric/types";
import { buildPlss, type Row } from "@/lib/infra/features";
import sections from "@/lib/infra/fixtures/plss-sections-okc.json";
import townships from "@/lib/infra/fixtures/plss-townships-okc.json";
import { nearestLoaded, placeLines, surveyAt } from "./here";

const pt = (layer: LayerFeature["properties"]["layer"], id: string, lon: number, lat: number, extra: Partial<LayerFeature["properties"]> = {}): LayerFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat, 0] },
  properties: { id, layer, name: id, source: "t", ...extra },
});

describe("nearestLoaded", () => {
  it("lists the nearest loaded features within reach, never map furniture or simulations", () => {
    const out = nearestLoaded(
      [pt("dams", "far", 1, 0), pt("dams", "near", 0.01, 0), pt("flood", "box", 0, 0, { kind: "loaded-box" }), pt("traffic", "car", 0, 0, { simulated: true })],
      0,
      0,
      50_000,
    );
    expect(out.map((x) => x.f.properties.id)).toEqual(["near"]);
    expect(out[0].m).toBeGreaterThan(1000);
    expect(out[0].m).toBeLessThan(1200);
  });
});

describe("placeLines", () => {
  it("keeps the constructs a person places themselves by, smallest first as the stack gives them", () => {
    const f = {
      nodes: [
        { id: "zcta:78205", kind: "zcta", name: "ZCTA 78205", code: "78205" },
        { id: "tract:1", kind: "tract", name: "Census Tract 1101" },
        { id: "place:4865000", kind: "place", name: "San Antonio city", code: "4865000" },
        { id: "county:48029", kind: "county", name: "Bexar County", code: "48029" },
        { id: "state:48", kind: "state", name: "Texas", code: "48" },
      ],
    } as unknown as Fabric;
    expect(placeLines(f)).toEqual([
      { kind: "ZIP code area", name: "ZCTA 78205", code: "78205" },
      { kind: "city or town", name: "San Antonio city", code: "4865000" },
      { kind: "county", name: "Bexar County", code: "48029" },
      { kind: "state", name: "Texas", code: "48" },
    ]);
  });
});

describe("surveyAt", () => {
  const t = buildPlss("township", townships.features as Row[]);
  const s = buildPlss("section", sections.features as Row[]);
  it("reads the township, range, meridian and section at a point from BLM's polygons", () => {
    const ring = (s[0].geometry as GeoJSON.Polygon).coordinates[0];
    // The middle of section 24's own outline.
    const lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
    const lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
    const a = surveyAt(lon, lat, t, s)!;
    expect(a.section).toBe("24");
    expect(a.township).toBe("T12N");
    expect(a.meridian).toBe("Indian Meridian");
    expect(a.state).toBe("OK");
  });
  it("answers null outside the grid rather than the nearest section", () => {
    expect(surveyAt(-98.49, 29.42, t, s)).toBeNull();
  });
});
