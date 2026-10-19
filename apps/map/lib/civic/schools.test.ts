// NCES public schools 2024-25 on answers captured 2026-10-17, unmodified: an Austin box (11
// schools, the critique's nces_box), three Marshall County, AL schools that report a negative
// TOTAL, and three Capitol Planning Region schools (CNTY in Connecticut's planning regions).
import { describe, expect, it } from "vitest";
import box from "./fixtures/nces-box-austin.json";
import negative from "./fixtures/nces-negative.json";
import ct from "./fixtures/nces-ct-09110.json";
import { buildSchools, ccd, frlShare, levelClass, SCHOOL_FIELDS, type SchoolExtra } from "./schools";
import { receivedRecordText } from "@/lib/catalog/recordText";

type Fc = { features: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> };

describe("the fields asked", () => {
  it("never asks a race, sex or grade-level enrollment cell, or a phone", () => {
    for (const f of SCHOOL_FIELDS) {
      expect(f, f).not.toMatch(/^(AM|AS|BL|HI|HP|TR|WH)(ALM|ALF)?$/);
      expect(f, f).not.toMatch(/ALM$|ALF$|^TOTMENROL$|^TOTFENROL$/);
      expect(f, f).not.toMatch(/^(PK|KG|G\d\d|UG|AE)$/);
      expect(f, f).not.toMatch(/PHONE/);
    }
    expect(SCHOOL_FIELDS).not.toContain("*");
  });
});

describe("school features", () => {
  const { features } = buildSchools((box as unknown as Fc).features);

  it("reads the Austin box: Texas School for the Deaf's -1 ratio and FTE as not reported, FRL share 50.6 %", () => {
    expect(features).toHaveLength(11);
    const tsd = features.find((f) => f.properties.id === "nces:480025309537")!;
    expect(tsd.properties.name).toBe("TEXAS SCHOOL FOR THE DEAF");
    expect(tsd.properties.details).toMatchObject({
      grades: "PK to 12",
      level: "Other",
      enrollment: "500",
      "free or reduced-price lunch": "50.6 % (253 of 500)",
      "students per FTE teacher": "not reported",
      "FTE teachers": "not reported",
      virtual: "not reported",
      "NCES page": "https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=480025309537",
    });
    expect(tsd.properties.kind).toBe("other");
  });

  it("marks a full virtual school's point as an office", () => {
    const v = features.find((f) => f.properties.id === "nces:480147313991")!;
    expect((v.properties.extra as SchoolExtra).virtual).toBe(true);
    expect(v.properties.details!["what the point is"]).toMatch(/administrative address/);
  });

  it("never shows a negative as 0 and never divides by a reporting code", () => {
    const neg = buildSchools((negative as unknown as Fc).features).features;
    expect(neg).toHaveLength(3);
    expect(neg[0].properties.details).toMatchObject({ enrollment: "not reported", "free or reduced-price lunch": "enrollment not reported" });
    expect(neg[2].properties.details).toMatchObject({ enrollment: "not applicable", "FTE teachers": "5.0" });
    expect(ccd(-9)).toEqual({ value: null, code: "not published (NCES code -9)" });
    expect(frlShare(0, -2)).toBe("not applicable");
    expect(frlShare(0, 0)).toBe("no enrollment reported");
  });

  it("keeps the published level word and puts it in a colour class", () => {
    expect(levelClass("Prekindergarten")).toBe("elementary");
    expect(levelClass("Secondary")).toBe("high");
    expect(levelClass("Adult Education")).toBe("other");
    expect(levelClass(null)).toBe("other");
  });

  it("attaches record text from published categories, the school's name and its place only: no street or count", () => {
    const t = receivedRecordText(features[0].properties)!;
    expect(t).toContain("school level: Other");
    // B0 (2026-10-18): the public school's published name, its label, rides once as the "name" segment.
    expect(t).toContain(`name: ${features[0].properties.name}`);
    expect(t).toContain("city: AUSTIN");
    expect(t.split("; ").filter((s) => !s.startsWith("name: ")).join("; ")).not.toMatch(/DEAF|CONGRESS|500|253/);
  });

  it("reads Connecticut counties as planning regions, the TIGER-current regime a county tower joins", () => {
    const c = buildSchools((ct as unknown as Fc).features).features;
    expect(c).toHaveLength(3);
    for (const f of c) expect(f.properties.details!.county).toBe("Capitol Planning Region (09110)");
  });
});
