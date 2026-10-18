import { beforeEach, describe, expect, it, vi } from "vitest";

// The real CesiumJS geodesic, loaded in Node, stands in for the lazy browser loader.
vi.mock("./cesium", async () => {
  const C = await import("cesium");
  return { getCesium: () => C, loadCesium: async () => C };
});

import { AUTHALIC_RADIUS_M, fmtArea, fmtLength, MAX_POINTS, measureClick, measureOpen, measureShape, ringArea, setMeasureMode } from "./measure";
import { useGlobe } from "@/lib/store/globe";
import { useStrata } from "@/lib/fabric/strataStore";

describe("area on the authalic sphere", () => {
  it("uses the sphere with the WGS84 ellipsoid's surface area, 510,065,622 km²", () => {
    expect(AUTHALIC_RADIUS_M).toBeCloseTo(6_371_007.2, 1);
    expect(Math.round((4 * Math.PI * AUTHALIC_RADIUS_M ** 2) / 1e6)).toBe(510_065_622);
  });

  it("gives the octant between the equator, the prime meridian and 90°E one eighth of it", () => {
    const octant = ringArea([[0, 0], [90, 0], [0, 90]]);
    expect(Math.round((octant * 8) / 1e6)).toBe(510_065_622);
  });

  // The WGS84 closed form for a quadrangle between two parallels and two
  // meridians, (a²/2)·Δλ·(q(φ2) − q(φ1)) (Snyder 1987, eq. 3-12), computed
  // here on its own so the check does not lean on measure.ts.
  const a = 6_378_137;
  const e2 = 0.00669437999014;
  const e = Math.sqrt(e2);
  const qOf = (latDeg: number) => {
    const s = Math.sin((latDeg * Math.PI) / 180);
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  };
  const quadrangle = (lat1: number, lat2: number, dLonDeg: number) => ((a * a) / 2) * ((dLonDeg * Math.PI) / 180) * (qOf(lat2) - qOf(lat1));

  it("matches the ellipsoid's closed form for a 0.01° cell: 1.075800 km² at 29.4°N (San Antonio), 1.079920 km² at 29°N", () => {
    const at294 = ringArea([[-98.5, 29.4], [-98.49, 29.4], [-98.49, 29.41], [-98.5, 29.41]]);
    expect((at294 / 1e6).toFixed(6)).toBe("1.075800");
    expect(Math.abs(at294 / quadrangle(29.4, 29.41, 0.01) - 1)).toBeLessThan(1e-6);
    const at29 = ringArea([[-98.5, 29], [-98.49, 29], [-98.49, 29.01], [-98.5, 29.01]]);
    expect((at29 / 1e6).toFixed(6)).toBe("1.079920");
    expect(Math.round(quadrangle(-90, 90, 360) / 1e6)).toBe(510_065_622);
  });

  it("does not care which way round the ring is drawn, and is zero under three points", () => {
    const a = ringArea([[0, 0], [1, 0], [1, 1], [0, 1]]);
    const b = ringArea([[0, 1], [1, 1], [1, 0], [0, 0]]);
    expect(a).toBeCloseTo(b, 3);
    expect(ringArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe("measureShape", () => {
  it("measures a line as the geodesic on WGS84: one degree of latitude at the equator is 110,574.4 m", () => {
    const m = measureShape({ kind: "line", points: [[0, 0], [0, 1]] });
    expect(m.lengthM).toBeCloseTo(110_574.39, 1);
    expect(m.areaM2).toBeUndefined();
    expect(m.segments).toBe(1);
    expect(m.formula[0]).toMatch(/^length = Σ geodesic distance on the WGS84 ellipsoid over 1 segment /);
  });

  it("closes an area, measures its perimeter and prints both formulas", () => {
    const m = measureShape({ kind: "area", points: [[-98.5, 29.4], [-98.49, 29.4], [-98.49, 29.41], [-98.5, 29.41]] });
    expect(m.segments).toBe(4);
    expect((m.areaM2! / 1e6).toFixed(6)).toBe("1.075800");
    expect(m.formula).toHaveLength(2);
    expect(m.formula[1]).toContain("authalic latitude");
  });

  it("skips a repeated vertex rather than counting a zero-length segment", () => {
    expect(measureShape({ kind: "line", points: [[0, 0], [0, 0], [0, 1]] }).segments).toBe(1);
  });
});

describe("formatting", () => {
  it("prints metric with imperial alongside", () => {
    expect(fmtLength(500)).toBe("500.0 m · 1640 ft");
    expect(fmtLength(110_574.39)).toBe("110.6 km · 68.708 mi");
    expect(fmtLength(2_500)).toBe("2.500 km · 1.553 mi");
    expect(fmtArea(1_075_800)).toBe("1.076 km² · 266 ac · 0.415 mi²");
    expect(fmtArea(4046.8564224)).toBe("4,047 m² · 1.00 ac");
  });
});

describe("the measure tools in the store", () => {
  beforeEach(() => {
    useGlobe.getState().setMeasure({ mode: "off", shape: null, elevation: null });
    useStrata.getState().setPicking(false);
  });

  it("turning a tool on ends the strata rail's wait for a pin-B tap", () => {
    useStrata.getState().setPicking(true);
    setMeasureMode("distance");
    expect(useStrata.getState().picking).toBe(false);
    expect(useGlobe.getState().measure.mode).toBe("distance");
    expect(measureOpen(useGlobe.getState().measure)).toBe(true);
  });

  it("adds clicked vertices to the shape, rounded to 5 decimals, up to the cap", () => {
    expect(measureClick(1, 1)).toBe(false);
    setMeasureMode("area");
    expect(measureClick(-98.123456, 29.987654)).toBe(true);
    expect(useGlobe.getState().measure.shape).toEqual({ kind: "area", points: [[-98.12346, 29.98765]] });
    for (let i = 0; i < MAX_POINTS + 5; i++) measureClick(i / 100, 0);
    expect(useGlobe.getState().measure.shape!.points).toHaveLength(MAX_POINTS);
  });

  it("keeps the shape when the tool is left, so the panel stays open with its readout", () => {
    setMeasureMode("distance");
    measureClick(0, 0);
    measureClick(0, 1);
    setMeasureMode("off");
    const m = useGlobe.getState().measure;
    expect(m.shape?.points).toHaveLength(2);
    expect(measureOpen(m)).toBe(true);
  });
});
