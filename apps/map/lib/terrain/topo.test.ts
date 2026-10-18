// The USGS historical topographic maps: the point query and the TNM match,
// from responses captured 2026-10-13 at San Francisco (-122.42, 37.77): the
// HTMC ImageServer point query (31 sheets) and TNM Access for the box
// around it (39 products). Unmodified.
import { describe, expect, it } from "vitest";
import htmc from "./fixtures/htmc-point-sf.json";
import tnm from "./fixtures/tnm-htmc-sf.json";
import { HTMC_FIELDS, parseHtmcSheets, parseTopoYear, resolveTopoYear, sheetText, tnmFiles, topoMosaicRule, topoTiles, topoYears, withTnmFiles, yearLabel } from "./topo";

describe("the sheets under a point", () => {
  it("reads every sheet, newest edition first, and lists each edition year once with its scales", () => {
    const sheets = parseHtmcSheets(htmc);
    expect(sheets).toHaveLength(31);
    expect(sheets[0].year).toBe(1995);
    const years = topoYears(sheets);
    expect(years.map((y) => y.year)).toEqual([1895, 1899, 1915, 1947, 1950, 1956, 1957, 1960, 1961, 1964, 1968, 1973, 1978, 1993, 1995]);
    for (let i = 1; i < years.length; i++) expect(years[i].year).toBeGreaterThan(years[i - 1].year);
    const y1956 = years.find((y) => y.year === 1956)!;
    expect(y1956.scales).toEqual([...y1956.scales].sort((a, b) => a - b));
    expect(sheets[0].surveyYear).toBeNull();
    expect(sheets[0].citation).toMatch(/^U\.S\. Geological Survey, San Francisco North \[map\], 1:24000/);
  });

  it("drops a row with no edition year rather than giving it one", () => {
    const j = htmc as unknown as { features: Array<{ attributes: Record<string, unknown> }> };
    const edited = { features: [{ attributes: { ...j.features[0].attributes, DateCurrent: null } }, ...j.features.slice(1)] };
    expect(parseHtmcSheets(edited)).toHaveLength(30);
    expect(parseHtmcSheets(null)).toEqual([]);
  });

  it("gives each sheet the GeoPDF and GeoTIFF TNM lists for the same scan, and null where TNM has none", () => {
    const files = tnmFiles(tnm);
    const sheets = withTnmFiles(parseHtmcSheets(htmc), files);
    const hit = sheets.filter((s) => s.geotiff);
    expect(hit).toHaveLength(30);
    for (const s of hit) {
      expect(s.geotiff).toMatch(new RegExp(`^https://prd-tnm\\.s3\\.amazonaws\\.com/.*_${s.scanId}_\\d{4}_\\d+_geo\\.tif$`));
      expect(s.geopdf).toMatch(/^https:\/\/prd-tnm\.s3\.amazonaws\.com\/.*_geo\.pdf$/);
    }
    const miss = sheets.find((s) => s.scanId === 300060)!;
    expect(miss.geotiff).toBeNull();
    expect(miss.geopdf).toBeNull();
    // TNM down: the sheets stand, without links.
    expect(withTnmFiles(parseHtmcSheets(htmc), null).every((s) => s.geotiff === null && s.geopdf === null)).toBe(true);
  });

  it("never asks for every field, nor for the dead GeoPDF link", () => {
    expect(HTMC_FIELDS).not.toContain("*");
    expect(HTMC_FIELDS).not.toContain("Download_GeoPDF");
  });
});

describe("the edition to draw", () => {
  const years = topoYears(parseHtmcSheets(htmc));
  it("draws the newest edition at the centre unless a year is asked for", () => {
    expect(resolveTopoYear(years, null)).toEqual({ year: 1995, present: true, nearest: [] });
    expect(resolveTopoYear(years, 1956)).toEqual({ year: 1956, present: true, nearest: [] });
    expect(resolveTopoYear([], null)).toEqual({ year: null, present: false, nearest: [] });
  });

  it("keeps a year the centre has no sheet for, and names the nearest editions", () => {
    expect(resolveTopoYear(years, 1910)).toEqual({ year: 1910, present: false, nearest: [1899, 1915] });
  });

  it("accepts only whole years inside 1879-2006", () => {
    expect(parseTopoYear("1895")).toBe(1895);
    expect(parseTopoYear(1878)).toBeNull();
    expect(parseTopoYear("2007")).toBeNull();
    expect(parseTopoYear("1895.5")).toBeNull();
    expect(parseTopoYear("")).toBeNull();
  });
});

describe("the tile template", () => {
  it("filters Esri's mosaic to one edition, most detailed scale on top, encoded so only the provider's tokens are braces", () => {
    const rule = JSON.parse(topoMosaicRule(1895));
    expect(rule).toEqual({ mosaicMethod: "esriMosaicAttribute", sortField: "Map_Scale", sortValue: "0", ascending: true, where: "Category=1 AND DateCurrent=1895" });
    const t = topoTiles(1895);
    expect(t).toMatch(/^https:\/\/historical1\.arcgis\.com\/arcgis\/rest\/services\/USGS_Historical_Topographic_Maps\/ImageServer\/exportImage\?/);
    expect(t.match(/\{(\w+)\}/g)).toEqual(["{westProjected}", "{southProjected}", "{eastProjected}", "{northProjected}"]);
    expect(decodeURIComponent(new URL(t.replace(/\{\w+\}/g, "0")).searchParams.get("mosaicRule")!)).toContain("DateCurrent=1895");
    expect(t).toContain("format=jpgpng");
  });

  it("labels the picker and the dossier lines", () => {
    expect(yearLabel({ year: 1956, scales: [24000, 62500] })).toBe("1956 (1:24,000, 1:62,500)");
    const s = parseHtmcSheets(htmc)[0];
    expect(sheetText(s)).toBe("San Francisco North · 1:24,000 · 1995 edition (printed 1999)");
  });
});
