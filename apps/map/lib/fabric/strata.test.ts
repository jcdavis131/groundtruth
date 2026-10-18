import { describe, expect, it } from "vitest";
import { ascendSteps, captionKind, constructExtent, countPhrase, densifyRing, extentSpanM, focusSet, formatArea, framePitch, orderStrata, SHORT_KIND, statsFromJoin, strataCaption } from "./strata";
import { compareFabrics, compareSummary } from "./compare";
import { nestingEdges, sortStack } from "./graph";
import { KINDS } from "./catalog";
import type { ConstructKind, ConstructNode } from "./types";
import type { LayerFeature, LayerId } from "@/lib/layers/types";

function node(kind: ConstructKind, code: string, name: string, areaKm2?: number, rings?: number[][][]): ConstructNode {
  return { id: `${kind}:${code}`, kind, domain: KINDS[kind].domain, name, code, areaKm2, rings, facts: {}, links: [], source: "census-tigerweb" };
}

const square = (x: number, y: number, r: number) => [[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]]];

// A Corpus Christi-shaped stack, deliberately out of order.
const STACK: ConstructNode[] = [
  node("country", "USA", "United States"),
  node("county", "48355", "Nueces County", 2172, square(-97.5, 27.7, 0.4)),
  node("huc12", "121102020304", "Oso Creek", 98, square(-97.4, 27.8, 0.05)),
  node("huc8", "12110202", "South Corpus Christi Bay", 1234, square(-97.4, 27.7, 0.3)),
  node("huc10", "1211020203", "Oso Bay", 650, square(-97.4, 27.75, 0.15)),
  node("tract", "48355006400", "Census Tract 64", 3.43, square(-97.398, 27.798, 0.01)),
  node("state", "48", "Texas", 676_587),
  node("cd", "4827", "Congressional District 27", 21_000),
  node("place", "4817000", "Corpus Christi city", 414),
];

describe("orderStrata", () => {
  it("orders smallest to largest, like the server's sortStack", () => {
    const ordered = orderStrata(STACK).map((n) => n.kind);
    expect(ordered).toEqual(["tract", "huc12", "place", "huc10", "huc8", "county", "cd", "state", "country"]);
    expect(orderStrata(STACK).map((n) => n.id)).toEqual(sortStack(STACK).map((n) => n.id));
  });
  it("uses the kind's ordering hint when no area is published, and never mutates its input", () => {
    const copy = [...STACK];
    orderStrata(STACK);
    expect(STACK).toEqual(copy);
    expect(orderStrata([node("country", "USA", "US"), node("flood", "X", "Flood zone X")]).map((n) => n.kind)).toEqual(["flood", "country"]);
  });
  it("has a short name for every kind", () => {
    for (const k of Object.keys(KINDS)) expect(SHORT_KIND[k as ConstructKind]?.length).toBeGreaterThan(0);
  });
});

describe("focusSet", () => {
  const edges = nestingEdges(STACK);
  it("takes the definitional parent and child (HUC prefix nesting)", () => {
    const f = focusSet({ nodes: STACK, edges }, "huc10:1211020203")!;
    expect(f.focus.name).toBe("Oso Bay");
    expect(f.parent?.id).toBe("huc8:12110202");
    expect(f.child?.id).toBe("huc12:121102020304");
  });
  it("falls back to the neighbouring stratum of the same point of view", () => {
    // No nesting edges at all: the next larger / smaller hydrologic unit stands in.
    const f = focusSet({ nodes: STACK, edges: [] }, "huc10:1211020203")!;
    expect(f.parent?.kind).toBe("huc8");
    expect(f.child?.kind).toBe("huc12");
    // The country has nothing above it; the state nests in it by definition.
    const top = focusSet({ nodes: STACK, edges }, "country:USA")!;
    expect(top.parent).toBeNull();
    expect(top.child?.kind).toBe("state");
    // With no edges, no world-domain unit sits below the country.
    expect(focusSet({ nodes: STACK, edges: [] }, "country:USA")!.child).toBeNull();
  });
  it("is null for an id not in the stack", () => {
    expect(focusSet({ nodes: STACK, edges }, "county:00000")).toBeNull();
  });
});

describe("extent and framing", () => {
  it("uses the outline's box, else a square of the published area around the point", () => {
    const box = constructExtent(STACK[1], [-97.4, 27.8]);
    [-97.9, 27.3, -97.1, 28.1].forEach((v, i) => expect(box[i]).toBeCloseTo(v, 9));
    const b = constructExtent(node("cd", "1", "CD", 10_000), [-97.4, 27.8]);
    expect(extentSpanM(b)).toBeGreaterThan(99_000);
    expect(extentSpanM(b)).toBeLessThan(101_000);
  });
  it("tilts less as the frame widens", () => {
    expect(framePitch(5_000)).toBeGreaterThan(framePitch(100_000));
    expect(framePitch(100_000)).toBeGreaterThan(framePitch(800_000));
    expect(framePitch(5_000_000)).toBeLessThanOrEqual(-75);
  });
  it("densifies long edges so ground outlines do not sag into the globe", () => {
    const d = densifyRing([[0, 0], [1, 0]], 0.2);
    expect(d).toHaveLength(6);
    expect(d[3][0]).toBeCloseTo(0.6, 9);
    expect(densifyRing([[179.9, 0], [-179.9, 0]], 0.2)).toHaveLength(2);
  });
});

describe("rail formatting and captions", () => {
  it("formats areas compactly", () => {
    expect(formatArea(3.43)).toBe("3.43");
    expect(formatArea(98)).toBe("98.0");
    expect(formatArea(1234)).toBe("1,234");
    expect(formatArea(21_000)).toBe("21.0k");
    expect(formatArea(676_587)).toBe("677k");
    expect(formatArea(9_147_593)).toBe("9.1M");
    expect(formatArea(undefined)).toBe("—");
  });
  it("counts only gauges from surface water and phrases counts", () => {
    const f = (layer: LayerId, kind: string) => ({ properties: { layer, kind, id: Math.random().toString(), name: "x", source: "t" } }) as unknown as LayerFeature;
    const joined = new Map<LayerId, LayerFeature[]>([
      ["water", [f("water", "gauge"), f("water", "flood-gauge"), f("water", "river")]],
      ["banks", [f("banks", "branch")]],
    ]);
    const s = statsFromJoin(joined, 2, { median: 34, rated: 2 });
    expect(s.byLayer).toEqual({ water: 2, banks: 1 });
    expect(s.total).toBe(3);
    expect(countPhrase("water", 1)).toBe("1 gauge");
    expect(countPhrase("occupations", 3, "Jobs")).toBe("3 jobs");
  });
  it("counts a binned fires cell as the detections it stands for in the rail", () => {
    const cell = { properties: { layer: "fires", kind: "viirs", id: "cell", name: "x", source: "t", extra: { count: 57 } } } as unknown as LayerFeature;
    const one = { properties: { layer: "fires", kind: "modis", id: "one", name: "y", source: "t", extra: { count: 1 } } } as unknown as LayerFeature;
    const s = statsFromJoin(new Map<LayerId, LayerFeature[]>([["fires", [cell, one]]]), null, null);
    expect(s.byLayer).toEqual({ fires: 58 });
    expect(s.total).toBe(58);
  });
  it("builds the Powers of Ten caption from computed values only", () => {
    const huc8 = STACK[3];
    expect(captionKind("huc8")).toBe("Subbasin");
    const s = statsFromJoin(new Map([["water", Array.from({ length: 14 }, (_, i) => ({ properties: { layer: "water", kind: "gauge", id: `g${i}` } }) as unknown as LayerFeature)]]), 2, null);
    expect(strataCaption(huc8, s)).toBe("SUBBASIN · South Corpus Christi Bay · 1,234 km² · 14 gauges · 2 warnings");
    // No area published, nothing joined, warnings unknown: only the name.
    expect(strataCaption(node("timezone", "CST", "Central"), statsFromJoin(null, null, null))).toBe("TIME ZONE · Central");
  });
  it("ascends through every stratum once, smallest first, dropping same-size twins", () => {
    const twin = { ...node("cdp", "x", "Corpus Christi city", 414.2) };
    const steps = ascendSteps([...STACK, twin]);
    expect(steps[0].kind).toBe("tract");
    expect(steps.at(-1)!.kind).toBe("country");
    expect(steps.filter((n) => n.name === "Corpus Christi city")).toHaveLength(1);
  });
});

describe("compareFabrics", () => {
  const B: ConstructNode[] = [
    node("country", "USA", "United States"),
    node("county", "48355", "Nueces County"),
    node("huc12", "121102020101", "Nueces Bay"),
    node("huc8", "12110202", "South Corpus Christi Bay"),
    node("state", "48", "Texas"),
    node("cd", "4834", "Congressional District 34"),
    node("place", "4858904", "Portland city"),
    node("flood", "AE", "Flood zone AE"),
  ];
  const c = compareFabrics({ nodes: STACK }, { nodes: B });
  const status = (k: ConstructKind) => c.rows.find((r) => r.kind === k)?.status;
  it("marks shared, different and one-sided kinds", () => {
    expect(status("county")).toBe("shared");
    expect(status("huc8")).toBe("shared");
    expect(status("cd")).toBe("differs");
    expect(status("huc12")).toBe("differs");
    expect(status("tract")).toBe("only-a");
    expect(status("flood")).toBe("only-b");
    expect(c.shared).toBe(4);
    expect(c.differs).toBe(3);
  });
  it("orders rows like the stack and finds the smallest construct both are inside", () => {
    expect(c.rows[0].kind).toBe("flood");
    expect(c.meet?.id).toBe("huc8:12110202");
  });
  it("summarises in words people use, differences first", () => {
    expect(compareSummary(c)).toBe("different city, same county, different congressional district, same HUC-8");
    expect(compareSummary(compareFabrics({ nodes: [] }, { nodes: [] }))).toBe("");
  });
  it("is symmetric in its verdicts", () => {
    const r = compareFabrics({ nodes: B }, { nodes: STACK });
    expect(r.shared).toBe(c.shared);
    expect(r.differs).toBe(c.differs);
  });
});

describe("rail kind column", () => {
  it("fits every short kind name in 11 characters", () => {
    for (const v of Object.values(SHORT_KIND)) expect(v.length).toBeLessThanOrEqual(11);
  });
});
