import { readFileSync } from "node:fs";
import path from "node:path";
import type { Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import { geometryBbox, pointInGeometry, ringsToGeometry } from "./esri";

// Esri rings: outer clockwise, holes counter-clockwise (lon/lat, y up).
const OUTER_A = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
const HOLE_A = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
const OUTER_B = [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]];

describe("ringsToGeometry", () => {
  it("one clockwise ring is a Polygon", () => {
    expect(ringsToGeometry([OUTER_A])).toEqual({ type: "Polygon", coordinates: [OUTER_A] });
  });

  it("a counter-clockwise ring is a hole of the outer ring that contains it", () => {
    expect(ringsToGeometry([OUTER_A, HOLE_A])).toEqual({ type: "Polygon", coordinates: [OUTER_A, HOLE_A] });
  });

  it("two outer rings are a MultiPolygon, each hole with its own ring", () => {
    const g = ringsToGeometry([OUTER_B, OUTER_A, HOLE_A]);
    expect(g).toEqual({ type: "MultiPolygon", coordinates: [[OUTER_B], [OUTER_A, HOLE_A]] });
  });

  it("junk is null", () => {
    expect(ringsToGeometry(undefined)).toBeNull();
    expect(ringsToGeometry([[[0, 0], [1, 1]]])).toBeNull();
    expect(ringsToGeometry([[[0, 0], [1, "x"], [1, 1], [0, 0]]])).toBeNull();
  });

  it("TxGIO's rings for the Alamo parcel (captured through identify) are one Polygon holding the Alamo", () => {
    const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "tx-stratmap-bexar.json"), "utf8"));
    const g = fx.rows[0].geometry as Polygon;
    // The fixture holds the converted rings; converting them again changes nothing.
    expect(ringsToGeometry(g.coordinates)).toEqual(g);
    expect(pointInGeometry(-98.4861, 29.426, g)).toBe(true);
  });
});

describe("pointInGeometry and geometryBbox", () => {
  const donut = ringsToGeometry([OUTER_A, HOLE_A])!;
  it("inside the ring but not in the hole", () => {
    expect(pointInGeometry(1, 1, donut)).toBe(true);
    expect(pointInGeometry(5, 5, donut)).toBe(false);
    expect(pointInGeometry(11, 5, donut)).toBe(false);
  });
  it("bbox of the outer rings", () => {
    expect(geometryBbox(ringsToGeometry([OUTER_B, OUTER_A])!)).toEqual([0, 0, 25, 10]);
  });
});
