import { describe, expect, it } from "vitest";
import { DIRECT_SOURCES, NWI_RASTER_TEMPLATE, RENDER_PRODUCTS, TERRARIUM_ATTRIBUTION, WHP_TEMPLATE, isRenderProduct, isSlrFeet, routeTileUrl } from "./products";
import { SOURCES } from "@/lib/provenance/sources";

describe("rendered products", () => {
  it("ask each publisher for the tile's projected box, in 3857, with the named raster function", () => {
    const slope = new URL(RENDER_PRODUCTS.slope.upstreamUrl(7420, 13575, 15));
    expect(slope.origin + slope.pathname).toBe("https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage");
    expect(slope.searchParams.get("bbox")).toBe("-10962904.34,3434162.81,-10961681.35,3435385.80");
    expect(slope.searchParams.get("bboxSR")).toBe("3857");
    // Rendered in 4326 the slope came back near-uniform in probing; 3857 only.
    expect(slope.searchParams.get("imageSR")).toBe("3857");
    expect(JSON.parse(slope.searchParams.get("renderingRule")!)).toEqual({ rasterFunction: "Slope Map" });
    const contours = new URL(RENDER_PRODUCTS.contours.upstreamUrl(7420, 13575, 15));
    expect(JSON.parse(contours.searchParams.get("renderingRule")!)).toEqual({ rasterFunction: "Preset 2ft Contour Interval" });
  });

  it("draw only FEMA's flood hazard zones (layer 28), never LOMAs (34) or LOMRs (1)", () => {
    const u = new URL(RENDER_PRODUCTS.floodmap.upstreamUrl(7418, 13579, 15));
    expect(u.searchParams.get("layers")).toBe("show:28");
    expect(u.searchParams.get("transparent")).toBe("true");
  });

  it("ask MRLC for NLCD 2021 in EPSG:3857", () => {
    const u = new URL(RENDER_PRODUCTS.landcover.upstreamUrl(233, 424, 10));
    expect(u.searchParams.get("LAYERS")).toBe("NLCD_2021_Land_Cover_L48");
    expect(u.searchParams.get("CRS")).toBe("EPSG:3857");
  });

  it("have sane zoom ranges and registered sources", () => {
    for (const p of Object.values(RENDER_PRODUCTS)) {
      expect(p.minZoom).toBeLessThanOrEqual(p.maxZoom);
      expect(SOURCES[p.source]).toBeDefined();
      expect(isRenderProduct(p.id)).toBe(true);
    }
    expect(isRenderProduct("constructor")).toBe(false);
    expect(isRenderProduct("toString")).toBe(false);
  });

  it("have one canonical tile URL each, so the edge caches one entry per tile", () => {
    expect(routeTileUrl("slope", 13, 1855, 3393)).toBe("/api/terrain?op=tile&product=slope&z=13&x=1855&y=3393");
  });
});

describe("direct sources", () => {
  it("name the host the browser fetches from", () => {
    for (const d of DIRECT_SOURCES) {
      expect(d.template.toLowerCase()).toContain(d.host);
      expect(SOURCES[d.source]).toBeDefined();
    }
  });

  it("ask WHP for the tile's projected box through the imagery provider's own tags, with the classified function", () => {
    for (const tag of ["{westProjected}", "{southProjected}", "{eastProjected}", "{northProjected}"]) expect(WHP_TEMPLATE).toContain(tag);
    expect(decodeURIComponent(WHP_TEMPLATE)).toContain('{"rasterFunction":"WHP_CLS_2023_8bit"}');
  });

  it("ask NWI's raster (Wetlands_Raster; v5 was retired) for the tile's projected box with 0 as NoData, so unmapped land draws clear", () => {
    for (const tag of ["{westProjected}", "{southProjected}", "{eastProjected}", "{northProjected}"]) expect(NWI_RASTER_TEMPLATE).toContain(tag);
    const u = new URL(NWI_RASTER_TEMPLATE.replace(/\{\w+\}/g, "0"));
    expect(u.pathname).toBe("/wetlandsmapservice/rest/services/Wetlands_Raster/ImageServer/exportImage");
    expect(u.searchParams.get("noData")).toBe("0");
    expect(u.searchParams.get("bboxSR")).toBe("3857");
    expect(DIRECT_SOURCES.find((d) => d.id === "wetlands")).toMatchObject({ host: "fwspublicservices.wim.usgs.gov", source: "usfws-nwi" });
  });

  it("offer only the sea level scenarios NOAA caches in whole feet", () => {
    expect(isSlrFeet(3)).toBe(true);
    expect(isSlrFeet(0)).toBe(false);
    expect(isSlrFeet(11)).toBe(false);
    expect(isSlrFeet("3")).toBe(false);
  });

  it("carry the terrain tiles' required attribution list", () => {
    expect(TERRARIUM_ATTRIBUTION).toHaveLength(11);
    expect(TERRARIUM_ATTRIBUTION.at(-1)).toMatch(/courtesy of the U\.S\. Geological Survey$/);
  });
});
