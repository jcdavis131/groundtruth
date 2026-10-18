// HIFLD hospitals (FEMA RAPT's copy) on answers captured 2026-10-17, unmodified: the open
// hospitals in an Austin box with the full record, two open hospitals FEMA publishes BEDS =
// -999 for, and Rhode Island's open hospitals in three pages of 10 with the national short record.
import { describe, expect, it } from "vitest";
import box from "./fixtures/hosp-box-austin.json";
import notPublished from "./fixtures/hosp-beds-notpublished.json";
import ri0 from "./fixtures/hosp-national-ri-p0.json";
import { bedsOf, buildHospitals, HOSPITAL_FIELDS, HOSPITAL_NATIONAL_FIELDS, hospitalWhere, packNational, unpackNational, type HospitalExtra } from "./hospitals";
import { hospitalSize } from "@/lib/globe/infraStyles";
import { receivedRecordText } from "@/lib/catalog/recordText";

type Fc = { features: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> };

describe("the fields asked", () => {
  it("never asks a telephone, staff count or other contact field", () => {
    for (const f of [...HOSPITAL_FIELDS, ...HOSPITAL_NATIONAL_FIELDS]) expect(f).not.toMatch(/TELEPHONE|PHONE|TTL_STAFF|EMAIL|CONTACT|ALT_NAME/);
    expect(HOSPITAL_FIELDS).not.toContain("*");
  });

  it("filters open hospitals in the where clause unless status=all", () => {
    expect(hospitalWhere("open")).toBe("STATUS='OPEN'");
    expect(hospitalWhere("all")).toBe("1=1");
  });
});

describe("hospital features", () => {
  const fs = buildHospitals((box as unknown as Fc).features);

  it("reads the Austin box as HIFLD publishes it, dates from epoch to day", () => {
    expect(fs).toHaveLength(17);
    const arise = fs.find((f) => f.properties.id === "hifld-hosp:0133978746")!;
    expect(arise.properties.name).toBe("ARISE AUSTIN MEDICAL CENTER");
    expect(arise.properties.kind).toBe("general");
    expect(arise.properties.details).toMatchObject({
      "HIFLD id": "0133978746",
      type: "general acute care",
      status: "open",
      beds: "19",
      trauma: "not published",
      helipad: "no",
      "owner type": "PROPRIETARY",
      source: "https://www.hhs.texas.gov/providers/health-care-facilities-regulation, as of 2024-03-08",
      "location checked against imagery": "2014-12-09",
      address: "3003 BEE CAVE ROAD, AUSTIN, TX 78746",
    });
    // WEBSITE "NOT AVAILABLE" is not a link, so it is left out, never shown as one.
    expect(arise.properties.details!.website).toBeUndefined();
  });

  it("attaches record text from the card's fields, its published name and city only: no address or owner", () => {
    const t = receivedRecordText(fs[0].properties)!;
    expect(t).toContain("hospital type: GENERAL ACUTE CARE");
    // B0 (2026-10-18): the licensed hospital's published name, its label, rides once as the "name" segment.
    expect(t).toContain(`name: ${fs[0].properties.name}`);
    expect(t.split("; ").filter((s) => !s.startsWith("name: ")).join("; ")).not.toMatch(/AUSTIN MEDICAL|BEE CAVE|PROPRIETARY|78746/);
  });

  it("shows BEDS = -999 as not published, at the base size, never 0", () => {
    const f = buildHospitals((notPublished as unknown as Fc).features);
    expect(f).toHaveLength(2);
    for (const x of f) {
      expect((x.properties.extra as HospitalExtra).beds).toBeNull();
      expect(x.properties.details!.beds).toBe("not published");
      expect(hospitalSize(x)).toBe(6);
    }
    expect(bedsOf(-999)).toBeNull();
    expect(bedsOf(0)).toBe(0);
  });

  it("builds the national short record and says where the full one is", () => {
    const f = buildHospitals((ri0 as unknown as Fc).features, true);
    expect(f).toHaveLength(10);
    expect(f[0].properties.details).toMatchObject({ "HIFLD id": "0001402906", type: "psychiatric", beds: "143", place: "PROVIDENCE, RI" });
    expect(f[0].properties.details!["full record"]).toMatch(/^descend below 300 km/);
    expect(f[0].properties.details!.address).toBeUndefined();
    expect(receivedRecordText(f[0].properties)).toBeNull();
  });
});

describe("the national packed rows", () => {
  it("round-trip to the same short-record features, values as FEMA sent them", () => {
    const rows = (ri0 as unknown as Fc).features;
    const packed = packNational(rows);
    expect(packed).toHaveLength(10);
    expect(packed[0]).toEqual(["0001402906", "BUTLER HOSPITAL", "PROVIDENCE", "RI", "PSYCHIATRIC", "OPEN", 143, "NOT AVAILABLE", "44007", ...(rows[0].geometry as GeoJSON.Point).coordinates.slice(0, 2)]);
    expect(buildHospitals(unpackNational(packed), true)).toEqual(buildHospitals(rows, true));
    // Under a third of the built features' size.
    expect(JSON.stringify(packed).length * 3).toBeLessThan(JSON.stringify(buildHospitals(rows, true)).length);
  });
});
