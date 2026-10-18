// The canvases' headline ladders and the capacity check spec.ts runs at
// validation: the OG card's own 46/40/34 px ladder holds the flagship title,
// the frame sets it on a rung of that ladder inside the column, and a title
// that no rung can set is caught by headlineMisfits, naming the canvas.

import { describe, expect, it } from "vitest";
import FIXTURE from "./fixtures/flagship-qcew-2019-2023.json";
import { CANVASES, CANVAS_IDS, headlineMisfits } from "./canvas";
import { layoutFrame, textBox } from "./frame";
import { fitHeadline, headlineAt } from "./metrics";
import { parseChartSpec, type BubbleSpec } from "./spec";
import { THEMES } from "./tokens";

const SPEC = parseChartSpec(FIXTURE) as BubbleSpec;
const OG = CANVASES.og;
const OG_HEADLINE = OG.headline as NonNullable<typeof OG.headline>;

describe("OG headline ladder", () => {
  it("is its own: 46, then 40, then 34 px, up to 5 lines of the 470 px column", () => {
    expect(OG_HEADLINE.ladder).toEqual([46, 40, 34]);
    expect(OG_HEADLINE.maxLines).toBe(5);
    expect(OG.column).toBe(470);
    expect(CANVASES.social.headline?.ladder).toEqual([60, 52, 46]);
  });

  it("fits the flagship title: 5 lines at 40 px (at 46 px, measured in Geist Black, it needs 7)", () => {
    const fit = fitHeadline(SPEC.headline, OG_HEADLINE.ladder, OG_HEADLINE.maxLines, OG.column, OG_HEADLINE.weight, OG_HEADLINE.lineHeight);
    expect(fit.size).toBe(40);
    expect(fit.lines).toEqual(["White-Collar and", "Blue-Collar Industry", "Job Growth in the", "150 Largest US Metro", "Areas, 2019 to 2023"]);
    expect(headlineAt(SPEC.headline, 46, 5, OG.column)).toBeNull();
    expect(headlineAt(SPEC.headline, 46, 7, OG.column)?.lines.length).toBe(7);
  });

  it.each(THEMES)("sets the flagship title on a rung of the ladder, inside the column, above the notes (%s)", (theme) => {
    const f = layoutFrame(SPEC, "og", theme);
    expect(f.headline?.size).toBe(40);
    const head = f.runs.filter((r) => r.node.role === "headline");
    expect(head.map((r) => r.node.text)).toEqual(f.headline?.lines);
    const notes = f.runs.filter((r) => r.node.role === "source" || r.node.role === "brand" || r.node.role === "permalink");
    const headBottom = Math.max(...head.map((r) => textBox(r.node).y + textBox(r.node).h));
    for (const r of head) {
      const b = textBox(r.node);
      expect(b.x).toBeGreaterThanOrEqual(OG.margin);
      expect(b.x + b.w).toBeLessThanOrEqual(OG.margin + OG.column);
      expect(b.y).toBeGreaterThanOrEqual(OG.margin);
    }
    expect(headBottom + OG.gaps.headline).toBeLessThanOrEqual(Math.min(...notes.map((r) => textBox(r.node).y)));
  });
});

describe("headlineMisfits", () => {
  it("passes the flagship title on every canvas", () => {
    expect(headlineMisfits(SPEC.headline)).toEqual([]);
  });

  it("checks only canvases that draw a headline, each at its last rung", () => {
    // 120 characters, the schema's coarse cap, and still over both canvases' capacity.
    const long = `${SPEC.headline}, Ranked by Covered Jobs`;
    expect(long.length).toBe(120);
    const misfits = headlineMisfits(long);
    expect(misfits).toEqual([
      { canvas: "social", size: 46, ladder: [60, 52, 46], maxLines: 3, width: 952 },
      { canvas: "og", size: 34, ladder: [46, 40, 34], maxLines: 5, width: 470 },
    ]);
    const drawn = CANVAS_IDS.filter((id) => CANVASES[id].headline);
    for (const m of misfits) expect(drawn).toContain(m.canvas);
    expect(() => layoutFrame({ ...SPEC, headline: long }, "og", "dark")).toThrow(/does not fit the og canvas/);
  });

  it("flags a single word wider than the column even when the line count would fit", () => {
    // One unbreakable token wider than 470 px at 34 px Black.
    const word = "Metropolitan-Statistical-Area-Employment";
    expect(headlineAt(word, 34, 5, OG.column)).toBeNull();
    expect(headlineMisfits(word).map((m) => m.canvas)).toContain("og");
  });
});
