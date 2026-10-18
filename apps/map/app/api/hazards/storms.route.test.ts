// /api/hazards?op=history&part=storms with the shard loaders stubbed: a shard that will not load
// is an error part (a caveat), never zeros, and nothing is fetched. No network.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));
vi.mock("@/lib/hazards/stormShards", () => ({
  STORM_LOADERS: {},
  loadStormShard: async (state: string) => {
    throw new Error(`no storm-events shard for state ${state}`);
  },
}));

const { GET } = await import("./route");

describe("op=history&part=storms with a missing shard", () => {
  it("answers 200 with the storms part unknown, not empty, and asks nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(new NextRequest("http://localhost/api/hazards?op=history&fips=48453&part=storms"));
    const body = (await res.json()) as { data: { storms: unknown; series: unknown[]; missing: Array<{ source: string; reason: string }> }; caveats: string[] };
    expect(res.status).toBe(200);
    expect(body.data.storms).toBeNull();
    expect(body.data.series).toEqual([]);
    expect(body.data.missing).toEqual([expect.objectContaining({ source: "NCEI Storm Events", reason: "source:failed" })]);
    expect(body.caveats.join(" ")).toMatch(/unknown, not empty/);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
