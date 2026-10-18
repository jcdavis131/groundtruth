import { describe, expect, it } from "vitest";
import { readingTime, reservoirOutputs, reservoirSlug, reservoirsCollector, statewidePercentFull, topByCapacity, twdbList } from "./reservoirs";

const NOW = Date.UTC(2026, 8, 11, 9, 0, 0);

/** TWDB recent-conditions.json fixture (abridged fields). */
const TWDB_FIXTURE = [
  { short_name: "toledo-bend", full_name: "Toledo Bend Reservoir", percent_full: 88.2, conservation_capacity: 4_472_900, conservation_storage: 3_945_100, elevation: 170.1, gauge_location: { type: "Point", coordinates: [-93.57, 31.17] }, timestamp: "2026-09-10" },
  { short_name: "sam-rayburn", full_name: "Sam Rayburn Reservoir", percent_full: 76.5, conservation_capacity: 2_876_000, conservation_storage: 2_200_100, gauge_location: { type: "Point", coordinates: [-94.1, 31.06] }, timestamp: "2026-09-10" },
  { short_name: "travis", full_name: "Lake Travis", percent_full: 61.0, conservation_capacity: 1_134_956, conservation_storage: 692_300, gauge_location: { type: "Point", coordinates: [-97.9, 30.39] }, timestamp: "2026-09-09" },
  { short_name: "no-data", full_name: "Unreported Lake", percent_full: null, conservation_capacity: 900_000, conservation_storage: null, gauge_location: null, timestamp: "2026-09-10" },
  { short_name: "tiny", full_name: "Tiny Pond", percent_full: 100, conservation_capacity: 10, conservation_storage: 10, timestamp: "2026-09-10" },
];

describe("twdbList", () => {
  it("accepts an array or an object keyed by name", () => {
    expect(twdbList(TWDB_FIXTURE)).toHaveLength(5);
    expect(twdbList({ a: TWDB_FIXTURE[0], b: TWDB_FIXTURE[1] })).toHaveLength(2);
    expect(twdbList(null)).toEqual([]);
    expect(twdbList("x")).toEqual([]);
  });
});

describe("statewidePercentFull", () => {
  it("weights by capacity over reservoirs that published both numbers", () => {
    const s = statewidePercentFull(TWDB_FIXTURE)!;
    const cap = 4_472_900 + 2_876_000 + 1_134_956 + 10;
    const sto = 3_945_100 + 2_200_100 + 692_300 + 10;
    expect(s.n).toBe(4);
    expect(s.percent).toBeCloseTo((100 * sto) / cap, 6);
  });
  it("is null with nothing usable", () => {
    expect(statewidePercentFull([])).toBeNull();
    expect(statewidePercentFull([{ short_name: "x", conservation_capacity: 0, conservation_storage: 0 }])).toBeNull();
  });
});

describe("topByCapacity / slug / time", () => {
  it("orders by capacity and skips unreported reservoirs", () => {
    expect(topByCapacity(TWDB_FIXTURE, 3).map((r) => r.short_name)).toEqual(["toledo-bend", "sam-rayburn", "travis"]);
  });
  it("slugs safely", () => {
    expect(reservoirSlug("O.H. Ivie")).toBe("o-h-ivie");
    expect(reservoirSlug("  Lake  Travis ")).toBe("lake-travis");
  });
  it("reads a date as UTC midnight and falls back to now", () => {
    expect(readingTime("2026-09-10", NOW)).toBe(Date.UTC(2026, 8, 10));
    expect(readingTime("2026-09-10T12:00:00Z", NOW)).toBe(Date.UTC(2026, 8, 10, 12));
    expect(readingTime("garbage", NOW)).toBe(NOW);
    expect(readingTime(undefined, NOW)).toBe(NOW);
  });
});

describe("reservoirOutputs", () => {
  it("emits the statewide estimate with its formula plus the top reservoirs as published", () => {
    const out = reservoirOutputs(TWDB_FIXTURE, NOW);
    expect(out[0].meta.id).toBe("snapshot:reservoir:texas:percent-full");
    expect(out[0].meta.provenance.kind).toBe("estimate");
    expect(out[0].meta.provenance.method).toMatch(/sum\(conservation_storage\)/);
    expect(out[0].points[0].t).toBe(Date.UTC(2026, 8, 10));
    const tb = out.find((o) => o.meta.id === "snapshot:reservoir:toledo-bend:percent-full")!;
    expect(tb.meta.provenance.kind).toBe("published");
    expect(tb.meta.unit).toBe("%");
    expect(tb.points).toEqual([{ t: Date.UTC(2026, 8, 10), v: 88.2 }]);
    expect(tb.meta.geo?.lon).toBe(-93.57);
    expect(out.some((o) => o.meta.id.includes("no-data"))).toBe(false);
  });
});

describe("reservoirsCollector", () => {
  it("collects from the injected fetch", async () => {
    const out = await reservoirsCollector.collect({ now: NOW, keys: {}, fetchJson: async <T>() => TWDB_FIXTURE as unknown as T });
    expect(out.length).toBe(1 + 4);
    expect(reservoirsCollector.describe().seriesPrefix).toBe("snapshot:reservoir:");
  });
});
