// Landslide susceptibility (USGS 2024), the picture layer: its direct source, its style, its place
// among the ground layers and its ground lines. lsus-tile-z12.png is a tile captured 2026-10-17
// (unmodified); lsus-tile-z12.hdr.txt is that response's headers with CRLF turned into LF.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIRECT_SOURCES, LANDSLIDE_SUSC_LEGEND, LANDSLIDE_SUSC_MAX_ZOOM, LANDSLIDE_SUSC_TILES } from "./products";
import { GROUND_LAYERS, TERRAIN_LAYERS } from "@/lib/layers/terrain";
import { landslideGroundLines, partsFor } from "./ground";
import { SOURCES } from "@/lib/provenance/sources";

describe("the direct source", () => {
  it("is USGS's tile cache on tiles.arcgis.com, to level 12, credited to the CC0 release", () => {
    const d = DIRECT_SOURCES.find((x) => x.id === "landslidesusc")!;
    expect(d).toMatchObject({ host: "tiles.arcgis.com", maxZoom: 12, source: "usgs-landslide-susc" });
    expect(d.template).toBe(LANDSLIDE_SUSC_TILES);
    expect(LANDSLIDE_SUSC_MAX_ZOOM).toBe(12);
    expect(SOURCES["usgs-landslide-susc"].license).toMatch(/^CC0 1\.0/);
    expect(SOURCES["usgs-landslide-susc"].url).toBe("https://doi.org/10.5066/P13KAGU3");
  });

  it("serves PNG bytes as application/octet-stream with nosniff (the iPhone Safari check is on the preview)", () => {
    const png = readFileSync(path.resolve(__dirname, "fixtures/lsus-tile-z12.png"));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const hdr = readFileSync(path.resolve(__dirname, "fixtures/lsus-tile-z12.hdr.txt"), "utf8");
    expect(hdr).toMatch(/^content-type: application\/octet-stream$/m);
    expect(hdr).toMatch(/^x-content-type-options: nosniff$/m);
  });
});

describe("the picture", () => {
  it("is a picture layer beside firehazard, never asks past level 12, and draws USGS's colours as published", async () => {
    const { landslidesuscStyle, TILE_Z } = await import("@/lib/globe/terrainStyles");
    const specs = landslidesuscStyle.tiles?.({}) ?? [];
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ key: "landslidesusc", kind: "xyz", url: LANDSLIDE_SUSC_TILES, tileSize: 512, maximumLevel: 12, floorLevel: 1, nearest: true, z: TILE_Z.landslidesusc });
    expect(specs[0].ink).toBeUndefined();
    expect(specs[0].shade).toBeUndefined();
    const ids = TERRAIN_LAYERS.map((l) => l.id);
    expect(ids.indexOf("landslidesusc")).toBe(ids.indexOf("firehazard") + 1);
    expect(LANDSLIDE_SUSC_LEGEND).toMatch(/^Classes 1-5 as USGS's tile service draws them/);
    expect(LANDSLIDE_SUSC_LEGEND).not.toMatch(/very (low|high)|risk/i);
  });

  it("is a ground layer: a click asks for the county's landslide line", () => {
    expect(GROUND_LAYERS).toContain("landslidesusc");
    expect(partsFor({ landslidesusc: true })).toEqual(["landslidesusc"]);
  });
});

describe("the ground lines", () => {
  it("say the county's share, the inventory count and its caveat; never a class under the click", () => {
    const d = landslideGroundLines({ fips: "48453", name: "Travis County", state: "TX", landslide: { prop_susc: 0.361441295, susc_area: 936.4637326, county_area: 2590.915166, v2_ls_count: 1, v2_density: 0.001067847 }, missing: [] });
    expect(d["landslide susceptibility"]).toBe("36.1 % of Travis County, TX is susceptible terrain (USGS 2024, 936 of 2,591 km2 of land)");
    expect(d["mapped landslides (USGS inventory v2)"]).toMatch(/^1 in the county's susceptible terrain \(mapping effort varies by state/);
    expect(JSON.stringify(d)).not.toMatch(/class \d/);
  });
  it("say why a county has none", () => {
    expect(landslideGroundLines({ fips: "09110", name: "Capitol Planning Region", state: "CT", landslide: null, missing: [{ source: "USGS landslide susceptibility", reason: "join:legacy_ct_counties" }] })["landslide susceptibility"]).toMatch(/Connecticut's old counties/);
    expect(landslideGroundLines({ fips: "02063", name: "Chugach Census Area", state: "AK", landslide: null, missing: [{ source: "USGS landslide susceptibility", reason: "join:boundary_changed_since_2010" }] })["landslide susceptibility"]).toMatch(/boundary changed since/);
    expect(landslideGroundLines(null)["landslide susceptibility"]).toBe("no county here");
  });
});
