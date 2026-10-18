// Leaking tanks by county, on EPA UST Finder answers captured 2026-10-15 for
// the 4 degree Gulf Coast box (-96,28,-92,32): layer 3 releases by county (57,
// with outlines) and layer 2 facilities by county (57, attributes).
import { describe, expect, it } from "vitest";
import rel from "./fixtures/ust-3-gulf.json";
import fac from "./fixtures/ust-2-gulf.json";
import { buildUst, count, countyKey, UST_LAYERS, ustParams, type UstExtra } from "./ust";

type Rows = Parameters<typeof buildUst>[0];

describe("UST Finder by county", () => {
  it("asks the two county layers only, never a point layer, with one geometry", () => {
    expect(Object.values(UST_LAYERS).sort()).toEqual([2, 3]);
    const r = ustParams("releases", [-96, 28, -92, 32]);
    const f = ustParams("facilities", [-96, 28, -92, 32]);
    expect(r).toMatchObject({ returnGeometry: "true", maxAllowableOffset: "0.01", geometryPrecision: "3" });
    expect(f.returnGeometry).toBe("false");
    for (const p of [r, f]) expect(p.outFields).not.toMatch(/Address|Facility_Name|\*/);
  });

  it("joins facilities to releases by county name and state, and Harris carries both", () => {
    const { features, unjoined } = buildUst(rel.features as unknown as Rows, fac.features as unknown as Rows);
    expect(features).toHaveLength(57);
    expect(unjoined).toEqual({ releases: 0, facilities: 0 });
    const harris = features.find((x) => x.properties.name === "Harris, Texas")!;
    expect(harris.properties.extra).toMatchObject({ releases: 4175, open: 211, noFurtherAction: 3964, facilities: { facilities: 8123, openTanks: 6276, closedTanks: 16145, tosTanks: 518 } });
  });

  it("derives nothing by subtraction: an open count EPA leaves empty stays 'not given'", () => {
    const { features } = buildUst(rel.features as unknown as Rows, fac.features as unknown as Rows);
    const madison = features.find((x) => x.properties.name === "Madison, Texas")!;
    const x = madison.properties.extra as UstExtra;
    // 26 releases, 26 no further action, and EPA's open count empty: not read as 0.
    expect([x.releases, x.noFurtherAction, x.open]).toEqual([26, 26, null]);
    expect(madison.properties.details?.["open releases"]).toBe("not given");
    expect(madison.properties.kind).toBe("not-given");
  });

  it("says unknown when the facilities layer did not answer, and unjoined when a name does not match", () => {
    const none = buildUst(rel.features as unknown as Rows, null);
    expect((none.features[0].properties.extra as UstExtra).facilitiesMissing).toBe("unanswered");
    expect(none.features[0].properties.details?.["UST facilities"]).toMatch(/^unknown/);
    // Only Harris's facilities row: every other county is unjoined, never zero.
    const harrisOnly = (fac.features as unknown as Rows).filter((f) => f.properties?.NAME === "Harris");
    const part = buildUst(rel.features as unknown as Rows, harrisOnly);
    expect(part.unjoined.releases).toBe(56);
    expect(part.features.filter((f) => (f.properties.extra as UstExtra).facilities).length).toBe(1);
  });

  it("reads counts strictly and keys counties without case or spacing", () => {
    expect(count(0)).toBe(0);
    expect(count(null)).toBeNull();
    expect(count("")).toBeNull();
    expect(count(-1)).toBeNull();
    expect(countyKey(" Fort  Bend ", "Texas")).toBe("fort bend|texas");
    expect(countyKey(null, "Texas")).toBeNull();
  });
});
