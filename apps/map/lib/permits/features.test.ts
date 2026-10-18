// Building-permit adapters on payloads captured from each city portal on
// 2026-09-26 with the route's own requests (lib/permits/fixtures, first 20
// rows). One Denver contractor name that may be a person's was replaced in
// the fixture; nothing else was edited. No network.
import { describe, expect, it } from "vitest";
import {
  answeredState,
  buildPermits,
  clip,
  finite,
  nycShifted,
  permitCitiesInBox,
  permitGapsInBox,
  permitRequest,
  permitRequestUrl,
  PERMIT_CITY_IDS,
  PERMIT_LIMIT,
  SF_KEEP,
  type PermitCityId,
} from "./features";

import chicago from "./fixtures/permits-chicago.json";
import austin from "./fixtures/permits-austin.json";
import seattle from "./fixtures/permits-seattle.json";
import denver from "./fixtures/permits-denver.json";
import nyc from "./fixtures/permits-nyc.json";
import nycShiftedRows from "./fixtures/permits-nyc-shifted.json";
import la from "./fixtures/permits-losangeles.json";
import sf from "./fixtures/permits-sanfrancisco.json";

type F = Parameters<typeof buildPermits>[1];
const rows = (j: unknown): F => (Array.isArray(j) ? j.map((r) => ({ geometry: null, properties: r as Record<string, unknown> })) : ((j as { features: F }).features));

describe("numbers and text the portals send", () => {
  it("reads numeric text and keeps blank as missing, never 0", () => {
    expect(finite("50000.0000")).toBe(50000);
    expect(finite("$1,250")).toBe(1250);
    expect(finite("")).toBeUndefined();
    expect(finite(" ")).toBeUndefined();
    expect(finite(null)).toBeUndefined();
    expect(finite("n/a")).toBeUndefined();
    expect(finite("0")).toBe(0);
  });
  it("cuts long descriptions visibly", () => {
    expect(clip("x".repeat(500))!.endsWith("…")).toBe(true);
    expect(clip("x".repeat(500))!.length).toBe(400);
    expect(clip("  a   b ")).toBe("a b");
  });
});

describe("city adapters on captured payloads", () => {
  it("Chicago: number, work, reported cost, PINs, and no contact name requested", () => {
    const p = buildPermits("chicago", rows(chicago));
    expect(p.length).toBe(20);
    expect(p[0].id).toMatch(/^chicago:/);
    expect(p.every((r) => r.valuationLabel === "reported cost")).toBe(true);
    expect(p.some((r) => r.parcel?.scheme === "pin")).toBe(true);
    const url = permitRequestUrl(permitRequest("chicago", [-87.64, 41.87, -87.62, 41.89], "2026-08-27"));
    expect(url).toContain("%24select=");
    expect(url).not.toMatch(/contact_/);
    // Socrata's within_box takes the north-west corner, then the south-east.
    expect(new URL(url).searchParams.get("$where")).toContain("within_box(location,41.89,-87.64,41.87,-87.62)");
  });

  it("Austin: TCAD parcel, contractor company, the city's record link; contractor_full_name never requested", () => {
    const p = buildPermits("austin", rows(austin));
    expect(p.length).toBeGreaterThan(10);
    expect(p.some((r) => r.parcel?.scheme === "tcad")).toBe(true);
    expect(p.some((r) => r.url?.startsWith("https://abc.austintexas.gov/"))).toBe(true);
    expect(p.some((r) => !!r.contractorCompany)).toBe(true);
    const url = permitRequestUrl(permitRequest("austin", [-97.75, 30.26, -97.735, 30.275], "2026-08-27"));
    expect(url).not.toMatch(/contractor_full_name|applicant/);
  });

  it("Seattle: estimated project cost from '50000.0000'-style text, the permit link, issued permits only", () => {
    const p = buildPermits("seattle", rows(seattle));
    expect(p.length).toBe(20);
    expect(p.every((r) => r.issued)).toBe(true);
    expect(p.some((r) => r.url?.startsWith("https://services.seattle.gov/"))).toBe(true);
    const url = decodeURIComponent(permitRequestUrl(permitRequest("seattle", [-122.345, 47.6, -122.325, 47.615], "2026-08-27")));
    expect(url).toContain("issueddate IS NOT NULL".replace(/ /g, "+"));
  });

  it("Denver: points from the ArcGIS geometry, epoch-ms dates, SCHEDNUM parcel, residential only", () => {
    const p = buildPermits("denver", rows(denver));
    expect(p.length).toBe(16);
    expect(p[0].issued).toMatch(/^2026-/);
    expect(p.some((r) => r.parcel?.scheme === "schednum")).toBe(true);
    expect(p.every((r) => r.kind === "Residential construction permit")).toBe(true);
  });

  it("New York: BBL parcel, estimated job costs; the column-shifted 'not yet issued' rows are dropped", () => {
    const p = buildPermits("nyc", rows(nyc));
    expect(p.length).toBe(20);
    expect(p.every((r) => r.parcel?.scheme === "bbl")).toBe(true);
    expect((nycShiftedRows as Array<Record<string, unknown>>).every(nycShifted)).toBe(true);
    expect(buildPermits("nyc", rows(nycShiftedRows))).toEqual([]);
    const url = permitRequestUrl(permitRequest("nyc", [-73.99, 40.745, -73.98, 40.755], "2026-08-27"));
    expect(url).not.toMatch(/applicant|owner|filing_representative/);
  });

  it("Los Angeles: the zoning printed on the permit and the valuation as published", () => {
    const p = buildPermits("losangeles", rows(la));
    expect(p.length).toBe(20);
    expect(p.some((r) => r.zoning?.includes("["))).toBe(true);
    expect(p.every((r) => r.valuationLabel === "valuation")).toBe(true);
  });

  it("San Francisco: asks data.sf.gov for SF_KEEP by name; block/lot parcel", () => {
    const p = buildPermits("sanfrancisco", rows(sf));
    expect(p.length).toBe(20);
    expect(p.some((r) => r.parcel?.scheme === "blocklot")).toBe(true);
    const url = new URL(permitRequestUrl(permitRequest("sanfrancisco", [-122.405, 37.785, -122.395, 37.795], "2026-08-27")));
    expect(url.host).toBe("data.sf.gov");
    expect(url.searchParams.get("$select")).toBe(SF_KEEP.join(","));
    // The captured rows carry only the columns asked for.
    const kept = new Set<string>(SF_KEEP);
    expect((sf as Array<Record<string, unknown>>).flatMap((r) => Object.keys(r)).filter((k) => !kept.has(k))).toEqual([]);
  });
});

describe("coverage", () => {
  it("every city has a request, newest first, capped at the limit", () => {
    for (const id of PERMIT_CITY_IDS) {
      const url = decodeURIComponent(permitRequestUrl(permitRequest(id as PermitCityId, [-100, 30, -99.99, 30.01], "2026-08-27")));
      expect(url, id).toMatch(/DESC/);
      expect(url, id).toMatch(new RegExp(`(\\$limit|resultRecordCount)=${PERMIT_LIMIT}`));
    }
  });

  it("names Dallas stale, Houston without a feed and San Antonio not wired, instead of an empty map", () => {
    expect(permitGapsInBox([-96.81, 32.77, -96.79, 32.79]).map((g) => g.state)).toEqual(["stale"]);
    expect(permitGapsInBox([-95.38, 29.75, -95.36, 29.77]).map((g) => g.state)).toEqual(["no-feed"]);
    expect(permitGapsInBox([-98.5, 29.41, -98.48, 29.43]).map((g) => g.state)).toEqual(["not-wired"]);
    expect(permitGapsInBox([-104.99, 39.74, -104.98, 39.75]).map((g) => g.state)).toEqual(["token-required"]);
    expect(permitCitiesInBox([-104.99, 39.74, -104.98, 39.75]).map((c) => c.id)).toEqual(["denver"]);
  });

  it("calls a capped answer partial, not covered", () => {
    expect(answeredState(PERMIT_LIMIT, false)).toBe("partial");
    expect(answeredState(12, false)).toBe("covered");
    expect(answeredState(12, true)).toBe("partial");
    expect(answeredState(0, false)).toBe("covered");
  });
});
