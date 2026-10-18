import { describe, expect, it } from "vitest";
import samples from "./fixtures/terrarium-samples.json";
import {
  bboxParam,
  bilinear,
  decodeTerrarium,
  hexRgb,
  inkToTint,
  lonLatToTile,
  pixelMetres,
  shadeToAlpha,
  terrariumHeight,
  tileBbox3857,
  tileBoundsDeg,
  validTile,
  WM_HALF,
} from "./webmercator";

describe("Web Mercator tiles", () => {
  it("level 0 is the whole square, and a tile's box is what ArcGIS was asked for in probing", () => {
    expect(tileBbox3857(0, 0, 0)).toEqual([-WM_HALF, -WM_HALF, WM_HALF, WM_HALF]);
    // The 3DEP slope render probed on 2026-09-26 over Brackenridge Park (z15 tile 7420/13575).
    expect(bboxParam(7420, 13575, 15)).toBe("-10962904.34,3434162.81,-10961681.35,3435385.80");
  });

  it("puts each probed point in the tile and pixel it was read from", () => {
    for (const p of samples.points) {
      const [fx, fy] = lonLatToTile(p.lon, p.lat, p.z);
      const [z, x, y] = p.tile.split("/").map(Number);
      expect(z).toBe(p.z);
      expect(Math.floor(fx)).toBe(x);
      expect(Math.floor(fy)).toBe(y);
      expect(Math.min(255, Math.floor((fx - x) * 256))).toBe(p.px);
      expect(Math.min(255, Math.floor((fy - y) * 256))).toBe(p.py);
    }
  });

  it("round-trips a tile's degree bounds through lonLatToTile", () => {
    const [w, s, e, n] = tileBoundsDeg(7420, 13575, 15);
    const [x0, y0] = lonLatToTile(w, n, 15);
    const [x1, y1] = lonLatToTile(e, s, 15);
    expect(x0).toBeCloseTo(7420, 9);
    expect(y0).toBeCloseTo(13575, 9);
    expect(x1).toBeCloseTo(7421, 9);
    expect(y1).toBeCloseTo(13576, 9);
  });

  it("accepts whole tiles inside their level only", () => {
    expect(validTile(15, 7420, 13575)).toBe(true);
    expect(validTile(1, 2, 0)).toBe(false);
    expect(validTile(3, -1, 0)).toBe(false);
    expect(validTile(3, 1.5, 0)).toBe(false);
    expect(validTile(25, 0, 0)).toBe(false);
  });

  it("sizes a pixel: about 4.2 m for a z15 256 px tile at 29.46° N", () => {
    expect(pixelMetres(15, 29.461)).toBeCloseTo(4.16, 2);
    expect(pixelMetres(14, 0, 512)).toBeCloseTo(pixelMetres(15, 0, 256), 9);
  });
});

describe("terrarium heights", () => {
  it("decodes R·256 + G + B/256 − 32768", () => {
    expect(terrariumHeight(128, 205, 122)).toBe(205.4765625);
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    // Below sea level stays below: the formula never clamps (only the globe's drawing does).
    expect(terrariumHeight(127, 170, 0)).toBe(-86);
  });

  it("agrees with USGS EPQS within 2.5 m at every probed point (z12 and z15)", () => {
    for (const p of samples.points) {
      const [r, g, b] = p.rgb;
      expect(Math.abs(terrariumHeight(r, g, b) - p.epqsMetres), `${p.name} z${p.z}`).toBeLessThan(2.5);
    }
  });

  it("decodes a real 16 × 16 crop into a smooth surface, and bilinear returns pixel centres exactly", () => {
    const rgb = Buffer.from(samples.crop.rgbBase64, "base64");
    const rgba = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 256; i++) rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
    const h = decodeTerrarium(rgba, 16, 16);
    expect(h).toHaveLength(256);
    for (const v of h) {
      expect(v).toBeGreaterThan(195);
      expect(v).toBeLessThan(215);
    }
    expect(bilinear(h, 16, 16, 3.5, 7.5)).toBeCloseTo(h[7 * 16 + 3], 5);
    // Halfway between two pixel centres is their mean.
    expect(bilinear(h, 16, 16, 4, 7.5)).toBeCloseTo((h[7 * 16 + 3] + h[7 * 16 + 4]) / 2, 5);
    // Outside the grid the edge holds.
    expect(bilinear(h, 16, 16, -3, -3)).toBeCloseTo(h[0], 5);
  });
});

describe("inkToTint", () => {
  it("turns black-on-paper line art into tinted lines on transparent", () => {
    // 3DEP's contour render: #FDFDFD paper, #010101 ink, fully opaque.
    const px = new Uint8ClampedArray([253, 253, 253, 255, 1, 1, 1, 255, 128, 128, 128, 255]);
    inkToTint(px, hexRgb("#F3E3A6"));
    expect([...px.slice(0, 4)]).toEqual([0xf3, 0xe3, 0xa6, 0]);
    expect([...px.slice(4, 8)]).toEqual([0xf3, 0xe3, 0xa6, 254]);
    expect(px[11]).toBeGreaterThan(100);
    expect(px[11]).toBeLessThan(140);
  });

  it("shadeToAlpha keeps only a hillshade's shading, as a multiply", () => {
    // USGS relief pixels as probed on 2026-09-26: white, the flat 244 of open ocean, flat Kansas (252), a deep shadow, black.
    const px = new Uint8ClampedArray([255, 255, 255, 255, 244, 244, 244, 255, 252, 252, 252, 255, 130, 130, 130, 255, 0, 0, 0, 255]);
    shadeToAlpha(px);
    for (let i = 0; i < px.length; i += 4) expect([...px.slice(i, i + 3)]).toEqual([0, 0, 0]);
    expect([px[3], px[7], px[11], px[15], px[19]]).toEqual([0, 11, 3, 125, 255]);
  });

  it("parses #RRGGBB and refuses anything else", () => {
    expect(hexRgb("#5EF2C2")).toEqual([0x5e, 0xf2, 0xc2]);
    expect(() => hexRgb("red")).toThrow();
  });
});
