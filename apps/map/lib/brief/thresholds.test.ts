import { describe, expect, it } from "vitest";
import { fieldsFor } from "@/lib/screener/fields";
import type { PeerStat } from "@/lib/places/percentiles";
import { nationalPeer, triggeredPlaceThresholds, PLACE_THRESHOLDS, type PlaceThreshold } from "./thresholds";

const KINDS = ["county", "metro", "state"] as const;
const DERIVED = ["home.momPct", "rent.momPct"];

const peer = (over: Partial<PeerStat> = {}): PeerStat => ({
  value: 24.3,
  pct: 96,
  rank: 120,
  n: 3088,
  min: 4,
  p25: 12,
  median: 16,
  p75: 20,
  max: 40,
  cohortKey: "county:us",
  cohortLabel: "US counties",
  ...over,
});

/** A value on the firing side of the rule. */
const fires = (t: PlaceThreshold): number => (t.op === "<" || t.op === "<=" ? t.value - 1 : t.value + 1);

describe("PLACE_THRESHOLDS", () => {
  it("gives every entry a non-empty label and a non-empty citation", () => {
    for (const kind of KINDS) {
      for (const t of PLACE_THRESHOLDS[kind]) {
        expect(t.label.length, `${kind} ${t.metric}`).toBeGreaterThan(0);
        expect(t.citation.length, `${kind} ${t.metric}`).toBeGreaterThan(0);
        expect(["watch", "alert"]).toContain(t.level);
        expect(["<", "<=", ">", ">="]).toContain(t.op);
        expect(["value", "yoyPct", "momPct", "pct"]).toContain(t.on);
        expect(Number.isFinite(t.value)).toBe(true);
      }
    }
  });

  it("names only metrics the screener publishes, plus the two derived month-over-month keys", () => {
    const known = new Set([...fieldsFor("county").map((f) => f.key), ...DERIVED]);
    for (const kind of KINDS) {
      for (const t of PLACE_THRESHOLDS[kind]) {
        expect(known.has(t.metric), `${kind}: ${t.metric}`).toBe(true);
      }
    }
  });

  it("ships a county table big enough to be a rule set, and a reduced metro table", () => {
    expect(PLACE_THRESHOLDS.county.length).toBeGreaterThanOrEqual(10);
    expect(PLACE_THRESHOLDS.metro.length).toBeLessThan(PLACE_THRESHOLDS.county.length);
  });

  it("omits rent and price-to-rent from the state table, because zoriState is always null", () => {
    for (const t of PLACE_THRESHOLDS.state) {
      expect(t.metric.startsWith("rent."), t.metric).toBe(false);
      expect(t.metric).not.toBe("priceToRent");
    }
  });

  it("carries no QCEW rule on the metro table, because there is no metro QCEW path", () => {
    for (const t of PLACE_THRESHOLDS.metro) expect(t.metric.startsWith("jobs.")).toBe(false);
  });
});

describe("triggeredPlaceThresholds", () => {
  it("skips a rule whose metric is missing rather than firing it", () => {
    const missing = triggeredPlaceThresholds("county", { "home.yoyPct": null }, {});
    expect(missing).toEqual([]);
    const absent = triggeredPlaceThresholds("county", {}, {});
    expect(absent).toEqual([]);
    const notFinite = triggeredPlaceThresholds("county", { "home.yoyPct": Number.NaN }, {});
    expect(notFinite).toEqual([]);
  });

  it("fires on the published value and keeps the threshold object intact", () => {
    const out = triggeredPlaceThresholds("county", { "home.yoyPct": -6.2 }, {});
    expect(out.length).toBe(2);
    expect(out.map((t) => t.threshold.level).sort()).toEqual(["alert", "watch"]);
    for (const t of out) {
      expect(t.value).toBe(-6.2);
      expect(t.threshold.citation).toBe(PLACE_THRESHOLDS.county.find((x) => x === t.threshold)!.citation);
      expect(t.threshold.citation.length).toBeGreaterThan(0);
      expect(t.peer).toBeUndefined();
    }
  });

  it("does not fire an on:pct rule when the national percentile is null", () => {
    const values = { priceToRent: 30 };
    const withPct = triggeredPlaceThresholds("county", values, { priceToRent: [peer({ pct: 96 })] });
    expect(withPct.some((t) => t.threshold.on === "pct")).toBe(true);
    expect(withPct.find((t) => t.threshold.on === "pct")!.peer?.pct).toBe(96);

    const nullPct = triggeredPlaceThresholds("county", values, { priceToRent: [peer({ pct: null, rank: null, reason: "too few peers" })] });
    expect(nullPct.some((t) => t.threshold.on === "pct")).toBe(false);

    const noCohort = triggeredPlaceThresholds("county", values, {});
    expect(noCohort.some((t) => t.threshold.on === "pct")).toBe(false);
  });

  it("reads the national cohort only, never a state or metro one", () => {
    const stateOnly = [peer({ cohortKey: "county:state:TX", cohortLabel: "Texas counties", pct: 99 })];
    expect(nationalPeer(stateOnly)).toBeUndefined();
    const out = triggeredPlaceThresholds("county", { priceToRent: 30 }, { priceToRent: stateOnly });
    expect(out.some((t) => t.threshold.on === "pct")).toBe(false);
    expect(nationalPeer([...stateOnly, peer()])?.cohortKey).toBe("county:us");
  });

  it("evaluates every rule in every table without throwing when fed a firing value", () => {
    for (const kind of KINDS) {
      for (const t of PLACE_THRESHOLDS[kind]) {
        const out = triggeredPlaceThresholds(kind, { [t.metric]: fires(t) }, { [t.metric]: [peer({ pct: t.op === "<" || t.op === "<=" ? 2 : 98 })] });
        expect(out.some((x) => x.threshold === t), `${kind} ${t.metric} ${t.op} ${t.value} on ${t.on}`).toBe(true);
      }
    }
  });
});
