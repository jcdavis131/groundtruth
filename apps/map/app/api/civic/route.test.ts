// /api/civic?op=health with data.cdc.gov replaced by answers captured 2026-10-16
// (lib/civic/fixtures; the whole-measure pull trimmed to seven Northeast states, values as
// CDC sent them): what each level asks, the compact rows, the national breaks, a county
// that fails reading unknown, and bad parameters never reaching CDC. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import northeast from "@/lib/civic/fixtures/places-county-diabetes-northeast-trimmed.json";
import tracts from "@/lib/civic/fixtures/places-tract-09110-diabetes.json";
import travis from "@/lib/civic/fixtures/places-county-48453-all.json";
import sviCounties from "@/lib/civic/fixtures/svi-county-ct-tx.json";
import sviTracts from "@/lib/civic/fixtures/svi-tract-austin.json";
import sviTravis from "@/lib/civic/fixtures/svi-place-48453.json";
import sviNone from "@/lib/civic/fixtures/svi-place-none.json";
import ncesAustin from "@/lib/civic/fixtures/nces-box-austin.json";

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
}));

const { GET } = await import("./route");

const calls: string[] = [];
let answer: (url: string) => Response | null = () => null;
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const r = answer(String(url));
      if (!r) throw new Error(`unexpected ${url}`);
      return r;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Body = { data: { rows?: Array<Record<string, unknown>>; values?: unknown[] }; count: number; breaks?: number[]; coverage?: Array<{ county: string; state: string; count: number | null }>; caveats: string[] };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/civic?${qs}`));
  return { status: res.status, body: (await res.json()) as Body };
}

describe("op=health", () => {
  it("level=county: one whole-measure pull, compact rows, national quintile breaks", async () => {
    answer = (u) => (u.startsWith("https://data.cdc.gov/resource/swc5-untb.json?") ? json(northeast) : null);
    const { status, body } = await get("op=health&level=county&measure=DIABETES");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const q = new URL(calls[0]).searchParams;
    expect(q.get("measureid")).toBe("DIABETES");
    expect(q.get("datavaluetypeid")).toBe("AgeAdjPrv");
    expect(body.count).toBe(135);
    expect(body.data.rows!.find((r) => r.fips === "09110")).toEqual({ fips: "09110", name: "Capitol", state: "CT", value: 9.2, low: 8.4, high: 10, year: 2023, population: 975328 });
    expect(body.breaks).toHaveLength(4);
    expect(body.caveats.join(" ")).toMatch(/not counts of diagnosed people/);
  });

  it("level=tract: one countyfips query per county, and a county that fails is unknown, not missing", async () => {
    answer = (u) => {
      if (!u.startsWith("https://data.cdc.gov/resource/cwsq-ngmh.json?")) return null;
      const where = new URL(u).searchParams.get("$where") ?? "";
      return where.includes("countyfips='09110'") ? json(tracts) : new Response("{}", { status: 400 });
    };
    const { status, body } = await get("op=health&level=tract&measure=DIABETES&counties=09120,09110");
    expect(status).toBe(200);
    expect(calls).toHaveLength(2);
    for (const u of calls) expect(u).not.toContain("within_box");
    expect(body.count).toBe(246);
    expect(body.coverage).toEqual([
      { county: "09110", state: "covered", count: 246 },
      { county: "09120", state: "error", count: null },
    ]);
    expect(body.caveats.join(" ")).toMatch(/09120 this time: its tracts are unknown/);
  });

  it("level=place: every measure for one county", async () => {
    answer = (u) => (new URL(u).searchParams.get("locationid") === "48453" ? json(travis) : null);
    const { status, body } = await get("op=health&level=place&fips=48453");
    expect(status).toBe(200);
    expect(body.data.values).toHaveLength(33);
  });

  it("refuses an unknown measure, a seventh county or a bad FIPS without asking", async () => {
    answer = () => json([]);
    for (const qs of ["op=health&measure=HAPPINESS", "op=health&level=tract&measure=DIABETES&counties=1,2", "op=health&level=tract&measure=DIABETES&counties=01001,01003,01005,01007,01009,01011,01013", "op=health&level=place&fips=4845", "op=ejscreen"]) {
      expect((await get(qs)).status, qs).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

// op=svi with CDC's ArcGIS service replaced by answers captured 2026-10-16 (lib/civic/fixtures,
// unmodified): Connecticut's nine planning regions plus Travis and Bexar, an Austin tract box,
// Travis County's place row, and a FIPS CDC has no row for.

const SVI = "https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/arcgis/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer";
type SviBody = { data: { rows?: Array<{ fips: string; rpl: Array<number | null>; flags: number | null }>; features?: unknown[]; fips?: string; row?: { rpl: number[] }; measures?: Record<string, { estimate: number | null }> }; count: number; breaks?: number[]; caveats: string[]; provenance: Array<{ source: { id: string } }>; error?: string };
async function getSvi(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/civic?${qs}`));
  return { status: res.status, body: (await res.json()) as SviBody };
}

describe("op=svi", () => {
  it("level=county: attributes only, named fields, ordered for paging, compact rows on fixed breaks", async () => {
    answer = (u) => (u.startsWith(`${SVI}/1/query?`) ? json(sviCounties) : null);
    const { status, body } = await getSvi("op=svi&level=county");
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    const p = new URL(calls[0]).searchParams;
    expect(p.get("returnGeometry")).toBe("false");
    expect(p.get("orderByFields")).toBe("FIPS");
    expect(p.get("outFields")).toBe("FIPS,COUNTY,STATE,ST_ABBR,RPL_THEMES,RPL_THEME1,RPL_THEME2,RPL_THEME3,RPL_THEME4,F_TOTAL");
    expect(body.count).toBe(11);
    expect(body.breaks).toEqual([0.25, 0.5, 0.75]);
    expect(body.data.rows!.find((r) => r.fips === "48453")).toMatchObject({ rpl: [0.5702, 0.5527, 0.0935, 0.882, 0.7805], flags: 2 });
    expect(body.data.rows!.filter((r) => r.fips.startsWith("09")).map((r) => r.fips)).toEqual(["09110", "09120", "09130", "09140", "09150", "09160", "09170", "09180", "09190"]);
    expect(body.provenance[0].source.id).toBe("cdc-svi");
    expect(body.caveats.join(" ")).toContain("not FEMA's social vulnerability");
    expect(body.caveats.join(" ")).toContain("describes itself as the 2020 SVI");
  });

  it("level=tract: SVI's own polygons in a snapped box of at most 0.4 degrees", async () => {
    answer = (u) => (u.startsWith(`${SVI}/2/query?`) ? json(sviTracts) : null);
    const { status, body } = await getSvi("op=svi&level=tract&bbox=-97.76,30.25,-97.72,30.29");
    expect(status).toBe(200);
    const p = new URL(calls[0]).searchParams;
    expect(p.get("returnGeometry")).toBe("true");
    expect(p.get("outSR")).toBe("4326");
    expect(JSON.parse(p.get("geometry")!)).toEqual({ xmin: -97.8, ymin: 30.25, xmax: -97.7, ymax: 30.3 });
    expect(body.data.features).toHaveLength(27);
  });

  it("level=place: one row with the 16 estimates; a FIPS CDC has no row for is a 404, never an empty success", async () => {
    answer = (u) => (u.startsWith(`${SVI}/1/query?`) ? json(new URL(u).searchParams.get("where") === "FIPS='48453'" ? sviTravis : sviNone) : null);
    const ok = await getSvi("op=svi&level=place&fips=48453");
    expect(ok.status).toBe(200);
    expect(ok.body.data.fips).toBe("48453");
    expect(ok.body.data.row!.rpl[0]).toBe(0.5702);
    expect(Object.keys(ok.body.data.measures!)).toHaveLength(16);
    expect(ok.body.data.measures!.POV150.estimate).toBe(17.3);
    const miss = await getSvi("op=svi&level=place&fips=99999");
    expect(miss.status).toBe(404);
    expect(miss.body.error).toMatch(/^not in this release/);
  });

  it("refuses a bad level, box or FIPS before asking CDC", async () => {
    for (const qs of ["op=svi&level=state", "op=svi&level=tract", "op=svi&level=tract&bbox=-97,30,-98,31", "op=svi&level=place&fips=4845", "op=svi&level=place&fips=48453'--"]) {
      expect((await getSvi(qs)).status, qs).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

// op=schools with NCES's MapServer replaced by the Austin box captured 2026-10-17, unmodified.
const NCES = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1/query?";
describe("op=schools", () => {
  it("asks a snapped civic box with named fields, no race or sex cell, and sends built points", async () => {
    answer = (u) => (u.startsWith(NCES) ? json(ncesAustin) : null);
    const res = await GET(new NextRequest("http://localhost/api/civic?op=schools&bbox=-97.76,30.25,-97.72,30.29"));
    const body = (await res.json()) as { data: { features: Array<{ properties: { id: string; layer: string } }> }; bbox: number[]; count: number; hidden: number; caveats: string[]; provenance: Array<{ source: { id: string } }> };
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const p = new URL(calls[0]).searchParams;
    expect(p.get("outFields")).not.toMatch(/(^|,)(AM|AS|BL|HI|HP|TR|WH)|ALM|ALF|PHONE|TOTMENROL|TOTFENROL/);
    expect(JSON.parse(p.get("geometry")!)).toEqual({ xmin: -97.8, ymin: 30.25, xmax: -97.7, ymax: 30.3 });
    expect(body.bbox).toEqual([-97.8, 30.25, -97.7, 30.3]);
    expect(body.count).toBe(11);
    expect(body.hidden).toBe(0);
    expect(body.data.features[0].properties.layer).toBe("schools");
    expect(body.provenance[0].source.id).toBe("nces-edge-public");
    expect(body.caveats.join(" ")).toContain("no race, sex or grade-level enrollment cell");
  });

  it("refuses a missing or inverted box before asking NCES", async () => {
    for (const qs of ["op=schools", "op=schools&bbox=-97,30,-98,31"]) expect((await getSvi(qs)).status, qs).toBe(400);
    expect(calls).toEqual([]);
  });
});
