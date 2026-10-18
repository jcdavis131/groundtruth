// Zoning adapters on payloads captured from each city's own service on
// 2026-09-26, with the exact requests the route sends (lib/zoning/fixtures).
// San Francisco's point is City Hall; its outlines are 13 of the 413 the
// layer's box around Union Square answered (-122.4175,37.78,-122.3975,37.795),
// up to three per general category. New York's condo fixtures are One57
// (-73.97905,40.76538), whose billing BBL 1010107506 has no ZTLDB row; the
// overlay and limited-height fixtures are Montague Street, Brooklyn Heights
// (-73.994,40.695). No network.
import { describe, expect, it } from "vitest";
import {
  arcgisPoint,
  buildOutlines,
  chicagoFamily,
  citiesInBox,
  cityByGeoid,
  cityRecord,
  familyFromWords,
  hitFor,
  houstonRecord,
  isoDate,
  notCoveredRecord,
  NYC_LOT_GAP,
  NYC_PLUTO_FIELDS,
  NYC_PLUTO_LAYER,
  nycFamily,
  nycOverlayRequests,
  overlaysUnknown,
  parsePlace,
  plutoBbl,
  pointRequest,
  polygonRequest,
  requestUrl,
  str,
  withPointOverlays,
  withZtldb,
  ZONING_CITIES,
  ZONING_CITY_IDS,
  type ZoningCityId,
} from "./features";

import seattlePoint from "./fixtures/seattle-point.json";
import denverPoint from "./fixtures/denver-point.json";
import nycPoint from "./fixtures/nyc-point.json";
import nycPluto from "./fixtures/nyc-pluto.json";
import nycZtldb from "./fixtures/nyc-ztldb.json";
import condoPoint from "./fixtures/nyc-condo-point.json";
import condoPluto from "./fixtures/nyc-condo-pluto.json";
import condoZtldb from "./fixtures/nyc-condo-ztldb.json";
import condoNysp from "./fixtures/nyc-condo-nysp.json";
import condoNyco from "./fixtures/nyc-condo-nyco.json";
import condoNylh from "./fixtures/nyc-condo-nylh.json";
import heightsNyco from "./fixtures/nyc-heights-nyco.json";
import heightsNylh from "./fixtures/nyc-heights-nylh.json";
import chicagoPoint from "./fixtures/chicago-point.json";
import dallasPoint from "./fixtures/dallas-point.json";
import saPoint from "./fixtures/sanantonio-point.json";
import saRow from "./fixtures/sanantonio-row.json";
import austinPoint from "./fixtures/austin-point.json";
import austinRow from "./fixtures/austin-row.json";
import laPoint from "./fixtures/losangeles-point.json";
import sfPoint from "./fixtures/sanfrancisco-point.json";
import tigerHouston from "./fixtures/tiger-houston.json";
import tigerBellaire from "./fixtures/tiger-bellaire.json";
import tigerBrooklyn from "./fixtures/tiger-brooklyn.json";
import tigerNone from "./fixtures/tiger-unincorporated.json";
import seattleOutlines from "./fixtures/seattle-outlines.json";
import chicagoOutlines from "./fixtures/chicago-outlines.json";
import sfOutlines from "./fixtures/sanfrancisco-outlines.json";

type Row = Record<string, unknown>;
type Fc = Parameters<typeof buildOutlines>[1];
const fcOf = (j: unknown): Fc => (j as { features: Fc }).features;
/** ArcGIS GeoJSON answers carry rows as feature properties; Socrata JSON is the rows. */
const rows = (j: unknown): Row[] => (Array.isArray(j) ? (j as Row[]) : ((j as { features: Array<{ properties: Row }> }).features.map((f) => f.properties)));

describe("helpers", () => {
  it("treats blank and whitespace strings as missing (Seattle sends ' ' for no overlay)", () => {
    expect(str(" ")).toBeUndefined();
    expect(str(null)).toBeUndefined();
    expect(str(" DF ")).toBe("DF");
  });
  it("reads ArcGIS epoch-ms and Socrata ISO dates, and nothing else", () => {
    expect(isoDate(1494745200000)).toBe("2017-05-14");
    expect(isoDate("2021-01-27T06:00:00.000Z")).toBe("2021-01-27");
    expect(isoDate("")).toBeUndefined();
    expect(isoDate(0)).toBeUndefined();
    expect(isoDate("not a date")).toBeUndefined();
  });
  it("derives colour families from the city's own words, mixed before commercial", () => {
    expect(familyFromWords("Commercial Mixed Use")).toBe("mixed");
    expect(familyFromWords("Neighborhood Commercial")).toBe("commercial");
    expect(familyFromWords("High-Density Multi-Family")).toBe("residential");
    expect(familyFromWords("Major Institutions")).toBe("public");
    expect(familyFromWords("Unzoned Right of Way")).toBe("right-of-way");
    expect(familyFromWords("Downtown District (Sec. 35-310.11)")).toBe("downtown");
    expect(familyFromWords(undefined)).toBe("other");
  });
  it("reads New York and Chicago district letters as their codes define them", () => {
    expect(nycFamily("C6-4.5")).toBe("commercial");
    expect(nycFamily("R8B")).toBe("residential");
    expect(nycFamily("M1-6")).toBe("industrial");
    expect(nycFamily("M1-8A/R12")).toBe("mixed");
    expect(nycFamily("PARK")).toBe("public");
    expect(chicagoFamily("DC-16")).toBe("downtown");
    expect(chicagoFamily("PD 1234")).toBe("planned");
    expect(chicagoFamily("PMD 3")).toBe("industrial");
    expect(chicagoFamily("RM-5")).toBe("residential");
    expect(chicagoFamily("B3-5")).toBe("commercial");
    expect(chicagoFamily("POS-1")).toBe("public");
  });
});

describe("city adapters on captured payloads", () => {
  it("Seattle: code, overlays that are set (blank ones dropped), ordinance, effective date, municode link", () => {
    const h = hitFor("seattle", rows(seattlePoint))!;
    expect(h.code).toBe("DOC1 U/450-U");
    expect(h.base).toBe("DOC1");
    expect(h.label).toBe("Downtown Office Core 1 U/450-U");
    expect(h.family).toBe("downtown");
    expect(h.overlays).toEqual(["overlay DF", "MHA", "incentive zoning"]);
    expect(h.ordinance).toBe("125291");
    expect(h.effective).toBe("2017-05-14");
    expect(h.codeUrl).toMatch(/^https:\/\/library\.municode\.com\/wa\/seattle\//);
    expect(h.published["code chapter"]).toBe("Chapter 23.49");
  });

  it("Denver: district, description with its double space collapsed, ordinance with year, no invented overlay", () => {
    const h = hitFor("denver", rows(denverPoint))!;
    expect(h.code).toBe("D-CV");
    expect(h.label).toBe("Downtown - Civic (D-CV)");
    expect(h.category).toBe("Commercial Mixed Use");
    expect(h.family).toBe("mixed");
    expect(h.overlays).toEqual([]);
    expect(h.ordinance).toBe("333 (2010)");
    expect(h.published["accessory dwelling units"]).toBe("No");
    expect(h.published.waivers).toBeUndefined();
  });

  it("New York: the district at the point, then the tax lot's ZTLDB row (both districts, the special district, the map)", () => {
    const h = hitFor("nyc", rows(nycPoint))!;
    expect(h.code).toBe("C6-4.5");
    const bbl = plutoBbl(rows(nycPluto));
    expect(bbl).toBe("1008350041");
    const full = withZtldb(h, rows(nycZtldb));
    expect(full.overlays).toEqual(["special district MiD"]);
    expect(full.published["districts on this tax lot"]).toBe("C5-3, C6-4.5");
    expect(full.published["zoning map"]).toBe("8D");
  });

  it("New York: a condominium's billing lot has no ZTLDB row, so DCP's layers at the point give its special district", () => {
    const h = hitFor("nyc", rows(condoPoint))!;
    expect(plutoBbl(rows(condoPluto))).toBe("1010107506");
    // The ZTLDB answers nothing for a 75xx lot; folding nothing in changes nothing, which the route must not report as "no overlays".
    expect(withZtldb(h, rows(condoZtldb))).toEqual(h);
    const full = withPointOverlays(h, rows(condoNysp), rows(condoNyco), rows(condoNylh), NYC_LOT_GAP.condo);
    expect(full.overlays).toEqual(["special district MiD"]);
    expect(full.published["special purpose district"]).toBe("Special Midtown District");
    expect(full.published["overlays from"]).toContain(NYC_LOT_GAP.condo);
  });

  it("New York: commercial overlays and limited-height districts from DCP's layers, as published (Brooklyn Heights)", () => {
    const h = { code: "R6", family: "residential" as const, overlays: [], published: {} };
    const full = withPointOverlays(h, [], rows(heightsNyco), rows(heightsNylh), NYC_LOT_GAP.noLot);
    expect(full.overlays).toEqual(["commercial overlay C1-3", "limited height LH-1"]);
    expect(full.published["special purpose district"]).toBeUndefined();
    const req = nycOverlayRequests(-73.994, 40.695);
    expect([req.sp, req.co, req.lh].map((r) => r.params.outFields)).toEqual(["SDLBL,SDNAME", "OVERLAY", "LHLBL,LHNAME"]);
  });

  it("New York: when nothing answers for the overlays they are unknown, never an empty list read as none", () => {
    const u = overlaysUnknown({ code: "C5-3", family: "commercial", overlays: [], published: {} }, NYC_LOT_GAP.lotDown);
    expect(u.published.overlays).toMatch(/^unknown, not absent: MapPLUTO did not answer this time/);
  });

  it("New York: MapPLUTO is asked for the BBL only, never the owner", () => {
    const req = arcgisPoint(NYC_PLUTO_LAYER, -73.9857, 40.7484, NYC_PLUTO_FIELDS);
    expect(req.params.outFields).toBe("BBL");
    expect(requestUrl(req)).not.toMatch(/owner/i);
    expect(plutoBbl([{ BBL: null }])).toBeNull();
    expect(plutoBbl([{ BBL: 0 }])).toBeNull();
  });

  it("Chicago: class, family, edit date; a PD number of 0 is not a planned development", () => {
    const h = hitFor("chicago", rows(chicagoPoint))!;
    expect(h.code).toBe("DC-16");
    expect(h.family).toBe("downtown");
    expect(h.caseNumber).toBe("32998");
    expect(h.editedAt).toBe("2026-08-26");
    expect(h.published["planned development"]).toBeUndefined();
  });

  it("Dallas: long district name, ordinance, effective date and case as published", () => {
    const h = hitFor("dallas", rows(dallasPoint))!;
    expect(h.code).toBe("CA-1(A)");
    expect(h.ordinance).toBe("29128");
    expect(h.effective).toBe("2021-01-27");
    expect(h.caseNumber).toBe("DCA 112-002");
    expect(h.family).toBe("coded");
  });

  it("San Antonio: a district with its UDC section; a blank case number stays blank", () => {
    const h = hitFor("sanantonio", rows(saPoint))!;
    expect(h.code).toBe("D");
    expect(h.label).toBe("Downtown District (Sec. 35-310.11)");
    expect(h.rightOfWay).toBe(false);
    expect(h.caseNumber).toBeUndefined();
  });

  it("San Antonio: UZROW twice at a street point is one right-of-way answer, not two districts", () => {
    const h = hitFor("sanantonio", rows(saRow))!;
    expect(h.code).toBe("UZROW");
    expect(h.rightOfWay).toBe(true);
    expect(h.family).toBe("right-of-way");
    expect(h.alsoHere).toBeUndefined();
  });

  it("Austin: a district inside a lot, nothing in the street", () => {
    expect(hitFor("austin", rows(austinPoint))!.code).toBe("CBD");
    expect(hitFor("austin", rows(austinRow))).toBeNull();
  });

  it("Los Angeles: the full Chapter 1A string and the city's description", () => {
    const h = hitFor("losangeles", rows(laPoint))!;
    expect(h.code).toBe("[LF1-WH1-5][P2-FA][CPIO]");
    expect(h.label).toBe("Public (Chapter 1A)");
    expect(h.family).toBe("public");
    expect(h.published["zone class"]).toBeUndefined();
  });

  it("San Francisco: district, its name and the planning code link", () => {
    const h = hitFor("sanfrancisco", rows(sfPoint))!;
    expect(h.code).toBe("P");
    expect(h.label).toBe("PUBLIC");
    expect(h.codeUrl).toMatch(/^https:\/\/codelibrary\.amlegal\.com\//);
    expect(h.published["planning code section"]).toBe("211");
  });
});

describe("records and states", () => {
  const place = (j: unknown) => parsePlace(rows(j));

  it("picks the city by the Census place under the point, never by a box", () => {
    expect(cityByGeoid(place(tigerHouston)?.geoid)?.id).toBe("houston");
    // Bellaire sits inside Houston's box and has its own zoning.
    expect(place(tigerBellaire)).toEqual({ geoid: "4807300", name: "Bellaire city" });
    expect(cityByGeoid(place(tigerBellaire)?.geoid)).toBeNull();
    // All five boroughs are one place.
    expect(cityByGeoid(place(tigerBrooklyn)?.geoid)?.id).toBe("nyc");
    expect(place(tigerNone)).toBeNull();
  });

  it("Houston says it has no zoning ordinance, positively", () => {
    const r = houstonRecord(-95.3698, 29.7604, place(tigerHouston)!);
    expect(r.state).toBe("no-ordinance");
    expect(r.note).toMatch(/no zoning ordinance/i);
    expect(r.code).toBeUndefined();
  });

  it("a place with no source is not covered, and says which place", () => {
    const r = notCoveredRecord(-95.4588, 29.7058, place(tigerBellaire));
    expect(r.state).toBe("not-covered");
    expect(r.note).toContain("Bellaire city");
    expect(notCoveredRecord(-98.9, 29.9, null).note).toMatch(/not inside an incorporated place/);
  });

  it("no polygon is 'no-district' and never reads as unzoned", () => {
    const r = cityRecord("austin", -97.7473, 30.2651, { geoid: "4805000", name: "Austin city" }, null);
    expect(r.state).toBe("no-district");
    expect(r.note).toMatch(/right-of-way/);
    expect(r.note).toMatch(/does not mean the land is unzoned/);
  });

  it("San Antonio's UZROW becomes the right-of-way state", () => {
    const r = cityRecord("sanantonio", -98.4946, 29.4244, { geoid: "4865000", name: "San Antonio city" }, hitFor("sanantonio", rows(saRow)));
    expect(r.state).toBe("right-of-way");
    expect(r.code).toBe("UZROW");
  });

  it("a district record carries the city, publisher and source", () => {
    const r = cityRecord("seattle", -122.3325, 47.6067, { geoid: "5363000", name: "Seattle city" }, hitFor("seattle", rows(seattlePoint)));
    expect(r).toMatchObject({ state: "district", city: "seattle", code: "DOC1 U/450-U", source: "seattle-zoning", publisher: "City of Seattle" });
  });
});

describe("requests", () => {
  it("every covered city has a point request; Houston none", () => {
    for (const id of ZONING_CITY_IDS) {
      const req = pointRequest(id, -100, 30);
      if (id === "houston") expect(req).toBeNull();
      else expect(req, id).not.toBeNull();
    }
  });

  it("asks every city for explicit fields, San Francisco included (on data.sf.gov, without its outline)", () => {
    for (const id of ZONING_CITY_IDS) {
      const req = pointRequest(id, -100, 30);
      if (!req) continue;
      const url = requestUrl(req);
      expect(url.includes("outFields=") || url.includes("%24select="), id).toBe(true);
      expect(url).not.toContain("outFields=*");
    }
    const sf = new URL(requestUrl(pointRequest("sanfrancisco", -122.4193, 37.7793)!));
    expect(sf.host).toBe("data.sf.gov");
    expect(sf.searchParams.get("$select")).not.toContain("the_geom");
  });

  it("draws outlines only where the service simplifies them on the server", () => {
    const b: [number, number, number, number] = [-100, 30, -99.99, 30.01];
    for (const id of ZONING_CITY_IDS) {
      const req = polygonRequest(id, b);
      expect(!!req, id).toBe(ZONING_CITIES[id].polygons);
      if (req) expect(requestUrl(req)).toMatch(/maxAllowableOffset|simplify_preserve_topology/);
    }
  });

  it("finds the cities a box meets", () => {
    expect(citiesInBox([-122.34, 47.6, -122.32, 47.62]).map((c) => c.id)).toEqual(["seattle"]);
    expect(citiesInBox([-90, 10, -89, 11])).toEqual([]);
  });
});

describe("outlines", () => {
  it("Seattle's ArcGIS outlines keep the object id, code and family", () => {
    const out = buildOutlines("seattle", fcOf(seattleOutlines));
    expect(out.length).toBeGreaterThan(5);
    expect(out[0].id).toMatch(/^seattle:\d+$/);
    expect(out.every((f) => f.properties.code && f.properties.city === "seattle")).toBe(true);
    expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
  });

  it("Chicago's Socrata outlines (no ids) get a stable id from code and first vertex", () => {
    const fc = fcOf(chicagoOutlines);
    const a = buildOutlines("chicago", fc);
    const b = buildOutlines("chicago", fc);
    expect(a.length).toBeGreaterThan(5);
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
    expect(a[0].id).toMatch(/^chicago:/);
    expect(a.every((f) => ["downtown", "planned", "commercial", "industrial", "residential", "public", "other"].includes(f.properties.family))).toBe(true);
  });

  it("San Francisco's Socrata outlines: code and family from the city's general category", () => {
    const out = buildOutlines("sanfrancisco", fcOf(sfOutlines));
    expect(out.length).toBe(13);
    expect(out[0].id).toMatch(/^sanfrancisco:/);
    expect(new Set(out.map((f) => f.properties.family))).toEqual(new Set(["commercial", "mixed", "public", "residential", "industrial"]));
    expect(out.find((f) => f.properties.code === "CMUO")?.properties.category).toBe("Mixed Use");
    const url = decodeURIComponent(requestUrl(polygonRequest("sanfrancisco", [-122.4175, 37.78, -122.3975, 37.795])!));
    expect(url).toMatch(/^https:\/\/data\.sf\.gov\/resource\/3i4a-hu95\.geojson\?/);
    expect(url).toContain("simplify_preserve_topology(the_geom,0.00003)");
  });

  it("drops rows with no geometry or no code", () => {
    const out = buildOutlines("nyc" as ZoningCityId, [
      { geometry: null, properties: { ZONEDIST: "R6" } },
      { geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { ZONEDIST: " " } },
      { id: 7, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { ZONEDIST: "R6" } },
    ]);
    expect(out.map((f) => f.id)).toEqual(["nyc:7"]);
  });
});
