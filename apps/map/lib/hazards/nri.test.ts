// FEMA National Risk Index on answers captured 2026-10-16, unmodified: the county rows FEMA
// returns for the San Antonio box (-99,29,-98,30) and the Connecticut box (-74,40,-71,43,
// planning regions 09110-09190), and the tracts of a Bexar County box. The county outlines are
// /api/economy?op=areas for -73.8,40.9,-71.7,42.1 as eye.jcamd.com answered it the same day.
import { describe, expect, it } from "vitest";
import ctyBexar from "./fixtures/nri-cty-sanantonio.json";
import ctyCt from "./fixtures/nri-cty-ct.json";
import tracts from "./fixtures/nri-tr-sanantonio.json";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import { countyOutlines } from "@/lib/layers/areas";
import { buildTracts, isNriClass, joinCounties, NRI_COUNTY_FIELDS, NRI_HAZARD_CODES, nriDetails, nriRow, parseNriPick, repick, type NriExtra } from "./nri";

const rows = (j: unknown) => ((j as { features: Array<{ attributes: Record<string, unknown> }> }).features ?? []).map((f) => nriRow(f.attributes));
const outlines = countyOutlines((areasCt as unknown as { data: Parameters<typeof countyOutlines>[0] }).data);

describe("National Risk Index rows", () => {
  it("asks named fields only: the composite, loss, social vulnerability, resilience and the 18 hazard ratings", () => {
    expect(NRI_COUNTY_FIELDS).toHaveLength(33);
    for (const h of NRI_HAZARD_CODES) expect(NRI_COUNTY_FIELDS).toContain(`${h}_RISKR`);
    expect(NRI_COUNTY_FIELDS).not.toContain("*");
  });

  it("reads Bexar as FEMA publishes it, rating words verbatim", () => {
    const bexar = rows(ctyBexar).find((r) => r.stcofips === "48029")!;
    expect(bexar).toMatchObject({ county: "Bexar", state: "TX", riskRating: "Relatively High", soviRating: "Relatively Moderate", version: "December 2025" });
    expect(bexar.riskScore).toBeCloseTo(99.43, 2);
    expect(bexar.hazards.TRND).toBe("Very High");
    const d = nriDetails(bexar, "county");
    expect(d["composite risk (FEMA NRI)"]).toBe("Relatively High (score 99.43 of 100)");
    expect(d["social vulnerability, as published in the NRI"]).toMatch(/^Relatively Moderate/);
    expect(d["expected annual loss"]).toMatch(/^\$[\d,]+ a year/);
    // The 18 hazards are listed by rating, very high first.
    const order = Object.keys(d).filter((k) => / risk$/.test(k));
    expect(order).toHaveLength(18);
    expect(d[order[0]]).toBe("Very High");
  });

  it("shows 'Not Applicable' as no rating, never low", () => {
    const na = rows(ctyBexar).find((r) => Object.values(r.hazards).includes("Not Applicable"))!;
    const h = NRI_HAZARD_CODES.find((x) => na.hazards[x] === "Not Applicable")!;
    expect(isNriClass("Not Applicable")).toBe(false);
    const j = joinCounties(outlines, [], parseNriPick(h));
    expect(j.notInIndex).toBe(outlines.length);
    // Joined against the San Antonio rows, the picked hazard's "Not Applicable" leaves the county unclassed.
    const fake = [{ geoid: na.stcofips!, name: na.county!, stusab: "TX", feature: outlines[0].feature }];
    const f = joinCounties(fake, [na], h).features[0];
    expect((f.properties.extra as NriExtra).rating).toBeNull();
    expect((f.properties.extra as NriExtra).noRating).toBe("Not Applicable");
    expect(f.properties.kind).toBe("no-rating");
  });
});

describe("the county join onto the shared outlines", () => {
  it("joins Connecticut's planning regions by FIPS with no crosswalk", () => {
    const ct = rows(ctyCt);
    expect(ct.filter((r) => r.stcofips?.startsWith("09")).map((r) => r.stcofips)).toEqual(["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"]);
    const j = joinCounties(outlines, ct, "composite");
    expect(outlines).toHaveLength(52);
    expect(j.matched).toBe(52);
    expect(j.notInIndex).toBe(0);
    expect(j.unmatched).toEqual([]);
    const capitol = j.features.find((f) => f.properties.id === "nri:county:09110")!;
    expect(capitol.properties.name).toBe("Capitol Planning Region, CT");
    expect((capitol.properties.extra as NriExtra).rating).toBe("Relatively High");
  });

  it("reads an outline FEMA has no row for as 'not in the index', and counts rows with no outline", () => {
    const j = joinCounties(outlines, rows(ctyBexar), "composite");
    expect(j.matched).toBe(0);
    expect(j.notInIndex).toBe(52);
    expect(j.unmatched).toContain("48029");
    const f = j.features[0];
    expect((f.properties.extra as NriExtra).noRating).toBe("not in the index");
    expect(f.properties.details?.["composite risk (FEMA NRI)"]).toMatch(/^not in the index/);
  });

  it("re-colours for another hazard without asking again", () => {
    const j = joinCounties(outlines, rows(ctyCt), "composite");
    const again = repick(j.features, "HRCN");
    const x = again.find((f) => f.properties.id === "nri:county:09110")!.properties.extra as NriExtra;
    expect(x.pick).toBe("HRCN");
    expect(x.rating ?? x.noRating).toBe(rows(ctyCt).find((r) => r.stcofips === "09110")!.hazards.HRCN);
  });
});

describe("tracts", () => {
  it("draws NRI's tract polygons named by FIPS, once each", () => {
    const fc = tracts as { features: Array<{ geometry: GeoJSON.Geometry; properties: Record<string, unknown> }> };
    const t = buildTracts(fc.features, "composite");
    expect(t).toHaveLength(73);
    expect(t[0].properties.name).toBe("Tract 48029110100 · Bexar, TX");
    expect(t[0].properties.details?.["tract fips"]).toBe("48029110100");
    expect(buildTracts([...fc.features, ...fc.features], "composite")).toHaveLength(73);
  });
});
