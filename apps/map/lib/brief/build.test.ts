// The brief's contract: the same facts always produce the same brief.
//
// The golden fixture is the review surface. After an intentional wording
// change, regenerate it with:
//   UPDATE_BRIEF_GOLDEN=1 npx vitest run lib/brief/build.test.ts
// which mirrors UPDATE_SCREENER_DOCS=1 for docs/SCREENER.md. A diff on
// lib/brief/golden/county-48453.json is then a diff on every sentence the
// product will say about a county, in one file, in one review.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QCEW_OTY_CAVEAT, buildBrief, briefText, familyOf, lensFamilies, type BuildBriefOptions } from "./build";
import { FIXTURE_OPTS, KING_INPUT, LOVING_INPUT, TRAVIS_INPUT } from "./fixtures";
import type { Brief, BriefInput } from "./types";

const GOLDEN = path.resolve(__dirname, "golden/county-48453.json");

/** The same run with the cap lifted, for the assertions that are about the whole detected set. */
const UNCAPPED: BuildBriefOptions = { ...FIXTURE_OPTS, maxFindings: 100 };

function serialise(b: Brief): string {
  return JSON.stringify(b, null, 2) + "\n";
}

/** A deterministic shuffle: reversal. No randomness in a test that asserts determinism. */
function reversed<T>(list: readonly T[]): T[] {
  return [...list].reverse();
}

function reversedKeys<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).reverse()) out[k] = o[k];
  return out;
}

describe("buildBrief", () => {
  it("is idempotent: the same input and options serialise identically", () => {
    expect(JSON.stringify(buildBrief(TRAVIS_INPUT, FIXTURE_OPTS))).toBe(JSON.stringify(buildBrief(TRAVIS_INPUT, FIXTURE_OPTS)));
  });

  it("matches lib/brief/golden/county-48453.json", () => {
    const text = serialise(buildBrief(TRAVIS_INPUT, FIXTURE_OPTS));
    if (process.env.UPDATE_BRIEF_GOLDEN === "1") {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, text);
      return;
    }
    expect(fs.existsSync(GOLDEN), "run UPDATE_BRIEF_GOLDEN=1 npx vitest run lib/brief/build.test.ts").toBe(true);
    expect(fs.readFileSync(GOLDEN, "utf8"), "the brief's wording changed; run UPDATE_BRIEF_GOLDEN=1 npx vitest run lib/brief/build.test.ts").toBe(text);
  });

  it("is invariant under reordering every array and every object key in the input", () => {
    const shuffled: BriefInput = {
      ...TRAVIS_INPUT,
      values: reversedKeys(TRAVIS_INPUT.values),
      previous: reversedKeys(TRAVIS_INPUT.previous),
      periods: { current: reversedKeys(TRAVIS_INPUT.periods.current), previous: reversedKeys(TRAVIS_INPUT.periods.previous) },
      suppressed: reversed(TRAVIS_INPUT.suppressed),
      skipped: reversed(TRAVIS_INPUT.skipped),
      indicators: reversed(TRAVIS_INPUT.indicators),
      releases: reversed(TRAVIS_INPUT.releases),
      provenance: reversedKeys(TRAVIS_INPUT.provenance),
    };
    expect(serialise(buildBrief(shuffled, FIXTURE_OPTS))).toBe(serialise(buildBrief(TRAVIS_INPUT, FIXTURE_OPTS)));
  });

  it("cites every finding, and prints a level's source on every threshold finding", () => {
    for (const input of [TRAVIS_INPUT, LOVING_INPUT]) {
      const b = buildBrief(input, FIXTURE_OPTS);
      expect(b.findings.length).toBeGreaterThan(0);
      for (const f of b.findings) {
        expect(f.provenance.length, `${f.kind} ${f.metric} carries no provenance`).toBeGreaterThan(0);
        if (f.kind === "threshold") expect(f.citation, `${f.metric} fired without a citation`).toBeTruthy();
      }
      expect(b.citations.length).toBeGreaterThan(0);
    }
  });

  it("moves only generatedAt when generatedAt moves", () => {
    const later: BuildBriefOptions = { ...FIXTURE_OPTS, generatedAt: "2027-01-05T09:30:00.000Z" };
    const a = buildBrief(TRAVIS_INPUT, FIXTURE_OPTS);
    const b = buildBrief(TRAVIS_INPUT, later);
    expect(b.findings.map((f) => f.id)).toEqual(a.findings.map((f) => f.id));
    expect(b.findings.map((f) => f.sentence)).toEqual(a.findings.map((f) => f.sentence));
    expect(b.digest.id).toBe(a.digest.id);
    expect(b.generatedAt).toBe("2027-01-05T09:30:00.000Z");
    expect(serialise({ ...b, generatedAt: a.generatedAt })).toBe(serialise(a));
  });

  it("names the withheld cells, prints no jobs move and never prints a withheld cell as zero", () => {
    const b = buildBrief(LOVING_INPUT, FIXTURE_OPTS);
    const gap = b.findings.find((f) => f.kind === "gap");
    expect(gap, "the withheld QCEW cells produced no gap finding").toBeDefined();
    expect(gap!.sentence).toContain("absent rather than zero");
    expect(gap!.sentence).toContain("Loving County");
    expect(b.findings.filter((f) => f.metric.startsWith("jobs."))).toEqual([]);
    const text = briefText(b);
    expect(text).not.toContain("$0");
    expect(text).not.toMatch(/\b0 jobs\b/);
    expect(text).not.toMatch(/employment[^.]*\b0\b/);
  });

  it("still produces a brief, a digest and a status for a county that published nothing", () => {
    const b = buildBrief(KING_INPUT, FIXTURE_OPTS);
    expect(b.findings).toEqual([]);
    expect(b.status).toBe("no data");
    expect(b.digest.sentence).toContain("No rule fired for King County this run");
    expect(b.digest.sentence).toContain("No level in the rule table was crossed.");
    expect(b.digest.id).toBeTruthy();
    expect(b.headline).toBe("King County: no published figures this run");
    expect(b.caveats).toEqual([]);
  });

  it("says in words that a QCEW comparison is BLS's own published over-the-year change", () => {
    const b = buildBrief(TRAVIS_INPUT, UNCAPPED);
    const jobs = b.findings.filter((f) => f.metric.startsWith("jobs.yoy."));
    expect(jobs.length).toBeGreaterThan(0);
    for (const f of jobs) {
      expect(f.sentence).toContain("published over-the-year change");
      expect(f.sentence).not.toMatch(/from .* to /);
    }
    expect(b.caveats).toContain(QCEW_OTY_CAVEAT);
    expect(buildBrief(KING_INPUT, FIXTURE_OPTS).caveats).not.toContain(QCEW_OTY_CAVEAT);
  });

  it("keeps the worst findings under a cap and counts the rest in the digest", () => {
    const full = buildBrief(TRAVIS_INPUT, FIXTURE_OPTS);
    const capped = buildBrief(TRAVIS_INPUT, { ...FIXTURE_OPTS, maxFindings: 3 });
    expect(capped.findings).toHaveLength(3);
    expect(capped.findings.map((f) => f.id)).toEqual(full.findings.slice(0, 3).map((f) => f.id));
    expect(capped.digest.sentence).toMatch(/further findings are not listed here\./);
    // The cap hides findings; it never changes the count the digest reports.
    expect(capped.digest.magnitude).toBe(full.digest.magnitude);
  });

  it("changes exactly one finding id when one input value changes", () => {
    const before = buildBrief(TRAVIS_INPUT, UNCAPPED);
    const after = buildBrief({ ...TRAVIS_INPUT, values: { ...TRAVIS_INPUT.values, "home.latest": 460000 } }, UNCAPPED);
    const beforeIds = new Set(before.findings.map((f) => f.id));
    const afterIds = new Set(after.findings.map((f) => f.id));
    const gone = [...beforeIds].filter((id) => !afterIds.has(id));
    const added = [...afterIds].filter((id) => !beforeIds.has(id));
    expect(gone).toHaveLength(1);
    expect(added).toHaveLength(1);
  });

  it("reads a crossing, a held level and a standing level apart", () => {
    const b = buildBrief(TRAVIS_INPUT, FIXTURE_OPTS);
    const thresholds = b.findings.filter((f) => f.kind === "threshold");
    expect(thresholds.length).toBeGreaterThan(0);
    const text = thresholds.map((f) => f.sentence).join(" ");
    expect(text).toContain("It was on the other side of that line in the previous published period.");
    expect(text).toContain("It was on the same side of that line in the previous published period.");
    expect(text).toContain("standing level rather than a change");
  });

  it("filters to a lens without dropping the holes", () => {
    const water = buildBrief({ ...TRAVIS_INPUT, lens: "water" }, UNCAPPED);
    const keep = lensFamilies("water")!;
    expect([...keep].sort()).toEqual(["housing", "water"]);
    expect(water.lens).toBe("water");
    // Every number shown belongs to a family the lens asked for; a hole —
    // metric "" — survives every lens, because a lens narrows which numbers
    // are shown, not which gaps are admitted to.
    for (const f of water.findings) {
      const family = familyOf(f.metric);
      expect(family == null || keep.has(family), `${f.metric} survived the water lens`).toBe(true);
    }
    expect(water.findings.some((f) => f.kind === "gap")).toBe(true);
    expect(water.findings.some((f) => f.metric.startsWith("jobs."))).toBe(false);
    // "explorer" carries no indicatorCategory and no screener, so it falls
    // back to the unfiltered default rather than emptying the brief.
    const explorer = buildBrief({ ...TRAVIS_INPUT, lens: "explorer" }, UNCAPPED);
    const plain = buildBrief(TRAVIS_INPUT, UNCAPPED);
    expect(explorer.findings.map((f) => f.id)).toEqual(plain.findings.map((f) => f.id));
  });
});
