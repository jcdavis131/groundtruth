// /api/permits with every upstream replaced by payloads captured from the
// portals themselves (lib/permits/fixtures): what each op answers, which
// coverage state every city in the box gets, and that a failure is named as
// missing, not absent. No network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import chicagoPermits from "@/lib/permits/fixtures/permits-chicago.json";
import denverPermits from "@/lib/permits/fixtures/permits-denver.json";
import nycLicences from "@/lib/permits/fixtures/licences-nycdcwp.json";
import nysla from "@/lib/permits/fixtures/licences-nysla.json";
import cwaQuery from "@/lib/permits/fixtures/echo-npdes-query.json";
import cwaRows from "@/lib/permits/fixtures/echo-npdes-rows.json";
import airQuery from "@/lib/permits/fixtures/echo-air-query.json";
import airRows from "@/lib/permits/fixtures/echo-air-rows.json";
import orm from "@/lib/permits/fixtures/usace-orm.json";
import emefSems from "@/lib/permits/fixtures/emef-0-houston.json";
import emefTri from "@/lib/permits/fixtures/emef-1-houston.json";
import emefRcra from "@/lib/permits/fixtures/emef-4-houston.json";
import emefAcres from "@/lib/permits/fixtures/emef-5-houston.json";
import emefSemsSv from "@/lib/permits/fixtures/emef-0-sunnyvale.json";
import nplBndSv from "@/lib/permits/fixtures/npl-bnd-sunnyvale.json";
import nplStatusSv from "@/lib/permits/fixtures/npl-status-sunnyvale.json";
import nplStatusNj from "@/lib/permits/fixtures/npl-status-nj.json";
import nplInfo from "@/lib/permits/fixtures/npl-bnd-info.json";
import fuds1 from "@/lib/permits/fixtures/fuds-1-njny.json";
import fuds2 from "@/lib/permits/fixtures/fuds-2-njny.json";
import fuds3 from "@/lib/permits/fixtures/fuds-3-njny.json";
import fuds4 from "@/lib/permits/fixtures/fuds-4-njny.json";
import ust3 from "@/lib/permits/fixtures/ust-3-gulf.json";
import ust2 from "@/lib/permits/fixtures/ust-2-gulf.json";

type F = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };
const asRows = (j: unknown): F[] => (Array.isArray(j) ? j.map((r) => ({ geometry: null, properties: r as Record<string, unknown> })) : (j as { features: F[] }).features);

const calls: string[] = [];
let failHosts: string[] = [];
/** EMEF layers to answer as cut at the record limit (the flag ArcGIS sets), to test the cap note. */
let truncatedLayers: number[] = [];
const emefParams: Array<Record<string, string>> = [];
/** Params of every non-EMEF ArcGIS query, by layer URL. */
const arcParams: Array<{ layer: string; params: Record<string, string> }> = [];

vi.mock("@/lib/server/cache", () => ({
  cached: async <T,>(_k: string, _ttl: number, produce: () => Promise<T>) => ({ value: await produce(), age: 0, hit: false }),
  cacheDelete: () => {},
  DeadlineError: class DeadlineError extends Error {},
}));

vi.mock("@/lib/civic/request", () => ({
  runRows: async (_name: string, req: { kind: string; layer?: string; url?: string; params?: Record<string, string> }) => {
    const url = req.kind === "arcgis" ? req.layer! : req.url!;
    calls.push(url);
    if (failHosts.some((h) => url.includes(h))) throw new Error(`${new URL(url).host} 503`);
    const emef = url.match(/\/EMEF\/efpoints\/MapServer\/(\d)$/);
    if (emef) {
      emefParams.push(req.params ?? {});
      const n = Number(emef[1]);
      // Layer 0 answers the Sunnyvale capture for the Sunnyvale box, Houston's otherwise.
      const sunnyvale = (req.params?.geometry ?? "").includes("-122.05");
      const fc = ({ 0: sunnyvale ? emefSemsSv : emefSems, 1: emefTri, 4: emefRcra, 5: emefAcres } as unknown as Record<number, { features: F[] }>)[n];
      if (!fc) throw new Error(`unexpected EMEF layer ${n}`);
      return { features: fc.features, truncated: truncatedLayers.includes(n) };
    }
    if (url.includes("FAC_Superfund_Site_Boundaries_EPA_Public")) {
      arcParams.push({ layer: url, params: req.params ?? {} });
      return { features: nplBndSv.features as unknown as F[], truncated: false };
    }
    if (url.includes("Superfund_National_Priorities_List")) {
      arcParams.push({ layer: url, params: req.params ?? {} });
      // The list's real rows from both captures, filtered to the IN list as the server would.
      const ids = new Set((req.params?.where.match(/'([A-Z0-9]+)'/g) ?? []).map((x) => x.slice(1, -1)));
      return { features: [...nplStatusSv.features, ...nplStatusNj.features].filter((f) => ids.has(f.properties.Site_EPA_ID)) as unknown as F[], truncated: false };
    }
    const ust = url.match(/\/UST_Finder_Feature_Layer_2eb\/FeatureServer\/(\d)$/);
    if (ust) {
      arcParams.push({ layer: url, params: req.params ?? {} });
      const fc = ({ 2: ust2, 3: ust3 } as unknown as Record<number, { features: F[] }>)[Number(ust[1])];
      if (!fc) throw new Error(`unexpected UST Finder layer ${ust[1]}`);
      return { features: fc.features, truncated: false };
    }
    const fuds = url.match(/\/fuds\/FeatureServer\/(\d)$/);
    if (fuds) {
      arcParams.push({ layer: url, params: req.params ?? {} });
      const fc = ({ 1: fuds1, 2: fuds2, 3: fuds3, 4: fuds4 } as unknown as Record<number, { features: F[] }>)[Number(fuds[1])];
      return { features: fc.features, truncated: false };
    }
    if (url.includes("ydr8-5enu")) return { features: asRows(chicagoPermits), truncated: false };
    if (url.includes("RESIDENTIALCONSTPERMIT")) return { features: asRows(denverPermits), truncated: false };
    if (url.includes("w7w3-xahh")) return { features: asRows(nycLicences), truncated: false };
    if (url.includes("9s3h-dpkz")) return { features: asRows(nysla), truncated: false };
    throw new Error(`unexpected request ${url}`);
  },
  civicJson: async (_name: string, url: string) => {
    calls.push(url);
    if (failHosts.some((h) => url.includes(h))) throw new Error(`${new URL(url).host} 503`);
    if (url.includes("cwa_rest_services.get_facilities")) return cwaQuery;
    if (url.includes("cwa_rest_services.get_qid")) return cwaRows;
    if (url.includes("air_rest_services.get_facilities")) return airQuery;
    if (url.includes("air_rest_services.get_qid")) return airRows;
    if (url.includes("orm-public-api")) return orm;
    if (url.includes("FAC_Superfund_Site_Boundaries_EPA_Public/FeatureServer/0?f=json")) return nplInfo;
    throw new Error(`unexpected request ${url}`);
  },
}));

const { GET } = await import("./route");

type Body = Record<string, unknown> & { data: { features: Array<{ properties: Record<string, unknown> }> }; caveats?: string[]; coverage: Array<{ name: string; state: string; count: number | null; reason?: string }> };
async function get(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/permits?${qs}`));
  return { status: res.status, body: (await res.json()) as Body, res };
}

beforeEach(() => {
  calls.length = 0;
  failHosts = [];
  truncatedLayers = [];
  emefParams.length = 0;
  arcParams.length = 0;
});

describe("/api/permits?op=building", () => {
  it("answers Chicago's permits with the city's disclaimer and a covered state", async () => {
    const { status, body } = await get("op=building&bbox=-87.64,41.8775,-87.62,41.8925");
    expect(status).toBe(200);
    expect(body.data.features.length).toBe(20);
    expect(body.days).toBe(30);
    expect(body.coverage).toEqual([expect.objectContaining({ name: "Chicago", state: "covered", count: 20 })]);
    expect(body.caveats?.join(" ")).toContain("The City of Chicago makes no claims");
  });

  it("names Dallas as stale without asking anyone", async () => {
    const { body } = await get("op=building&bbox=-96.805,32.7675,-96.785,32.7825");
    expect(body.data.features).toEqual([]);
    expect(body.coverage).toEqual([expect.objectContaining({ name: "Dallas", state: "stale", count: null })]);
    expect(calls).toEqual([]);
  });

  it("shows Denver's residential permits and names the commercial layer's token", async () => {
    const { body } = await get("op=building&bbox=-105,39.7325,-104.98,39.7475");
    expect(body.coverage.map((c) => [c.name, c.state])).toEqual([
      ["Denver", "covered"],
      ["Denver (commercial)", "token-required"],
    ]);
  });

  it("names a city that failed as missing, and holds the answer briefly", async () => {
    failHosts = ["data.cityofchicago.org"];
    const { body, res } = await get("op=building&bbox=-87.64,41.8775,-87.62,41.8925");
    expect(body.coverage).toEqual([expect.objectContaining({ name: "Chicago", state: "error", count: null })]);
    expect(body.caveats?.join(" ")).toMatch(/missing from this answer, not absent/);
    expect(res.headers.get("cache-control")).toContain("s-maxage=120");
  });

  it("rejects a days window outside 7 to 90 and a malformed box", async () => {
    expect((await get("op=building&bbox=-87.64,41.8775,-87.62,41.8925&days=365")).status).toBe(400);
    expect((await get("op=building&bbox=-87.64,41.8775")).status).toBe(400);
  });
});

describe("/api/permits?op=licences", () => {
  it("answers New York's two registries with the home-business heuristic counted", async () => {
    const { status, body } = await get("op=licences&bbox=-73.9925,40.7425,-73.9775,40.7525");
    expect(status).toBe(200);
    expect(body.coverage.map((c) => c.name).sort()).toEqual(["New York City premises licences", "New York State liquor licences"]);
    expect(body.withheld).toBe(3);
    expect(JSON.stringify(body.data)).not.toContain("[removed from this fixture");
    expect(body.caveats?.join(" ")).toMatch(/heuristic/);
  });
});

describe("/api/permits?op=environmental", () => {
  it("answers ECHO's two programs and the Corps, never relaying the Corps' national total", async () => {
    const { status, body } = await get("op=environmental&bbox=-95.2,29.7,-95,29.8");
    expect(status).toBe(200);
    const byName = Object.fromEntries(body.coverage.map((c) => [c.name, c]));
    expect(byName["EPA ECHO, Clean Water Act (NPDES)"]).toMatchObject({ state: "partial", count: 25 });
    expect(byName["EPA ECHO, Clean Air Act"]).toMatchObject({ state: "partial", count: 25 });
    // The search answered its 300 maximum, 128 of them from elsewhere: the box's 172 are every one there.
    expect(byName["U.S. Army Corps of Engineers, ORM"]).toMatchObject({ state: "covered", count: 172 });
    expect(JSON.stringify(body)).not.toContain("109678");
  });

  it("draws no Corps action outside the box it answers for", async () => {
    const { body } = await get("op=environmental&bbox=-95.2,29.7,-95,29.8");
    const [w, s, e, n] = body.bbox as number[];
    const usace = (body.data.features as unknown as Array<{ geometry: { coordinates: [number, number] }; properties: { program: string } }>).filter((f) => f.properties.program === "usace");
    expect(usace.length).toBe(172);
    for (const f of usace) {
      const [x, y] = f.geometry.coordinates;
      expect(x >= w && x <= e && y >= s && y <= n, `${x},${y}`).toBe(true);
    }
    expect(JSON.stringify(body.data)).not.toContain("[cut from this fixture: a row from outside the box]");
    const prov = (body.provenance as Array<{ source: { id: string }; notes?: string[] }>).find((p) => p.source.id === "usace-orm");
    expect(prov?.notes).toEqual(["172 in the box", "127 more the search answered from outside the box, dropped"]);
  });

  it("keeps the other programs when ECHO fails", async () => {
    failHosts = ["echodata.epa.gov"];
    const { body } = await get("op=environmental&bbox=-95.2,29.7,-95,29.8");
    expect(body.coverage.filter((c) => c.state === "error").length).toBe(2);
    expect(body.coverage.filter((c) => c.state === "error").every((c) => c.count === null)).toBe(true);
    expect(body.data.features.length).toBe(172);
  });

  it("rejects an unknown op", async () => {
    expect((await get("op=coverage")).status).toBe(400);
  });
});

describe("/api/permits?op=contaminants", () => {
  it("answers EPA's Superfund, TRI, RCRA and Brownfields layers, never water (2) or air (3), with named fields only", async () => {
    const { status, body } = await get("op=contaminants&bbox=-95.3,29.7,-95.15,29.8");
    expect(status).toBe(200);
    const layers = calls.filter((u) => u.includes("/EMEF/")).map((u) => u.split("/").pop());
    expect(layers.sort()).toEqual(["0", "1", "4", "5"]);
    for (const p of emefParams) {
      expect(p.outFields).toBe("registry_id,primary_name,pgm_sys_acrnm,pgm_sys_id,facility_url");
      expect(p.outFields).not.toContain("location_address");
      expect(p.resultRecordCount).toBe("1000");
    }
    const byName = Object.fromEntries(body.coverage.map((c) => [c.name, c]));
    expect(byName["EPA SEMS"]).toMatchObject({ state: "covered", count: 1 });
    expect(byName["EPA TRI"]).toMatchObject({ state: "covered", count: 117 });
    expect(byName["EPA RCRA"]).toMatchObject({ state: "covered", count: 617 });
    expect(byName["EPA Brownfields"]).toMatchObject({ state: "covered", count: 24 });
    const sems = body.data.features.find((f) => f.properties.kind === "sems")!;
    expect(sems.properties.name).toBe("SEMS TXN000607093");
    expect((sems.properties as { details?: Record<string, unknown> }).details).toMatchObject({ "facility (as EPA publishes it)": "US OIL RECOVERY", "registry id": "110015665528", "EPA record": "https://enviro.epa.gov/envirofacts/sems/detail-view?id=TXN000607093" });
    expect(JSON.stringify(body.data)).not.toMatch(/location_address/);
    expect(body.caveats?.join(" ")).toMatch(/not a finding of contamination/);
  });

  it("says a program was capped, and names a program that failed as missing", async () => {
    truncatedLayers = [4];
    const capped = await get("op=contaminants&bbox=-95.3,29.7,-95.15,29.8");
    expect(capped.body.coverage.find((c) => c.name === "EPA RCRA")).toMatchObject({ state: "partial", reason: "the first 1,000 of more in this box" });
    expect(capped.body.caveats?.join(" ")).toMatch(/1,000-listing cap/);
    truncatedLayers = [];
    failHosts = ["geopub.epa.gov"];
    const down = await get("op=contaminants&bbox=-95.3,29.7,-95.15,29.8");
    expect(down.status).toBe(200);
    const emef = down.body.coverage.filter((c) => c.name.startsWith("EPA "));
    expect(emef.map((c) => c.name).sort()).toEqual(["EPA Brownfields", "EPA RCRA", "EPA SEMS", "EPA TRI"]);
    expect(emef.every((c) => c.state === "error" && c.count === null)).toBe(true);
    // USACE's FUDS answered: one failing host never fails the others.
    expect(down.body.coverage.filter((c) => c.name.startsWith("USACE")).every((c) => c.state === "covered")).toBe(true);
    expect(down.body.caveats?.join(" ")).toMatch(/missing from this answer, not absent/);
  });
});

describe("/api/permits?op=contaminants: Superfund boundaries and the NPL list", () => {
  const SV = "op=contaminants&bbox=-122.05,37.35,-121.95,37.45";
  type Feat = { properties: { kind?: string; name: string; details: Record<string, unknown>; extra: Record<string, unknown> } };
  const feats = (b: Body) => b.data.features as unknown as Feat[];

  it("sends no polygons without polygons=1, and still joins every Superfund point to the NPL list by EPA ID", async () => {
    const { status, body } = await get(SV);
    expect(status).toBe(200);
    expect(calls.some((u) => u.includes("FAC_Superfund_Site_Boundaries_EPA_Public"))).toBe(false);
    expect(feats(body).some((f) => f.properties.kind === "npl")).toBe(false);
    const sems = feats(body).filter((f) => f.properties.extra.program === "sems");
    expect(sems).toHaveLength(10);
    const amd = sems.find((f) => f.properties.name === "SEMS CAD048634059")!;
    expect(amd.properties.details["NPL list"]).toBe("NPL Site");
    expect((amd.properties.extra.npl as { listed: string }).listed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.coverage.find((c) => c.name === "EPA NPL status list")).toMatchObject({ state: "covered", count: 10 });
    expect(body.caveats?.join(" ")).toMatch(/only with polygons=1/);
  });

  it("with polygons=1 draws the boundaries, named fields only, and keeps a site that is not on the list apart from an unknown one", async () => {
    const { body } = await get(`${SV}&polygons=1`);
    const bnd = arcParams.find((a) => a.layer.includes("FAC_Superfund_Site_Boundaries_EPA_Public"))!;
    expect(bnd.params.where).toBe("EPA_PROGRAM IS NULL OR EPA_PROGRAM LIKE 'Superfund%'");
    expect(bnd.params.outFields).not.toMatch(/CONTACT|TELEPHONE|STREET|ZIP|GIS_AREA|DESCRIPTION|\*/);
    const npl = feats(body).filter((f) => f.properties.kind === "npl");
    expect(npl).toHaveLength(15);
    expect(body.coverage.find((c) => c.name === "EPA Superfund site boundaries")).toMatchObject({ state: "covered", count: 15 });
    // 14 sites in the box, 12 of them on the list.
    expect(body.coverage.find((c) => c.name === "EPA NPL status list")).toMatchObject({ state: "covered", count: 12 });
    const triple = npl.filter((f) => f.properties.name === "Superfund CAN000900265");
    expect(triple).toHaveLength(2);
    expect(triple[0].properties.details["NPL list"]).toBe("not on EPA's NPL status list");
    expect(triple[0].properties.extra.siteFeatures).toBe(2);
    expect(JSON.stringify(body.data)).not.toMatch(/<a |target=/);
  });

  it("says the NPL list is unknown, never 'not listed', when it fails, and keeps every point and boundary", async () => {
    failHosts = ["Superfund_National_Priorities_List"];
    const { status, body } = await get(`${SV}&polygons=1`);
    expect(status).toBe(200);
    expect(body.coverage.find((c) => c.name === "EPA NPL status list")).toMatchObject({ state: "error", count: null });
    const sems = feats(body).filter((f) => f.properties.extra.program === "sems" && f.properties.kind !== "npl");
    expect(sems).toHaveLength(10);
    for (const f of [...sems, ...feats(body).filter((x) => x.properties.kind === "npl")]) {
      expect(f.properties.details["NPL list"]).toMatch(/^unknown/);
      expect("npl" in f.properties.extra).toBe(false);
    }
    expect(feats(body).filter((f) => f.properties.kind === "npl")).toHaveLength(15);
  });

  it("keeps the points when the boundary layer fails", async () => {
    failHosts = ["FAC_Superfund_Site_Boundaries_EPA_Public"];
    const { body } = await get(`${SV}&polygons=1`);
    expect(body.coverage.find((c) => c.name === "EPA Superfund site boundaries")).toMatchObject({ state: "error", count: null });
    expect(feats(body).filter((f) => f.properties.extra.program === "sems")).toHaveLength(10);
  });
});

describe("/api/permits?op=contaminants: Formerly Used Defense Sites", () => {
  const NJNY = "op=contaminants&bbox=-74.1,40.5,-73.9,40.7";
  type Feat = { properties: { kind?: string; name: string; details: Record<string, unknown>; extra: Record<string, unknown> } };
  const fudsOf = (b: Body) => (b.data.features as unknown as Feat[]).filter((f) => f.properties.extra.program === "fuds");

  it("asks property points and projects, never the owner or the narratives, and no polygons without polygons=1", async () => {
    const { body } = await get(NJNY);
    const asked = arcParams.filter((a) => a.layer.includes("/fuds/"));
    expect(asked.map((a) => a.layer.split("/").pop()).sort()).toEqual(["1", "2"]);
    for (const a of asked) expect(a.params.outFields).not.toMatch(/CURRENTOWNER|FEATUREDESCRIPTION|OFFICIALSITENAME|\*/);
    const f = fudsOf(body);
    expect(f).toHaveLength(126);
    expect(f.every((x) => x.properties.extra.shape === "point")).toBe(true);
    expect(body.coverage.find((c) => c.name === "USACE FUDS properties")).toMatchObject({ state: "covered", count: 126 });
    expect(body.coverage.find((c) => c.name === "USACE FUDS projects")).toMatchObject({ state: "covered", count: 72 });
    expect(body.caveats?.join(" ")).toMatch(/Formerly Used Defense Sites inventory/);
  });

  it("with polygons=1 draws boundaries in place of their points, and munitions response sites", async () => {
    const { body } = await get(`${NJNY}&polygons=1`);
    const f = fudsOf(body);
    const by = (s: string) => f.filter((x) => x.properties.extra.shape === s).length;
    expect([by("point"), by("property"), by("mrs")]).toEqual([99, 29, 11]);
    expect(body.coverage.find((c) => c.name === "USACE FUDS properties")).toMatchObject({ count: 99, reason: expect.stringMatching(/drawn as its boundary/) });
    expect(body.coverage.find((c) => c.name === "USACE FUDS property boundaries")).toMatchObject({ state: "covered", count: 29 });
    expect(body.coverage.find((c) => c.name === "USACE FUDS munitions response sites")).toMatchObject({ state: "covered", count: 11 });
  });

  it("says projects are unknown when the project layer fails, and keeps the properties", async () => {
    failHosts = ["fuds/FeatureServer/2"];
    const { body } = await get(NJNY);
    expect(body.coverage.find((c) => c.name === "USACE FUDS projects")).toMatchObject({ state: "error", count: null });
    const f = fudsOf(body);
    expect(f).toHaveLength(126);
    expect(f[0].properties.details.projects).toMatch(/^unknown/);
  });
});

describe("/api/permits?op=ust", () => {
  it("asks the two county layers only, in a 4 degree box, and joins facilities by county name", async () => {
    const { status, body } = await get("op=ust&bbox=-96,28,-92,32");
    expect(status).toBe(200);
    const asked = arcParams.filter((a) => a.layer.includes("UST_Finder")).map((a) => a.layer.split("/").pop()).sort();
    expect(asked).toEqual(["2", "3"]);
    expect(body.bbox).toEqual([-96, 28, -92, 32]);
    expect(body.data.features).toHaveLength(57);
    expect(body.unjoined).toEqual({ releases: 0, facilities: 0 });
    expect(body.coverage.map((c) => [c.name, c.state, c.count])).toEqual([
      ["EPA UST Finder, releases by county", "covered", 57],
      ["EPA UST Finder, facilities by county", "covered", 57],
    ]);
    expect(body.caveats?.join(" ")).toMatch(/Individual sites are not shown because many are private homes/);
  });

  it("keeps the releases and says facilities are unknown when that layer fails, and clamps a big box", async () => {
    failHosts = ["UST_Finder_Feature_Layer_2eb/FeatureServer/2"];
    const { body } = await get("op=ust&bbox=-100,25,-90,35");
    expect((body.bbox as number[])[2] - (body.bbox as number[])[0]).toBeLessThanOrEqual(4);
    expect(body.coverage.find((c) => c.name.includes("facilities"))).toMatchObject({ state: "error", count: null });
    expect(body.data.features[0].properties.details).toMatchObject({ "UST facilities": expect.stringMatching(/^unknown/) });
  });
});

describe("op=tri", () => {
  const triCalls: string[] = [];
  const answerTri = (formR: unknown, formA: unknown) => {
    triCalls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        triCalls.push(u);
        if (!u.startsWith("https://data.epa.gov/dmapservice/tri.tri_reporting_form/")) throw new Error(`unexpected request ${u}`);
        const body = u.includes("/form_type_ind/equals/S/") ? formA : formR;
        return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
  };
  const getTri = async (qs: string) => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest(`http://localhost/api/permits?${qs}`));
    return { status: res.status, body: (await res.json()) as { data: { year: number; rows: Array<Record<string, unknown>>; totals: Array<{ unit: string }>; formA: Array<{ chemical: string }> | null }; caveats: string[] } };
  };

  it("answers the Form R rows and totals per medium and unit, and the Form A list, from the allowlist only", async () => {
    const formR = (await import("@/lib/permits/fixtures/tri-r-91331MCPRD12306-2024.json")).default;
    const formA = (await import("@/lib/permits/fixtures/tri-a-91331MCPRD12306-2024.json")).default;
    // The upstream sends contact columns on every row; give the real rows those column names to prove they never leave.
    const withContacts = (formR as Array<Record<string, unknown>>).map((r) => ({ ...r, certif_name: "stand-in", public_contact_email: "stand-in", technical_phone_ext: "stand-in" }));
    answerTri(withContacts, formA);
    const { status, body } = await getTri("op=tri&trifid=91331MCPRD12306&year=2024");
    expect(status).toBe(200);
    expect(triCalls).toHaveLength(2);
    expect(body.data.year).toBe(2024);
    expect(body.data.rows).toHaveLength(11);
    expect(JSON.stringify(body)).not.toContain("stand-in");
    expect(body.data.formA?.map((f) => f.chemical)).toContain("Methanol");
    expect(body.caveats.join(" ")).toMatch(/pounds and grams are never added/);
    vi.unstubAllGlobals();
  });

  it("tries the year before when the newest complete year holds nothing, and says unknown when Form A fails", async () => {
    // Deer Park's real 2024 rows stand in for "the year before has rows": what is tested is the fallback and the shape.
    const deerPark = (await import("@/lib/permits/fixtures/tri-r-77536DRPRK5900H-2024-trimmed.json")).default;
    triCalls.length = 0;
    const [newest, before] = (await import("@/lib/permits/tri")).triDefaultYears();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        triCalls.push(u);
        if (u.includes("/form_type_ind/equals/S/")) return new Response("busy", { status: 404 });
        const rows = u.includes(`/reporting_year/equals/${before}/`) ? deerPark : [];
        return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const { status, body } = await getTri("op=tri&trifid=77536DRPRK5900H");
    expect(status).toBe(200);
    expect(triCalls.some((u) => u.includes(`/reporting_year/equals/${newest}/`))).toBe(true);
    expect(body.data.formA).toBeNull();
    expect(body.data.rows.length).toBe(24);
    expect(new Set(body.data.totals.map((t) => t.unit))).toEqual(new Set(["Pounds", "Grams"]));
    expect(body.caveats.join(" ")).toMatch(/Form A list did not answer this time/);
    vi.unstubAllGlobals();
  });

  it("refuses a bad facility id or year without asking EPA", async () => {
    answerTri([], []);
    expect((await getTri("op=tri&trifid=77536drprk5900h")).status).toBe(400);
    expect((await getTri("op=tri&trifid=77536DRPRK5900H/../x")).status).toBe(400);
    expect((await getTri("op=tri&trifid=77536DRPRK5900H&year=1986")).status).toBe(400);
    expect((await getTri("op=tri&trifid=77536DRPRK5900H&year=20x4")).status).toBe(400);
    expect((await getTri("op=tri")).status).toBe(400);
    expect(triCalls).toEqual([]);
    vi.unstubAllGlobals();
  });
});
