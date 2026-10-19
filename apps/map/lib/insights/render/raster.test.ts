// The PNG path: the flagship's SVG rasterised by resvg-wasm with the vendored
// Geist files as its only fonts. Cross-OS PNG byte identity is not claimed,
// so these tests assert properties of the decoded pixels, not bytes: the
// signature and sizes, the subject's colour at its bubble's centre, enough
// ink in the headline band to prove the fonts loaded (resvg given no fonts
// draws no text at all), weights 400, 700 and 900 drawn by three distinct
// faces, every text run's ink inside the box the layout measured for it and
// filling most of it, clear space between legend items, and initialisation that
// survives a hot reload and retries after a failure.
//
// Preview PNGs for a visual review are written, not asserted, with:
//   INSIGHTS_PNG_OUT=<dir> npx vitest run lib/insights/render/raster.test.ts
// (bubble-social-dark.png, bubble-social-light.png, bubble-og-dark.png).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { initWasm } from "@resvg/resvg-wasm";
import { describe, expect, it } from "vitest";
import { escapeXml } from "@/lib/feed/hash";
import config from "@/next.config";
import FIXTURE from "./fixtures/flagship-qcew-2019-2023.json";
import type { CanvasId } from "./canvas";
import { layoutBubble } from "./charts/bubble";
import { textBox } from "./frame";
import { measure } from "./metrics";
import { FONT_FILES, PNG_WIDTH, WASM_FILE, ensureResvg, forgetResvgInit, toPng } from "./raster";
import { renderChart, renderSvg } from "./render";
import { textNodes, type TextNode } from "./scene";
import { parseChartSpec, type BubbleSpec } from "./spec";
import { PALETTES, hexToRgb, type Theme } from "./tokens";

const SPEC = parseChartSpec(FIXTURE) as BubbleSpec;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type Rgb = [number, number, number];

interface Decoded {
  width: number;
  height: number;
  /** RGB, 3 bytes a pixel, rows top to bottom. */
  rgb: Uint8Array;
}

/** IHDR width and height, without decoding the image. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** A minimal PNG decoder for what resvg writes: 8-bit RGB or RGBA, not interlaced. Alpha is dropped (every chart paints an opaque background). */
function decodePng(png: Uint8Array): Decoded {
  expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === "IHDR") {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      const [depth, colour, , , interlace] = png.subarray(off + 16, off + 21);
      expect([depth, interlace]).toEqual([8, 0]);
      expect([2, 6]).toContain(colour);
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const img = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? img[row + i - channels] : 0;
      const b = y > 0 ? img[row - stride + i] : 0;
      const c = y > 0 && i >= channels ? img[row - stride + i - channels] : 0;
      const pred = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      img[row + i] = (raw[src + i] + pred) & 0xff;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) rgb.set(img.subarray(p * channels, p * channels + 3), p * 3);
  return { width, height, rgb };
}

function pixel(d: Decoded, x: number, y: number): Rgb {
  const i = (Math.floor(y) * d.width + Math.floor(x)) * 3;
  return [d.rgb[i], d.rgb[i + 1], d.rgb[i + 2]];
}

/** CIE L*a*b* (D65) of an sRGB colour. */
function lab(rgb: Rgb): Rgb {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb.map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference. */
function deltaE(p: Rgb, q: Rgb): number {
  const [a, b] = [lab(p), lab(q)];
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Ink: a channel more than 48 levels off the background. The grain moves a pixel at most 0.08 of the way to its speck colour (about 20 levels). */
function isInk(p: Rgb, bg: Rgb): boolean {
  return Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2])) > 48;
}

function inkIn(d: Decoded, bg: Rgb, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(d.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(d.width, Math.ceil(x1)); x++) if (isInk(pixel(d, x, y), bg)) n++;
  }
  return n;
}

const rendered = new Map<string, Promise<{ png: Uint8Array<ArrayBuffer>; svg: string }>>();
function png(canvas: CanvasId, theme: Theme, width: number) {
  const key = `${canvas}|${theme}|${width}`;
  let p = rendered.get(key);
  if (!p) {
    const svg = renderSvg(SPEC, canvas, theme);
    p = toPng(svg, width).then((bytes) => ({ png: bytes, svg }));
    rendered.set(key, p);
  }
  return p;
}

describe("toPng", () => {
  it("writes a PNG: the signature, then IHDR", async () => {
    const { png: bytes } = await png("social", "dark", PNG_WIDTH.social);
    expect([...bytes.subarray(0, 8)]).toEqual(SIGNATURE);
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe("IHDR");
  });

  it("draws the social card at 1080 x 1350, the download at 2160 x 2700 and the OG card at 1200 x 630", async () => {
    expect(PNG_WIDTH).toEqual({ social: 1080, download: 2160, og: 1200 });
    expect(pngSize((await png("social", "dark", 1080)).png)).toEqual({ width: 1080, height: 1350 });
    expect(pngSize((await png("social", "dark", 2160)).png)).toEqual({ width: 2160, height: 2700 });
    expect(pngSize((await png("og", "dark", 1200)).png)).toEqual({ width: 1200, height: 630 });
  });

  it("rasterises the same SVG at 2160 as at 1080, not a second layout", async () => {
    const a = await png("social", "dark", 1080);
    const b = await png("social", "dark", 2160);
    expect(b.svg).toBe(a.svg);
    const small = decodePng(a.png);
    const big = decodePng(b.png);
    const austin = layoutBubble(SPEC, "social", "dark").marks.find((m) => m.subject) as { cx: number; cy: number };
    expect(deltaE(pixel(big, austin.cx * 2, austin.cy * 2), pixel(small, austin.cx, austin.cy))).toBeLessThan(3);
  });

  it("fills Austin's bubble with the subject accent on dark: the centre pixel within deltaE 10", async () => {
    for (const [canvas, width] of [["social", 1080], ["og", 1200]] as Array<[CanvasId, number]>) {
      const d = decodePng((await png(canvas, "dark", width)).png);
      const austin = layoutBubble(SPEC, canvas, "dark").marks.find((m) => m.id === "C1242") as { cx: number; cy: number; subject: boolean };
      expect(austin.subject).toBe(true);
      const at = pixel(d, austin.cx, austin.cy);
      expect(deltaE(at, hexToRgb(PALETTES.dark.signal)), `${canvas} centre ${at.join(",")}`).toBeLessThan(10);
    }
  });

  it("draws the headline with the vendored fonts: over 20,000 ink pixels in the headline band", async () => {
    for (const [canvas, width] of [["social", 1080], ["og", 1200]] as Array<[CanvasId, number]>) {
      const d = decodePng((await png(canvas, "dark", width)).png);
      const head = layoutBubble(SPEC, canvas, "dark").frame.runs.filter((r) => r.node.role === "headline").map((r) => textBox(r.node));
      const x0 = Math.min(...head.map((b) => b.x));
      const y0 = Math.min(...head.map((b) => b.y));
      const x1 = Math.max(...head.map((b) => b.x + b.w));
      const y1 = Math.max(...head.map((b) => b.y + b.h));
      expect(inkIn(d, hexToRgb(PALETTES.dark.bg), x0, y0, x1, y1), canvas).toBeGreaterThan(20000);
    }
  });

  it("returns bytes a Response can carry as they are", async () => {
    const svg = renderSvg(SPEC, "og", "dark");
    const res = new Response(await toPng(svg, 1080), { headers: { "content-type": "image/png" } });
    const back = new Uint8Array(await res.arrayBuffer());
    expect([...back.subarray(0, 8)]).toEqual(SIGNATURE);
    expect(pngSize(back)).toEqual({ width: 1080, height: 567 });
  });

  it("refuses a width that is not a whole number of px from 1 to 4096", async () => {
    const svg = renderSvg(SPEC, "og", "dark");
    await expect(toPng(svg, 0)).rejects.toThrow(/PNG width/);
    await expect(toPng(svg, 1080.5)).rejects.toThrow(/PNG width/);
    await expect(toPng(svg, 8192)).rejects.toThrow(/PNG width/);
  });
});

describe("metrics against the font as rasterised", () => {
  /** One run alone on a black card at its own size, weight and spacing, x at `pad`. */
  function runSvg(t: TextNode, pad: number): { svg: string; width: number } {
    const width = Math.ceil(t.width + 2 * pad);
    const height = Math.ceil(t.size * 2);
    const ls = t.letterSpacing ? ` letter-spacing="${t.letterSpacing}"` : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Geist,system-ui,sans-serif"><rect width="${width}" height="${height}" fill="#000000"/><text x="${pad}" y="${t.size * 1.3}" font-size="${t.size}" font-weight="${t.weight}"${ls} fill="#ffffff">${escapeXml(t.text)}</text></svg>`;
    return { svg, width };
  }

  /** Left and right ink columns (right exclusive) of a run rasterised alone at `pad`. */
  async function inkSpan(t: TextNode, pad: number): Promise<{ left: number; right: number }> {
    const { svg, width } = runSvg(t, pad);
    const d = decodePng(await toPng(svg, width));
    const black: Rgb = [0, 0, 0];
    let left = Infinity;
    let right = -Infinity;
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        if (!isInk(pixel(d, x, y), black)) continue;
        if (x < left) left = x;
        if (x + 1 > right) right = x + 1;
      }
    }
    return { left, right };
  }

  it("maps weights 400, 700 and 900 to three distinct faces, each inking 90-100 % of its own measured width", async () => {
    const L = layoutBubble(SPEC, "social", "dark");
    const samples = [L.frame.runs.find((r) => r.node.role === "headline")?.node, L.frame.runs.find((r) => r.node.role === "legend" && r.node.text.startsWith("Bubble size"))?.node, textNodes(L.nodes).find((t) => t.text === "Austin")] as TextNode[];
    expect(samples.every(Boolean)).toBe(true);
    for (const s of samples) {
      const inks: number[] = [];
      for (const weight of [400, 700, 900] as const) {
        const t: TextNode = { ...s, weight, width: measure(s.text, s.size, weight, s.letterSpacing ?? 0) };
        const { left, right } = await inkSpan(t, 16);
        const ink = right - left;
        expect(ink / t.width, `"${s.text}" at ${weight}`).toBeGreaterThan(0.9);
        expect(ink / t.width, `"${s.text}" at ${weight}`).toBeLessThanOrEqual(1);
        inks.push(ink);
      }
      // A weight that fell back to a neighbouring face would ink the same width as that face.
      expect(inks[1], `"${s.text}" Bold wider than Regular`).toBeGreaterThan(inks[0]);
      expect(inks[2], `"${s.text}" Black wider than Bold`).toBeGreaterThan(inks[1]);
    }
  });

  it("keeps every unrotated text run's ink inside its measured width (headline, legend, ticks, notes, labels)", async () => {
    const seen = new Set<string>();
    const runs: TextNode[] = [];
    for (const canvas of ["social", "og"] as CanvasId[]) {
      const L = layoutBubble(SPEC, canvas, "dark");
      for (const t of [...textNodes(L.frame.over), ...textNodes(L.nodes)]) {
        const key = `${t.text}|${t.size}|${t.weight}|${t.letterSpacing ?? 0}`;
        if (t.rotate || seen.has(key)) continue;
        seen.add(key);
        runs.push(t);
      }
    }
    expect(runs.map((t) => t.role)).toEqual(expect.arrayContaining(["headline", "legend", "tick", "source", "brand", "permalink", "label", "axis-title"]));
    const pad = 16;
    for (const t of runs) {
      const { left, right } = await inkSpan(t, pad);
      expect(right, `no ink for "${t.text}": the font did not load`).toBeGreaterThan(left);
      // Antialiasing may tint one pixel column past the outline.
      expect(right, `"${t.text}" ${t.size}/${t.weight} ink ends past its measured ${t.width.toFixed(2)} px`).toBeLessThanOrEqual(pad + t.width + 1);
      expect(left, `"${t.text}" ink starts left of its anchor`).toBeGreaterThanOrEqual(pad - 2);
      // Nor is a box measured much wider than its text: side bearings and the 3 % pad leave ink at 91-97 %.
      expect((right - left) / t.width, `"${t.text}" ${t.size}/${t.weight} inks too little of its measured width`).toBeGreaterThan(0.88);
    }
  });

  it.each([["social", 1080], ["og", 1200]] as Array<[CanvasId, number]>)("leaves clear space between legend items on a row, wrapping rather than overlapping (%s)", async (canvas, width) => {
    const r = renderChart(SPEC, canvas, "dark");
    const frame = r.layout.frame;
    const legend = frame.runs.filter((x) => x.node.role === "legend").map((x) => x.node);
    const glyphs = frame.over.filter((n) => n.type === "circle");
    const rows = new Map<number, TextNode[]>();
    for (const t of legend) rows.set(t.y, [...(rows.get(t.y) ?? []), t]);
    expect(rows.size).toBeGreaterThan(1); // the four items do not fit one row, so they wrap
    const band = { x0: frame.canvas.margin, x1: frame.canvas.width - frame.canvas.margin };
    const d = decodePng((await png(canvas, "dark", width)).png);
    const bg = hexToRgb(PALETTES.dark.bg);
    let gaps = 0;
    for (const items of rows.values()) {
      items.sort((a, b) => a.x - b.x);
      for (const t of items) {
        const b = textBox(t);
        expect(b.x).toBeGreaterThanOrEqual(band.x0);
        expect(b.x + b.w).toBeLessThanOrEqual(band.x1);
      }
      for (let i = 1; i < items.length; i++) {
        const prev = textBox(items[i - 1]);
        const next = textBox(items[i]);
        const glyph = glyphs.filter((g) => g.type === "circle" && g.cy > next.y && g.cy < next.y + next.h && g.cx > prev.x + prev.w && g.cx < next.x);
        const nextStart = Math.min(next.x, ...glyph.map((g) => (g.type === "circle" ? g.cx - g.r - (g.strokeWidth ?? 0) : Infinity)));
        expect(nextStart - (prev.x + prev.w), `gap before "${items[i].text}"`).toBeGreaterThan(8);
        expect(inkIn(d, bg, prev.x + prev.w + 1, prev.y, nextStart - 1, prev.y + prev.h), `ink between "${items[i - 1].text}" and "${items[i].text}"`).toBe(0);
        gaps++;
      }
    }
    expect(gaps).toBeGreaterThan(0);
  });
});

describe("deployment", () => {
  it("traces the wasm and every font raster.ts reads into the /insights/** functions", () => {
    const include = config.outputFileTracingIncludes?.["/insights/**"] ?? [];
    expect(include).toContain(`./${WASM_FILE}`);
    const fontGlob = include.find((p) => p.endsWith("*.ttf")) as string;
    expect(fontGlob).toBe("./lib/insights/render/fonts/*.ttf");
    const dir = fontGlob.slice(2, fontGlob.lastIndexOf("/"));
    for (const f of FONT_FILES) {
      expect(path.posix.dirname(f)).toBe(dir);
      expect(existsSync(path.join(process.cwd(), f)), f).toBe(true);
    }
    expect(existsSync(path.join(process.cwd(), WASM_FILE))).toBe(true);
  });
});

describe("initialisation", () => {
  it("keeps drawing after a hot reload finds resvg already initialised", async () => {
    await toPng(renderSvg(SPEC, "og", "dark"), 120);
    // The package is initialised for this process: a second initWasm throws, as it does after a hot reload.
    await expect(initWasm(await readFile(path.join(process.cwd(), WASM_FILE)))).rejects.toThrow(/Already initialized/);
    forgetResvgInit();
    const bytes = await toPng(renderSvg(SPEC, "og", "dark"), 120);
    expect([...bytes.subarray(0, 8)]).toEqual(SIGNATURE);
  });

  it("forgets a failed initialisation, so the next call tries again", async () => {
    forgetResvgInit();
    await expect(ensureResvg(() => Promise.reject(new Error("wasm file missing")))).rejects.toThrow("wasm file missing");
    await expect(ensureResvg()).resolves.toBeUndefined();
    const bytes = await toPng(renderSvg(SPEC, "og", "dark"), 120);
    expect(pngSize(bytes)).toEqual({ width: 120, height: 63 });
  });
});

const OUT = process.env.INSIGHTS_PNG_OUT;
describe.runIf(OUT)("previews", () => {
  it("writes the social and OG PNGs for a visual review", async () => {
    const dir = path.resolve(OUT as string);
    mkdirSync(dir, { recursive: true });
    for (const [canvas, theme, width] of [["social", "dark", 1080], ["social", "light", 1080], ["og", "dark", 1200]] as Array<[CanvasId, Theme, number]>) {
      writeFileSync(path.join(dir, `bubble-${canvas}-${theme}.png`), (await png(canvas, theme, width)).png);
    }
  });
});
