import { describe, expect, it } from "vitest";
import counties from "./data/counties.json";
import { SUCCESSORS, editDistance, joinName, nameIndex, nearName, norm, pointIn, pointInRings, polygon } from "./countyJoin";

const ix = nameIndex(counties.rows);

describe("norm", () => {
  it("drops case, accents, punctuation and the county-type suffix", () => {
    expect(norm("St. Louis County")).toBe("saint louis");
    expect(norm("Pe&ntilde;uelas Municipio")).toBe("penuelas");
    expect(norm("ANCHORAGE, MUNICIPALITY")).toBe("anchorage");
    expect(norm("VALDEZ-CORDOVA CENSUS AREA")).toBe("valdez cordova");
  });
});

describe("joinName", () => {
  it("matches a county named with 'and' whole", () => {
    expect(joinName(ix, "MT", "LEWIS AND CLARK").geoid).toBe("30049");
    expect(joinName(ix, "Virginia", "King and Queen").geoid).toBe("51097");
    expect(joinName(ix, "ak", "LAKE AND PENINSULA BOROUGH").geoid).toBe("02164");
  });
  it("strips a suffix after a comma when the whole string is one county", () => {
    expect(joinName(ix, "ak", "ANCHORAGE, MUNICIPALITY").geoid).toBe("02020");
  });
  it("matches with or without inner spaces", () => {
    expect(joinName(ix, "IL", "Du Page").geoid).toBe("17043");
    expect(joinName(ix, "IL", "DuPage").geoid).toBe("17043");
  });
  it("does not place a bare name that is both a county and an independent city", () => {
    const r = joinName(ix, "MD", "Baltimore");
    expect(r.geoid).toBeNull();
    expect(r.reason).toBe("ambiguous_county_or_city");
    expect(r.candidates?.sort()).toEqual(["24005", "24510"]);
  });
  it("places a Virginia independent city named with 'city'", () => {
    expect(joinName(ix, "VA", "Norton city").geoid).toBe("51720");
  });
  it("does not place a multi-county string, and names its counties", () => {
    const r = joinName(ix, "CA", "Kern, Los Angeles, San Bernardino");
    expect(r.geoid).toBeNull();
    expect(r.reason).toBe("multi_county");
    expect(r.candidates?.sort()).toEqual(["06029", "06037", "06071"]);
  });
  it("fails closed on Connecticut's legacy counties, with every planning region as candidates", () => {
    const r = joinName(ix, "CT", "Fairfield");
    expect(r.geoid).toBeNull();
    expect(r.reason).toBe("no_name_match");
    expect(r.candidates).toHaveLength(9);
  });
  it("fails closed on Valdez-Cordova, which ACS2023 does not have", () => {
    expect(joinName(ix, "AK", "VALDEZ-CORDOVA CENSUS AREA").geoid).toBeNull();
    expect(SUCCESSORS["AK|valdez cordova"]).toEqual(["02063", "02066"]);
  });
  it("says why for a blank county and a state outside counties.json", () => {
    expect(joinName(ix, "TX", null).reason).toBe("no_county");
    expect(joinName(ix, "gu", "Guam").reason).toBe("state_not_in_counties");
  });
});

describe("nearName", () => {
  it("takes a misspelling one edit from exactly one county", () => {
    expect(nearName(ix, "PA", "SCHUYKILL")).toBe("42107");
    expect(nearName(ix, "SC", "BARNEWELL")).toBe("45011");
    expect(nearName(ix, "TX", "WHICHITA")).toBe("48485");
  });
  it("refuses short names, lists and anything two edits away", () => {
    expect(nearName(ix, "TX", "Bexa")).toBeNull();
    expect(nearName(ix, "TX", "Harris, Fort Bend")).toBeNull();
    expect(nearName(ix, "PA", "SCHYKLL")).toBeNull();
  });
  it("counts edits", () => {
    expect(editDistance("barnwell", "barnewell")).toBe(1);
    expect(editDistance("abc", "xyz")).toBe(2);
  });
});

describe("points", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  it("counts holes (even-odd)", () => {
    expect(pointInRings(1, 1, [square, hole])).toBe(true);
    expect(pointInRings(5, 5, [square, hole])).toBe(false);
    expect(pointInRings(11, 5, [square])).toBe(false);
  });
  it("returns every polygon hit and never the nearest", () => {
    const polys = [polygon("A", [square]), polygon("B", [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]])];
    expect(pointIn(polys, 5, 5)).toEqual(["A"]);
    expect(pointIn(polys, 15, 5)).toEqual(["B"]);
    expect(pointIn(polys, 25, 5)).toEqual([]);
  });
});
