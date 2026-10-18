// EPA ATTAINS impaired waters, from the Baltimore Harbor envelope
// (-76.62,39.26,-76.58,39.30, isimpaired='Y') captured 2026-10-13: layer 1
// (2 lines) and layer 2 (5 areas), unmodified.
import { describe, expect, it } from "vitest";
import lines from "./fixtures/attains-1-baltimore.json";
import areas from "./fixtures/attains-2-baltimore.json";
import { ATTAINS_FIELDS, buildImpaired, categoryText, tierOf, type ImpairedExtra } from "./impaired";

type Rows = Parameters<typeof buildImpaired>[0];

describe("impaired assessment units", () => {
  it("builds one feature per unit, named by its id and category, never by a person", () => {
    const l = buildImpaired(lines.features as unknown as Rows, "line");
    const a = buildImpaired(areas.features as unknown as Rows, "area");
    expect(l).toHaveLength(2);
    expect(a).toHaveLength(5);
    const jones = l.find((f) => (f.properties.extra as ImpairedExtra).auId === "MD-02130904")!;
    expect(jones.properties.name).toBe("MD-02130904 · category 5");
    expect(jones.properties.details).toMatchObject({
      "assessment unit": "Jones Falls",
      category: "5: impaired, needs a TMDL: on the 303(d) list",
      "on the 303(d) list": "yes",
      TMDL: "yes",
      "reporting cycle": "2024",
      "EPA action status": "EPA Final Action",
      "How's My Waterway (EPA)": "https://mywaterway.epa.gov/waterbody-report/MDE_EASP/MD-02130904/2024",
    });
    expect((jones.properties.extra as ImpairedExtra).tier).toBe("listed");
    const planned = l.find((f) => (f.properties.extra as ImpairedExtra).category === "4A")!;
    expect((planned.properties.extra as ImpairedExtra).tier).toBe("planned");
    expect(a.every((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")).toBe(true);
    // A line asked for as an area (or the reverse) is not drawn as one.
    expect(buildImpaired(lines.features as unknown as Rows, "area")).toEqual([]);
  });

  it("reads a missing TMDL or 303(d) flag as not reported, never as no", () => {
    const row = (lines.features as unknown as Rows)[1];
    const edited = [{ ...row, properties: { ...row.properties, hastmdl: null, on303dlist: "" } }];
    const [f] = buildImpaired(edited, "line");
    expect((f.properties.extra as ImpairedExtra).tmdl).toBeNull();
    expect((f.properties.extra as ImpairedExtra).on303d).toBeNull();
    expect(f.properties.details?.TMDL).toBe("not reported");
    // Category 5 still draws as listed without the flag.
    expect((f.properties.extra as ImpairedExtra).tier).toBe("listed");
  });

  it("names each category and shows an unfamiliar one as the state reports it", () => {
    expect(categoryText("4C")).toMatch(/other than a pollutant/);
    expect(categoryText("5R")).toBe("5R (as the state reports it)");
    expect(categoryText(null)).toBe("category not reported");
    expect(tierOf("5R", true)).toBe("listed");
    expect(tierOf("4B", false)).toBe("planned");
    expect(tierOf(null, null)).toBe("other");
  });

  it("asks for named fields only", () => {
    expect(ATTAINS_FIELDS).not.toContain("*");
  });
});
