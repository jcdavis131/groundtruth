import { describe, expect, it } from "vitest";
import { normalizeZip, parseZctaCentroid, parseZctaCounty, zctaCentroidQuery } from "./geo";

// shape per https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/2020-zcta-record-layout.html; unverified in sandbox
const REL = [
  "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_COUNTY_20|GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|AREAWATER_COUNTY_20|MTFCC_COUNTY_20|CLASSFP_COUNTY_20|FUNCSTAT_COUNTY_20|AREALAND_PART|AREAWATER_PART",
  "1|28211|ZCTA5 28211|30000000|100000|G6350|S|10|37119|Mecklenburg County|1000000000|5000000|G4020|H1|A|30000000|100000",
  "2|78725|ZCTA5 78725|90000000|0|G6350|S|11|48453|Travis County|2000000000|1|G4020|H1|A|60000000|0",
  "3|78725|ZCTA5 78725|90000000|0|G6350|S|12|48021|Bastrop County|2000000000|1|G4020|H1|A|30000000|0",
  "4|00000|bad|1|0|G6350|S|13|4|bad county|1|0|G4020|H1|A|1|0",
  "",
].join("\n");

describe("parseZctaCounty", () => {
  it("maps each ZCTA to the county with the largest land share", () => {
    const m = parseZctaCounty(REL);
    expect(m.get("28211")).toBe("37119");
    expect(m.get("78725")).toBe("48453");
    expect(m.has("00000")).toBe(false);
    expect(m.size).toBe(2);
  });
  it("reads the header by name, so a reordered file still parses", () => {
    const text = ["GEOID_COUNTY_20|AREALAND_PART|GEOID_ZCTA5_20", "48029|10|78249", "48091|20|78249"].join("\n");
    expect(parseZctaCounty(text).get("78249")).toBe("48091");
  });
  it("throws when the columns are missing", () => {
    expect(() => parseZctaCounty("a|b\n1|2")).toThrow(/columns missing/);
  });
  it("returns an empty map for an empty file", () => {
    expect(parseZctaCounty("").size).toBe(0);
  });
});

describe("normalizeZip", () => {
  it("keeps five digits from ZIP and ZIP+4", () => {
    expect(normalizeZip("95014")).toBe("95014");
    expect(normalizeZip("95014-2083")).toBe("95014");
    expect(normalizeZip("950142083")).toBe("95014");
    expect(normalizeZip(" 78725 ")).toBe("78725");
  });
  it("rejects foreign postcodes and blanks", () => {
    expect(normalizeZip("SW1A 1AA")).toBeNull();
    expect(normalizeZip("")).toBeNull();
    expect(normalizeZip(null)).toBeNull();
    expect(normalizeZip("1234")).toBeNull();
  });
});

describe("zcta centroid", () => {
  it("builds an attribute-only query with the ZCTA quoted", () => {
    const u = zctaCentroidQuery("78725");
    expect(u).toContain("/query?");
    expect(decodeURIComponent(u)).toContain("where=ZCTA5='78725'");
    expect(u).toContain("returnGeometry=false");
  });
  it("parses CENTLAT/CENTLON attributes to [lon, lat]", () => {
    // shape per TIGERweb ArcGIS REST query with f=json; unverified in sandbox
    expect(parseZctaCentroid({ features: [{ attributes: { ZCTA5: "78725", CENTLAT: "+30.2312345", CENTLON: "-097.6198765" } }] })).toEqual([-97.6199, 30.2312]);
    expect(parseZctaCentroid({ features: [{ properties: { CENTLAT: 30.5, CENTLON: -97.5 } }] })).toEqual([-97.5, 30.5]);
  });
  it("returns null for no features or bad numbers and throws on an ArcGIS error", () => {
    expect(parseZctaCentroid({ features: [] })).toBeNull();
    expect(parseZctaCentroid({ features: [{ attributes: { CENTLAT: "x", CENTLON: "y" } }] })).toBeNull();
    expect(parseZctaCentroid({ features: [{ attributes: { CENTLAT: "95", CENTLON: "0" } }] })).toBeNull();
    expect(() => parseZctaCentroid({ error: { message: "Invalid layer" } })).toThrow(/Invalid layer/);
  });
});
