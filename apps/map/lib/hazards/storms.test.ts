// The storms part: the zone-share gate on the committed bake's national tallies
// (lib/hazards/data/storm-events/meta.json), one county's series from a shard, the zero rule,
// Connecticut, Alaska and a failed load. The derived Texas shard fixture is the bake's own output
// on the 2025 slice (lib/hazards/fixtures/storm-events-48.shard.json).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import metaJson from "./data/storm-events/meta.json";
import shardTx from "./data/storm-events/48.json";
import type { StormMeta, StormShard } from "./stormBake";
import { STORM_EVENTS_CAVEAT, STORM_MAIN_TYPES, STORM_ZONE_SHARE_MAX, stormAsSeries, stormGate, stormSeries, stormSeriesId } from "./storms";
import { toolByName } from "@/lib/mcp/tools";
import { loadStormShard, STORM_LOADERS } from "./stormShards";
import { assembleStorms } from "./history";

const meta = metaJson as unknown as StormMeta;
const derived = JSON.parse(readFileSync(path.resolve(__dirname, "fixtures", "storm-events-48.shard.json"), "utf8")) as { types: string[]; shard: StormShard };
const geo = { kind: "county" as const, id: "48453", name: "Travis County, TX" };

describe("the zone-share gate", () => {
  it("is 10 % (Cam's decision 3, pending)", () => expect(STORM_ZONE_SHARE_MAX).toBe(0.1));
  it("is said as the gate is: 10 % or more zone-coded, never 'mostly' (the caveat and the MCP hazards description)", () => {
    const desc = toolByName("county_history")!.description;
    for (const text of [STORM_EVENTS_CAVEAT, desc]) {
      expect(text).toContain(`${Math.round(STORM_ZONE_SHARE_MAX * 100)} % or more`);
      expect(text).not.toMatch(/mostly zone-coded|most of its rows/);
    }
  });
  it("blanks 1996 Flood (10 % or more zone-coded) and draws 1996 Hail", () => {
    expect(stormGate(meta, 1996, "Flood")).toMatchObject({ drawn: false, reason: "zone-coded" });
    expect(stormGate(meta, 1996, "Hail")).toMatchObject({ drawn: true });
  });
  it("draws hail, thunderstorm wind and flash floods in every year 1996-2026 (the three tower series)", () => {
    for (const t of STORM_MAIN_TYPES) for (let y = 1996; y <= 2026; y++) expect(stormGate(meta, y, t).drawn, `${t} ${y}`).toBe(true);
  });
  it("is per year: Wildfire is drawn in 1996 and blank in 2025", () => {
    expect(stormGate(meta, 1996, "Wildfire").drawn).toBe(true);
    expect(stormGate(meta, 2025, "Wildfire")).toMatchObject({ drawn: false, reason: "zone-coded" });
  });
  it("says not-recorded, not zone-coded, for a type no file row has that year", () => {
    expect(stormGate(meta, 1996, "No Such Type")).toEqual({ drawn: false, reason: "not-recorded", share: null });
  });
});

describe("stormSeries", () => {
  const m: StormMeta = { ...meta, types: derived.types };
  it("gives Travis its 2025 counts and leaves absent years absent with the zero rule off", () => {
    const a = stormSeries(m, derived.shard, "48453", false);
    const hail = a.types.find((t) => t.type === "Hail")!;
    expect(hail.points).toEqual([[2025, 15]]);
    expect(a.types.find((t) => t.type === "Flash Flood")!.points).toEqual([[2025, 7]]);
    expect(a.types.find((t) => t.type === "Thunderstorm Wind")!.points).toEqual([[2025, 6]]);
    expect(a.years).toEqual([1996, 2026]);
  });
  it("fills drawn years with 0 with the zero rule on, and never fills a zone-coded year", () => {
    const a = stormSeries(m, derived.shard, "48453", true);
    const hail = a.types.find((t) => t.type === "Hail")!;
    expect(hail.points).toHaveLength(31);
    expect(hail.points.find(([y]) => y === 1996)).toEqual([1996, 0]);
    const flood = a.types.find((t) => t.type === "Flood");
    if (flood) {
      expect(flood.blank.map(([y]) => y)).toContain(1996);
      expect(flood.points.find(([y]) => y === 1996)).toBeUndefined();
    }
  });
  it("draws blanked years as null points, never 0", () => {
    const s = stormAsSeries(stormSeries(meta, shardTx as unknown as StormShard, "48453", false), geo, {} as never);
    const flood = s.find((x) => x.id === stormSeriesId("Flood", "48453"));
    expect(flood).toBeDefined();
    expect(flood!.points.filter((p) => p.v === 0)).toEqual([]);
    expect(flood!.points.find((p) => p.t === Date.UTC(1996, 0, 1))?.v).toBeNull();
  });
  it("carries the Bedford County, VA break at 2013", () => {
    expect(stormSeries(meta, { state: "51", counties: {} }, "51019", false).break?.year).toBe(2013);
  });
});

describe("assembleStorms", () => {
  const ok = { value: { meta: { ...meta, types: derived.types }, shard: derived.shard }, retrievedAt: "2026-10-17T00:00:00.000Z", url: meta.dir };
  it("answers a county with series, NCEI provenance and the caveats", () => {
    const a = assembleStorms({ fips: "48453", now: Date.UTC(2026, 9, 17), years: null, storms: ok }, geo);
    expect(a.storms?.fips).toBe("48453");
    expect(a.provenance[0].source.id).toBe("ncei-storm-events");
    expect(a.series.some((s) => s.id === "se:hail:48453")).toBe(true);
    expect(a.caveats.join(" ")).toMatch(/Tornadoes are counted from SPC/);
  });
  it("is null with join:legacy_ct_counties for a planning region", () => {
    const a = assembleStorms({ fips: "09110", now: 0, years: null, storms: ok }, geo);
    expect(a.storms).toBeNull();
    expect(a.missing).toEqual([{ source: "NCEI Storm Events", reason: "join:legacy_ct_counties" }]);
  });
  it("says why for Alaska, and a failed load is unknown, never zeros", () => {
    const ak = assembleStorms({ fips: "02020", now: 0, years: null, storms: { skip: "join:ncei_areas_not_counties" } }, geo);
    expect(ak.missing[0].reason).toBe("join:ncei_areas_not_counties");
    expect(ak.caveats[0]).toMatch(/Alaska/);
    const bad = assembleStorms({ fips: "48453", now: 0, years: null, storms: { error: "no storm-events shard for state 48", url: meta.dir } }, geo);
    expect(bad.storms).toBeNull();
    expect(bad.series).toEqual([]);
    expect(bad.missing[0].reason).toBe("source:failed");
  });
});

describe("the shard loaders", () => {
  it("has one loader per committed shard, and unwraps a JSON module's default", async () => {
    expect(Object.keys(STORM_LOADERS).sort()).toEqual(meta.shards);
    const sh = await loadStormShard("48");
    expect(sh.counties["48453"]["2025"]).toBeDefined();
    await expect(loadStormShard("02")).rejects.toThrow(/no storm-events shard/);
    await expect(loadStormShard("48", { "48": async () => ({ default: null }) })).rejects.toThrow(/not a shard/);
  });
});
