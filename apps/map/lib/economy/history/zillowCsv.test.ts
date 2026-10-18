import { describe, expect, it } from "vitest";
import { isoDate } from "./align";
import { parseZillowHistory } from "./zillowCsv";

// Header shape of County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv, three month columns.
export const COUNTY_CSV = [
  "RegionID,SizeRank,RegionName,RegionType,StateName,State,Metro,StateCodeFIPS,MunicipalCodeFIPS,2000-01-31,2000-02-29,2000-03-31",
  '2841,42,Travis County,county,TX,TX,"Austin-Round Rock-San Marcos, TX",48,453,150000,151000,152500',
  "1090,3,Cook County,county,IL,IL,\"Chicago-Naperville-Elgin, IL-IN\",17,031,,180000.5,181000",
  "9999,3100,Loving County,county,TX,TX,,48,301,,,",
  "",
].join("\r\n");

export const METRO_CSV = [
  "RegionID,SizeRank,RegionName,RegionType,StateName,2000-01-31,2000-02-29",
  "102001,0,United States,country,,120000,120500",
  '394355,15,"Austin, TX",msa,TX,140000,140700',
].join("\n");

export const STATE_CSV = ["RegionID,SizeRank,RegionName,RegionType,StateName,2000-01-31", "54,1,Texas,state,TX,100000"].join("\n");

describe("parseZillowHistory", () => {
  it("keys counties by five-digit FIPS and keeps every month with blanks as null", () => {
    const t = parseZillowHistory("zhviCounty", COUNTY_CSV);
    expect(t.dates).toEqual(["2000-01-31", "2000-02-29", "2000-03-31"]);
    expect(t.times.map(isoDate)).toEqual(t.dates);
    const travis = t.rows.get("48453")!;
    expect(travis.name).toBe("Travis County");
    expect(travis.state).toBe("TX");
    expect(travis.metro).toBe("Austin-Round Rock-San Marcos, TX");
    expect(travis.sizeRank).toBe(42);
    expect(travis.values).toEqual([150000, 151000, 152500]);
    expect(t.rows.get("17031")!.values).toEqual([null, 180000.5, 181000]);
  });
  it("drops rows with no numeric cell", () => {
    expect(parseZillowHistory("zhviCounty", COUNTY_CSV).rows.has("48301")).toBe(false);
  });
  it("metro file: national row keyed US, metros by RegionID", () => {
    const t = parseZillowHistory("zhviMetro", METRO_CSV);
    expect(t.rows.get("US")).toMatchObject({ regionType: "country", name: "United States", values: [120000, 120500] });
    expect(t.rows.get("394355")).toMatchObject({ regionType: "msa", name: "Austin, TX", state: "TX" });
  });
  it("state file keyed by name with StateName as the abbreviation", () => {
    const t = parseZillowHistory("zhviState", STATE_CSV);
    expect(t.rows.get("Texas")).toMatchObject({ state: "TX", values: [100000] });
  });
  it("rejects a file without month columns", () => {
    expect(() => parseZillowHistory("zhviCounty", "RegionID,RegionName\n1,x")).toThrow(/month columns/);
  });
});
