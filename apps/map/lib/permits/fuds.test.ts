// USACE Formerly Used Defense Sites, on answers captured 2026-10-15 from the
// fuds FeatureServer for the NJ/NY envelope (-74.6,40.4,-73.7,40.95): layer 1
// property points (126), layer 2 projects (73), layer 3 munitions response
// sites (11) and layer 4 property boundaries (29); and the national layer-2
// rows with a cost to complete of 0 on a project that is not complete (3).
import { describe, expect, it } from "vitest";
import pts from "./fixtures/fuds-1-njny.json";
import proj from "./fixtures/fuds-2-njny.json";
import mrs from "./fixtures/fuds-3-njny.json";
import polys from "./fixtures/fuds-4-njny.json";
import cost0 from "./fixtures/fuds-2-cost0-open.json";
import {
  buildFudsMrs,
  buildFudsProjects,
  buildFudsProperties,
  categoryText,
  costToComplete,
  fiscalYear,
  FUDS_LAYERS,
  FUDS_NEVER,
  fudsParams,
  fudsStatus,
  portalLink,
  type FudsExtra,
} from "./fuds";
import { matchScore } from "@/lib/search/allowlist";

type Rows = Parameters<typeof buildFudsProperties>[0];
const NOW = Date.UTC(2026, 9, 15);

describe("the FUDS requests", () => {
  it("never ask for the owner, the narratives or *, on any layer", () => {
    for (const l of FUDS_LAYERS) {
      const fields = fudsParams(l, [-74.6, 40.4, -73.7, 40.95]).outFields.split(",");
      expect(fields, l.id).not.toContain("*");
      for (const bad of FUDS_NEVER) expect(fields, `${l.id} ${bad}`).not.toContain(bad);
    }
  });

  it("asks polygons only for boundaries and munitions sites, simplified, and no geometry for projects", () => {
    const by = Object.fromEntries(FUDS_LAYERS.map((l) => [l.id, fudsParams(l, [-74.6, 40.4, -73.7, 40.95])]));
    expect(FUDS_LAYERS.filter((l) => l.polygons).map((l) => l.layer).sort()).toEqual([3, 4]);
    expect(by["property-polygons"].maxAllowableOffset).toBe("0.0005");
    expect(by.mrs.geometryPrecision).toBe("5");
    expect(by.projects.returnGeometry).toBe("false");
    expect(by.properties.resultRecordCount).toBe("1000");
  });
});

describe("normalising", () => {
  it("reads FISCALYEAR strictly, as text on one layer and a number on the other", () => {
    expect(pts.features[0].properties.FISCALYEAR).toBe("2024");
    expect(polys.features[0].properties.FISCALYEAR).toBe(2024);
    expect(fiscalYear("2024")).toBe(2024);
    expect(fiscalYear(2024)).toBe(2024);
    expect(fiscalYear("")).toBeNull();
    expect(fiscalYear(null)).toBeNull();
    expect(fiscalYear(0)).toBeNull();
  });

  it("maps both STATUS vocabularies to one enum, and anything else to null", () => {
    expect(new Set(pts.features.map((f) => fudsStatus(f.properties.STATUS)))).toEqual(new Set(["with-projects", "without-projects", "all-closed-out"]));
    expect(new Set(polys.features.map((f) => fudsStatus(f.properties.STATUS)))).toEqual(new Set(["with-projects", "all-closed-out"]));
    expect(fudsStatus("something else")).toBeNull();
    expect(fudsStatus(null)).toBeNull();
  });

  it("keeps a cost to complete of 0 only on a completed project", () => {
    const fortHancock = proj.features[0].properties;
    expect(fortHancock.PROJECTSTATUS).toBe("Response Complete and Site Closeout");
    expect(costToComplete(fortHancock.COSTTOCOMPLETE, fortHancock.PROJECTSTATUS)).toBe(0);
    const open = cost0.features.map((f) => f.properties);
    expect(open.map((p) => p.PROJECTSTATUS).sort()).toEqual(["Cleanup", "Cleanup", "Investigation"]);
    for (const p of open) expect(costToComplete(p.COSTTOCOMPLETE, p.PROJECTSTATUS), p.PROJECTNUMBER).toBeNull();
    expect(costToComplete(null, "Investigation")).toBeNull();
    expect(costToComplete(1917, "Cleanup")).toBe(1917);
  });

  it("expands category codes it knows and shows others as USACE codes them", () => {
    expect(categoryText("BD/DR")).toBe("BD/DR (building demolition and debris removal)");
    expect(categoryText("PRP/HTRW")).toBe("PRP (potentially responsible party (a non-DoD party also responsible)) + HTRW (hazardous, toxic and radioactive waste)");
    expect(categoryText("MMRP/CWM")).toBe("MMRP (military munitions) + CWM (as USACE codes it)");
    expect(categoryText(null)).toBeNull();
  });

  it("links only to USACE's FUDS portal over https", () => {
    expect(portalLink(pts.features[0].properties.EMSMGMTACTIONPLANLINK)).toBe("https://fudsportal.usace.army.mil/ems/inventory/map?id=57383");
    expect(portalLink("http://fudsportal.usace.army.mil/x")).toBeNull();
    expect(portalLink(null)).toBeNull();
  });
});

describe("properties, projects and munitions response sites", () => {
  const projects = buildFudsProjects(proj.features, NOW);

  it("draws a property once: its boundary where USACE has one in the answer, else its point", () => {
    const pointsOnly = buildFudsProperties(pts.features as unknown as Rows, null, projects);
    expect(pointsOnly).toHaveLength(126);
    const both = buildFudsProperties(pts.features as unknown as Rows, polys.features as unknown as Rows, projects);
    const shapes = both.map((f) => (f.properties.extra as FudsExtra).shape);
    // 29 boundaries; 27 of their properties also have a point in the box, which is not drawn.
    expect(shapes.filter((s) => s === "property")).toHaveLength(29);
    expect(shapes.filter((s) => s === "point")).toHaveLength(126 - 27);
    const nums = both.map((f) => (f.properties.extra as FudsExtra).programId);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("attaches each property's projects, with planned dates marked, and drops a project whose property is not in the box", () => {
    expect([...projects.values()].flat()).toHaveLength(73);
    const f = buildFudsProperties(pts.features as unknown as Rows, null, projects);
    const attached = f.reduce((n, x) => n + ((x.properties.extra as FudsExtra).projects?.length ?? 0), 0);
    expect(attached).toBe(72);
    const hancock = f.find((x) => (x.properties.extra as FudsExtra).programId === "C02NJ0004")!;
    const d = hancock.properties.details!;
    expect(d["property (as USACE lists it)"]).toBe("Fort Hancock");
    expect(d.state).toBe("NJ");
    expect(d["USACE district"]).toBe("NAE");
    expect(d["data fiscal year"]).toBe(2024);
    expect(d["project 01CON/HTRW"]).toMatch(/^CON \(containerized\) \+ HTRW .*status Response Complete and Site Closeout.*cost to complete \$0 \(complete\)/);
    expect(Object.entries(d).some(([k, v]) => k.startsWith("project ") && /\(planned\)/.test(String(v)))).toBe(true);
  });

  it("says projects are unknown, not none, when the project layer did not answer", () => {
    const f = buildFudsProperties(pts.features as unknown as Rows, null, null);
    expect(f[0].properties.details?.projects).toMatch(/^unknown/);
    expect((f[0].properties.extra as FudsExtra).projects).toBeNull();
  });

  it("names a property by its number and never finds it by its name", () => {
    const f = buildFudsProperties(pts.features as unknown as Rows, null, projects);
    const hancock = f.find((x) => (x.properties.extra as FudsExtra).programId === "C02NJ0004")!;
    expect(hancock.properties.name).toBe("FUDS C02NJ0004");
    expect(matchScore(hancock.properties, "c02nj0004")).toBeGreaterThan(0);
    expect(matchScore(hancock.properties, "fort hancock")).toBe(0);
  });

  it("draws munitions response sites with their priority, 'not given' when null", () => {
    const m = buildFudsMrs(mrs.features as unknown as Rows);
    expect(m).toHaveLength(11);
    expect(m[0].properties.name).toBe("FUDS MRS C02NY001604");
    expect(m[0].properties.details?.["relative priority"]).toBe("not given");
    expect(m[0].properties.details?.["restoration program"]).toBe("MMRP");
    expect(JSON.stringify(m)).not.toMatch(/CURRENTOWNER|FEATUREDESCRIPTION/);
  });
});
