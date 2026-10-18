// The public schools layer in the browser: nothing asked above 25 km or outside the United
// States, and below it the civic box with its dashed outline, so ground outside it never reads
// as "no school". The route answer is the Austin capture (2026-10-17) built as the route builds it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import austin from "@/lib/civic/fixtures/nces-box-austin.json";
import { buildSchools } from "@/lib/civic/schools";
import { schoolsLayer, schoolsRequest } from "./schools";
import type { FetchContext } from "./types";

const ctx = (lon: number, lat: number, height: number): FetchContext => ({ keys: {}, view: { lon, lat, height, heading: 0, pitch: -90 }, now: 0, options: {} });
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (!url.startsWith("/api/civic?op=schools&bbox=")) throw new Error(`unexpected ${url}`);
      const features = buildSchools((austin as unknown as { features: never[] }).features).features;
      const bbox = new URL(url, "http://x").searchParams.get("bbox")!.split(",").map(Number);
      return new Response(JSON.stringify({ data: { type: "FeatureCollection", features }, bbox, hidden: 0 }), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("schools", () => {
  it("asks nothing above 25 km or outside the United States", async () => {
    expect((await schoolsLayer.fetch(ctx(-97.74, 30.27, 30_000))).note).toMatch(/^descend below 25 km/);
    expect((await schoolsLayer.fetch(ctx(2.35, 48.86, 10_000))).note).toMatch(/United States only/);
    expect(calls).toEqual([]);
  });

  it("draws the schools with the loaded box, and counts them by level", async () => {
    const r = await schoolsLayer.fetch(ctx(-97.74, 30.27, 10_000));
    expect(calls).toEqual([schoolsRequest({ lon: -97.74, lat: 30.27 })]);
    const box = r.collection.features.filter((f) => f.properties.kind === "loaded-box");
    expect(box).toHaveLength(1);
    expect(r.collection.features).toHaveLength(12);
    expect(r.note).toMatch(/^11 public schools in the dashed box \(outside it: not loaded\)/);
    expect(r.note).toContain("full virtual (drawn faint: the point is an office)");
  });
});
