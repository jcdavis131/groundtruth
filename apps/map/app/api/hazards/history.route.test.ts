// /api/hazards?op=history with every upstream replaced by captures from 2026-10-17
// (lib/hazards/fixtures, unmodified): which upstreams are asked for which county, Connecticut
// asking only USDM, a failing upstream becoming a caveat, a point resolved to its county,
// part=landslide asking nothing, and bad parameters never reaching an upstream. No network.
// Round 8: the NCEI Storm Events part reads the committed Texas shard (lib/hazards/data), so the
// non-storm assertions filter the "se:" series out and the storm ones are checked on their own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import femaTravis from "@/lib/hazards/fixtures/fema-48453.json";
import femaOglala from "@/lib/hazards/fixtures/fema-46102-46113.json";
import dsciTravis from "@/lib/hazards/fixtures/usdm-dsci-48453.json";
import dsciCt from "@/lib/hazards/fixtures/usdm-dsci-09110.json";
import catTravis from "@/lib/hazards/fixtures/usdm-cat-48453.json";
import cagTavg from "@/lib/hazards/fixtures/cag-tx453-tavg.json";
import cagPcp from "@/lib/hazards/fixtures/cag-tx453-pcp.json";
import { CAG_BASE, FEMA_DDS, USDM_API } from "@/lib/hazards/history";
import { TIGER_COUNTY_20M } from "@/lib/hazards/sources";

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
      if (body === 404) return new Response("Not Found", { status: 404 });
      if (body === 503) return new Response("busy", { status: 503 });
      if (body == null) throw new Error(`unexpected request ${url}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const notStorm = (id: string) => !id.startsWith("se:");

type Body = { data: Record<string, unknown> & { series?: Array<{ id: string; points: unknown[] }>; missing?: Array<{ source: string; reason: string }>; landslide?: Record<string, number> | null; fips?: string }; caveats: string[]; provenance: Array<{ source: { id: string } }>; error?: string; ctRegime?: unknown };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/hazards?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}

const travisAnswers = (u: string): unknown => {
  if (u.startsWith(FEMA_DDS)) return femaTravis;
  if (u.startsWith(`${USDM_API}/GetDSCI?aoi=48453`)) return dsciTravis;
  if (u.startsWith(`${USDM_API}/GetDroughtSeverityStatisticsByAreaPercent?aoi=48453`)) return catTravis;
  if (u.startsWith(`${CAG_BASE}/TX-453/tavg/`)) return cagTavg;
  if (u.startsWith(`${CAG_BASE}/TX-453/pcp/`)) return cagPcp;
  return null;
};

describe("op=history", () => {
  it("Travis: five upstream calls (FEMA, USDM x2, CAG x2), seven series plus storm events, the declarations and the landslide row", async () => {
    answer = travisAnswers;
    const { status, body } = await get("op=history&fips=48453");
    expect(status).toBe(200);
    expect(calls).toHaveLength(5);
    expect(body.data.series!.map((s) => s.id).filter(notStorm)).toEqual(["fema:dr:48453", "fema:em:48453", "fema:fm:48453", "usdm:dsci:48453", "cag:tavg:48453", "cag:pcp:48453", "spc:tornadoes:48453"]);
    expect(body.data.series!.map((s) => s.id)).toEqual(expect.arrayContaining(["se:hail:48453", "se:thunderstorm-wind:48453", "se:flash-flood:48453"]));
    const hail = body.data.series!.find((s) => s.id === "se:hail:48453") as unknown as { points: Array<{ t: number; v: number | null }> };
    expect(hail.points.find((p) => p.t === Date.UTC(2025, 0, 1))?.v).toBe(15);
    expect(body.provenance.map((p) => p.source.id)).toContain("ncei-storm-events");
    expect((body.data.declarations as unknown[]).length).toBe(37);
    expect(body.data.landslide).toMatchObject({ prop_susc: 0.361441295 });
    expect(body.provenance.map((p) => p.source.id)).toEqual(expect.arrayContaining(["fema-openfema", "usdm", "noaa-cag", "noaa-spc", "usgs-landslide-susc"]));
    expect(JSON.stringify(body).length).toBeLessThan(4_500_000);
  });

  it("Oglala Lakota: one FEMA call asks for 102 and Shannon's old 113, and the 16 declarations are not a 0", async () => {
    // USDM and CAG answer empty / 404 here; this test is about FEMA's filter and its rows.
    answer = (u) => (u.startsWith(FEMA_DDS) ? femaOglala : u.startsWith(USDM_API) ? [] : u.startsWith(CAG_BASE) ? 404 : null);
    const { status, body } = await get("op=history&fips=46102");
    expect(status).toBe(200);
    const fema = calls.filter((c) => c.startsWith(FEMA_DDS));
    expect(fema).toHaveLength(1);
    expect(decodeURIComponent(fema[0])).toContain("fipsStateCode eq '46' and (fipsCountyCode eq '102' or fipsCountyCode eq '113')");
    expect((body.data.declarations as unknown[]).length).toBe(16);
    const dr = body.data.series!.find((s) => s.id === "fema:dr:46102")!;
    expect(dr.points.length).toBeGreaterThan(0);
    expect(body.caveats.join(" ")).toMatch(/old code 113/);
  });

  it("a Connecticut planning region asks USDM only and says why the rest are missing", async () => {
    answer = (u) => (u.startsWith(`${USDM_API}/GetDSCI?aoi=09110`) ? dsciCt : u.startsWith(`${USDM_API}/GetDroughtSeverityStatisticsByAreaPercent?aoi=09110`) ? [] : null);
    const { status, body } = await get("op=history&fips=09110");
    expect(status).toBe(200);
    expect(calls.every((c) => c.startsWith(USDM_API))).toBe(true);
    expect(calls).toHaveLength(2);
    expect(body.data.series!.map((s) => s.id)).toEqual(["usdm:dsci:09110"]);
    expect(body.data.missing!.map((m) => m.reason)).toEqual(["join:legacy_ct_counties", "join:legacy_ct_counties", "join:legacy_ct_counties", "join:legacy_ct_counties", "join:legacy_ct_counties", "join:legacy_ct_counties"]);
    expect(body.data.missing!.find((m) => m.source === "NCEI Storm Events")?.reason).toBe("join:legacy_ct_counties");
    expect(body.data.storms).toBeNull();
    expect(body.caveats.join(" ")).toMatch(/only drought is shown for planning regions/);
  });

  it("a failing upstream is a caveat, not a 500; a CAG 404 is not-in-release", async () => {
    answer = (u) => (u.startsWith(FEMA_DDS) ? 503 : u.startsWith(CAG_BASE) ? 404 : travisAnswers(u));
    const { status, body } = await get("op=history&fips=48453");
    expect(status).toBe(200);
    expect(body.data.missing!.find((m) => m.source === "FEMA")?.reason).toBe("source:failed");
    expect(body.data.missing!.filter((m) => m.source.startsWith("NOAA Climate")).map((m) => m.reason)).toEqual(["source:not_in_release", "source:not_in_release"]);
    expect(body.caveats.join(" ")).toMatch(/FEMA did not answer this time/);
    expect(body.data.series!.map((s) => s.id).filter(notStorm)).toEqual(["usdm:dsci:48453", "spc:tornadoes:48453"]);
  });

  it("lon/lat resolves the county through TIGERweb; part=landslide asks nothing else", async () => {
    answer = (u) => (u.startsWith(`${TIGER_COUNTY_20M}/query?`) ? { features: [{ attributes: { GEOID: "48453" } }] } : null);
    const { status, body } = await get("op=history&lon=-97.74&lat=30.27&part=landslide");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get("outFields")).toBe("GEOID");
    expect(body.data.fips).toBe("48453");
    expect(body.data.landslide).toMatchObject({ prop_susc: 0.361441295, v2_ls_count: 1 });
    const ct = await get("op=history&fips=09110&part=landslide");
    expect(ct.body.data.landslide).toBeNull();
    expect(ct.body.data.missing).toEqual([{ source: "USGS landslide susceptibility", reason: "join:legacy_ct_counties" }]);
    expect(calls).toHaveLength(1);
  });

  it("part=storms answers the baked Storm Events series alone, asking no upstream", async () => {
    answer = () => null;
    const { status, body } = await get("op=history&fips=48453&part=storms");
    expect(status).toBe(200);
    expect(calls).toHaveLength(0);
    const storms = body.data.storms as { types: Array<{ type: string; points: Array<[number, number]> }> };
    expect(storms.types.find((t) => t.type === "Hail")!.points).toContainEqual([2025, 15]);
    expect(storms.types.map((t) => t.type)).not.toContain("Tornado");
    expect(body.data.series!.every((s) => s.id.startsWith("se:"))).toBe(true);
    expect(body.provenance.map((p) => p.source.id)).toEqual(["ncei-storm-events"]);
    expect(JSON.stringify(body).length).toBeLessThan(60_000);
    const ct = await get("op=history&fips=09110&part=storms");
    expect(ct.body.data.storms).toBeNull();
    expect(ct.body.data.missing).toEqual([{ source: "NCEI Storm Events", reason: "join:legacy_ct_counties" }]);
    const ak = await get("op=history&fips=02020&part=storms");
    expect(ak.body.data.missing).toEqual([{ source: "NCEI Storm Events", reason: "join:ncei_areas_not_counties" }]);
    // San Juan, Puerto Rico: county-coded by municipio from 2009; the earlier area-coded rows are not on it.
    const sj = await get("op=history&fips=72127&part=storms");
    const sjTypes = (sj.body.data.storms as { types: Array<{ points: Array<[number, number]> }> }).types;
    expect(sjTypes.some((t) => t.points.some(([y]) => y >= 2009))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses bad parameters and unknown counties without asking any upstream", async () => {
    answer = () => null;
    for (const qs of ["op=history&fips=48453&part=hcv", "op=history", "op=history&fips=4845", "op=history&fips=48453&lon=-97&lat=30", "op=history&lon=-97", "op=history&fips=48453&years=0", "op=history&fips=48453&years=132", "op=history&fips=48453&declarations=1001", "op=history&fips=48453&part=fema"]) {
      const { status } = await get(qs);
      expect(status, qs).toBe(400);
    }
    for (const fips of ["09001", "02261", "99999"]) {
      const { status, body } = await get(`op=history&fips=${fips}`);
      expect(status, fips).toBe(404);
      expect(body.error).toMatch(/not a current county/);
    }
    expect(calls).toHaveLength(0);
  });
});
