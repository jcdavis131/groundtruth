import { describe, expect, it } from "vitest";
import { CONUS_BBOX, countQuakes, inConus, quakeOutputs, quakesCollector } from "./quakes";

const NOW = Date.UTC(2026, 8, 11, 0, 0, 0);

/** USGS 2.5_day.geojson fixture (abridged properties). */
const FEED = {
  type: "FeatureCollection",
  metadata: { generated: NOW - 30_000, url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", title: "USGS Magnitude 2.5+ Earthquakes, Past Day", status: 200, api: "1.10.3", count: 6 },
  features: [
    { type: "Feature", properties: { mag: 4.7, place: "off the coast of Oregon", time: NOW - 1000, type: "earthquake" }, geometry: { type: "Point", coordinates: [-125.1, 44.2, 10] }, id: "us1" },
    { type: "Feature", properties: { mag: 2.6, place: "California", time: NOW - 2000 }, geometry: { type: "Point", coordinates: [-118.4, 34.1, 8] }, id: "ci1" },
    { type: "Feature", properties: { mag: 5.9, place: "Kermadec Islands", time: NOW - 3000 }, geometry: { type: "Point", coordinates: [-177.9, -29.7, 40] }, id: "us2" },
    { type: "Feature", properties: { mag: 3.1, place: "Alaska", time: NOW - 4000 }, geometry: { type: "Point", coordinates: [-150.1, 61.5, 30] }, id: "ak1" },
    { type: "Feature", properties: { mag: null, place: "unknown" }, geometry: { type: "Point", coordinates: [0, 0, 0] }, id: "x1" },
    { type: "Feature", properties: { mag: 4.5, place: "Puerto Rico" }, geometry: null, id: "pr1" },
  ],
};

describe("inConus", () => {
  it("uses the lower-48 box", () => {
    expect(inConus(-118.4, 34.1)).toBe(true);
    expect(inConus(-150.1, 61.5)).toBe(false);
    expect(inConus(CONUS_BBOX[0], CONUS_BBOX[1])).toBe(true);
  });
});

describe("countQuakes", () => {
  it("buckets by magnitude for the world and CONUS, skipping malformed events", () => {
    expect(countQuakes(FEED)).toEqual({
      world: { "m2.5": 4, "m4.5": 2 },
      conus: { "m2.5": 2, "m4.5": 1 },
    });
  });
  it("returns zeros for an empty feed", () => {
    expect(countQuakes({})).toEqual({ world: { "m2.5": 0, "m4.5": 0 }, conus: { "m2.5": 0, "m4.5": 0 } });
  });
});

describe("quakeOutputs / collector", () => {
  it("emits four series stamped with the sample time and the feed's generated time", async () => {
    const out = quakeOutputs(countQuakes(FEED), NOW, FEED.metadata.generated);
    expect(out.map((o) => o.meta.id)).toEqual(["snapshot:quakes:world:m2.5", "snapshot:quakes:world:m4.5", "snapshot:quakes:conus:m2.5", "snapshot:quakes:conus:m4.5"]);
    expect(out.map((o) => o.points[0].v)).toEqual([4, 2, 2, 1]);
    expect(out[0].points[0].t).toBe(NOW);
    expect(out[0].meta.provenance.releasedAt).toBe(new Date(NOW - 30_000).toISOString());
    expect(out[3].meta.provenance.method).toMatch(/epicentre inside/);
    expect(out[0].meta.geo?.kind).toBe("world");
    const viaCollector = await quakesCollector.collect({ now: NOW, keys: {}, fetchJson: async <T>() => FEED as unknown as T });
    expect(viaCollector.map((o) => o.points[0].v)).toEqual([4, 2, 2, 1]);
  });
});
