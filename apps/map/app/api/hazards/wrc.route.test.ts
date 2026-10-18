// /api/hazards?op=wrc with USFS's answers replaced by captures from 2026-10-17
// (lib/hazards/fixtures, unmodified): named fields, attribute rows only for counties with the
// ranks parsed and the published strings kept, community polygons in a clamped box, one GEOID,
// a 404 for a GEOID with no row, and bad parameters never reaching USFS. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import boulder from "@/lib/hazards/fixtures/wrc-county-08013.json";
import blank from "@/lib/hazards/fixtures/wrc-county-blank.json";
import places from "@/lib/hazards/fixtures/wrc-place-boulder-box.json";
import { WRC_COUNTY_LAYER, WRC_PLACE_LAYER } from "@/lib/hazards/wrc";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

const { GET } = await import("./route");

const calls: string[] = [];
let answer: (url: string) => unknown = () => null;
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const body = answer(String(url));
      if (body == null) throw new Error(`unexpected request ${url}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Body = { data: Record<string, unknown> & { rows?: Array<Record<string, unknown>>; features?: unknown[] }; count: number; notRanked?: number; excluded?: number; bbox?: number[]; caveats: string[]; provenance: Array<{ source: { id: string } }>; error?: string };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/hazards?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}
const both = { ...boulder, features: [...(boulder as { features: unknown[] }).features, ...(blank as { features: unknown[] }).features] };

describe("op=wrc", () => {
  it("level=county: attribute rows, named fields, ranks as numbers with the published strings kept, DC not ranked", async () => {
    answer = (u) => (u.startsWith(`${WRC_COUNTY_LAYER}/query?`) ? both : null);
    const { status, body } = await get("op=wrc&level=county");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]).searchParams;
    expect(q.get("f")).toBe("json");
    expect(q.get("returnGeometry")).toBe("false");
    expect(q.get("outFields")).not.toContain("*");
    expect(q.get("outFields")).not.toMatch(/NAME\b|STATE_NAME/);
    const b = body.data.rows!.find((r) => r.geoid === "08013")!;
    expect(b.national).toEqual([97.2, 95.7, 98.7, 98.8]);
    expect((b.raw as Record<string, string>).RISK_NATIO).toBe("97.20%");
    const dc = body.data.rows!.find((r) => r.geoid === "11001")!;
    expect(dc.national).toEqual([null, null, null, null]);
    expect(body.notRanked).toBe(1);
    expect(body.caveats.join(" ")).toMatch(/Not ranked by USFS: 11001/);
    expect(body.provenance[0].source.id).toBe("usfs-wrc");
  });

  it("level=place: community polygons in a box clamped to 1 degree, at most 1,000", async () => {
    answer = (u) => (u.startsWith(`${WRC_PLACE_LAYER}/query?`) ? places : null);
    const { status, body } = await get("op=wrc&level=place&bbox=-107,38,-103,42");
    expect(status).toBe(200);
    const q = new URL(calls[0]).searchParams;
    expect(q.get("resultRecordCount")).toBe("1000");
    const g = JSON.parse(q.get("geometry")!) as { xmin: number; xmax: number; ymin: number; ymax: number };
    expect(g.xmax - g.xmin).toBeLessThanOrEqual(1.0001);
    expect(g.ymax - g.ymin).toBeLessThanOrEqual(1.0001);
    expect(body.count).toBe(23);
    expect(body.excluded).toBe(1);
  });

  it("level=fips: one county, and a 404 'not in this release' for a GEOID with no row", async () => {
    answer = (u) => (u.startsWith(`${WRC_COUNTY_LAYER}/query?`) ? (new URL(u).searchParams.get("where") === "GEOID='08013'" ? boulder : { features: [] }) : null);
    const ok = await get("op=wrc&level=fips&fips=08013");
    expect(ok.status).toBe(200);
    expect((ok.body.data.ranks as Array<Record<string, unknown>>)[0]).toMatchObject({ measure: "RISK_NATIONAL_RANK", national: 97.2, publishedNational: "97.20%" });
    const miss = await get("op=wrc&level=fips&fips=72001");
    expect(miss.status).toBe(404);
    expect(miss.body.error).toMatch(/^not in this release/);
  });

  it("refuses bad parameters before any request", async () => {
    answer = () => null;
    for (const qs of ["op=wrc&level=state", "op=wrc&level=place", "op=wrc&level=fips&fips=0801", "op=wrc&level=fips&fips=08013'--"]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});
