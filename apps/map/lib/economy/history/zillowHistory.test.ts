import { describe, expect, it } from "vitest";
import { ZILLOW_FILES } from "@/lib/economy/sources";
import { parseZillowHistory } from "./zillowCsv";
import { COUNTY_CSV, METRO_CSV, STATE_CSV } from "./zillowCsv.test";
import { zillowFileFor, zillowRowKey, zillowRowToSeries, zillowSeriesId } from "./zillowHistory";

describe("zillowRowToSeries", () => {
  const county = parseZillowHistory("zhviCounty", COUNTY_CSV);
  it("county row: id, geo, points with nulls, published provenance citing the file", () => {
    const s = zillowRowToSeries("zhvi", county, county.rows.get("17031")!, "2024-01-01T00:00:00.000Z");
    expect(s.id).toBe("zhvi:county:17031");
    expect(s.geo).toEqual({ kind: "county", id: "17031", name: "Cook County, IL" });
    expect(s.points.map((p) => p.v)).toEqual([null, 180000.5, 181000]);
    expect(s.frequency).toBe("monthly");
    expect(s.unit).toBe("$");
    expect(s.provenance.kind).toBe("published");
    expect(s.provenance.source.id).toBe("zillow-zhvi");
    expect(s.provenance.upstreamUrl).toBe(ZILLOW_FILES.zhviCounty);
    expect(s.provenance.seriesId).toBe("County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month");
    expect(s.provenance.period).toBe("2000-03");
    expect(s.provenance.retrievedAt).toBe("2024-01-01T00:00:00.000Z");
  });
  it("period is the last non-null month", () => {
    const t = parseZillowHistory("zoriCounty", COUNTY_CSV.replace("150000,151000,152500", "1500,1510,"));
    const s = zillowRowToSeries("zori", t, t.rows.get("48453")!);
    expect(s.provenance.period).toBe("2000-02");
    expect(s.provenance.source.id).toBe("zillow-zori");
    expect(s.unit).toBe("$ per month");
  });
  it("national and metro and state ids", () => {
    const metro = parseZillowHistory("zhviMetro", METRO_CSV);
    const us = zillowRowToSeries("zhvi", metro, metro.rows.get("US")!);
    expect(us.id).toBe("zhvi:us");
    expect(us.geo).toEqual({ kind: "us", id: "US", name: "United States" });
    const msa = zillowRowToSeries("zori", metro, metro.rows.get("394355")!);
    expect(msa.id).toBe("zori:metro:394355");
    expect(msa.geo).toBeUndefined();
    const state = parseZillowHistory("zhviState", STATE_CSV);
    expect(zillowSeriesId("zhvi", state.rows.get("Texas")!)).toBe("zhvi:state:TX");
    expect(zillowRowToSeries("zhvi", state, state.rows.get("Texas")!).geo).toEqual({ kind: "state", id: "TX", name: "Texas" });
  });
});

describe("scope routing", () => {
  it("picks the file and row key for each scope; ZORI has no state file", () => {
    expect(zillowFileFor("zhvi", { kind: "county", fips: "48453" })).toBe("zhviCounty");
    expect(zillowFileFor("zori", { kind: "county", fips: "48453" })).toBe("zoriCounty");
    expect(zillowFileFor("zhvi", { kind: "state", name: "Texas" })).toBe("zhviState");
    expect(zillowFileFor("zori", { kind: "state", name: "Texas" })).toBeNull();
    expect(zillowFileFor("zhvi", { kind: "us" })).toBe("zhviMetro");
    expect(zillowFileFor("zori", { kind: "metro", regionId: "394355" })).toBe("zoriMetro");
    expect(zillowRowKey({ kind: "us" })).toBe("US");
    expect(zillowRowKey({ kind: "county", fips: "48453" })).toBe("48453");
    expect(zillowRowKey({ kind: "state", name: "Texas" })).toBe("Texas");
    expect(zillowRowKey({ kind: "metro", regionId: "1" })).toBe("1");
  });
});
