import { describe, expect, it } from "vitest";
import { issPositionAt, type IssExtra } from "./iss";

function extra(prev: { lon: number; lat: number } | null): IssExtra {
  return {
    prev: prev ? { ...prev, altM: 420_000, t: 1_000 } : null,
    cur: { lon: 10, lat: 20, altM: 421_000, t: 11_000 },
    velocityKmh: 27_600,
    visibility: "daylight",
    footprintKm: 4500,
  };
}

describe("issPositionAt", () => {
  it("holds the latest fix without a previous fix", () => {
    expect(issPositionAt(extra(null), 5_000)).toEqual([10, 20, 421_000]);
  });

  it("interpolates halfway between fixes", () => {
    const [lon, lat, alt] = issPositionAt(extra({ lon: 0, lat: 10 }), 6_000);
    expect(lon).toBeCloseTo(5, 9);
    expect(lat).toBeCloseTo(15, 9);
    expect(alt).toBeCloseTo(420_500, 6);
  });

  it("holds the latest fix past its time (never extrapolates)", () => {
    expect(issPositionAt(extra({ lon: 0, lat: 10 }), 60_000)).toEqual([10, 20, 421_000]);
  });

  it("takes the short way across the antimeridian", () => {
    const x = extra({ lon: 179, lat: 0 });
    x.cur = { lon: -179, lat: 0, altM: 420_000, t: 11_000 };
    const [lon] = issPositionAt(x, 6_000);
    // Halfway between 179 and -179 the short way is ±180, not 0.
    expect(Math.abs(Math.abs(lon) - 180)).toBeLessThan(1e-6);
  });
});
