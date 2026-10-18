import { describe, expect, it } from "vitest";
import type { LayerFeature } from "./types";
import { FeatureMemo, geometrySignature } from "./featureMemo";

const f = (id: string): LayerFeature => ({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id, layer: "flood", name: id, source: "t" } });

describe("FeatureMemo", () => {
  it("hands back the object already drawn for an id, and evicts the least recently seen past the limit", () => {
    const memo = new FeatureMemo(3);
    const first = memo.stable([f("a"), f("b")]);
    const second = memo.stable([f("b"), f("c"), f("d")]);
    expect(second[0]).toBe(first[1]);
    expect(memo.size).toBe(3);
    const third = memo.stable([f("a")]);
    // "a" was evicted, so it comes back as the new object.
    expect(third[0]).not.toBe(first[0]);
  });

  it("redraws an id whose geometry changed shape", () => {
    const memo = new FeatureMemo();
    memo.stable([f("d")]);
    const moved: LayerFeature = { ...f("d"), geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    expect(memo.stable([moved])[0]).toBe(moved);
  });

  it("fingerprints a multipolygon by its part count and its first and last outer rings", () => {
    const part = (n: number) => [Array.from({ length: n }, (_, i) => [i, i])];
    expect(geometrySignature({ type: "MultiPolygon", coordinates: [part(4), part(7)] })).toBe("M2:4:7");
    expect(geometrySignature({ type: "Polygon", coordinates: part(5) })).toBe("P1:5");
  });
});
