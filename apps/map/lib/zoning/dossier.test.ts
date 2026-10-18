import { describe, expect, it } from "vitest";
import { snapBbox } from "@/lib/civic/bbox";
import { districtBox, districtsNote } from "@/lib/layers/zoning";
import { searchableDetail } from "@/lib/search/allowlist";
import { cityRecord, hitFor, houstonRecord, notCoveredRecord } from "./features";
import { STATE_WORDS, zoningErrorFeature, zoningPointFeature } from "./dossier";
import seattlePoint from "./fixtures/seattle-point.json";

const rows = (j: unknown) => (j as { features: Array<{ properties: Record<string, unknown> }> }).features.map((f) => f.properties);

describe("the zoning dossier", () => {
  it("titles each state plainly and never calls a gap unzoned", () => {
    const place = { geoid: "5363000", name: "Seattle city" };
    const d = zoningPointFeature(cityRecord("seattle", -122.3325, 47.6067, place, hitFor("seattle", rows(seattlePoint))), 0);
    expect(d.properties.name).toBe("DOC1 U/450-U · Seattle");
    expect(d.properties.details?.zoning).toBe("DOC1 U/450-U");
    expect(d.properties.details?.overlays).toBe("overlay DF; MHA; incentive zoning");
    expect(d.properties.details?.["code (city link)"]).toMatch(/^https:\/\/library\.municode\.com/);
    const gap = zoningPointFeature(cityRecord("austin", -97.7473, 30.2651, { geoid: "4805000", name: "Austin city" }, null), 0);
    expect(gap.properties.name).toBe("No district polygon · Austin");
    expect(String(gap.properties.details?.answer)).toMatch(/not "unzoned"/);
    expect(zoningPointFeature(houstonRecord(-95.37, 29.76, { geoid: "4835000", name: "Houston city" }), 0).properties.name).toBe("No zoning ordinance · Houston");
    expect(zoningPointFeature(notCoveredRecord(-98.9, 29.9, null), 0).properties.name).toBe("Zoning not covered · outside any incorporated place");
    for (const w of Object.values(STATE_WORDS)) expect(w).not.toMatch(/^unzoned/);
  });

  it("makes only the district code searchable, not the ordinance or the city's prose", () => {
    const d = zoningPointFeature(cityRecord("seattle", -122.3325, 47.6067, { geoid: "5363000", name: "Seattle city" }, hitFor("seattle", rows(seattlePoint))), 0);
    const keys = Object.keys(d.properties.details ?? {}).filter((k) => searchableDetail(k));
    expect(keys).toEqual(["zoning", "city"].filter((k) => searchableDetail(k)));
    expect(searchableDetail("ordinance")).toBe(false);
    expect(searchableDetail("what it allows (seattle)")).toBe(false);
  });

  it("says a failed lookup failed", () => {
    const f = zoningErrorFeature(-122.3, 47.6, "zoning 502", 0);
    expect(f.properties.name).toBe("Zoning lookup failed");
    expect(String(f.properties.details?.answer)).toMatch(/nothing is known/);
  });
});

describe("the zoning layer's box", () => {
  it("asks for a box already on the route's grid, so the route does not grow it", () => {
    for (const [lon, lat] of [[-98.4912, 29.4213], [-122.3325, 47.6067], [-73.9857, 40.7484], [-87.6305, 41.8842]]) {
      const b = districtBox(lon, lat);
      expect(snapBbox(b, 0.04, 0.0025), `${lon},${lat}`).toEqual(b);
      expect(b[3] - b[1]).toBeCloseTo(0.015, 6);
    }
  });

  it("says 'no zoning source here' outside every covered city, not an empty map", () => {
    expect(districtsNote(0, {}, [-100.01, 31.99, -99.99, 32.01])).toMatch(/^no zoning source here/);
    const n = districtsNote(12, { sources: [{ city: "seattle", name: "Seattle", count: 12, truncated: false }], failed: [], pointOnly: [] }, [-122.34, 47.6, -122.32, 47.62]);
    expect(n).toMatch(/12 district outlines in the dashed box/);
    expect(n).toMatch(/City of Seattle/);
  });
});
