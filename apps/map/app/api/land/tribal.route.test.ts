// /api/land?op=tribal with BIA's answer replaced by the national capture of 2026-10-17
// (lib/land/fixtures/bia-lar-national.json, fetched with this route's exact query): the query,
// the small-part rule applied before the answer leaves the server, the count in the caveat,
// and the Oklahoma line. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import lar from "@/lib/land/fixtures/bia-lar-national.json";
import { BIA_LAR_LAYER, TRIBAL_FIELDS } from "@/lib/land/tribal";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

const { GET } = await import("./route");

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (!String(url).startsWith(`${BIA_LAR_LAYER}/query?`)) throw new Error(`unexpected request ${url}`);
      return new Response(JSON.stringify(lar), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Body = { data: { features: Array<{ properties: Record<string, unknown> }> }; count: number; droppedParts: number; keptSmallLargest: number; hiddenAreas: unknown[]; caveats: string[]; provenance: Array<{ source: { id: string } }> };

describe("op=tribal", () => {
  it("asks the five fields at offset 0.01, drops small parts server-side and says how many", async () => {
    const res = await GET(new NextRequest("http://localhost/api/land?op=tribal"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]).searchParams;
    expect(q.get("outFields")).toBe(TRIBAL_FIELDS.join(","));
    expect(q.get("maxAllowableOffset")).toBe("0.01");
    expect(q.get("outSR")).toBe("4326");
    expect(body.count).toBe(335);
    expect(body.droppedParts).toBe(3009 - 82);
    expect(body.keptSmallLargest).toBe(82);
    expect(body.hiddenAreas).toEqual([]);
    const c = body.caveats.join(" ");
    expect(c).toContain("2,927 polygon parts under 0.7 km2 (about the size of a 160-acre allotment) are dropped and not drawn");
    expect(c).toContain("82 parts under 0.7 km2 are drawn, because each is its land area's only or largest part, so no land area disappears");
    expect(c).toMatch(/Nothing here is joined to parcels, names or addresses/);
    expect(c).toMatch(/no Eastern Oklahoma region rows/);
    expect(c).toMatch(/as BIA codes it/);
    expect(body.provenance[0].source.id).toBe("bia-lar");
    for (const f of body.data.features) expect(JSON.stringify(f.properties)).not.toMatch(/@|phone/i);
  });
});
