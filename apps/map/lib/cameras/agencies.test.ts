// The transport-agency camera adapters on payloads captured 2026-09-26:
// Caltrans CWWP2 District 7, DriveBC HighwayCams (BC Data Catalogue CSV),
// Fintraffic weather camera stations and LTA traffic images.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMERA_IMAGE_HOSTS, caltransUrl, parseCaltrans, parseDigitraffic, parseDriveBc, parseLta } from "./agencies";
import caltrans from "./fixtures/caltrans-d7.json";
import digitraffic from "./fixtures/digitraffic-stations.json";
import lta from "./fixtures/lta-traffic-images.json";

const drivebcCsv = readFileSync(path.join(__dirname, "fixtures", "drivebc-webcams.csv"), "utf8");

describe("Caltrans CWWP2", () => {
  const cams = parseCaltrans(caltrans as never);
  it("reads the district file into cameras with their live still", () => {
    expect(cams).toHaveLength(4);
    const c = cams[0];
    expect(c.id).toBe("d7-1");
    expect(c.name).toBe("I-110 : (196) Avenue 26 Off Ramp");
    expect(c.lat).toBeCloseTo(34.0837);
    expect(c.lon).toBeCloseTo(-118.2215);
    expect(c.imageUrl).toBe("https://cwwp2.dot.ca.gov/data/d7/cctv/image/i110196avenue26offramp/i110196avenue26offramp.jpg");
    expect(c.facing).toBe("South");
    expect(c.available).toBe(true);
  });
  it("keeps CWWP2's unreliable county out and says which camera is out of service", () => {
    expect(cams[0].area).toBe("Cypress Park, Caltrans District 7");
    expect(cams[0].area).not.toContain("Alameda");
    expect(cams.some((c) => c.available === false)).toBe(true);
  });
  it("names each district's file", () => {
    expect(caltransUrl(7)).toBe("https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json");
    expect(caltransUrl(12)).toBe("https://cwwp2.dot.ca.gov/data/d12/cctv/cctvStatusD12.json");
  });
});

describe("DriveBC HighwayCams", () => {
  const cams = parseDriveBc(drivebcCsv);
  it("reads the licensed CSV with the published orientation word, not a drawn bearing", () => {
    expect(cams).toHaveLength(5);
    const c = cams[0];
    expect(c.id).toBe("2");
    expect(c.name).toBe("Coquihalla Great Bear Snowshed - N");
    expect(c.facing).toBe("N");
    expect(c.road).toBe("Highway 5");
    expect(c.lat).toBeCloseTo(49.596374);
    expect(c.imageUrl).toBe("https://www.drivebc.ca/images/2.jpg");
    expect(c.pageUrl).toBe("https://images.drivebc.ca/bchighwaycam/pub/html/www/2.html");
  });
  it("fails loudly on a changed header rather than guessing columns", () => {
    expect(() => parseDriveBc("a,b,c\n1,2,3\n")).toThrow(/header/);
  });
});

describe("Digitraffic weather cameras", () => {
  it("shows the first camera view of each gathering station", () => {
    const cams = parseDigitraffic(digitraffic as never);
    expect(cams[0].id).toBe("C01503");
    expect(cams[0].name).toBe("kt51 Inkoo");
    expect(cams[0].imageUrl).toBe("https://weathercam.digitraffic.fi/C0150301.jpg");
    expect(cams[0].available).toBe(true);
    expect(cams[0].area).toBe("3 camera views at this station (the first is shown)");
  });
});

describe("LTA traffic images", () => {
  it("names a camera by its id, since the API publishes no name", () => {
    const cams = parseLta(lta as never);
    expect(cams).toHaveLength(3);
    expect(cams[0].name).toBe("LTA traffic camera 2701");
    expect(cams[0].imageUrl?.startsWith("https://images.data.gov.sg/")).toBe(true);
  });
});

describe("image hosts", () => {
  it("lists every host an adapter hands to the browser, all https", () => {
    const urls = [
      ...parseCaltrans(caltrans as never),
      ...parseDriveBc(drivebcCsv),
      ...parseDigitraffic(digitraffic as never),
      ...parseLta(lta as never),
    ]
      .map((c) => c.imageUrl)
      .filter((u): u is string => !!u);
    for (const u of urls) {
      const url = new URL(u);
      expect(url.protocol).toBe("https:");
      expect(CAMERA_IMAGE_HOSTS as readonly string[]).toContain(url.host);
    }
  });
});
