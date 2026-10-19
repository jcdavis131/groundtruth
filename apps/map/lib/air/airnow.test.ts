// AirNow's hourly observations file, on rows captured from
// HourlyAQObs_2026092619.dat (Canada, San Antonio, Mexico, an inactive site
// and an active site with no AQI that hour).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AIR_PRELIMINARY, AQI_LABEL, airFeature, aqiCategory, hourlyAqObsUrl, parseHourlyAqObs, rowSite, siteAqi, siteRow, type AirExtra } from "./airnow";

const file = readFileSync(path.join(__dirname, "fixtures", "hourlyaqobs-2026092619.dat"), "utf8");

describe("parseHourlyAqObs", () => {
  const r = parseHourlyAqObs(file);
  it("keeps active sites with a position and counts the rest", () => {
    expect(r.sites.map((s) => s.aqsid)).toEqual(["000010601", "000020104", "480290032", "480290052", "000020401", "484800010001"]);
    expect(r.inactive).toBe(1);
  });
  it("reads each pollutant's AQI and concentration as sent", () => {
    const sa = r.sites.find((s) => s.aqsid === "480290032")!;
    expect(sa.name).toBe("San Antonio Northwest C23");
    expect(sa.agency).toBe("Texas Commission on Environmental Quality");
    expect(sa.aqi).toEqual({ OZONE: 64, PM25: 59 });
    expect(sa.validAt).toBe("2026-09-26T19:00:00.000Z");
    expect(sa.reportingArea).toBe("San Antonio");
    expect(sa.conc.find((c) => c.param === "OZONE")).toEqual({ param: "OZONE", value: 62, unit: "PPB" });
    // This hour the file has a PM2.5 NowCast AQI (59) with the hourly concentration cell empty: no concentration is shown, none is made up.
    expect(sa.conc.find((c) => c.param === "PM25")).toBeUndefined();
  });
  it("never invents an AQI for a site that reported none this hour", () => {
    const quiet = r.sites.find((s) => s.aqsid === "000020401")!;
    expect(siteAqi(quiet)).toBeNull();
    const f = airFeature(quiet);
    expect(f.properties.kind).toBe("not rated");
    expect((f.properties.extra as AirExtra).aqi).toBeUndefined();
    expect(f.properties.details?.AQI).toBe("no AQI reported by this site this hour");
  });
});

describe("AQI categories", () => {
  it("use EPA's breakpoints and colours", () => {
    expect(aqiCategory(50)?.name).toBe("Good");
    expect(aqiCategory(51)?.name).toBe("Moderate");
    expect(aqiCategory(64)?.color).toBe("#FFFF00");
    expect(aqiCategory(101)?.name).toBe("Unhealthy for Sensitive Groups");
    expect(aqiCategory(350)?.name).toBe("Hazardous");
    expect(aqiCategory(undefined)).toBeNull();
  });
  it("colour a site by its highest pollutant AQI, the way the AQI names a place", () => {
    expect(siteAqi({ aqi: { OZONE: 64, PM25: 59 } })).toEqual({ value: 64, pollutant: "OZONE" });
  });
});

describe("airFeature", () => {
  const sa = parseHourlyAqObs(file).sites.find((s) => s.aqsid === "480290032")!;
  const f = airFeature(sa);
  it("says PRELIMINARY and credits the reporting agency before AirNow", () => {
    expect(f.properties.details?.status).toBe(AIR_PRELIMINARY);
    expect(f.properties.source).toContain("preliminary");
    expect(f.properties.details?.credit).toBe("Texas Commission on Environmental Quality, via the U.S. EPA AirNow program");
  });
  it("shows the values unchanged, named as the NowCast or 1-hour AQI the file defines them as", () => {
    expect(f.properties.details?.["ozone NowCast AQI"]).toBe(64);
    expect(f.properties.details?.["PM2.5 NowCast AQI"]).toBe(59);
    expect(f.properties.details?.["OZONE hourly concentration"]).toBe("62 ppb");
    expect(f.properties.details?.AQI).toBe("64 (ozone NowCast AQI) · Moderate");
    expect(AQI_LABEL.NO2).toBe("NO₂ 1-hour AQI");
  });
  it("round-trips a site through the compact row the route sends", () => {
    expect(rowSite(siteRow(sa))).toEqual(sa);
  });
});

describe("hourlyAqObsUrl", () => {
  it("names the dated UTC file", () => {
    expect(hourlyAqObsUrl(Date.UTC(2026, 8, 26, 19))).toBe("https://files.airnowtech.org/airnow/2026/20260926/HourlyAQObs_2026092619.dat");
  });
});
