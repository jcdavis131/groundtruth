// The National Risk Index layer in the browser: counties joined onto the shared county
// outlines (the same /api/economy?op=areas request commerce and realestate make, for the same
// box the NRI rows are asked for), tracts below 60 km, and nothing above 2,500 km. Route
// answers are the 2026-10-16 captures (lib/economy/fixtures/areas-ct.json and the FEMA rows
// for the Connecticut box), wrapped as the routes wrap them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import areasCt from "@/lib/economy/fixtures/areas-ct.json";
import ctyCt from "@/lib/hazards/fixtures/nri-cty-ct.json";
import { riskindexLayer, riskindexViewKey } from "./riskindex";
import type { FetchContext } from "./types";

const ctx = (height: number, options: Record<string, unknown> = {}): FetchContext => ({ keys: {}, view: { lon: -72.7, lat: 41.6, height, heading: 0, pitch: -90 }, now: 0, options });
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.startsWith("/api/economy?op=areas") ? areasCt : url.startsWith("/api/hazards?op=nri&level=county") ? { data: { level: "county", rows: (ctyCt as { features: Array<{ attributes: unknown }> }).features.map((f) => f.attributes) } } : null;
      if (!body) throw new Error(`unexpected ${url}`);
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("riskindex", () => {
  it("asks the county rows for the box the outlines are asked for, and joins them by FIPS", async () => {
    const r = await riskindexLayer.fetch(ctx(400_000, { nriHazard: "HRCN" }));
    expect(calls).toHaveLength(2);
    const box = (u: string) => new URL(u, "http://x").searchParams.get("bbox");
    expect(box(calls[0])).toBe(box(calls[1]));
    expect(r.meta).toMatchObject({ level: "county", pick: "HRCN", notInIndex: 0 });
    expect(r.collection.features).toHaveLength(52);
    expect(r.note).toMatch(/^52 counties · hurricane risk/);
  });

  it("asks nothing above 2,500 km and keys tracts below 60 km apart from counties", async () => {
    const r = await riskindexLayer.fetch(ctx(3_000_000));
    expect(calls).toEqual([]);
    expect(r.note).toMatch(/^descend below 2,500 km/);
    expect(riskindexViewKey(ctx(50_000).view)).toMatch(/^tract:/);
    expect(riskindexViewKey(ctx(400_000).view)).toMatch(/^county:/);
  });
});
