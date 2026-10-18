// /api/water?op=impaired with fetch replaced by EPA ATTAINS answers captured
// 2026-10-13 (lib/water/fixtures): the where clause and named fields asked
// for, the grid box, the cap note, and that a failed layer reads unknown, not
// none. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import lines from "@/lib/water/fixtures/attains-1-baltimore.json";
import areas from "@/lib/water/fixtures/attains-2-baltimore.json";
import cwsRows from "@/lib/water/fixtures/cws-collegeville.json";
import cwsGeom from "@/lib/water/fixtures/cws-collegeville-geom.json";
import patCentroid from "@/lib/water/fixtures/pat-centroid-collegeville.json";
import patResults from "@/lib/water/fixtures/pat-results-collegeville.json";
import nldiPos from "@/lib/water/fixtures/nldi-position-boise.json";
import nldiOcean from "@/lib/water/fixtures/nldi-position-ocean.json";
import nldiDm from "@/lib/water/fixtures/nldi-dm-boise.json";
import nldiGauges from "@/lib/water/fixtures/nldi-ut-gauges-boise.json";
import nldiBasin from "@/lib/water/fixtures/nldi-basin-boise.json";
import epaV21 from "@/lib/water/fixtures/epa-v21-boise.json";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

const { GET } = await import("./route");

const calls: string[] = [];
let answer: (url: string) => Response | null = () => null;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  answer = () => null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      const r = answer(u);
      if (!r) throw new Error(`unexpected request ${u}`);
      return r;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Body = { data: { features: Array<{ properties: { name: string; details: Record<string, unknown> } }> }; bbox: number[]; coverage: Array<{ id: string; state: string; count: number | null }>; caveats: string[] };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/water?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}
const ATT = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/ATTAINS_Assessment/FeatureServer";

describe("op=impaired", () => {
  it("asks both ATTAINS layers for impaired units only, named fields, in the snapped box", async () => {
    answer = (u) => (u.startsWith(`${ATT}/1/query?`) ? json(lines) : u.startsWith(`${ATT}/2/query?`) ? json(areas) : null);
    const { status, body } = await get("op=impaired&bbox=-76.62,39.26,-76.58,39.30");
    expect(status).toBe(200);
    expect(calls).toHaveLength(2);
    for (const u of calls) {
      const p = new URL(u).searchParams;
      expect(p.get("where")).toBe("isimpaired='Y'");
      expect(p.get("outFields")).toBe("assessmentunitidentifier,assessmentunitname,state,organizationname,reportingcycle,ircategory,overallstatus,on303dlist,hastmdl,waterbodyreportlink,cyclestatus");
      expect(p.get("resultRecordCount")).toBe("2000");
      expect(JSON.parse(p.get("geometry")!)).toEqual({ xmin: -76.62, ymin: 39.26, xmax: -76.58, ymax: 39.3 });
    }
    expect(body.bbox).toEqual([-76.62, 39.26, -76.58, 39.3]);
    expect(body.data.features).toHaveLength(7);
    expect(body.coverage).toEqual([
      expect.objectContaining({ id: "lines", state: "covered", count: 2 }),
      expect.objectContaining({ id: "areas", state: "covered", count: 5 }),
    ]);
    expect(body.caveats.join(" ")).toMatch(/not the same as clean/);
  });

  it("reads a failed layer as unknown, not none, and refuses a bad box without asking", async () => {
    answer = (u) => (u.startsWith(`${ATT}/1/query?`) ? json(lines) : u.startsWith(`${ATT}/2/query?`) ? new Response("busy", { status: 404 }) : null);
    const { status, body } = await get("op=impaired&bbox=-76.62,39.26,-76.58,39.30");
    expect(status).toBe(200);
    expect(body.coverage.find((c) => c.id === "areas")).toMatchObject({ state: "error", count: null });
    expect(body.caveats.join(" ")).toMatch(/area layer did not answer this time; impaired lakes, estuaries and watersheds here are unknown, not absent/);
    calls.length = 0;
    expect((await get("op=impaired&bbox=-76.58,39.26,-76.62,39.30")).status).toBe(400);
    expect((await get("op=impaired&bbox=,39.26,-76.58,39.30")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("says when a layer hit the record limit", async () => {
    answer = (u) => (u.startsWith(`${ATT}/1/query?`) ? json({ ...lines, properties: { exceededTransferLimit: true } }) : u.startsWith(`${ATT}/2/query?`) ? json(areas) : null);
    const { body } = await get("op=impaired&bbox=-76.62,39.26,-76.58,39.30");
    expect(body.coverage.find((c) => c.id === "lines")?.state).toBe("partial");
    expect(body.caveats.join(" ")).toMatch(/lines: the first 2,000 in this box; zoom in/);
  });
});

// PFAS (UCMR 5): fetch answered with the Collegeville captures (2026-10-15) for the route's snapped box.
const CWS = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query?";
const PATQ = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/PFAS_Analytic_Tools_Layers/FeatureServer/1/query?";

describe("op=pfas", () => {
  type PBody = Body & { systems: Record<string, number>; notDrawn: Array<{ pwsid: string; state: string }>; polygons: boolean };
  const pfas = (fail: { results?: boolean; cws?: boolean } = {}) => (u: string) => {
    if (u.startsWith(CWS)) {
      if (fail.cws) return new Response("busy", { status: 503 });
      return json(new URL(u).searchParams.get("returnGeometry") === "true" ? cwsGeom : cwsRows);
    }
    if (u.startsWith(PATQ)) {
      const where = new URL(u).searchParams.get("where") ?? "";
      if (where.includes("F_PWS_ID IN")) return fail.results ? new Response("busy", { status: 404 }) : json(patResults);
      return json(patCentroid);
    }
    return null;
  };

  it("asks service areas first, then estimated locations, then UCMR 5 results by PWSID, and answers the four states", async () => {
    answer = pfas();
    const { status, body } = (await get("op=pfas&bbox=-75.55,40.13,-75.40,40.25")) as { status: number; body: PBody };
    expect(status).toBe(200);
    expect(body.bbox).toEqual([-75.54, 40.12, -75.4, 40.26]);
    expect(calls.filter((u) => u.startsWith(CWS))).toHaveLength(1);
    expect(new URL(calls.find((u) => u.startsWith(CWS))!).searchParams.get("returnGeometry")).toBe("false");
    const results = calls.filter((u) => u.startsWith(PATQ) && u.includes("F_PWS_ID+IN"));
    expect(results).toHaveLength(1);
    const where = new URL(results[0]).searchParams.get("where")!;
    expect(where).toContain("Result_At_or_Above_UCMR_MRL IS NOT NULL");
    expect(where).toContain("'PA1460073'");
    for (const u of calls) expect(u).not.toMatch(/HBSL|Facility_Name|Sample_Point/);
    expect(body.systems).toEqual({ detected: 9, "not-detected": 0, "not-in-ucmr5": 7, unknown: 0 });
    expect(body.data.features).toHaveLength(9);
    expect(body.notDrawn).toHaveLength(7);
    expect(body.coverage.map((c) => [c.id, c.state, c.count])).toEqual([
      ["service-areas", "covered", 16],
      ["estimated-locations", "covered", 5],
      ["results", "covered", 9],
    ]);
    expect(body.caveats.join(" ")).toMatch(/not at any tap/);
  });

  it("with polygons=1 draws every system on its service area", async () => {
    answer = pfas();
    const { body } = (await get("op=pfas&bbox=-75.55,40.13,-75.40,40.25&polygons=1")) as { status: number; body: PBody };
    expect(body.polygons).toBe(true);
    expect(body.data.features).toHaveLength(16);
    expect(body.notDrawn).toEqual([]);
    const aqua = body.data.features.find((f) => f.properties.name === "PWS PA1460073")!;
    expect(aqua.properties.details["UCMR 5"]).toMatch(/^PFAS at or above/);
  });

  it("reads every system unknown, never not-detected, when the results do not answer", async () => {
    answer = pfas({ results: true });
    const { status, body } = (await get("op=pfas&bbox=-75.55,40.13,-75.40,40.25")) as { status: number; body: PBody };
    expect(status).toBe(200);
    expect(body.systems).toEqual({ detected: 0, "not-detected": 0, "not-in-ucmr5": 0, unknown: 16 });
    expect(body.coverage.find((c) => c.id === "results")).toMatchObject({ state: "error", count: null });
    expect(body.caveats.join(" ")).toMatch(/"unknown", never "not detected"/);
  });

  it("keeps the systems EPA places by estimated location when the service areas fail", async () => {
    answer = pfas({ cws: true });
    const { status, body } = (await get("op=pfas&bbox=-75.55,40.13,-75.40,40.25")) as { status: number; body: PBody };
    expect(status).toBe(200);
    expect(body.coverage.find((c) => c.id === "service-areas")).toMatchObject({ state: "error", count: null });
    expect(body.systems.detected).toBe(5);
  });

  it("refuses a bad box without asking", async () => {
    answer = pfas();
    expect((await get("op=pfas&bbox=-75.4,40.13,-75.55,40.25")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

// NLDI and EPA answers captured 2026-10-16 at the Boise River, unmodified (lib/water/fixtures/nldi-*, epa-v21-*).
const NLDI = "https://api.water.usgs.gov/nldi/linked-data";
const EPA = "https://watersgeo.epa.gov/arcgis/rest/services/NHDPlus/NHDPlus/MapServer/2/query?";
const status404 = (body: unknown) => new Response(JSON.stringify(body), { status: 404, headers: { "content-type": "application/json" } });
type RBody = { data: { comid: number | null; reach: { name: string | null; flowCfs: number | null } | null; type?: string; features?: Array<{ geometry: { type: string }; properties: Record<string, unknown> }> }; meta?: { distanceKm?: number | null; count?: number }; distanceKm?: number | null; count?: number; caveats: string[]; provenance: Array<{ source: { id: string } }> };

describe("op=reach", () => {
  it("asks NLDI for the catchment at the snapped point, then EPA V2.1 by comid with lowercase fields", async () => {
    answer = (u) => (u.startsWith(`${NLDI}/comid/position?`) ? json(nldiPos) : u.startsWith(EPA) ? json(epaV21) : null);
    const { status, body } = (await get("op=reach&lon=-116.20231&lat=43.61504")) as unknown as { status: number; body: RBody };
    expect(status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[0])).toContain("POINT(-116.202 43.615)");
    const q = new URL(calls[1]).searchParams;
    expect(q.get("where")).toBe("comid=23398863");
    expect(q.get("outFields")).toBe(q.get("outFields")!.toLowerCase());
    expect(body.data.comid).toBe(23398863);
    expect(body.data.reach).toMatchObject({ name: "Boise River" });
    expect(body.provenance.map((p) => p.source.id)).toEqual(["usgs-nldi", "epa-nhdplus-v21"]);
    expect(body.caveats.join(" ")).toMatch(/model estimate, not a measurement/);
  });

  it("answers 'no reach here' (comid null, 200) where NLDI has no catchment, and never asks EPA", async () => {
    answer = (u) => (u.startsWith(`${NLDI}/comid/position?`) ? status404(nldiOcean) : null);
    const { status, body } = (await get("op=reach&lon=-70&lat=40")) as unknown as { status: number; body: RBody };
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ comid: null, reach: null });
    expect(calls).toHaveLength(1);
    expect(body.caveats.join(" ")).toMatch(/no reach here, not an error/);
  });

  it("keeps the comid with unknown attributes when EPA does not answer", async () => {
    answer = (u) => (u.startsWith(`${NLDI}/comid/position?`) ? json(nldiPos) : u.startsWith(EPA) ? new Response("no", { status: 400 }) : null);
    const { status, body } = (await get("op=reach&lon=-116.2023&lat=43.6150")) as unknown as { status: number; body: RBody };
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ comid: 23398863, reach: null });
    expect(body.caveats.join(" ")).toMatch(/unknown, not absent/);
  });

  it("refuses a missing point", async () => {
    expect((await get("op=reach&lon=-116.2")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("op=trace", () => {
  it("sends the default distance and makes the main stem one line set", async () => {
    answer = (u) => (u.startsWith(`${NLDI}/comid/23398863/navigation/DM/flowlines?`) ? json(nldiDm) : null);
    const { status, body } = (await get("op=trace&comid=23398863&mode=down")) as unknown as { status: number; body: RBody };
    expect(status).toBe(200);
    expect(new URL(calls[0]).searchParams.get("distance")).toBe("100");
    expect(body.data.features).toHaveLength(1);
    expect(body.data.features![0].geometry.type).toBe("MultiLineString");
    expect(body.count).toBe(79);
    expect(body.caveats.join(" ")).toMatch(/not the watersheds/);
  });

  it("lists the gauges upstream within the asked distance, capped at 500 km", async () => {
    answer = (u) => (u.startsWith(`${NLDI}/comid/23398863/navigation/UT/nwissite?`) ? json(nldiGauges) : null);
    const { body } = (await get("op=trace&comid=23398863&mode=gauges&distance=900")) as unknown as { status: number; body: RBody };
    expect(new URL(calls[0]).searchParams.get("distance")).toBe("500");
    expect(body.distanceKm).toBe(500);
    expect(body.data.features).toHaveLength(128);
    expect(body.data.features![0].properties).toMatchObject({ identifier: "USGS-13186000", siteNo: "13186000" });
  });

  it("returns NLDI's simplified basin as one polygon", async () => {
    answer = (u) => (u.startsWith(`${NLDI}/comid/23398863/basin?`) ? json(nldiBasin) : null);
    const { body } = (await get("op=trace&comid=23398863&mode=basin")) as unknown as { status: number; body: RBody };
    expect(new URL(calls[0]).searchParams.get("simplified")).toBe("true");
    expect(body.data.features![0].geometry.type).toBe("Polygon");
    expect(body.data.features![0].properties.vertices).toBe(793);
  });

  it("refuses a bad comid, mode or distance without asking", async () => {
    for (const qs of ["op=trace&mode=down", "op=trace&comid=abc&mode=down", "op=trace&comid=23398863&mode=sideways", "op=trace&comid=23398863&mode=down&distance=-5"]) {
      expect((await get(qs)).status, qs).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});
