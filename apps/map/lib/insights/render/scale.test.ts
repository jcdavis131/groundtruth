import { describe, expect, it } from "vitest";
import { formatTick, formatValue, numericAxis, stepTicks, valueDigits } from "./scale";

describe("stepTicks", () => {
  it("lists every multiple of the step, snapped to its precision", () => {
    expect(stepTicks(-20, 40, 10)).toEqual([-20, -10, 0, 10, 20, 30, 40]);
    expect(stepTicks(0, 1, 0.1)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(stepTicks(-0.5, 0.5, 0.25)).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
  });
});

describe("numericAxis", () => {
  it("widens the data extent outward to whole steps and keeps the reference line in range", () => {
    const a = numericAxis({ label: "x", format: "signedPct", step: 10, reference: [{ value: 0 }] }, [-15.66, 35.65, null]);
    expect(a.domain).toEqual({ min: -20, max: 40 });
    expect(a.ticks.map((t) => t.label)).toEqual(["-20%", "-10%", "0%", "+10%", "+20%", "+30%", "+40%"]);
    const positive = numericAxis({ label: "x", format: "pct", step: 5, reference: [{ value: 0 }] }, [3, 12]);
    expect(positive.domain.min).toBe(0);
  });

  it("honours a fixed domain and falls back to nice ticks without a step", () => {
    expect(numericAxis({ label: "x", format: "num", domain: [0, 100], step: 25 }, [3]).ticks.map((t) => t.value)).toEqual([0, 25, 50, 75, 100]);
    const nice = numericAxis({ label: "x", format: "usd" }, [120000, 480000]);
    expect(nice.ticks[0].label.startsWith("$")).toBe(true);
    expect(nice.domain.min).toBeLessThanOrEqual(120000);
    expect(nice.domain.max).toBeGreaterThanOrEqual(480000);
  });

  it("draws a plain 0..1 axis when nothing is published", () => {
    expect(numericAxis({ label: "x", format: "num" }, [null, null]).domain).toEqual({ min: 0, max: 1 });
  });
});

describe("formatting", () => {
  it("goes through lib/brief/format.ts for every format", () => {
    expect(formatValue(35.648, "signedPct", 1)).toBe("+35.6%");
    expect(formatValue(-4.1, "pct", 1)).toBe("-4.1%");
    expect(formatValue(187324, "num")).toBe("187,324");
    expect(formatValue(452000, "usd")).toBe("$452,000");
    expect(formatValue(null, "num")).toBe("not published");
  });

  it("prints the zero tick of a signed axis without a sign", () => {
    expect(formatTick(0, "signedPct")).toBe("0%");
    expect(formatTick(10, "signedPct")).toBe("+10%");
  });

  it("gives percents at least one decimal as values", () => {
    expect(valueDigits("signedPct", 0)).toBe(1);
    expect(valueDigits("num", 0)).toBe(0);
    expect(valueDigits("usd", 2)).toBe(2);
  });
});
