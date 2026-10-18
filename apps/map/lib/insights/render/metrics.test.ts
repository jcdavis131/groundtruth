// metrics.json is generated (scripts/gen-font-metrics.mjs); this keeps it
// honest against the TTFs actually shipped, and pins the measurement and
// wrapping rules every layout decision rests on.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import METRICS from "./metrics.json";
import { KERN_PAD, balancedWrap, fitHeadline, fitsWidth, measure, unmapped, wrap, wrapSource, type TextStyle } from "./metrics";
import { fontMetrics, metricCodePoints, parseTtf } from "./ttf";

const FONTS = path.resolve(__dirname, "fonts");

// Real upstream URLs, long enough to need breaking inside the URL: the Census
// metro population file the flagship cites, and the QCEW slice this fixture reads.
const CENSUS_CBSA = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/metro/totals/cbsa-est2025-alldata.csv";
const QCEW_SLICE = "https://data.bls.gov/cew/data/api/2023/a/industry/1024.csv";

describe("metrics.json", () => {
  it("matches the vendored TTFs byte for byte and glyph for glyph", () => {
    const cps = metricCodePoints();
    for (const [weight, m] of Object.entries(METRICS.weights)) {
      const bytes = fs.readFileSync(path.join(FONTS, m.file));
      expect(bytes.length, `${m.file} size`).toBe(m.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), `${m.file} sha256; rerun node scripts/gen-font-metrics.mjs`).toBe(m.sha256);
      const parsed = fontMetrics(parseTtf(new Uint8Array(bytes)), cps);
      expect({ file: m.file, bytes: m.bytes, sha256: m.sha256, ...parsed }, `weight ${weight}`).toEqual(m);
    }
  });

  it("is generated from Geist 1.7.2 (Regular hmtx count 975, not the 973 of the copy bundled with Next's OG image package)", () => {
    expect(METRICS.version).toBe("1.7.2");
    expect(METRICS.weights["400"].numberOfHMetrics).toBe(975);
    expect(Object.keys(METRICS.weights)).toEqual(["400", "700", "900"]);
  });

  it("maps everything the renderer prints except the soft hyphen", () => {
    for (const w of [400, 700, 900] as const) {
      expect(unmapped("Austin −4.1% × 1,250 → “Dallas” … · ½", w)).toEqual([]);
      expect(unmapped("co­operate x", w)).toEqual([0xad, 0x2009]);
    }
  });

  it("ships the OFL licence beside the fonts", () => {
    const licence = fs.readFileSync(path.join(FONTS, "LICENSE.txt"), "utf8");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    // A Reserved Font Name would be declared in the copyright header, before the licence text.
    const header = licence.slice(0, licence.indexOf("SIL OPEN FONT LICENSE Version 1.1"));
    expect(header).toContain("Copyright 2024 The Geist Project Authors");
    expect(header).not.toMatch(/Reserved Font Name/i);
  });
});

describe("measure", () => {
  it("sums advances over unitsPerEm, padded for kerning", () => {
    // The render lane's probe: "Austin, TX" at Regular 28 is 128.49 px of advances.
    expect(measure("Austin, TX", 28, 400) / KERN_PAD).toBeCloseTo(128.49, 2);
    expect(measure("", 20, 700)).toBe(0);
  });

  it("adds letter-spacing after every character", () => {
    expect(measure("ATLAS", 18, 900, 3) - measure("ATLAS", 18, 900)).toBeCloseTo(15, 9);
  });

  it("is wider for heavier weights", () => {
    expect(measure("Embedding Atlas", 20, 900)).toBeGreaterThan(measure("Embedding Atlas", 20, 400));
  });
});

const SRC: TextStyle = { size: 17, weight: 400, lineHeight: 23 / 17 };
const OG_SRC: TextStyle = { size: 14, weight: 400, lineHeight: 18 / 14 };

describe("wrapSource", () => {
  it("never returns a line wider than the column, breaking inside a URL at '/'", () => {
    for (const [style, width] of [
      [SRC, 952],
      [OG_SRC, 470],
      [OG_SRC, 200],
    ] as const) {
      const lines = wrapSource(`Source: U.S. Census Bureau, Population Estimates Program, ${CENSUS_CBSA}.`, width, style);
      expect(fitsWidth(lines, width, style)).toBe(true);
      // The URL reads back exactly when the broken pieces are rejoined.
      expect(lines.join(" ").replace(/\/ /g, "/")).toContain(CENSUS_CBSA);
    }
    const narrow = wrapSource(CENSUS_CBSA, 200, OG_SRC);
    expect(narrow.length).toBeGreaterThan(1);
    for (const l of narrow.slice(0, -1)) expect(l.endsWith("/")).toBe(true);
    expect(narrow.join("")).toBe(CENSUS_CBSA);
  });

  it("falls back to URL punctuation, then characters, when a piece between slashes is still too wide", () => {
    const lines = wrapSource("cbsa-est2025-alldata.csv", 60, OG_SRC);
    expect(fitsWidth(lines, 60, OG_SRC)).toBe(true);
    expect(lines.join("")).toBe("cbsa-est2025-alldata.csv");
    const chars = wrapSource("abcdefghijklmnopqrstuvwxyz", 30, OG_SRC);
    expect(fitsWidth(chars, 30, OG_SRC)).toBe(true);
    expect(chars.join("")).toBe("abcdefghijklmnopqrstuvwxyz");
  });

  it("leaves text that fits alone", () => {
    expect(wrapSource(QCEW_SLICE, 952, SRC)).toEqual([QCEW_SLICE]);
  });
});

describe("wrap and balancedWrap", () => {
  const style: TextStyle = { size: 24, weight: 400, lineHeight: 1.33 };
  const dek = "Private-sector jobs in finance and professional services against goods-producing jobs, change in annual averages from 2019 to 2023.";

  it("balances to the same line count without exceeding the width", () => {
    const greedy = wrap(dek, 952, style);
    const balanced = balancedWrap(dek, 952, style);
    expect(balanced.length).toBe(greedy.length);
    expect(fitsWidth(balanced, 952, style)).toBe(true);
    const spread = (ls: string[]) => Math.max(...ls.map((l) => measure(l, 24, 400))) - Math.min(...ls.map((l) => measure(l, 24, 400)));
    expect(spread(balanced)).toBeLessThanOrEqual(spread(greedy));
  });
});

describe("fitHeadline", () => {
  const title = "No Major Metro Matches Austin's Combination of Office-Industry and Goods-and-Logistics Job Growth";

  it("takes the largest ladder size that fits in maxLines", () => {
    const fit = fitHeadline(title, [46, 40, 34], 5, 470);
    expect([46, 40, 34]).toContain(fit.size);
    expect(fit.lines.length).toBeLessThanOrEqual(5);
    expect(fitsWidth(fit.lines, 470, { size: fit.size, weight: 900, lineHeight: 1.06 })).toBe(true);
  });

  it("throws instead of truncating when nothing on the ladder fits", () => {
    expect(() => fitHeadline(title, [60], 2, 470)).toThrow(/does not fit/);
  });
});
