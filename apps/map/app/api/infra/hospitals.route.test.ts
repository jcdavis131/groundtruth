// /api/infra?op=hospitals with FEMA's answers replaced by captures from 2026-10-17
// (lib/infra/fixtures, unmodified): a box gets the full record with named fields and no
// telephone; a wide box gets the national short record, paged on FEMA's
// exceededTransferLimit (Rhode Island's open hospitals in pages of 10 stand in for the
// national pages of 2,000, which the route asks by resultOffset) sent as packed rows;
// status=all drops the open filter. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import box from "@/lib/infra/fixtures/hosp-box-austin.json";
import ri0 from "@/lib/infra/fixtures/hosp-national-ri-p0.json";
import ri1 from "@/lib/infra/fixtures/hosp-national-ri-p1.json";
import ri2 from "@/lib/infra/fixtures/hosp-national-ri-p2.json";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

const { GET } = await import("./route");

const H = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Hospitals_RAPT/FeatureServer/6/query?";
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

type Body = { data: { features?: Array<{ properties: { id: string; details: Record<string, string> } }>; columns?: string[]; rows?: unknown[][] }; national: boolean; status: string; count: number; truncated: boolean; caveats: string[]; provenance: Array<{ source: { id: string } }> };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/infra?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}

describe("op=hospitals", () => {
  it("a box: the full record, open only, named fields, never a telephone", async () => {
    answer = (u) => (u.startsWith(H) ? box : null);
    const { status, body } = await get("op=hospitals&bbox=-97.8,30.2,-97.65,30.4");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const p = new URL(calls[0]).searchParams;
    expect(p.get("where")).toBe("STATUS='OPEN'");
    expect(p.get("outFields")).toContain("SOURCEDATE");
    expect(p.get("outFields")).not.toMatch(/TELEPHONE|TTL_STAFF/);
    expect(body.national).toBe(false);
    expect(body.count).toBe(17);
    expect(body.data.features![0].properties.details.address).toBeDefined();
    expect(body.provenance[0].source.id).toBe("hifld-hospitals");
    expect(body.caveats.join(" ")).toContain("last public copy");
    // An open-only answer holds no closed rows to count, so its caveat carries no closed count.
    expect(body.caveats.join(" ")).toContain("ask status=all for the hospitals HIFLD lists as closed too");
    expect(body.caveats.join(" ")).not.toMatch(/\b374\b/);
  });

  it("a box (round 8): CMS's star rating rides in extra.cms only for the hospitals the bake attached, with CMS provenance", async () => {
    answer = (u) => (u.startsWith(H) ? box : null);
    const { body } = await get("op=hospitals&bbox=-97.8,30.2,-97.65,30.4");
    const feats = body.data.features as unknown as Array<{ properties: { extra: { cms?: { ccn: string; rating: number | null } | null }; details: Record<string, string> } }>;
    const attached = feats.filter((f) => f.properties.extra.cms);
    expect(attached).toHaveLength(6);
    expect(feats.filter((f) => f.properties.extra.cms === null)).toHaveLength(11);
    for (const f of feats) expect(f.properties.details["CMS star rating"]).toBeDefined();
    expect(body.provenance.map((p) => p.source.id)).toEqual(["hifld-hospitals", "cms-provider-data"]);
    expect(body.caveats.join(" ")).toMatch(/joined to HIFLD's hospital by street address and ZIP code \(exactly, or once a PO box or drawer is set aside, ordinal street words are read as numbers and U S as US\)/);
    expect(body.caveats.join(" ")).toMatch(/a match whose HIFLD name or type marks a tenant of another hospital is refused/);
    expect(body.caveats.join(" ")).not.toMatch(/never gets its host's rating/);
    expect(calls).toHaveLength(1);
  });

  it("a wide box: every hospital nationally with the short record, paged until FEMA says the answer is whole", async () => {
    answer = (u) => {
      if (!u.startsWith(H)) return null;
      const off = new URL(u).searchParams.get("resultOffset");
      return off === "0" ? ri0 : off === "2000" ? ri1 : off === "4000" ? ri2 : null;
    };
    const { status, body } = await get("op=hospitals&bbox=-180,-90,180,90");
    expect(status).toBe(200);
    expect(calls).toHaveLength(3);
    const p = new URL(calls[0]).searchParams;
    expect(p.get("outFields")).toBe("ID,NAME,CITY,STATE,TYPE,STATUS,BEDS,TRAUMA,COUNTYFIPS");
    expect(p.get("orderByFields")).toBe("FID");
    expect(body.national).toBe(true);
    expect(body.count).toBe(21);
    expect(body.truncated).toBe(false);
    // Packed rows, not features: 8,140 built features would near the response limit.
    expect(body.data.columns).toEqual(["ID", "NAME", "CITY", "STATE", "TYPE", "STATUS", "BEDS", "TRAUMA", "COUNTYFIPS", "lon", "lat"]);
    expect(body.data.rows![0].slice(0, 9)).toEqual(["0001402906", "BUTLER HOSPITAL", "PROVIDENCE", "RI", "PSYCHIATRIC", "OPEN", 143, "NOT AVAILABLE", "44007"]);
    expect(body.data.features).toBeUndefined();
  });

  it("the layer's 150 km box at Anchorage (5.6 degrees wide) still gets the full record, not the national set", async () => {
    answer = (u) => (u.startsWith(H) ? box : null);
    const { status, body } = await get("op=hospitals&bbox=-152.7,59.85,-147.1,62.55");
    expect(status).toBe(200);
    expect(body.national).toBe(false);
    expect(body.data.features).toBeDefined();
    expect(new URL(calls[0]).searchParams.get("outFields")).toContain("ADDRESS");
  });

  it("status=all drops the open filter; anything else is refused before asking", async () => {
    answer = (u) => (u.startsWith(H) ? box : null);
    await get("op=hospitals&bbox=-97.8,30.2,-97.65,30.4&status=all");
    expect(new URL(calls[0]).searchParams.get("where")).toBe("1=1");
    calls.length = 0;
    expect((await get("op=hospitals&bbox=-97.8,30.2,-97.65,30.4&status=closed")).status).toBe(400);
    expect((await get("op=hospitals")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
