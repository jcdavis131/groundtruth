import { describe, expect, it } from "vitest";
import { chunk, detailFor, MAX_SPAN_DEG, parseBbox, parseCert, parseCountyFips, parseState, parseYear } from "./api";

describe("parseBbox", () => {
  it("snaps outward to a 1° grid", () => {
    expect(parseBbox("-97.9,30.1,-97.4,30.6")).toEqual([-98, 30, -97, 31]);
  });
  it("rejects malformed, inverted and out-of-range boxes", () => {
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox("")).toBeNull();
    expect(parseBbox("1,2,3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
    expect(parseBbox("-97,31,-98,30")).toBeNull();
    expect(parseBbox("-97,30,-96,95")).toBeNull();
    expect(parseBbox("-190,30,-96,31")).toBeNull();
  });
  it("clamps a huge box to MAX_SPAN_DEG around its centre", () => {
    const b = parseBbox("-120,20,-70,50")!;
    expect(b[2] - b[0]).toBeLessThanOrEqual(MAX_SPAN_DEG);
    expect(b[3] - b[1]).toBeLessThanOrEqual(MAX_SPAN_DEG);
    expect((b[0] + b[2]) / 2).toBeCloseTo(-95, 0);
  });
  it("never crosses the poles or the antimeridian", () => {
    const b = parseBbox("-180,-90,180,90")!;
    expect(b[0]).toBeGreaterThanOrEqual(-180);
    expect(b[1]).toBeGreaterThanOrEqual(-90);
    expect(b[2]).toBeLessThanOrEqual(180);
    expect(b[3]).toBeLessThanOrEqual(90);
  });
});

describe("parseCountyFips", () => {
  it("accepts five digits with a valid state and a non-000 county", () => {
    expect(parseCountyFips("48453")).toBe("48453");
    expect(parseCountyFips(" 01073 ")).toBe("01073");
    expect(parseCountyFips("72127")).toBe("72127");
  });
  it("rejects states, short ids, letters and impossible states", () => {
    expect(parseCountyFips("48000")).toBeNull();
    expect(parseCountyFips("4845")).toBeNull();
    expect(parseCountyFips("484530")).toBeNull();
    expect(parseCountyFips("4845a")).toBeNull();
    expect(parseCountyFips("00453")).toBeNull();
    expect(parseCountyFips("99001")).toBeNull();
    expect(parseCountyFips(null)).toBeNull();
  });
});

describe("parseCert", () => {
  it("accepts one to six digits, positive", () => {
    expect(parseCert("3511")).toBe(3511);
    expect(parseCert("999999")).toBe(999999);
  });
  it("rejects zero, negatives, decimals, too long and blanks", () => {
    expect(parseCert("0")).toBeNull();
    expect(parseCert("-5")).toBeNull();
    expect(parseCert("3.5")).toBeNull();
    expect(parseCert("1234567")).toBeNull();
    expect(parseCert("")).toBeNull();
    expect(parseCert(null)).toBeNull();
  });
});

describe("parseYear", () => {
  it("returns the fallback when absent and the year when in range", () => {
    expect(parseYear(null, 2008, 2026, 2025)).toBe(2025);
    expect(parseYear("", 2008, 2026, 2025)).toBe(2025);
    expect(parseYear("2023", 2008, 2026, 2025)).toBe(2023);
  });
  it("returns null when malformed or out of range", () => {
    expect(parseYear("23", 2008, 2026, 2025)).toBeNull();
    expect(parseYear("2007", 2008, 2026, 2025)).toBeNull();
    expect(parseYear("2027", 2008, 2026, 2025)).toBeNull();
    expect(parseYear("20x3", 2008, 2026, 2025)).toBeNull();
  });
});

describe("parseState", () => {
  it("upper-cases two letters and rejects anything else", () => {
    expect(parseState("tx")).toBe("TX");
    expect(parseState("TEX")).toBeNull();
    expect(parseState("4")).toBeNull();
    expect(parseState(null)).toBeNull();
  });
});

describe("chunk", () => {
  it("splits into runs of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], 1.5)).toThrow();
  });
});

describe("detailFor", () => {
  it("picks finer polygons for smaller boxes", () => {
    expect(detailFor([-98, 30, -97, 31])).toBe("500K");
    expect(detailFor([-100, 28, -95, 32])).toBe("5M");
    expect(detailFor([-105, 25, -95, 35])).toBe("20M");
  });
});
