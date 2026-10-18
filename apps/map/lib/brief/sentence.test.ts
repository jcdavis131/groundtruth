import { describe, expect, it } from "vitest";
import type { PeerStat } from "@/lib/places/percentiles";
import { PLACE_THRESHOLDS, type PlaceThreshold } from "./thresholds";
import { digestSentence, metricCopy, moveSentence, rankSentence, releaseSentence, suppressedSentence, thresholdSentence } from "./sentence";
import { METRO_METRICS } from "@/lib/places/percentiles";
import { fieldsFor } from "@/lib/screener/fields";

/**
 * A sentence-final period is one followed by whitespace or the end of the
 * string; a decimal point is followed by a digit and does not count. Exactly
 * one of these is the whole contract: every template emits one sentence.
 */
const sentenceFinal = (s: string): number => (s.match(/\.(\s|$)/g) ?? []).length;

const isOneSentence = (s: string) => {
  expect(s.endsWith("."), s).toBe(true);
  expect(sentenceFinal(s), s).toBe(1);
  expect(s.trim()).toBe(s);
};

const peer = (over: Partial<PeerStat> = {}): PeerStat => ({
  value: 24.3,
  pct: 96,
  rank: 812,
  n: 3088,
  min: 4,
  p25: 12,
  median: 16.4,
  p75: 20,
  max: 40,
  cohortKey: "county:us",
  cohortLabel: "US counties",
  ...over,
});

const fires = (t: PlaceThreshold): number => (t.op === "<" || t.op === "<=" ? t.value - 1 : t.value + 1);

describe("moveSentence", () => {
  const periods = { current: "2026-07-31", previous: "2026-06-30" };

  it("names the subject, the size, the direction, both periods and the source", () => {
    const { sentence } = moveSentence("home.latest", 457600, 452000, periods, "Travis County, TX");
    isOneSentence(sentence);
    expect(sentence).toContain("Travis County, TX's typical home value");
    expect(sentence).toContain("fell");
    expect(sentence).toContain("$457,600");
    expect(sentence).toContain("$452,000");
    expect(sentence).toContain("June 2026");
    expect(sentence).toContain("July 2026");
    expect(sentence).toContain("Zillow ZHVI");
  });

  it("prints the arithmetic, with both inputs and the result in the first line", () => {
    const { arithmetic } = moveSentence("home.latest", 457600, 452000, periods, "Travis County, TX");
    expect(arithmetic.length).toBeGreaterThan(0);
    expect(arithmetic[0]).toContain("452000");
    expect(arithmetic[0]).toContain("457600");
    expect(arithmetic[0]).toContain("-1.2%");
    expect(arithmetic.some((a) => a.includes("2026-07-31"))).toBe(true);
  });

  it("says rose for a rise and held at for no change, and never divides by zero", () => {
    expect(moveSentence("jobs.emp", 700000, 780000, { current: "2026-Q1", previous: "2025-Q4" }, "Travis County, TX").sentence).toContain("rose");
    const flat = moveSentence("rent.latest", 1800, 1800, periods, "Travis County, TX");
    isOneSentence(flat.sentence);
    expect(flat.sentence).toContain("held at");
    const fromZero = moveSentence("jobs.emp", 0, 40, periods, "Loving County, TX");
    isOneSentence(fromZero.sentence);
    expect(fromZero.arithmetic[0]).toBe("40 = 40 - 0");
  });

  it("keeps a quarter label as a quarter rather than inventing a month", () => {
    const { sentence } = moveSentence("jobs.emp", 700000, 780000, { current: "2026-Q1", previous: "2025-Q4" }, "Travis County, TX");
    expect(sentence).toContain("2026-Q1");
    expect(sentence).toContain("2025-Q4");
    isOneSentence(sentence);
  });
});

describe("thresholdSentence", () => {
  it("prints the citation next to the label for every rule in every table", () => {
    for (const kind of ["county", "metro", "state"] as const) {
      for (const t of PLACE_THRESHOLDS[kind]) {
        const s = thresholdSentence(t, fires(t), "Travis County, TX", t.on === "pct" ? peer() : undefined);
        isOneSentence(s);
        expect(s, `${kind} ${t.metric}`).toContain(t.citation);
        expect(s, `${kind} ${t.metric}`).toContain(t.label);
      }
    }
  });

  it("says watch or alert in words, and never says a line was crossed on a date", () => {
    const watch = PLACE_THRESHOLDS.county.find((t) => t.level === "watch")!;
    const alert = PLACE_THRESHOLDS.county.find((t) => t.level === "alert")!;
    expect(thresholdSentence(watch, fires(watch), "Travis County, TX", peer())).toContain("a watch level here");
    expect(thresholdSentence(alert, fires(alert), "Travis County, TX")).toContain("an alert level here");
    for (const t of PLACE_THRESHOLDS.county) {
      expect(thresholdSentence(t, fires(t), "Travis County, TX", peer())).not.toContain("crossed");
    }
  });

  it("prints the peer position for a percentile rule, and degrades when there is no rank", () => {
    const t = PLACE_THRESHOLDS.county.find((x) => x.on === "pct")!;
    expect(thresholdSentence(t, 26, "Travis County, TX", peer())).toContain("812th of 3,088 US counties");
    const noRank = thresholdSentence(t, 26, "Travis County, TX", peer({ rank: null }));
    isOneSentence(noRank);
    expect(noRank).toContain("US counties");
  });
});

describe("rankSentence", () => {
  it("prints the value, the position, the cohort size and the median", () => {
    const s = rankSentence("priceToRent", peer(), "Travis County, TX");
    isOneSentence(s);
    expect(s).toContain("24.3");
    expect(s).toContain("812th of 3,088");
    expect(s).toContain("US counties");
    expect(s).toContain("16.4");
  });

  it("says why there is no rank instead of printing a rank of one", () => {
    const s = rankSentence("priceToRent", peer({ rank: null, pct: null, n: 2, reason: "only 2 US counties published it this month" }), "Loving County, TX");
    isOneSentence(s);
    expect(s).toContain("no rank");
    expect(s).toContain("only 2 US counties published it this month");
  });
});

describe("suppressedSentence", () => {
  it("says the figures are absent, never zero", () => {
    const s = suppressedSentence(["jobs.emp", "jobs.avgWeeklyWage"], "Loving County, TX");
    isOneSentence(s);
    expect(s).toContain("absent");
    expect(s).toContain("employment");
    expect(s).toContain("wage");
    expect(s).not.toMatch(/(^|\s)0([\s,.]|$)/);
  });

  it("collapses duplicate nouns and still reads as one sentence when nothing was withheld", () => {
    expect(suppressedSentence(["jobs.emp", "jobs.yoy.emp"], "Loving County, TX")).toContain("employment cells");
    const none = suppressedSentence([], "Travis County, TX");
    isOneSentence(none);
    expect(none).toContain("absent");
  });
});

describe("releaseSentence", () => {
  it("prints a window and says how firmly the date is known", () => {
    const official = releaseSentence(
      { title: "BLS QCEW county file", earliest: "2026-09-02", latest: "2026-09-02", precision: "official" },
      "Travis County, TX",
    );
    isOneSentence(official);
    expect(official).toContain("on 2026-09-02");
    expect(official).toContain("publisher's own calendar");

    const approx = releaseSentence(
      { title: "Zillow ZHVI", earliest: "2026-09-15", latest: "2026-09-22", precision: "approximate" },
      "Travis County, TX",
    );
    isOneSentence(approx);
    expect(approx).toContain("between 2026-09-15 and 2026-09-22");
    expect(approx).toContain("estimated");
  });
});

describe("digestSentence", () => {
  it("counts the findings and anchors them to published headline values", () => {
    const s = digestSentence(
      "Travis County, TX",
      { "home.latest": 452000, "jobs.emp": 780123 },
      { "home.latest": "2026-07-31", "jobs.emp": "2026-Q1" },
      3,
    );
    isOneSentence(s);
    expect(s).toContain("3 findings");
    expect(s).toContain("$452,000");
    expect(s).toContain("July 2026");
    expect(s).toContain("780,123");
    expect(s).toContain("2026-Q1");
  });

  it("uses the singular for one finding and says so when nothing fired or nothing published", () => {
    const one = digestSentence("Travis County, TX", { "home.latest": 452000 }, { "home.latest": "2026-07-31" }, 1);
    isOneSentence(one);
    expect(one).toContain("1 finding fired");
    const none = digestSentence("Loving County, TX", {}, {}, 0);
    isOneSentence(none);
    expect(none).toContain("No rule fired");
    expect(none).toContain("no published headline value");
  });
});

describe("determinism", () => {
  it("produces byte-identical output for the same inputs on two calls", () => {
    const periods = { current: "2026-07-31", previous: "2026-06-30" };
    const t = PLACE_THRESHOLDS.county[0];
    const once = [
      moveSentence("home.latest", 457600, 452000, periods, "Travis County, TX").sentence,
      moveSentence("home.latest", 457600, 452000, periods, "Travis County, TX").arithmetic.join("|"),
      thresholdSentence(t, fires(t), "Travis County, TX"),
      rankSentence("priceToRent", peer(), "Travis County, TX"),
      suppressedSentence(["jobs.emp"], "Loving County, TX"),
      releaseSentence({ title: "Zillow ZHVI", earliest: "2026-09-15", latest: "2026-09-22", precision: "approximate" }, "Travis County, TX"),
      digestSentence("Travis County, TX", { "home.latest": 452000 }, { "home.latest": "2026-07-31" }, 2),
    ];
    const twice = [
      moveSentence("home.latest", 457600, 452000, periods, "Travis County, TX").sentence,
      moveSentence("home.latest", 457600, 452000, periods, "Travis County, TX").arithmetic.join("|"),
      thresholdSentence(t, fires(t), "Travis County, TX"),
      rankSentence("priceToRent", peer(), "Travis County, TX"),
      suppressedSentence(["jobs.emp"], "Loving County, TX"),
      releaseSentence({ title: "Zillow ZHVI", earliest: "2026-09-15", latest: "2026-09-22", precision: "approximate" }, "Travis County, TX"),
      digestSentence("Travis County, TX", { "home.latest": 452000 }, { "home.latest": "2026-07-31" }, 2),
    ];
    expect(twice).toEqual(once);
  });
});

describe("metricCopy covers every metric a page can rank", () => {
  // metricCopy falls back to the raw key as the noun, and that noun is written
  // straight into a <title> and a meta description — a metro page once shipped
  // "emp in the top 7% of US metro areas". A fallback is the right behaviour at
  // runtime and the wrong thing to discover in production, so every metric the
  // percentile engine can actually rank is pinned here.
  const ranked = [
    ...METRO_METRICS,
    ...fieldsFor("county").filter((f) => f.kind !== "string").map((f) => f.key),
    ...fieldsFor("state").filter((f) => f.kind !== "string").map((f) => f.key),
  ];

  it.each([...new Set(ranked)])("has copy for %s", (metric) => {
    expect(metricCopy(metric).noun, `metricCopy fell back to the raw key for "${metric}"`).not.toBe(metric);
  });
});
