import { afterEach, describe, expect, it } from "vitest";
import { countOf, month, num, ordinal, pct, signedPct, usd, MISSING } from "./format";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("usd / num", () => {
  it("groups thousands and drops cents by default", () => {
    expect(usd(452000)).toBe("$452,000");
    expect(usd(452000.4)).toBe("$452,000");
    expect(usd(-1234)).toBe("-$1,234");
    expect(usd(1234.5678, 2)).toBe("$1,234.57");
    expect(num(3088)).toBe("3,088");
    expect(num(780123)).toBe("780,123");
    expect(num(24.35, 1)).toBe("24.4");
  });
  it("returns MISSING for a value that was not published, never 0 and never a dash", () => {
    for (const f of [usd, num]) {
      expect(f(null)).toBe(MISSING);
      expect(f(undefined)).toBe(MISSING);
      expect(f(Number.NaN)).toBe(MISSING);
      expect(f(Number.POSITIVE_INFINITY)).toBe(MISSING);
    }
    expect(usd(0)).toBe("$0");
    expect(num(0)).toBe("0");
  });
});

describe("pct / signedPct", () => {
  it("prints one digit by default and honours an explicit digit count", () => {
    expect(pct(6.24)).toBe("6.2%");
    expect(pct(-4.14)).toBe("-4.1%");
    expect(pct(6.246, 2)).toBe("6.25%");
    expect(pct(0)).toBe("0.0%");
  });
  it("signedPct always carries an explicit sign", () => {
    expect(signedPct(6.2)).toBe("+6.2%");
    expect(signedPct(-4.1)).toBe("-4.1%");
    expect(signedPct(0)).toBe("+0.0%");
    expect(signedPct(-0.04)).toBe("-0.0%");
    expect(signedPct(1234.5)).toBe("+1,234.5%");
  });
  it("returns MISSING for a value that was not published", () => {
    expect(pct(null)).toBe(MISSING);
    expect(signedPct(undefined)).toBe(MISSING);
    expect(signedPct(Number.NaN)).toBe(MISSING);
  });
});

describe("month", () => {
  it("names the month in UTC, so the first of the month is not the previous one", () => {
    expect(month("2026-07-31")).toBe("July 2026");
    expect(month("2026-01-01")).toBe("January 2026");
    expect(month("2026-12-01")).toBe("December 2026");
    expect(month("2026-07")).toBe("July 2026");
  });
  it("passes a quarter label through rather than inventing a month inside it", () => {
    expect(month("2026-Q1")).toBe("2026-Q1");
  });
  it("returns MISSING for an absent period", () => {
    expect(month(null)).toBe(MISSING);
    expect(month("")).toBe(MISSING);
  });
});

describe("ordinal / countOf", () => {
  it("handles the teens, which are all th", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(101)).toBe("101st");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(1012)).toBe("1,012th");
    expect(ordinal(null)).toBe(MISSING);
  });
  it("prints a position with its denominator", () => {
    expect(countOf(812, 3088)).toBe("812th of 3,088");
    expect(countOf(1, 52)).toBe("1st of 52");
    expect(countOf(null, 3088)).toBe(MISSING);
    expect(countOf(812, null)).toBe(MISSING);
  });
});

describe("determinism", () => {
  // The brief has to be byte-identical across machines. These formatters are
  // pinned to en-US and UTC at module scope precisely so a different TZ in the
  // environment cannot move a single character.
  it("is unchanged when the process timezone moves to the far side of the date line", () => {
    const shot = () => [
      usd(452000),
      num(3088),
      pct(6.24),
      signedPct(-4.1),
      month("2026-01-01"),
      month("2026-07-31"),
      ordinal(21),
      countOf(812, 3088),
    ];
    const before = shot();
    process.env.TZ = "Pacific/Kiritimati";
    expect(shot()).toEqual(before);
    process.env.TZ = "Pacific/Niue";
    expect(shot()).toEqual(before);
    process.env.TZ = ORIGINAL_TZ ?? "UTC";
    expect(shot()).toEqual(before);
  });
});
