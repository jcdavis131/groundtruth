// Rule evaluation. Pure: a watchlist, the resolved values, and (optionally)
// what the last run saw go in; events and the next state come out.
//
// Threshold ops (<, >, <=, >=) need only the current value. crosses_above /
// crosses_below / changes_by_pct need a reference: the resolver's own
// look-back when it has one (series, indicator), else the value stored by the
// previous evaluation. With neither, crosses_* degrade to threshold checks
// and changes_by_pct is skipped, and the caveats say so; a stateless feed
// reader still gets something honest.

import { itemLabel, type Rule, type RuleOp, type Watchlist } from "./model";
import type { ResolveResult } from "./resolve";

export interface StateValue {
  value: number | null;
  /** Period the value described. */
  asOf: string;
  /** ISO time the value was recorded. */
  at: string;
}

/** What one evaluation leaves behind for the next: last value per item and metric. */
export interface WatchState {
  version: 1;
  updatedAt: string;
  /** "<kind>:<id>|<metric>" -> last seen. */
  values: Record<string, StateValue>;
}

export interface WatchEvent {
  itemRef: number;
  ruleIndex: number;
  rule: Rule;
  kind: string;
  itemId: string;
  name: string;
  metric: string;
  value: number;
  /** Reference value the op compared against, when it had one. */
  previous?: number | null;
  /** How the reference was obtained. */
  basis: "threshold" | "lookback" | "state" | "degraded";
  firedAt: string;
  asOf: string;
  message: string;
  link: string;
}

export interface Skipped {
  itemRef: number;
  ruleIndex: number;
  reason: string;
}

export interface Evaluation {
  events: WatchEvent[];
  state: WatchState;
  caveats: string[];
  /** Rule x item pairs that had a number to test. */
  checked: number;
  skipped: Skipped[];
}

export function stateKey(kind: string, id: string, metric: string): string {
  return `${kind}:${id}|${metric}`;
}

export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString("en-US");
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

const OP_TEXT: Record<RuleOp, string> = {
  "<": "below",
  ">": "above",
  "<=": "at or below",
  ">=": "at or above",
  crosses_above: "crossed above",
  crosses_below: "crossed below",
  changes_by_pct: "changed by",
};

/** Pure comparison for the four threshold ops. */
export function threshold(op: RuleOp, cur: number, value: number): boolean {
  switch (op) {
    case "<":
      return cur < value;
    case ">":
      return cur > value;
    case "<=":
      return cur <= value;
    case ">=":
      return cur >= value;
    default:
      return false;
  }
}

/** Percent change from `ref` to `cur`; null when the reference is zero. */
export function pctChange(ref: number, cur: number): number | null {
  if (ref === 0) return null;
  return ((cur - ref) / Math.abs(ref)) * 100;
}

interface Test {
  fired: boolean;
  basis: WatchEvent["basis"];
  previous?: number | null;
  skip?: string;
  degraded?: boolean;
}

function test(rule: Rule, cur: number, ref: number | null | undefined, refBasis: "lookback" | "state" | undefined): Test {
  const hasRef = typeof ref === "number" && Number.isFinite(ref);
  switch (rule.op) {
    case "<":
    case ">":
    case "<=":
    case ">=":
      return { fired: threshold(rule.op, cur, rule.value), basis: "threshold" };
    case "crosses_above":
      if (!hasRef) return { fired: cur >= rule.value, basis: "degraded", degraded: true };
      return { fired: ref < rule.value && cur >= rule.value, basis: refBasis ?? "state", previous: ref };
    case "crosses_below":
      if (!hasRef) return { fired: cur <= rule.value, basis: "degraded", degraded: true };
      return { fired: ref > rule.value && cur <= rule.value, basis: refBasis ?? "state", previous: ref };
    case "changes_by_pct": {
      if (!hasRef) return { fired: false, basis: "degraded", skip: "no reference value for changes_by_pct (first run, or stateless feed)" };
      const pct = pctChange(ref, cur);
      if (pct == null) return { fired: false, basis: refBasis ?? "state", previous: ref, skip: "reference value is zero; percent change undefined" };
      const fired = rule.value > 0 ? pct >= rule.value : pct <= rule.value;
      return { fired, basis: refBasis ?? "state", previous: ref };
    }
  }
}

function message(name: string, rule: Rule, cur: number, t: Test): string {
  const unitless = `${name}: ${rule.metric} ${fmtValue(cur)}`;
  if (rule.op === "changes_by_pct" && typeof t.previous === "number") {
    const pct = pctChange(t.previous, cur) ?? 0;
    return `${unitless} ${OP_TEXT[rule.op]} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)} % (from ${fmtValue(t.previous)}; rule ${rule.value > 0 ? "+" : ""}${rule.value} %)`;
  }
  const opText = t.degraded ? (rule.op === "crosses_above" ? "at or above" : "at or below") : OP_TEXT[rule.op];
  const prev = typeof t.previous === "number" ? ` (was ${fmtValue(t.previous)})` : t.degraded ? " (no previous value; threshold check)" : "";
  return `${unitless} ${opText} ${fmtValue(rule.value)}${prev}`;
}

/**
 * Evaluate every rule against every resolved item it refers to.
 * `previous` is the state the last evaluation returned (null when stateless).
 */
export function evaluate(wl: Watchlist, results: ResolveResult[], previous?: WatchState | null, now: number = Date.now()): Evaluation {
  const firedAt = new Date(now).toISOString();
  const events: WatchEvent[] = [];
  const skipped: Skipped[] = [];
  const caveats = new Set<string>();
  let checked = 0;
  let degraded = 0;
  const prevValues = previous?.values ?? {};
  const nextValues: Record<string, StateValue> = { ...prevValues };

  // Record what we saw first, so state carries every metric, ruled or not.
  results.forEach((r, i) => {
    if (!r.ok) {
      caveats.add(`${itemLabel(wl.items[i] ?? { kind: r.kind, id: r.id })}: ${r.error}`);
      return;
    }
    for (const [metric, value] of Object.entries(r.metrics)) {
      nextValues[stateKey(r.kind, r.id, metric)] = { value, asOf: r.asOf, at: firedAt };
    }
  });

  wl.rules.forEach((rule, ruleIndex) => {
    const targets = rule.itemRef == null || rule.itemRef === "*" ? results.map((_, i) => i) : [rule.itemRef];
    for (const itemRef of targets) {
      const r = results[itemRef];
      if (!r) {
        skipped.push({ itemRef, ruleIndex, reason: "itemRef points past the end of items" });
        continue;
      }
      if (!r.ok) {
        skipped.push({ itemRef, ruleIndex, reason: `item did not resolve: ${r.error}` });
        continue;
      }
      if (!(rule.metric in r.metrics)) {
        if (rule.itemRef !== "*" && rule.itemRef != null) skipped.push({ itemRef, ruleIndex, reason: `item publishes no "${rule.metric}" metric` });
        continue;
      }
      const cur = r.metrics[rule.metric];
      if (cur == null || !Number.isFinite(cur)) {
        skipped.push({ itemRef, ruleIndex, reason: `"${rule.metric}" is null (withheld or not published this period)` });
        continue;
      }
      checked++;
      let ref: number | null | undefined;
      let refBasis: "lookback" | "state" | undefined;
      if (r.previous && rule.metric in r.previous) {
        ref = r.previous[rule.metric];
        refBasis = "lookback";
      } else {
        const st = prevValues[stateKey(r.kind, r.id, rule.metric)];
        if (st) {
          ref = st.value;
          refBasis = "state";
        }
      }
      const t = test(rule, cur, ref, refBasis);
      if (t.degraded) degraded++;
      if (t.skip) {
        skipped.push({ itemRef, ruleIndex, reason: t.skip });
        continue;
      }
      if (!t.fired) continue;
      events.push({
        itemRef,
        ruleIndex,
        rule,
        kind: r.kind,
        itemId: r.id,
        name: r.name,
        metric: rule.metric,
        value: cur,
        previous: t.previous,
        basis: t.basis,
        firedAt,
        asOf: r.asOf,
        message: message(r.name, rule, cur, t),
        link: r.link,
      });
    }
  });

  if (degraded) caveats.add(`${degraded} crosses_above/crosses_below check${degraded === 1 ? "" : "s"} had no previous value (first run, or the server keeps no state) and fell back to a plain threshold; the next run with state will only fire on an actual crossing.`);
  if (!previous) caveats.add("No previous state: this evaluation is stateless. Publish the list (POST /api/watch) on a server with GEV_WATCH_KV enabled to get true crossing alerts.");

  return {
    events,
    state: { version: 1, updatedAt: firedAt, values: nextValues },
    caveats: [...caveats],
    checked,
    skipped,
  };
}
