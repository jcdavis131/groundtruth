// The frame on the committed QCEW fixture: every text run inside its column on
// the social and OG canvases, the bottom-up stack in order, fixed-step
// gridlines, the bottom-left corner's tick labels never crowding (one
// dropped when they repeat, the y one lifted when they differ), the font set
// only on the root of an inline SVG, and the same
// bytes for the same spec in any input order.

import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/qcew-metro-job-growth-2019-2023.json";
import { CANVASES, type CanvasId } from "./canvas";
import { BRAND, axesFor, frameSvg, layoutFrame, legendItems, permalink, sourceParagraphs, textBox, type Frame, type TextRun } from "./frame";
import { capHeight } from "./metrics";
import { boxesOverlap } from "./place";
import { textSpan } from "./scene";
import { parseChartSpec, type BubbleSpec } from "./spec";
import { THEMES } from "./tokens";

const SPEC = parseChartSpec(FIXTURE) as BubbleSpec;
const EPS = 1e-6;

function runs(f: Frame, role: TextRun["node"]["role"]): TextRun[] {
  return f.runs.filter((r) => r.node.role === role);
}

describe.each(["social", "og"] as CanvasId[])("%s canvas", (id) => {
  const cv = CANVASES[id];

  describe.each(THEMES)("%s", (theme) => {
    const f = layoutFrame(SPEC, id, theme);

    it("keeps every source-line run inside the text column", () => {
      const src = runs(f, "source");
      expect(src.length).toBeGreaterThan(2);
      for (const r of src) {
        const span = textSpan(r.node);
        expect(r.node.width, r.node.text).toBeLessThanOrEqual(cv.column + EPS);
        expect(span.x0, r.node.text).toBeGreaterThanOrEqual(cv.margin - EPS);
        expect(span.x1, r.node.text).toBeLessThanOrEqual(cv.margin + cv.column + EPS);
      }
    });

    it("keeps every other horizontal run inside its band and on the canvas", () => {
      for (const r of f.runs) {
        const span = textSpan(r.node);
        if (r.limit) {
          expect(span.x0, `${r.node.role}: ${r.node.text}`).toBeGreaterThanOrEqual(r.limit.x0 - EPS);
          expect(span.x1, `${r.node.role}: ${r.node.text}`).toBeLessThanOrEqual(r.limit.x1 + EPS);
        } else {
          // Rotated y title: its length runs down from the plot top and must end above the plot bottom.
          expect(r.node.rotate).toBe(-90);
          expect(r.node.width).toBeLessThanOrEqual(f.plot.h + EPS);
        }
        expect(r.node.y).toBeGreaterThan(0);
        expect(r.node.y).toBeLessThan(cv.height);
      }
    });

    it("sets the headline on the canvas's ladder within its line cap", () => {
      expect(f.headline).not.toBeNull();
      expect(cv.headline?.ladder).toContain(f.headline?.size);
      expect(f.headline?.lines.length).toBeLessThanOrEqual(cv.headline?.maxLines ?? 0);
      expect(runs(f, "headline").map((r) => r.node.text).join(" ")).toBe(SPEC.headline);
    });

    it("leaves a plot at least minPlot tall", () => {
      expect(f.plot.h).toBeGreaterThanOrEqual(cv.minPlot);
      expect(f.plot.w).toBeGreaterThan(0);
    });

    it("prints the brand and the permalink", () => {
      expect(runs(f, "brand").map((r) => r.node.text)).toEqual([BRAND]);
      expect(runs(f, "permalink").map((r) => r.node.text).join("")).toBe(permalink(SPEC));
    });
  });
});

describe("stack layout (social)", () => {
  const f = layoutFrame(SPEC, "social", "dark");
  const top = (r: TextRun) => r.node.y - r.node.size; // generous: above the cap top
  const bottom = (r: TextRun) => r.node.y + r.node.size * 0.3; // below the descender

  it("stacks headline, dek, plot, ticks, x title, legend, source and brand without overlap", () => {
    const head = runs(f, "headline");
    const dek = runs(f, "dek");
    const xTicks = runs(f, "tick").filter((r) => r.node.anchor === "middle");
    const xTitle = runs(f, "axis-title").filter((r) => !r.node.rotate);
    const legend = runs(f, "legend");
    const source = runs(f, "source");
    const brand = runs(f, "brand");
    const maxBottom = (rs: TextRun[]) => Math.max(...rs.map(bottom));
    const minTop = (rs: TextRun[]) => Math.min(...rs.map(top));
    expect(dek.length).toBeGreaterThan(0);
    expect(maxBottom(head)).toBeLessThanOrEqual(minTop(dek));
    expect(maxBottom(dek)).toBeLessThanOrEqual(f.plot.y);
    expect(f.plot.y + f.plot.h).toBeLessThanOrEqual(minTop(xTicks));
    expect(maxBottom(xTicks)).toBeLessThanOrEqual(minTop(xTitle));
    expect(maxBottom(xTitle)).toBeLessThanOrEqual(minTop(legend));
    expect(maxBottom(legend)).toBeLessThanOrEqual(minTop(source));
    expect(maxBottom(source)).toBeLessThanOrEqual(minTop(brand));
    expect(maxBottom(brand)).toBeLessThanOrEqual(CANVASES.social.height);
  });

  it("measures the left gutter from the widest y tick label", () => {
    const yTicks = runs(f, "tick").filter((r) => r.node.anchor === "end");
    for (const r of yTicks) expect(textSpan(r.node).x1).toBeLessThanOrEqual(f.plot.x);
    const title = runs(f, "axis-title").find((r) => r.node.rotate === -90);
    // The rotated title's glyphs reach at most one descent right of its baseline; the widest tick starts past that.
    const titleRight = (title?.node.x ?? Infinity) + (title?.node.size ?? 0) * 0.3;
    expect(titleRight).toBeLessThan(Math.min(...yTicks.map((r) => textSpan(r.node).x0)));
    expect(title?.node.x).toBeGreaterThanOrEqual(CANVASES.social.margin);
  });
});

describe("axes", () => {
  it("draws gridlines at the spec's fixed 10-point steps, zero reading 0%", () => {
    const { x, y } = axesFor(SPEC);
    expect(x?.ticks.map((t) => t.value)).toEqual([-20, -10, 0, 10, 20, 30, 40]);
    expect(x?.ticks.map((t) => t.label)).toEqual(["-20%", "-10%", "0%", "+10%", "+20%", "+30%", "+40%"]);
    expect(y?.ticks.map((t) => t.value)).toEqual([-20, -10, 0, 10, 20, 30]);
    const f = layoutFrame(SPEC, "social", "dark");
    expect(f.sx?.(-20)).toBeCloseTo(f.plot.x, 9);
    expect(f.sx?.(40)).toBeCloseTo(f.plot.x + f.plot.w, 9);
    expect(f.sy?.(-20)).toBeCloseTo(f.plot.y + f.plot.h, 9);
    expect(f.sy?.(30)).toBeCloseTo(f.plot.y, 9);
    const grid = f.under.filter((n) => n.type === "line" && n.stroke.color === f.palette.grid.color && n.stroke.opacity === f.palette.grid.opacity);
    expect(grid.length).toBe(7 + 6);
  });

  it.each(["social", "og", "inline-wide", "inline-narrow"] as CanvasId[])("prints the corner value once where both axes start at the bottom-left corner (%s)", (id) => {
    const f = layoutFrame(SPEC, id, "dark");
    const ticks = runs(f, "tick").map((r) => r.node);
    // Both axes start at -20%: the x row keeps its "-20%", the y column's repeat is dropped; its gridline stays.
    expect(ticks.filter((t) => t.anchor === "middle").map((t) => t.text)).toEqual(["-20%", "-10%", "0%", "+10%", "+20%", "+30%", "+40%"]);
    expect(ticks.filter((t) => t.anchor === "end").map((t) => t.text)).toEqual(["-10%", "0%", "+10%", "+20%", "+30%"]);
    const grid = f.under.filter((n) => n.type === "line" && n.stroke.color === f.palette.grid.color && n.stroke.opacity === f.palette.grid.opacity);
    expect(grid.length).toBe(7 + 6);
    const sep = CANVASES[id].gaps.tick / 2;
    for (let i = 0; i < ticks.length; i++) for (let j = i + 1; j < ticks.length; j++) expect(boxesOverlap(textBox(ticks[i]), textBox(ticks[j]), sep), `${ticks[i].text} / ${ticks[j].text}`).toBe(false);
  });

  it("lifts the lowest y label clear of the first x label when the two corner values differ", () => {
    // An x domain from -30: the corner holds "-30%" on x and "-20%" on y. Every row is still plotted.
    const s: BubbleSpec = { ...SPEC, x: { ...SPEC.x, domain: [-30, 40] } };
    expect(SPEC.data.every((d) => d.x == null || (d.x >= -30 && d.x <= 40))).toBe(true);
    for (const id of ["social", "og"] as CanvasId[]) {
      const f = layoutFrame(s, id, "dark");
      const cv = CANVASES[id];
      const xs = runs(f, "tick").map((r) => r.node).filter((t) => t.anchor === "middle");
      const ys = runs(f, "tick").map((r) => r.node).filter((t) => t.anchor === "end");
      expect(xs[0].text).toBe("-30%");
      expect(ys.map((t) => t.text)).toEqual(["-20%", "-10%", "0%", "+10%", "+20%", "+30%"]);
      const low = ys[0];
      const centred = (f.sy?.(-20) as number) + capHeight(cv.tick.size, cv.tick.weight) / 2;
      expect(low.y).toBeLessThan(centred);
      const xb = textBox(xs[0]);
      const yb = textBox(low);
      expect(boxesOverlap(xb, yb, cv.gaps.tick / 2)).toBe(false);
      expect(yb.y + yb.h + cv.gaps.tick / 2).toBeCloseTo(xb.y, 9);
      // The other y labels stay centred on their gridlines.
      expect(ys[1].y).toBeCloseTo((f.sy?.(-10) as number) + capHeight(cv.tick.size, cv.tick.weight) / 2, 9);
    }
  });

  it("turns a labelled reference line into a keep-out box inside the plot", () => {
    const s: BubbleSpec = { ...SPEC, y: { ...SPEC.y, reference: [{ value: 0, label: "No change" }] } };
    const f = layoutFrame(s, "social", "light");
    expect(f.keepOut.length).toBe(1);
    const k = f.keepOut[0];
    expect(k.x).toBeGreaterThanOrEqual(f.plot.x);
    expect(k.x + k.w).toBeLessThanOrEqual(f.plot.x + f.plot.w + EPS);
    expect(k.y).toBeGreaterThanOrEqual(f.plot.y);
    const label = runs(f, "reference")[0].node;
    expect(label.text).toBe("No change");
    expect(label.halo?.color).toBe(f.palette.bg);
  });
});

describe("notes", () => {
  it("prints the universe, one compact source line and each method once", () => {
    const paras = sourceParagraphs(SPEC);
    expect(paras[0]).toBe("The 150 largest metropolitan areas by 2019 total covered employment, Puerto Rico included.");
    expect(paras[1]).toBe("Source: U.S. Bureau of Labor Statistics, Quarterly Census of Employment and Wages, 2019 and 2023, data.bls.gov/cew/data/api/.");
    expect(paras.slice(2).every((p) => p.startsWith("Computed by Embedding Atlas: "))).toBe(true);
    expect(paras.length).toBe(2 + 2);
  });

  it("keys the legend on the subject, bubble size, outlines for negatives and the unpublished count", () => {
    expect(legendItems(SPEC)).toEqual([
      { glyph: "signal", text: "Austin" },
      { glyph: "bubble", text: "Bubble size = change in total covered jobs, 2019 to 2023" },
      { glyph: "outline", text: "Outline = negative" },
      { glyph: "none", text: "36 of 150 not published", muted: true },
    ]);
  });

  it("moves the permalink under the brand when one row cannot hold both", () => {
    const f = layoutFrame(SPEC, "og", "dark");
    const brand = runs(f, "brand")[0].node;
    const link = runs(f, "permalink");
    expect(link.every((r) => r.node.y > brand.y)).toBe(true);
  });
});

describe("SVG", () => {
  it("sets font-family only on the root element in inline variants", () => {
    for (const id of ["inline-wide", "inline-narrow"] as CanvasId[]) {
      for (const theme of THEMES) {
        const svg = frameSvg(layoutFrame(SPEC, id, theme));
        const root = svg.slice(0, svg.indexOf(">") + 1);
        expect(root.startsWith("<svg ")).toBe(true);
        expect(svg.match(/font-family/g)?.length, `${id} ${theme}`).toBe(1);
        expect(root).toContain('style="font-family:var(--font-display),Geist,system-ui,sans-serif"');
        expect(root).toContain('width="100%"');
        expect(svg).not.toMatch(/<text[^>]*font-family/);
      }
    }
  });

  it("names Geist once, on the root, in standalone variants", () => {
    const svg = frameSvg(layoutFrame(SPEC, "social", "dark"));
    expect(svg.match(/font-family/g)?.length).toBe(1);
    expect(svg.slice(0, svg.indexOf(">"))).toContain('font-family="Geist,system-ui,sans-serif"');
    expect(svg).toContain('width="1080" height="1350" viewBox="0 0 1080 1350"');
  });

  it("is byte-identical twice and under reordered data and provenance", () => {
    const a = frameSvg(layoutFrame(SPEC, "social", "dark"));
    expect(frameSvg(layoutFrame(SPEC, "social", "dark"))).toBe(a);
    const shuffled: BubbleSpec = { ...SPEC, data: [...SPEC.data].reverse(), provenance: Object.fromEntries(Object.entries(SPEC.provenance).reverse()) };
    expect(frameSvg(layoutFrame(shuffled, "social", "dark"))).toBe(a);
  });

  it("prefixes every id from the spec hash, distinct per canvas and theme, with title and desc", () => {
    const ids = new Set<string>();
    for (const id of ["social", "og", "inline-wide", "inline-narrow"] as CanvasId[]) {
      for (const theme of THEMES) {
        const f = layoutFrame(SPEC, id, theme);
        const svg = frameSvg(f);
        ids.add(f.idPrefix);
        for (const m of svg.matchAll(/ id="([^"]+)"/g)) expect(m[1].startsWith(`${f.idPrefix}-`)).toBe(true);
        expect(svg).toContain(`aria-labelledby="${f.idPrefix}-t ${f.idPrefix}-d"`);
        expect(svg).toContain(`<title id="${f.idPrefix}-t">${SPEC.headline}</title>`);
        expect(svg).toContain(`fill="url(#${f.idPrefix}-grain)"`);
      }
    }
    expect(ids.size).toBe(8);
  });

  it("omits the headline and brand on inline canvases but keeps them in <title>", () => {
    const f = layoutFrame(SPEC, "inline-wide", "light");
    expect(f.headline).toBeNull();
    expect(runs(f, "headline")).toEqual([]);
    expect(runs(f, "brand")).toEqual([]);
    expect(frameSvg(f)).toContain(`<title id="${f.idPrefix}-t">`);
  });
});

describe("refusals", () => {
  it("throws on text the vendored font cannot draw", () => {
    const s: BubbleSpec = { ...SPEC, headline: `Job Growth by Industry Group in the 150 Largest US Metro Areas, 2019­2023` };
    expect(() => layoutFrame(s, "social", "dark")).toThrow(/U\+00AD/);
  });

  it("throws rather than truncating a headline no ladder size can set", () => {
    const s: BubbleSpec = { ...SPEC, headline: "Extraordinarily-Comprehensive-Metropolitan-Employment-Reconsiderations" };
    expect(() => layoutFrame(s, "og", "dark")).toThrow(/does not fit/);
  });
});
