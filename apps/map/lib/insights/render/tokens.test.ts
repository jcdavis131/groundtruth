// Contrast is computed from the tokens themselves: each paint composited over
// its theme's background, then the WCAG 2.x ratio. The light theme is the
// one the verifier caught (bubble stroke 2.28:1, leader 2.77:1); these pin it.

import { describe, expect, it } from "vitest";
import { PALETTES, THEMES, composite, contrastOnBg, hexToRgb } from "./tokens";

describe("contrast arithmetic", () => {
  it("matches WCAG's reference points", () => {
    expect(contrastOnBg("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastOnBg("#ffffff", "#ffffff")).toBeCloseTo(1, 6);
    expect(contrastOnBg("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("composites an opacity over the background before measuring", () => {
    expect(composite({ color: "#000000", opacity: 0.5 }, "#ffffff")).toEqual([128, 128, 128]);
    // The render lane's first light palette, as the verifier measured it.
    expect(contrastOnBg({ color: "#4a5563", opacity: 0.5 }, "#f4f6f8")).toBeCloseTo(2.27, 2);
    expect(contrastOnBg({ color: "#16202a", opacity: 0.45 }, "#f4f6f8")).toBeCloseTo(2.76, 2);
  });

  it("rejects anything but #rrggbb", () => {
    expect(() => hexToRgb("rgba(0,0,0,.5)")).toThrow();
  });
});

describe("light theme", () => {
  const L = PALETTES.light;

  it("is drawn on #f4f6f8", () => {
    expect(L.bg).toBe("#f4f6f8");
  });

  it("gives bubble strokes and leaders at least 3:1 against the background", () => {
    expect(contrastOnBg(L.bubbleStroke, "#f4f6f8")).toBeGreaterThanOrEqual(3);
    expect(contrastOnBg(L.leader, "#f4f6f8")).toBeGreaterThanOrEqual(3);
  });
});

describe.each(THEMES)("%s theme", (theme) => {
  const p = PALETTES[theme];

  it("keeps every text colour at 4.5:1 or better", () => {
    for (const [name, c] of Object.entries({ ink: p.ink, text: p.text, muted: p.muted, signal: p.signal })) {
      expect(contrastOnBg(c, p.bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps every informative mark at 3:1 or better (WCAG 1.4.11)", () => {
    for (const [name, paint] of Object.entries({ bubbleStroke: p.bubbleStroke, outline: p.outline, leader: p.leader, reference: p.reference })) {
      expect(contrastOnBg(paint, p.bg), name).toBeGreaterThanOrEqual(3);
    }
  });

  it("halos in the background colour", () => {
    expect(p.halo.color).toBe(p.bg);
  });
});
