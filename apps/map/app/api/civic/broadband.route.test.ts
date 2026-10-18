// /api/civic?op=broadband with the FCC BDC layer (via Esri) replaced by answers captured
// 2026-10-17 (lib/civic/fixtures, unmodified): compact county rows with Connecticut's legacy
// counties listed as unmatched, hexagons in a box clamped to 0.3 degrees, one county's place row
// with its shares as named ratios, a 404 for a planning region, and the licence line in
// provenance. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import travis from "@/lib/civic/fixtures/bdc-county-48453.json";
import ct from "@/lib/civic/fixtures/bdc-county-ct.json";
import hexAustin from "@/lib/civic/fixtures/bdc-hex-austin.json";
import { BDC_COUNTY_LAYER, BDC_HEX_LAYER, BDC_ROW_COLUMNS } from "@/lib/civic/broadband";

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

type Body = { data: Record<string, unknown> & { rows?: unknown[][]; columns?: string[]; features?: unknown[]; shares?: Array<{ name: string; formula: string; value: number | null }> }; count: number; unmatched?: string[]; caveats: string[]; provenance: Array<{ source: { id: string }; notes?: string[] }>; error?: string };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/civic?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}
const rows = { ...ct, features: [...(ct as { features: unknown[] }).features, ...(travis as { features: unknown[] }).features] };

describe("op=broadband", () => {
  it("level=county: compact rows in `columns` order, Connecticut's legacy counties unmatched, the licence in provenance", async () => {
    answer = (u) => (u.startsWith(`${BDC_COUNTY_LAYER}/query?`) ? rows : null);
    const { status, body } = await get("op=broadband&level=county");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]).searchParams;
    expect(q.get("returnGeometry")).toBe("false");
    expect(q.get("outFields")).not.toContain("*");
    expect(q.get("outFields")).not.toMatch(/CountyName|StateName/);
    expect(body.data.columns).toEqual([...BDC_ROW_COLUMNS]);
    const t = body.data.rows!.find((r) => r[0] === "48453")!;
    expect(t).toEqual(["48453", 371965, 2869, 1826, 367270, 268206, 345477, 238525, 41, 4740]);
    expect(body.unmatched).toEqual(["09001", "09003", "09005", "09007", "09009", "09011", "09013", "09015"]);
    expect(body.caveats.join(" ")).toMatch(/Esri Master License Agreement/);
    expect(body.provenance[0].source.id).toBe("fcc-bdc-esri");
    expect(body.provenance[0].notes?.join(" ")).toMatch(/Esri Master License Agreement/);
  });

  it("level=hex: BDC's hexagons in a box clamped to 0.3 degrees", async () => {
    answer = (u) => (u.startsWith(`${BDC_HEX_LAYER}/query?`) ? hexAustin : null);
    const { status, body } = await get("op=broadband&level=hex&bbox=-98.5,29.5,-97,31");
    expect(status).toBe(200);
    const g = JSON.parse(new URL(calls[0]).searchParams.get("geometry")!) as { xmin: number; xmax: number; ymin: number; ymax: number };
    expect(g.xmax - g.xmin).toBeLessThanOrEqual(0.3001);
    expect(g.ymax - g.ymin).toBeLessThanOrEqual(0.3001);
    expect(body.count).toBe(33);
    expect(body.caveats.join(" ")).toMatch(/single location/);
  });

  it("level=place: every technology and the shares as named ratios; 404 for a planning region", async () => {
    answer = (u) => (u.startsWith(`${BDC_COUNTY_LAYER}/query?`) ? (new URL(u).searchParams.get("where") === "GEOID='48453'" ? travis : { features: [] }) : null);
    const ok = await get("op=broadband&level=place&fips=48453");
    expect(ok.status).toBe(200);
    expect(ok.body.data.totalLocations).toBe(371965);
    expect(ok.body.data.shares![0]).toMatchObject({ name: "unserved share", formula: "UnservedBSLs / TotalBSLs" });
    const miss = await get("op=broadband&level=place&fips=09110");
    expect(miss.status).toBe(404);
    expect(miss.body.error).toMatch(/legacy counties/);
  });

  it("refuses bad parameters before any request", async () => {
    answer = () => null;
    for (const qs of ["op=broadband&level=tract", "op=broadband&level=hex", "op=broadband&level=place&fips=4845", "op=broadband&level=place&fips=48453'--"]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});
