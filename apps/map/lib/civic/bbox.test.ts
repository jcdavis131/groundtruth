import { describe, expect, it } from "vitest";
import { numParam, parseBbox, snapBbox } from "./bbox";
import { gateOf } from "./request";

describe("civic box parsing", () => {
  it("keeps a box already on the grid exactly as it is", () => {
    expect(snapBbox([-98.5, 29.41, -98.48, 29.43], 0.04, 0.0025)).toEqual([-98.5, 29.41, -98.48, 29.43]);
    expect(snapBbox([-122.3375, 47.6, -122.3225, 47.615], 0.04, 0.0025)).toEqual([-122.3375, 47.6, -122.3225, 47.615]);
  });
  it("snaps outward and clamps to the span around the centre", () => {
    expect(snapBbox([-98.501, 29.411, -98.479, 29.429], 0.04, 0.0025)).toEqual([-98.5025, 29.41, -98.4775, 29.43]);
    const big = snapBbox([-99, 29, -98, 30], 0.04, 0.0025);
    expect(big[2] - big[0]).toBeCloseTo(0.04, 6);
    expect(big[3] - big[1]).toBeCloseTo(0.04, 6);
  });
  it("rejects malformed, inverted, blank and out-of-range boxes", () => {
    expect(parseBbox(null, 0.04, 0.0025)).toBeNull();
    expect(parseBbox("1,2,3", 0.04, 0.0025)).toBeNull();
    expect(parseBbox("-98,29,-99,30", 0.04, 0.0025)).toBeNull();
    expect(parseBbox(",29,-98,30", 0.04, 0.0025)).toBeNull();
    expect(parseBbox("-98,29,-97,95", 0.04, 0.0025)).toBeNull();
  });
  it("reads a blank number as missing, not 0", () => {
    expect(numParam("")).toBeNull();
    expect(numParam(null)).toBeNull();
    expect(numParam(" 0 ")).toBe(0);
    expect(numParam("abc")).toBeNull();
  });
});

describe("politeness gates", () => {
  it("shares one gate per portal host across datasets", () => {
    expect(gateOf("https://data.cityofchicago.org/resource/dj47-wfun.json?x=1").gate).toBe(gateOf("https://data.cityofchicago.org/resource/ydr8-5enu.json").gate);
    expect(gateOf("https://data.cityofchicago.org/resource/dj47-wfun.json").minIntervalMs).toBe(1000);
  });
  it("gates ArcGIS Online by organisation, and the federal APIs more slowly", () => {
    const sea = gateOf("https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/X/FeatureServer/0");
    const sa = gateOf("https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/Y/FeatureServer/12");
    expect(sea.gate).not.toBe(sa.gate);
    expect(sea.minIntervalMs).toBe(500);
    expect(gateOf("https://echodata.epa.gov/echo/cwa_rest_services.get_facilities").minIntervalMs).toBe(2000);
    expect(gateOf("https://permits.ops.usace.army.mil/orm-public-api/permits/search").minIntervalMs).toBe(2000);
    expect(gateOf("https://maps.lacity.org/lahub/rest/services/City_Planning_Department/MapServer/8").minIntervalMs).toBe(500);
  });
});
