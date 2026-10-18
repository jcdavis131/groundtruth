// SSURGO two-step parsing on Soil Data Access answers captured 2026-09-26:
// south Bexar County (Duval loamy fine sand, four unrated minor components),
// San Antonio clay loam (one rated component), a water map unit, and the
// `{}` SDA sends when nothing matches (open ocean).
import { describe, expect, it } from "vitest";
import duvalPoint from "./fixtures/sda-duval-point.json";
import duvalMapunit from "./fixtures/sda-duval-mapunit.json";
import clayPoint from "./fixtures/sda-saclay-point.json";
import clayMapunit from "./fixtures/sda-saclay-mapunit.json";
import waterMapunit from "./fixtures/sda-water-mapunit.json";
import empty from "./fixtures/sda-empty.json";
import { decimal, isMukey, mapunitSql, nccpiText, NCCPI_RULE, parseComponents, parseSoilPoint, pointSql, sdaRows, soilAnswer, wktPoint } from "./soil";

describe("SDA queries", () => {
  it("puts only a formatted coordinate and a digit key into SQL", () => {
    expect(wktPoint(-98.45, 29.28)).toBe("POINT(-98.450000 29.280000)");
    expect(pointSql(-98.45, 29.28)).toContain("SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(-98.450000 29.280000)')");
    expect(() => wktPoint(Number.NaN, 29)).toThrow();
    expect(() => wktPoint(200, 29)).toThrow();
    expect(mapunitSql("390497")).toContain(`ci.mrulename = '${NCCPI_RULE}'`);
    expect(() => mapunitSql("390497' OR 1=1 --")).toThrow();
    expect(isMukey("390497")).toBe(true);
    expect(isMukey("")).toBe(false);
    expect(isMukey("12a")).toBe(false);
  });
});

describe("step 1: point -> map unit", () => {
  it("reads the map unit, farmland class, survey area and its save date", () => {
    expect(parseSoilPoint(clayPoint)).toEqual({
      mukey: "390497",
      symbol: "SaB",
      name: "San Antonio clay loam, 1 to 3 percent slopes",
      farmlandClass: "All areas are prime farmland",
      areaSymbol: "TX029",
      areaName: "Bexar County, Texas",
      surveySaved: "9/4/2025 2:58:52 PM",
    });
    expect(parseSoilPoint(duvalPoint)?.farmlandClass).toBe("Prime farmland if irrigated");
  });

  it("answers null, not an error, when SDA returns {} (no map unit at the point)", () => {
    expect(sdaRows(empty)).toEqual([]);
    expect(parseSoilPoint(empty)).toBeNull();
    expect(parseSoilPoint(null)).toBeNull();
  });
});

describe("step 2: map unit -> components with NCCPI", () => {
  it("keeps the dominant component first with its rating, and unrated components as null", () => {
    const comps = parseComponents(duvalMapunit);
    expect(comps.map((c) => c.name)).toEqual(["Duval", "Dilley", "Webb", "Poth", "Unnamed"]);
    expect(comps[0]).toMatchObject({ percent: 85, major: true, nccpi: 0.379, nccpiClass: "Moderately low inherent productivity" });
    for (const c of comps.slice(1)) {
      expect(c.nccpi).toBeNull();
      expect(c.nccpiClass).toBe("Not rated");
      // SDA pads the flag ("No "): a minor component is never read as major.
      expect(c.major).toBe(false);
    }
  });

  it("prints the rating with NRCS's words, and 'not rated' rather than 0", () => {
    const clay = soilAnswer(parseSoilPoint(clayPoint)!, parseComponents(clayMapunit));
    expect(nccpiText(clay.dominant)).toBe("0.455 (Moderate inherent productivity)");
    const water = parseComponents(waterMapunit);
    expect(water[0].nccpi).toBeNull();
    expect(nccpiText(water[0])).toBe("not rated (NRCS: Not rated)");
    expect(nccpiText(null)).toBe("no component rows");
  });

  it("never reads a blank or null decimal as 0", () => {
    expect(decimal(null)).toBeNull();
    expect(decimal("")).toBeNull();
    expect(decimal("  ")).toBeNull();
    expect(decimal("n/a")).toBeNull();
    expect(decimal("0")).toBe(0);
    expect(decimal("0.513")).toBe(0.513);
  });
});
