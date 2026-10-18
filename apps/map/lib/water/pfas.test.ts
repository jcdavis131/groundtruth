// PFAS in drinking water (UCMR 5), on answers captured 2026-10-15: the
// Collegeville, PA box (-75.54,40.12,-75.40,40.26, the route's snapped box):
// 16 service areas (attributes, and with geometry), EPA's estimated-location
// group-by (5 systems) and the results group-by for the 16 PWSIDs (313
// groups); the Middlebury, VT box (-73.2,43.96,-73.08,44.08): 2 service areas,
// 1 system by estimated location, 29 result groups, every one below the
// reporting level; and two Illinois service areas EPA marks as modelled.
import { describe, expect, it } from "vitest";
import cws from "./fixtures/cws-collegeville.json";
import cwsGeom from "./fixtures/cws-collegeville-geom.json";
import centroid from "./fixtures/pat-centroid-collegeville.json";
import results from "./fixtures/pat-results-collegeville.json";
import cwsMb from "./fixtures/cws-middlebury.json";
import centroidMb from "./fixtures/pat-centroid-middlebury.json";
import resultsMb from "./fixtures/pat-results-middlebury.json";
import modelled from "./fixtures/cws-modeled-il.json";
import { buildPfasSystems, chunkIds, cwsParams, highest, PAT_IN_CHUNK, patCentroidParams, patResultsParams, pfasBin, pfasFeatures, type PfasExtra } from "./pfas";
import { matchScore } from "@/lib/search/allowlist";

type Fc = Parameters<typeof buildPfasSystems>[0];
const attrs = (j: { features: Array<{ attributes: Record<string, unknown> }> }) => j.features.map((f) => f.attributes);
const BOX: [number, number, number, number] = [-75.54, 40.12, -75.4, 40.26];

describe("the requests", () => {
  it("asks service areas with geometry only for polygons, simplified", () => {
    expect(cwsParams(BOX, false).returnGeometry).toBe("false");
    expect(cwsParams(BOX, false).maxAllowableOffset).toBeUndefined();
    expect(cwsParams(BOX, true)).toMatchObject({ returnGeometry: "true", maxAllowableOffset: "0.0005", geometryPrecision: "5" });
  });

  it("asks UCMR 5 by equality, drops Hazard Index rows, never asks the health flag, and chunks the PWSIDs", () => {
    expect(patCentroidParams(BOX).where).toBe("UCMR_Cycle='UCMR 5 (2023-2025)'");
    const ids = cws.features.map((f) => f.properties.PWSID as string);
    const [one] = patResultsParams([...ids, "x') OR ('1'='1"]);
    expect(one.where).toMatch(/^UCMR_Cycle='UCMR 5 \(2023-2025\)' AND F_PWS_ID IN \(/);
    expect(one.where).toMatch(/AND Result_At_or_Above_UCMR_MRL IS NOT NULL$/);
    expect(chunkIds(one.where)).toHaveLength(16);
    expect(one.where).not.toContain("OR");
    for (const p of [one, patCentroidParams(BOX)]) expect(JSON.stringify(p)).not.toMatch(/HBSL|Facility_Name|Sample_Point/);
    // Seventy PWSID-shaped strings: synthetic input to the chunker, not data. What is tested is the chunking.
    const many = Array.from({ length: 70 }, (_, i) => `PA14600${String(i).padStart(2, "0")}`);
    const chunks = patResultsParams(many);
    expect(chunks).toHaveLength(Math.ceil(70 / PAT_IN_CHUNK));
    expect(chunks.flatMap((c) => chunkIds(c.where))).toHaveLength(70);
  });
});

describe("systems and their four states", () => {
  const systems = buildPfasSystems(cws.features as unknown as Fc, attrs(centroid), attrs(results), new Set());

  it("finds systems by service area first: AQUA PA MAIN SYSTEM, whose estimated location is outside the box, is in", () => {
    expect(systems).toHaveLength(16);
    expect(attrs(centroid).map((a) => a.F_PWS_ID)).not.toContain("PA1460073");
    const aqua = systems.find((s) => s.pwsid === "PA1460073")!;
    expect(aqua).toMatchObject({ name: "AQUA PA MAIN SYSTEM", population: 822600, state: "detected", stateCode: "PA" });
    expect(aqua.results[0]).toEqual({ contaminant: "PFPeA", maxNgL: 21.8, detections: 43, results: 50 });
    expect(highest(aqua)).toBe(21.8);
    // Its estimated location comes from its results rows.
    expect(aqua.place?.method).toBe("Estimated Water System Service Area Centroid");
  });

  it("gives 9 systems detected and 7 not in UCMR 5 here, none null", () => {
    const by = (st: string) => systems.filter((s) => s.state === st).map((s) => s.pwsid);
    expect(by("detected")).toHaveLength(9);
    expect(by("not-in-ucmr5").sort()).toEqual(["PA1150006", "PA1150206", "PA1460008", "PA1460015", "PA1460064", "PA1460068", "PA1460071"]);
    expect(by("unknown")).toEqual([]);
  });

  it("reads a sampled system with every result below the reporting level as not-detected, not null and not 0", () => {
    const mb = buildPfasSystems(cwsMb.features as unknown as Fc, attrs(centroidMb), attrs(resultsMb), new Set());
    const midd = mb.find((s) => s.pwsid === "VT0005004")!;
    expect(midd.state).toBe("not-detected");
    expect(midd.results.every((r) => r.detections === 0 && r.maxNgL === null)).toBe(true);
    expect(midd.results.reduce((n, r) => n + r.results, 0)).toBe(174);
    expect(highest(midd)).toBeNull();
    expect(mb.find((s) => s.pwsid === "VT0005003")!.state).toBe("not-in-ucmr5");
  });

  it("reads 'unknown', never not-detected or not-in-ucmr5, when the results did not answer", () => {
    const none = buildPfasSystems(cws.features as unknown as Fc, attrs(centroid), null, new Set());
    expect(new Set(none.map((s) => s.state))).toEqual(new Set(["unknown"]));
    const part = buildPfasSystems(cws.features as unknown as Fc, attrs(centroid), attrs(results), new Set(["PA1460008"]));
    expect(part.find((s) => s.pwsid === "PA1460008")!.state).toBe("unknown");
  });

  it("marks a boundary EPA modelled", () => {
    const il = buildPfasSystems(modelled.features as unknown as Fc, null, [], new Set());
    expect(il.map((s) => s.area?.modelled)).toEqual([true, true]);
    expect(systems.every((s) => s.area?.modelled === false)).toBe(true);
  });
});

describe("features", () => {
  it("draws service areas with polygons, and estimated-location points without, never a guessed point", () => {
    const sys = buildPfasSystems(cwsGeom.features as unknown as Fc, attrs(centroid), attrs(results), new Set());
    const near = pfasFeatures(sys, true);
    expect(near.features).toHaveLength(16);
    expect(near.features.every((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")).toBe(true);
    const mid = pfasFeatures(buildPfasSystems(cws.features as unknown as Fc, attrs(centroid), attrs(results), new Set()), false);
    // The 9 sampled systems have an estimated location; the 7 not in UCMR 5 have none and are listed.
    expect(mid.features).toHaveLength(9);
    expect(mid.features.every((f) => f.geometry.type === "Point")).toBe(true);
    expect(mid.notDrawn.map((n) => n.state)).toEqual(Array(7).fill("not-in-ucmr5"));
    const aqua = mid.features.find((f) => (f.properties.extra as PfasExtra).pwsid === "PA1460073")!;
    expect(aqua.properties.details?.drawn).toBe("as a ring at EPA's estimated location: Estimated Water System Service Area Centroid");
    expect(aqua.properties.details?.["PFPeA (ng/L)"]).toBe("highest 21.8; 43 of 50 results at or above the reporting level");
  });

  it("names a system by its PWSID and never finds it by its name", () => {
    const f = pfasFeatures(buildPfasSystems(cws.features as unknown as Fc, attrs(centroid), attrs(results), new Set()), false).features;
    const aqua = f.find((x) => (x.properties.extra as PfasExtra).pwsid === "PA1460073")!;
    expect(aqua.properties.name).toBe("PWS PA1460073");
    expect(matchScore(aqua.properties, "pa1460073")).toBeGreaterThan(0);
    expect(matchScore(aqua.properties, "aqua pa")).toBe(0);
  });

  it("bins a highest result for the legend, and leaves no result unbinned", () => {
    expect([pfasBin(null), pfasBin(3), pfasBin(5), pfasBin(12.6), pfasBin(57.3)]).toEqual([null, 0, 1, 2, 3]);
  });
});
