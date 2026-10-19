// Axes and number formatting for the renderer. The scale arithmetic is
// lib/desk/chart.ts's (niceTicks, scaleLinear), imported, not copied; the
// formatting is lib/brief/format.ts's, so a number on a chart and the same
// number in a brief sentence are the same characters.

import { niceTicks, scaleLinear, type Extent } from "@/lib/desk/chart";
import { num, pct, signedPct, usd } from "@/lib/brief/format";
import { defaults, type AxisSpec, type Format } from "./spec";

export { niceTicks, scaleLinear };
export type { Extent };

/** A value in one of the four v1 formats; null and non-finite read "not published" (format.ts MISSING). */
export function formatValue(v: number | null | undefined, format: Format, digits = 0): string {
  switch (format) {
    case "pct":
      return pct(v, digits);
    case "signedPct":
      return signedPct(v, digits);
    case "num":
      return num(v, digits);
    case "usd":
      return usd(v, digits);
  }
}

/**
 * Decimal places for a data value (the table, the description, a subject
 * note), as opposed to a tick: the axis's own digits, but at least one for a
 * percent, which is how lib/brief prints percents ("+36.0%").
 */
export function valueDigits(format: Format, digits?: number): number {
  return Math.max(digits ?? defaults.digits, format === "pct" || format === "signedPct" ? 1 : 0);
}

/**
 * A tick label. Same as formatValue except that the zero tick of a signedPct
 * axis reads "0%": a gridline at zero has no direction, and "+0%" would
 * suggest one.
 */
export function formatTick(v: number, format: Format, digits = 0): string {
  if (format === "signedPct" && v === 0) return pct(0, digits);
  return formatValue(v, format, digits);
}

/** Decimal places a step needs to print exactly (10 -> 0, 2.5 -> 1, 0.25 -> 2). */
function stepDecimals(step: number): number {
  for (let d = 0; d < 10; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  return 10;
}

/** Every multiple of `step` from lo to hi inclusive, snapped to the step's precision so 0.30000000000000004 prints as 0.3. */
export function stepTicks(lo: number, hi: number, step: number): number[] {
  const d = stepDecimals(step);
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(Number((k * step).toFixed(d)));
  return out;
}

export interface Tick {
  value: number;
  label: string;
}

/** A laid-out numeric axis: title, domain and the ticks (gridlines) with their labels. */
export interface NumericAxis {
  title: string;
  domain: Extent;
  ticks: Tick[];
  reference: Array<{ value: number; label?: string }>;
}

/**
 * Domain and ticks for one numeric axis. A fixed `domain` wins; else the
 * extent of the finite values (and of every reference line, so a 0 line is
 * always on the chart) is widened outward to whole `step`s when a step is
 * given ("gridlines at 10-point steps"), or to "nice" ticks otherwise. With
 * no finite value and no domain the axis is a plain 0..1, labelled honestly
 * by its ticks; the chart says what is missing, not the axis.
 */
export function numericAxis(axis: AxisSpec, values: Array<number | null | undefined>): NumericAxis {
  const digits = axis.digits ?? defaults.digits;
  const reference = axis.reference ?? [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (const r of reference) {
    if (r.value < lo) lo = r.value;
    if (r.value > hi) hi = r.value;
  }
  let domain: Extent;
  let ticks: number[];
  if (axis.domain) {
    domain = { min: axis.domain[0], max: axis.domain[1] };
    ticks = axis.step ? stepTicks(domain.min, domain.max, axis.step) : niceTicks(domain.min, domain.max, 6).ticks.filter((t) => t >= domain.min && t <= domain.max);
  } else if (lo === Infinity) {
    const n = niceTicks(0, 1, 6);
    domain = n.domain;
    ticks = n.ticks;
  } else if (axis.step) {
    const step = axis.step;
    let min = Math.floor(lo / step + 1e-9) * step;
    let max = Math.ceil(hi / step - 1e-9) * step;
    if (min === max) {
      min -= step;
      max += step;
    }
    ticks = stepTicks(min, max, step);
    domain = { min: ticks[0], max: ticks[ticks.length - 1] };
  } else {
    const n = niceTicks(lo, hi, 6);
    domain = n.domain;
    ticks = n.ticks;
  }
  return {
    title: axis.label,
    domain,
    ticks: ticks.map((value) => ({ value, label: formatTick(value, axis.format, digits) })),
    reference: reference.filter((r) => r.value >= domain.min && r.value <= domain.max),
  };
}
