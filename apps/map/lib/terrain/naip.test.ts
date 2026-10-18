// NAIP by year on Planetary Computer answers captured 2026-10-16, unmodified: the STAC search
// at Des Moines (8 years), the 2023 registration, and the 404 bodies Planetary Computer sends
// for an id it does not hold (a tile asked with an empty id, and /info for an unknown id).
import { describe, expect, it } from "vitest";
import stac from "./fixtures/pc-stac-desmoines.json";
import reg2023 from "./fixtures/pc-register-2023.json";
import tile404 from "./fixtures/pc-tile-404.json";
import info404 from "./fixtures/pc-info-404.json";
import { isSearchIdNotFound, naipItemText, naipTiles, naipYears, parseNaipYear, parseSearchId, registerBody, resolveNaipYear, stacBody } from "./naip";
import { naipStyle } from "@/lib/globe/terrainStyles";
import { groundDetails } from "./ground";

describe("NAIP years at a point", () => {
  it("reads the 8 Des Moines years, oldest first, one item each, with the flight date in the item", () => {
    const y = naipYears(stac);
    expect(y.map((x) => x.year)).toEqual([2011, 2013, 2014, 2015, 2017, 2019, 2021, 2023]);
    expect(y[0].items).toEqual([{ id: expect.stringContaining("ia_m_4109328_nw_15"), date: "2011-07-18", gsd: expect.any(Number), state: "IA" }]);
    // The same item listed twice is kept once.
    const doubled = { features: [...(stac as { features: unknown[] }).features, ...(stac as { features: unknown[] }).features] };
    expect(naipYears(doubled).map((x) => x.items.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(naipItemText(y[7])).toBe("flown 2023-09-02, 0.3 m, IA (ia_m_4109328_nw_15_030_20230902_20240104)");
  });

  it("asks one search per point, a year only when filtering by one", () => {
    expect(stacBody(-93.62, 41.59)).toEqual({ collections: ["naip"], intersects: { type: "Point", coordinates: [-93.62, 41.59] }, limit: 100 });
    expect(stacBody(-93.62, 41.59, 2014).query).toEqual({ "naip:year": { eq: "2014" } });
  });

  it("draws the year asked (kept where it was not flown, so a link survives a pan), else the newest here", () => {
    const y = naipYears(stac);
    expect(resolveNaipYear(y, null)).toEqual({ year: 2023, present: true });
    expect(resolveNaipYear(y, 2014)).toEqual({ year: 2014, present: true });
    expect(resolveNaipYear(y, 2016)).toEqual({ year: 2016, present: false });
    expect(resolveNaipYear([], null)).toEqual({ year: null, present: false });
    expect(parseNaipYear("2009")).toBeNull();
    expect(parseNaipYear("2014")).toBe(2014);
    // This year at most: no year ahead is flown, so none is registered.
    expect(parseNaipYear("2026", new Date("2026-10-16T00:00:00Z"))).toBe(2026);
    expect(parseNaipYear("2027", new Date("2026-10-16T00:00:00Z"))).toBeNull();
  });
});

describe("the per-year mosaic", () => {
  it("registers naip:year as a string, reads the searchid, and never hard-codes one", () => {
    expect(JSON.stringify(registerBody(2023))).toContain('{"property":"naip:year"},"2023"');
    expect(parseSearchId(reg2023)).toBe("47390dd3950110f09a58e4678f4f6192");
    expect(parseSearchId({ searchid: "../x" })).toBeNull();
    expect(naipTiles("47390dd3950110f09a58e4678f4f6192")).toMatch(/\/mosaic\/47390dd3950110f09a58e4678f4f6192\/tiles\/WebMercatorQuad\/\{z\}\/\{x\}\/\{y\}@1x\?collection=naip/);
  });

  it("knows Planetary Computer's 'SearchId not found' 404 from any other answer", () => {
    expect(isSearchIdNotFound(404, tile404)).toBe(true);
    expect(isSearchIdNotFound(404, info404)).toBe(true);
    expect(isSearchIdNotFound(200, info404)).toBe(false);
    expect(isSearchIdNotFound(404, { detail: "Not Found" })).toBe(false);
  });

  it("asks no tile below level 11 and refuses a template from anywhere but the mosaic path", () => {
    const tiles = naipTiles("47390dd3950110f09a58e4678f4f6192");
    const spec = naipStyle.tiles?.({ meta: { naipYear: 2023, naipTiles: tiles } }) ?? [];
    expect(spec).toHaveLength(1);
    expect(spec[0]).toMatchObject({ floorLevel: 11, url: tiles, key: expect.stringMatching(/^naip:2023:/) });
    expect(naipStyle.tiles?.({ meta: { naipYear: 2023, naipTiles: "https://evil.example/{z}/{x}/{y}" } })).toBeNull();
    expect(naipStyle.tiles?.({ meta: { naipYear: null, naipTiles: tiles } })).toBeNull();
  });
});

describe("the NAIP ground answer", () => {
  it("gives the drawn year's flight date first, then the other years here", () => {
    const years = naipYears(stac);
    const d = groundDetails({ lon: -93.62, lat: 41.59, parts: { naip: { loading: false, data: { years, year: 2014 } } } });
    expect(d["aerial photograph (NAIP)"]).toMatch(/^2014: flown 2014-10-11/);
    expect(d["other NAIP years here"]).toBe("2011, 2013, 2015, 2017, 2019, 2021, 2023");
    const none = groundDetails({ lon: -150, lat: 20, parts: { naip: { loading: false, data: { years: [], year: null } } } });
    expect(none["aerial photograph (NAIP)"]).toMatch(/^no NAIP photograph here/);
  });
});
