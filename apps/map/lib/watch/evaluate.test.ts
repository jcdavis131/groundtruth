import { describe, expect, it } from "vitest";
import { evaluate, fmtValue, pctChange, stateKey, threshold, type WatchState } from "./evaluate";
import type { Rule, Watchlist } from "./model";
import type { ResolveResult } from "./resolve";

const NOW = Date.parse("2026-09-10T12:00:00Z");

function wl(rules: Rule[], items: Watchlist["items"] = [{ kind: "county", id: "48453", name: "Travis" }, { kind: "gauge", id: "USGS-1" }]): Watchlist {
  return { id: "t", title: "T", items, rules, createdAt: "2026-09-01T00:00:00Z", version: 1 };
}

const county = (yoy: number | null): ResolveResult => ({ ok: true, kind: "county", id: "48453", name: "Travis County, TX", metrics: { "home.yoyPct": yoy, "home.latest": 500_000 }, asOf: "2026-07-31", provenance: [], link: "https://g/c" });
const gauge = (stage: number, previous?: number): ResolveResult => ({ ok: true, kind: "gauge", id: "USGS-1", name: "River", metrics: { stage }, previous: previous == null ? undefined : { stage: previous }, asOf: "2026-09-10T11:45:00Z", provenance: [], link: "https://g/g" });
const failed: ResolveResult = { ok: false, kind: "gauge", id: "USGS-1", name: "gauge USGS-1", error: "USGS down", link: "https://g/g" };

describe("threshold ops", () => {
  it("compare plainly", () => {
    expect(threshold("<", 1, 2)).toBe(true);
    expect(threshold(">", 1, 2)).toBe(false);
    expect(threshold("<=", 2, 2)).toBe(true);
    expect(threshold(">=", 2, 2)).toBe(true);
    expect(threshold("crosses_above", 5, 2)).toBe(false);
  });

  it("fire against the current value and carry a message with the name", () => {
    const e = evaluate(wl([{ itemRef: 0, metric: "home.yoyPct", op: ">=", value: 3 }]), [county(3.4), gauge(2)], null, NOW);
    expect(e.events).toHaveLength(1);
    expect(e.events[0]).toMatchObject({ itemRef: 0, ruleIndex: 0, metric: "home.yoyPct", value: 3.4, basis: "threshold", link: "https://g/c", firedAt: new Date(NOW).toISOString() });
    expect(e.events[0].message).toBe("Travis County, TX: home.yoyPct 3.40 at or above 3.00");
    expect(e.checked).toBe(1);
  });

  it("do not fire when the comparison fails", () => {
    const e = evaluate(wl([{ itemRef: 0, metric: "home.yoyPct", op: "<", value: 3 }]), [county(3.4), gauge(2)], null, NOW);
    expect(e.events).toEqual([]);
  });
});

describe("itemRef and skips", () => {
  it('"*" applies to every item that publishes the metric, silently skipping others', () => {
    const e = evaluate(wl([{ itemRef: "*", metric: "stage", op: ">", value: 1 }]), [county(3), gauge(2)], null, NOW);
    expect(e.events.map((x) => x.itemRef)).toEqual([1]);
    expect(e.skipped).toEqual([]);
  });
  it("an explicit itemRef without the metric is reported", () => {
    const e = evaluate(wl([{ itemRef: 0, metric: "stage", op: ">", value: 1 }]), [county(3), gauge(2)], null, NOW);
    expect(e.events).toEqual([]);
    expect(e.skipped[0].reason).toMatch(/publishes no "stage"/);
  });
  it("null values, failed items and out-of-range refs are skipped with reasons", () => {
    const e = evaluate(wl([{ itemRef: 0, metric: "home.yoyPct", op: ">", value: 1 }, { itemRef: 1, metric: "stage", op: ">", value: 1 }, { itemRef: 5, metric: "x", op: ">", value: 1 }]), [county(null), failed], null, NOW);
    expect(e.events).toEqual([]);
    expect(e.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/is null/), expect.stringMatching(/did not resolve: USGS down/), expect.stringMatching(/past the end/)]);
    expect(e.caveats.some((c) => c.includes("USGS down"))).toBe(true);
  });
});

describe("crosses_* without previous state", () => {
  it("degrades to a threshold check and says so", () => {
    const e = evaluate(wl([{ itemRef: 1, metric: "stage", op: "crosses_above", value: 3 }]), [county(1), gauge(3.5)], null, NOW);
    expect(e.events).toHaveLength(1);
    expect(e.events[0].basis).toBe("degraded");
    expect(e.events[0].message).toMatch(/threshold check/);
    expect(e.caveats.some((c) => c.includes("fell back to a plain threshold"))).toBe(true);
    expect(e.caveats.some((c) => c.includes("stateless"))).toBe(true);
  });
  it("crosses_below degraded", () => {
    const e = evaluate(wl([{ itemRef: 1, metric: "stage", op: "crosses_below", value: 3 }]), [county(1), gauge(2.5)], null, NOW);
    expect(e.events).toHaveLength(1);
    expect(evaluate(wl([{ itemRef: 1, metric: "stage", op: "crosses_below", value: 3 }]), [county(1), gauge(3.5)], null, NOW).events).toEqual([]);
  });
});

describe("crosses_* with state", () => {
  const rule: Rule = { itemRef: 1, metric: "stage", op: "crosses_above", value: 3 };
  const stateWith = (v: number | null): WatchState => ({ version: 1, updatedAt: "x", values: { [stateKey("gauge", "USGS-1", "stage")]: { value: v, asOf: "y", at: "z" } } });

  it("fires only on an actual crossing", () => {
    expect(evaluate(wl([rule]), [county(1), gauge(3.5)], stateWith(2.9), NOW).events).toHaveLength(1);
    expect(evaluate(wl([rule]), [county(1), gauge(3.5)], stateWith(3.2), NOW).events).toEqual([]); // already above
    expect(evaluate(wl([rule]), [county(1), gauge(2.5)], stateWith(2.0), NOW).events).toEqual([]); // still below
    const e = evaluate(wl([rule]), [county(1), gauge(3.0)], stateWith(2.9), NOW);
    expect(e.events[0].basis).toBe("state");
    expect(e.events[0].previous).toBe(2.9);
    expect(e.events[0].message).toBe("River: stage 3.00 crossed above 3.00 (was 2.90)");
    expect(e.caveats).toEqual([]);
  });

  it("crosses_below mirrors", () => {
    const r: Rule = { itemRef: 1, metric: "stage", op: "crosses_below", value: 3 };
    expect(evaluate(wl([r]), [county(1), gauge(2.5)], stateWith(3.2), NOW).events).toHaveLength(1);
    expect(evaluate(wl([r]), [county(1), gauge(2.5)], stateWith(2.8), NOW).events).toEqual([]);
  });

  it("prefers the resolver's own look-back over stored state", () => {
    const e = evaluate(wl([rule]), [county(1), gauge(3.5, 2.0)], stateWith(3.4), NOW);
    expect(e.events).toHaveLength(1);
    expect(e.events[0].basis).toBe("lookback");
  });

  it("a null stored value counts as no reference (degrades)", () => {
    const e = evaluate(wl([rule]), [county(1), gauge(3.5)], stateWith(null), NOW);
    expect(e.events[0].basis).toBe("degraded");
  });

  it("writes every metric into the next state and keeps entries for items that failed this run", () => {
    const prev: WatchState = { version: 1, updatedAt: "x", values: { [stateKey("gauge", "USGS-1", "stage")]: { value: 9, asOf: "old", at: "old" } } };
    const e = evaluate(wl([]), [county(2), failed], prev, NOW);
    expect(e.state.values[stateKey("county", "48453", "home.yoyPct")]).toEqual({ value: 2, asOf: "2026-07-31", at: new Date(NOW).toISOString() });
    expect(e.state.values[stateKey("county", "48453", "home.latest")].value).toBe(500_000);
    expect(e.state.values[stateKey("gauge", "USGS-1", "stage")].value).toBe(9);
    expect(e.state.updatedAt).toBe(new Date(NOW).toISOString());
  });
});

describe("changes_by_pct", () => {
  const up: Rule = { itemRef: 1, metric: "stage", op: "changes_by_pct", value: 10, window: "7d" };
  const down: Rule = { itemRef: 1, metric: "stage", op: "changes_by_pct", value: -10 };

  it("fires on the signed percent change from the reference", () => {
    const e = evaluate(wl([up, down]), [county(1), gauge(2.2, 2.0)], null, NOW);
    expect(e.events).toHaveLength(1);
    expect(e.events[0].ruleIndex).toBe(0);
    expect(e.events[0].message).toBe("River: stage 2.20 changed by +10.0 % (from 2.00; rule +10 %)");
    const f = evaluate(wl([up, down]), [county(1), gauge(1.7, 2.0)], null, NOW);
    expect(f.events.map((x) => x.ruleIndex)).toEqual([1]);
    expect(evaluate(wl([up, down]), [county(1), gauge(2.1, 2.0)], null, NOW).events).toEqual([]);
  });

  it("is skipped without a reference, and when the reference is zero", () => {
    const e = evaluate(wl([up]), [county(1), gauge(2.2)], null, NOW);
    expect(e.events).toEqual([]);
    expect(e.skipped[0].reason).toMatch(/no reference value/);
    const z = evaluate(wl([up]), [county(1), gauge(2.2, 0)], null, NOW);
    expect(z.skipped[0].reason).toMatch(/zero/);
  });

  it("uses stored state when the resolver has no look-back", () => {
    const st: WatchState = { version: 1, updatedAt: "x", values: { [stateKey("gauge", "USGS-1", "stage")]: { value: 2, asOf: "y", at: "z" } } };
    const e = evaluate(wl([up]), [county(1), gauge(2.5)], st, NOW);
    expect(e.events).toHaveLength(1);
    expect(e.events[0].basis).toBe("state");
  });
});

describe("formatting", () => {
  it("fmtValue and pctChange", () => {
    expect(fmtValue(1234567.8)).toBe("1,234,568");
    expect(fmtValue(12.345)).toBe("12.3");
    expect(fmtValue(-0.5)).toBe("-0.50");
    expect(pctChange(0, 1)).toBeNull();
    expect(pctChange(-10, -5)).toBe(50);
  });
});
