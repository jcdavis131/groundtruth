// The rendered bubble chart: byte-equal to the committed goldens, the same
// bytes twice and for reordered input, area-true radii, an outline with no
// fill for every metro that lost jobs, and a named refusal for chart kinds
// this renderer has no layout for.
//
// The goldens are the review surface for the drawing. After an intentional
// change to layout, placement or styling, regenerate them with:
//   UPDATE_INSIGHTS_GOLDEN=1 npx vitest run lib/insights/render/render.test.ts
// and read the diff (or open the SVGs) before committing.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/flagship-qcew-2019-2023.json";
import { signedPct } from "@/lib/brief/format";
import { CANVASES, CANVAS_IDS, type CanvasId } from "./canvas";
import { MAX_RADIUS, layoutBubble } from "./charts/bubble";
import { renderChart, renderSvg } from "./render";
import { f2 } from "./svg";
import { parseChartSpec, type BubbleSpec, type ChartSpec } from "./spec";
import { PALETTES, THEMES, type Theme } from "./tokens";

const SPEC = parseChartSpec(FIXTURE) as BubbleSpec;
const GOLDENS: Array<[CanvasId, Theme]> = [
  ["social", "dark"],
  ["social", "light"],
  ["og", "dark"],
  ["inline-wide", "light"],
];
const golden = (canvas: CanvasId, theme: Theme): string => path.resolve(__dirname, `golden/bubble-${canvas}-${theme}.svg`);
const UPDATE = "UPDATE_INSIGHTS_GOLDEN=1 npx vitest run lib/insights/render/render.test.ts";

/** Rows, provenance keys and label ids all reversed: a deterministic reordering of everything a spec orders. */
function reversed(s: BubbleSpec): BubbleSpec {
  return {
    ...s,
    data: [...s.data].reverse().map((d) => ({ ...d, provenance: [...d.provenance].reverse() })),
    provenance: Object.fromEntries(Object.entries(s.provenance).reverse()),
    labels: { ...s.labels, ids: [...(s.labels?.ids ?? [])].reverse() },
  };
}

describe("goldens", () => {
  it.each(GOLDENS)("bubble-%s-%s.svg is byte-equal", (canvas, theme) => {
    const svg = renderSvg(SPEC, canvas, theme);
    const file = golden(canvas, theme);
    if (process.env.UPDATE_INSIGHTS_GOLDEN === "1") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, svg);
      return;
    }
    expect(fs.existsSync(file), `missing golden; run ${UPDATE}`).toBe(true);
    expect(svg === fs.readFileSync(file, "utf8"), `the drawing changed; run ${UPDATE} and review the diff`).toBe(true);
  });
});

describe("determinism", () => {
  it.each(CANVAS_IDS.flatMap((c) => THEMES.map((t): [CanvasId, Theme] => [c, t])))("%s %s renders the same bytes twice and for reversed input", (canvas, theme) => {
    const a = renderSvg(SPEC, canvas, theme);
    expect(renderSvg(SPEC, canvas, theme)).toBe(a);
    expect(renderSvg(reversed(SPEC), canvas, theme)).toBe(a);
  });
});

describe("bubbles", () => {
  const L = layoutBubble(SPEC, "social", "dark");
  const mark = new Map(L.marks.map((m) => [m.id, m]));
  const row = new Map(SPEC.data.map((d) => [d.id, d]));

  it("draws one bubble per plotted row: 114 of 150", () => {
    expect(L.marks.length).toBe(114);
    expect(SPEC.data.filter((d) => d.x != null && d.y != null).map((d) => d.id).sort()).toEqual([...mark.keys()].sort());
  });

  it("makes bubble AREA proportional to |size|, the largest at MAX_RADIUS", () => {
    for (const canvas of CANVAS_IDS) {
      const marks = layoutBubble(SPEC, canvas, "dark").marks;
      const k = MAX_RADIUS * CANVASES[canvas].scale;
      const maxAbs = Math.max(...marks.map((m) => Math.abs(row.get(m.id)?.size as number)));
      for (const m of marks) {
        const size = Math.abs(row.get(m.id)?.size as number);
        expect((m.r * m.r) / (k * k), `${canvas} ${m.id}`).toBeCloseTo(size / maxAbs, 12);
      }
      expect(Math.max(...marks.map((m) => m.r))).toBeCloseTo(k, 12);
    }
  });

  it("draws every metro that lost jobs as an outline with no fill, and every other one filled", () => {
    for (const m of L.marks) {
      const size = row.get(m.id)?.size as number;
      expect(m.style, m.id).toBe(size < 0 ? "outline" : "fill");
    }
    expect(L.marks.filter((m) => m.style === "outline").length).toBe(39);
  });

  it.each([
    ["C4186", "San Francisco-Oakland-Fremont, CA", -37775],
    ["C3108", "Los Angeles-Long Beach-Anaheim, CA", -44696],
    ["C3830", "Pittsburgh, PA", -57109],
  ])("draws %s (%s, %d jobs) as an outline with no fill in the SVG", (id, name, size) => {
    const d = row.get(id) as BubbleSpec["data"][number];
    expect([d.fullLabel, d.size]).toEqual([name, size]);
    for (const [canvas, theme] of GOLDENS) {
      const r = renderChart(SPEC, canvas, theme);
      const m = r.layout.marks.find((x) => x.id === id) as NonNullable<ReturnType<typeof mark.get>>;
      const pal = PALETTES[theme];
      const el = r.svg.split("\n").filter((l) => l.startsWith(`<circle cx="${f2(m.cx)}" cy="${f2(m.cy)}" r="${f2(m.r)}"`));
      expect(el, `${canvas} ${theme}`).toEqual([`<circle cx="${f2(m.cx)}" cy="${f2(m.cy)}" r="${f2(m.r)}" fill="none" stroke="${pal.outline.color}" stroke-width="${f2(Math.max(1, 1.5 * CANVASES[canvas].scale))}"/>`]);
    }
  });

  it("draws the subject filled in the signal colour, with its own notes under its label", () => {
    const svg = renderSvg(SPEC, "social", "dark");
    const m = mark.get("C1242") as NonNullable<ReturnType<typeof mark.get>>;
    expect(svg).toContain(`<circle cx="${f2(m.cx)}" cy="${f2(m.cy)}" r="${f2(m.r)}" fill="${PALETTES.dark.signal}"/>`);
    const austin = row.get("C1242") as BubbleSpec["data"][number];
    // The fixture's builder formats the note itself; it must read exactly as lib/brief/format.ts would.
    expect(SPEC.subjectNotes).toEqual([`${signedPct(austin.x, 1)} / ${signedPct(austin.y, 1)}`]);
    expect(svg).toContain(`fill="${PALETTES.dark.signal}">${SPEC.subjectNotes?.[0]}</text>`);
  });

  it.each(CANVAS_IDS)("draws bubbles by area, largest first, the subject in its place by size, on %s", (canvas) => {
    const marks = layoutBubble(SPEC, canvas, "dark").marks;
    for (let i = 1; i < marks.length; i++) {
      const [a, b] = [marks[i - 1], marks[i]];
      expect(b.r * b.r, `${a.id} before ${b.id}`).toBeLessThanOrEqual(a.r * a.r);
      if (a.r === b.r) expect(a.id < b.id, `tie ${a.id} / ${b.id} by id`).toBe(true);
    }
    // Austin is not the largest bubble, so it is not drawn last: nothing smaller sits under its opaque fill.
    const subject = marks.findIndex((m) => m.subject);
    expect(subject).toBe(marks.filter((m) => m.r > (marks[subject] as (typeof marks)[number]).r).length);
    expect(subject).toBeLessThan(marks.length - 1);
  });

  it("emits the bubbles into the SVG in that draw order", () => {
    for (const [canvas, theme] of GOLDENS) {
      const r = renderChart(SPEC, canvas, theme);
      const lines = r.svg.split("\n");
      const at = r.layout.marks.map((m) => lines.findIndex((l) => l.startsWith(`<circle cx="${f2(m.cx)}" cy="${f2(m.cy)}" r="${f2(m.r)}"`)));
      expect(at.every((i) => i >= 0), `${canvas} ${theme}`).toBe(true);
      for (let i = 1; i < at.length; i++) expect(at[i], `${canvas} ${theme} ${r.layout.marks[i].id}`).toBeGreaterThan(at[i - 1]);
    }
  });
});

describe("SVG", () => {
  it("keeps font-family on the root element only, labels included, inline and standalone", () => {
    for (const canvas of CANVAS_IDS) {
      const svg = renderSvg(SPEC, canvas, "light");
      expect(svg.match(/font-family/g)?.length, canvas).toBe(1);
      expect(svg.slice(0, svg.indexOf(">"))).toContain("font-family");
    }
  });

  it("titles the document with the headline and describes it from the fixed template", () => {
    const r = renderChart(SPEC, "social", "dark");
    expect(r.scene.title).toBe(SPEC.headline);
    expect(r.scene.desc).toContain("114 of 150 plotted; 36 not published.");
    expect(r.svg).toBe(renderSvg(SPEC, "social", "dark"));
  });
});

describe("refusals", () => {
  it("names a chart kind it has no layout for instead of drawing an empty frame", () => {
    // Two real rows with nothing published on the slope's encodings: a valid slope spec, and no value invented.
    const rows = SPEC.data.slice(0, 2).map((d) => ({ id: d.id, label: d.label, fullLabel: d.fullLabel, provenance: d.provenance, from: null, to: null }));
    const slope = parseChartSpec({ version: 1, kind: "slope", slug: SPEC.slug, headline: SPEC.headline, asOf: SPEC.asOf, universe: SPEC.universe, provenance: SPEC.provenance, from: "2019", to: "2023", y: SPEC.y, data: rows }) as ChartSpec;
    expect(() => renderChart(slope, "social", "dark")).toThrow(/bubble charts only; it has no layout for a slope chart/);
  });
});
