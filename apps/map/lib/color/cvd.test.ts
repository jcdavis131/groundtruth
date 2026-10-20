// The legend's colour-vision gate. The thresholds below were fixed in the B5
// brief before the ramp was touched; they are not tuned to the ramp:
//   - under protan, deutan and tritan at severity 1.0 (Machado, Oliveira and
//     Fernandes 2009), CIE L* strictly increases along heatColor at heat
//     0, 0.25, 0.6 and 1;
//   - CIEDE2000 >= 10 between adjacent legend entries, under each of the three;
//   - CIEDE2000 >= 10 between NOT_LOADED and heatColor(0), under each of the three;
//   - WCAG 2.1 1.4.11 contrast >= 3:1 between NOT_LOADED and heatColor(0).

import { describe, expect, it } from "vitest";
import { heatColor, NOT_LOADED } from "@/lib/fabric/emergence";
import { PLACES_BIN_COLORS } from "@/lib/civic/places";
import { SVI_BIN_COLORS } from "@/lib/civic/svi";
import { BROADBAND_BIN_COLORS } from "@/lib/civic/broadband";
import { WRC_BIN_COLORS } from "@/lib/hazards/wrc";
import { HOUSING_BIN_COLORS } from "@/lib/civic/housing";
import { CVD_KINDS, ciede2000, lightness, simulate, wcagContrast, type Cvd } from "./cvd";

const STOPS = [0, 0.25, 0.6, 1] as const;
const RAMP = STOPS.map((h) => heatColor(h));
const seen = (hex: string, kind: Cvd | null) => (kind ? simulate(hex, kind) : hex);

describe("the colour arithmetic", () => {
  it("matches published anchors", () => {
    expect(wcagContrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(wcagContrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(lightness("#000000")).toBeCloseTo(0, 3);
    expect(lightness("#ffffff")).toBeCloseTo(100, 2);
    expect(ciede2000("#336699", "#336699")).toBeCloseTo(0, 6);
    expect(ciede2000("#000000", "#ffffff")).toBeCloseTo(100, 1);
    // CIEDE2000 is symmetric.
    expect(ciede2000("#22d3ee", "#facc15")).toBeCloseTo(ciede2000("#facc15", "#22d3ee"), 6);
  });
  it("leaves greys grey under every deficiency (each Machado row sums to 1)", () => {
    for (const kind of CVD_KINDS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(simulate("#808080", kind).slice(i, i + 2), 16));
      expect(Math.abs(r - 128), kind).toBeLessThanOrEqual(1);
      expect(Math.abs(g - 128), kind).toBeLessThanOrEqual(1);
      expect(Math.abs(b - 128), kind).toBeLessThanOrEqual(1);
    }
  });
  it("moves a saturated red the way protanopia does (it goes dark and olive)", () => {
    expect(lightness(simulate("#ff0000", "protan"))).toBeLessThan(lightness("#ff0000"));
  });
});

describe("the heat ramp under colour-vision deficiency", () => {
  for (const kind of [null, ...CVD_KINDS] as const) {
    const name = kind ?? "normal vision";
    it(`CIE L* strictly increases along the ramp, ${name}`, () => {
      const L = RAMP.map((c) => lightness(seen(c, kind)));
      for (let i = 1; i < L.length; i++) expect(L[i], `${name}: stop ${STOPS[i]} (${RAMP[i]}) vs ${STOPS[i - 1]} (${RAMP[i - 1]})`).toBeGreaterThan(L[i - 1]);
    });
    it(`adjacent legend entries differ by CIEDE2000 >= 10, ${name}`, () => {
      for (let i = 1; i < RAMP.length; i++) {
        const d = ciede2000(seen(RAMP[i - 1], kind), seen(RAMP[i], kind));
        expect(d, `${name}: ${RAMP[i - 1]} to ${RAMP[i]}`).toBeGreaterThanOrEqual(10);
      }
    });
    it(`not loaded is told from the lowest ramp colour by CIEDE2000 >= 10, ${name}`, () => {
      expect(ciede2000(seen(NOT_LOADED, kind), seen(heatColor(0), kind))).toBeGreaterThanOrEqual(10);
    });
  }
  it("not loaded has WCAG 1.4.11 contrast of at least 3:1 against the ramp's low stop", () => {
    expect(wcagContrast(NOT_LOADED, heatColor(0))).toBeGreaterThanOrEqual(3);
  });
  it("keeps the hue order slate, cyan, gold, orange (hue angle of the three upper stops falls from cyan to orange)", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const mx = Math.max(r, g, b);
      const d = mx - Math.min(r, g, b);
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const [, cyan, gold, orange] = RAMP.map(hue);
    expect(cyan).toBeGreaterThan(160);
    expect(cyan).toBeLessThan(215);
    expect(gold).toBeGreaterThan(30);
    expect(gold).toBeLessThan(55);
    expect(orange).toBeGreaterThan(10);
    expect(orange).toBeLessThan(gold);
  });
});

describe("the index palettes under colour-vision deficiency", () => {
  // The sequential palettes run pale to deep; their lightness must fall at every step for all three deficiencies.
  const sequential: Record<string, readonly string[]> = {
    "CDC PLACES": PLACES_BIN_COLORS,
    "CDC/ATSDR SVI": SVI_BIN_COLORS,
    "FCC broadband": BROADBAND_BIN_COLORS,
    "USFS WRC": WRC_BIN_COLORS,
    "HUD housing": HOUSING_BIN_COLORS,
  };
  for (const [name, colors] of Object.entries(sequential)) {
    for (const kind of [null, ...CVD_KINDS] as const) {
      it(`${name}: CIE L* strictly falls from the lowest bin to the highest, ${kind ?? "normal vision"}`, () => {
        const L = colors.map((c) => lightness(seen(c, kind)));
        for (let i = 1; i < L.length; i++) expect(L[i], `${name} bin ${i}`).toBeLessThan(L[i - 1]);
      });
    }
  }
  // Measured, not gated: FEMA's rating colours (green to red) have no single lightness order from Very Low
  // to Very High even under normal vision. CIE L* (Very Low to Very High): normal 70.2, 74.9, 72.2, 56.6,
  // 40.0; protan 72.8, 76.2, 67.4, 48.4, 30.9; deutan 68.3, 74.1, 74.9, 61.1, 44.6; tritan 70.3, 74.3,
  // 69.9, 55.8, 42.7. Very Low to Relatively Low rises under normal vision and all three deficiencies;
  // Relatively Low to Relatively Moderate rises only under deutan (74.1 to 74.9) and falls under protan
  // (76.2 to 67.4). The HUD housing and USFS WRC bins fall under CIEDE2000 10 between some neighbours.
  // Changing a published palette is not this PR's brief; the numbers are in its description.
  it.todo("FEMA NRI rating colours keep one lightness order from Very Low to Very High (measured: they do not, even under normal vision)");
});
